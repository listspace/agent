import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { MAX_FILE_BYTES, fileNameOf, mimeTypeFor, readLocalFile } from '../src/files.js'
import { ITEM_ID, runCli, tempDir, type Sent } from './fake.js'

const level4 = { effective: 4, name: 'Act' }

const attachedBody = (sent: Sent) => {
  const body = sent.body
  const fields = typeof body === 'object' && body !== null ? body : {}
  const filename = 'filename' in fields && typeof fields.filename === 'string' ? fields.filename : 'file'
  return {
    status: 201,
    body: {
      data: {
        outcome: 'applied',
        level: level4,
        undo: null,
        attachment: {
          id: `att-${filename}`,
          item_id: ITEM_ID,
          filename,
          mime_type: 'application/pdf',
          size_bytes: 5,
          created_at: '2026-10-07T10:00:00Z',
          url: 'https://files.example.test/signed',
          url_expires_at: '2026-10-07T10:10:00Z',
          is_cover: false,
          link_preview: null,
        },
      },
    },
  }
}

async function filesIn(names: Record<string, string | Uint8Array>): Promise<string> {
  const dir = await tempDir()
  for (const [name, content] of Object.entries(names)) await writeFile(join(dir, name), content)
  return dir
}

test('mimeTypeFor: known extensions in any case, Markdown as text, unknown and missing refused', () => {
  assert.equal(mimeTypeFor('Report.PDF'), 'application/pdf')
  assert.equal(mimeTypeFor('photo.jpeg'), 'image/jpeg')
  assert.equal(mimeTypeFor('notes.md'), 'text/plain')
  assert.equal(mimeTypeFor('deck.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.equal(mimeTypeFor('setup.exe'), null)
  assert.equal(mimeTypeFor('Makefile'), null)
  assert.equal(mimeTypeFor('.env'), null)
  assert.equal(mimeTypeFor('trailing.'), null)
})

test('fileNameOf takes the last part of a Windows or POSIX path', () => {
  assert.equal(fileNameOf('C:\\Users\\me\\Documents\\plan.pdf'), 'plan.pdf')
  assert.equal(fileNameOf('/home/me/plan.pdf'), 'plan.pdf')
  assert.equal(fileNameOf('plan.pdf'), 'plan.pdf')
})

test('readLocalFile: missing, a folder, too large (checked before reading) and ok', async () => {
  const dir = await filesIn({ 'a.txt': 'hello', 'big.txt': 'x'.repeat(20) })
  await mkdir(join(dir, 'folder.pdf'))
  assert.deepEqual(await readLocalFile(join(dir, 'nope.txt'), 100), { kind: 'missing' })
  assert.deepEqual(await readLocalFile(join(dir, 'folder.pdf'), 100), { kind: 'not_a_file' })
  assert.deepEqual(await readLocalFile(join(dir, 'big.txt'), 10), { kind: 'too_large', sizeBytes: 20 })
  // Over the first size and up to the second: opened, not read
  const large = await readLocalFile(join(dir, 'big.txt'), 10, 20)
  assert.equal(large.kind, 'large')
  assert.equal(large.kind === 'large' ? large.blob.size : 0, 20)
  assert.deepEqual(await readLocalFile(join(dir, 'big.txt'), 10, 19), { kind: 'too_large', sizeBytes: 20 })
  const ok = await readLocalFile(join(dir, 'a.txt'), 100)
  assert.equal(ok.kind, 'ok')
  assert.equal(ok.kind === 'ok' ? Buffer.from(ok.bytes).toString('utf8') : '', 'hello')
})

test('attach uploads each file as base64 with its name and type, and prints what was attached', async () => {
  const dir = await filesIn({ 'plan.pdf': '%PDF-', 'notes.md': '# Notes' })
  const route = `POST /items/${ITEM_ID}/attachments`
  const result = await runCli(['attach', ITEM_ID, join(dir, 'plan.pdf'), join(dir, 'notes.md')], { [route]: attachedBody })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.sent.length, 2)
  assert.deepEqual(result.sent[0]?.body, { filename: 'plan.pdf', mime_type: 'application/pdf', content_base64: Buffer.from('%PDF-').toString('base64') })
  assert.deepEqual(result.sent[1]?.body, { filename: 'notes.md', mime_type: 'text/plain', content_base64: Buffer.from('# Notes').toString('base64') })
  assert.match(result.stdout, /Attached "plan.pdf" \(5 bytes\) to 2222.*att-plan.pdf \(level 4 \(Act\)\)/)
  assert.match(result.stdout, /Attached "notes.md"/)
})

test('attach --json prints the server answers as a data list', async () => {
  const dir = await filesIn({ 'plan.pdf': '%PDF-' })
  const result = await runCli(['attach', ITEM_ID, join(dir, 'plan.pdf'), '--json'], { [`POST /items/${ITEM_ID}/attachments`]: attachedBody })
  assert.equal(result.code, 0, result.stderr)
  const printed: unknown = JSON.parse(result.stdout)
  assert.ok(typeof printed === 'object' && printed !== null && 'data' in printed && Array.isArray(printed.data))
  assert.equal(printed.data.length, 1)
  assert.equal(printed.data[0].attachment.filename, 'plan.pdf')
})

test('attach checks every file before sending anything: type, missing, empty', async () => {
  const dir = await filesIn({ 'ok.pdf': '%PDF-', 'tool.exe': 'MZ', 'empty.txt': '' })

  const wrongType = await runCli(['attach', ITEM_ID, join(dir, 'ok.pdf'), join(dir, 'tool.exe')], {})
  assert.equal(wrongType.code, 2)
  assert.match(wrongType.stderr, /tool\.exe: this type of file cannot be attached\. Allowed: .*pdf/)
  assert.equal(wrongType.sent.length, 0)

  const missing = await runCli(['attach', ITEM_ID, join(dir, 'gone.pdf')], {})
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /gone\.pdf: no such file/)

  const empty = await runCli(['attach', ITEM_ID, join(dir, 'empty.txt')], {})
  assert.equal(empty.code, 2)
  assert.match(empty.stderr, /empty\.txt is empty/)
})

test('attach: a file over 8 MB goes straight to storage: a link with its size, the PUT from disk without the token, then the finish', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'film.mov'), new Uint8Array(MAX_FILE_BYTES + 1))
  const putBodies: number[] = []
  const result = await runCli(['attach', ITEM_ID, join(dir, 'film.mov')], {
    [`POST /items/${ITEM_ID}/upload-links`]: {
      status: 201,
      body: { data: { upload_url: 'https://storage.example.test/private/tmp/abc?X-Amz-Signature=s', finish_url: 'https://api.listspace.app/v1/uploads/lsu_x/' } },
    },
    'PUT /private/tmp/abc': (sent) => {
      putBodies.push(sent.headers.has('authorization') ? -1 : 1)
      return { status: 200 }
    },
    'POST /uploads/lsu_x/': (sent) => ({ ...attachedBody({ ...sent, body: { filename: 'film.mov' } }) }),
  })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Attached "film\.mov"/)
  assert.deepEqual(result.sent.map((s) => `${s.method} ${s.path}`), [`POST /items/${ITEM_ID}/upload-links`, 'PUT /private/tmp/abc', 'POST /uploads/lsu_x/'])
  assert.deepEqual(result.sent[0]?.body, { filename: 'film.mov', size_bytes: MAX_FILE_BYTES + 1 })
  // The storage link and the finish link are the credential: the token goes to neither
  assert.deepEqual(putBodies, [1])
  assert.equal(result.sent[2]?.headers.has('authorization'), false)
})

test('attach: storage refusing the PUT stops with a message, and nothing is finished', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'film.mov'), new Uint8Array(MAX_FILE_BYTES + 1))
  const result = await runCli(['attach', ITEM_ID, join(dir, 'film.mov')], {
    [`POST /items/${ITEM_ID}/upload-links`]: { status: 201, body: { data: { upload_url: 'https://storage.example.test/private/tmp/abc', finish_url: 'https://api.listspace.app/v1/uploads/lsu_x/' } } },
    'PUT /private/tmp/abc': { status: 403 },
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /refused the file \(HTTP 403\)/)
  assert.equal(result.sent.some((s) => s.path === '/uploads/lsu_x/'), false)
})

test('attach usage: needs an item and a file, an item id, and refuses --inbox', async () => {
  const dir = await filesIn({ 'ok.pdf': '%PDF-' })
  assert.equal((await runCli(['attach', ITEM_ID], {})).code, 2)
  const notId = await runCli(['attach', 'Fix the footer', join(dir, 'ok.pdf')], {})
  assert.equal(notId.code, 2)
  assert.match(notId.stderr, /is not an item id/)
  const inbox = await runCli(['attach', ITEM_ID, join(dir, 'ok.pdf'), '--inbox', '--reason', 'x'], {})
  assert.equal(inbox.code, 2)
  assert.match(inbox.stderr, /cannot wait in the Inbox/)
  assert.equal(inbox.sent.length, 0)
})

test('attach: a level below Act is refused with the server message; a later failure names what was attached', async () => {
  const dir = await filesIn({ 'a.pdf': '%PDF-', 'b.pdf': '%PDF-' })
  const route = `POST /items/${ITEM_ID}/attachments`
  const refused = { status: 403, body: { error: { code: 'level_too_low', message: 'Attaching needs level 4 (Act); this board is at level 3 (Capture).' } } }

  const first = await runCli(['attach', ITEM_ID, join(dir, 'a.pdf')], { [route]: refused })
  assert.equal(first.code, 1)
  assert.match(first.stderr, /needs level 4 \(Act\)/)

  let calls = 0
  const second = await runCli(['attach', ITEM_ID, join(dir, 'a.pdf'), join(dir, 'b.pdf'), '--json'], {
    [route]: (sent) => {
      calls += 1
      return calls === 1 ? attachedBody(sent) : refused
    },
  })
  assert.equal(second.code, 1)
  const printed: unknown = JSON.parse(second.stdout)
  assert.ok(typeof printed === 'object' && printed !== null && 'error' in printed)
  assert.match(JSON.stringify(printed.error), /Attached a\.pdf; b\.pdf and the rest were not/)
})
