import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { MAX_FILE_BYTES, fileNameOf, mimeTypeFor, readLocalFile } from '../src/files.js'
import { ApiClient, CliFailure, parseToken, type ApiToken } from '../src/api.js'
import { attachCommand, type FileToAttach } from '../src/commands.js'
import { ITEM_ID, TOKEN, fakeApi, runCli, tempDir, type Reply, type Routes, type Sent } from './fake.js'

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

test('attach: several large files ask for their links in one call, then each is sent and finished', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'a.mov'), new Uint8Array(MAX_FILE_BYTES + 1))
  await writeFile(join(dir, 'b.mov'), new Uint8Array(MAX_FILE_BYTES + 2))
  const result = await runCli(['attach', ITEM_ID, join(dir, 'a.mov'), join(dir, 'b.mov')], {
    'POST /upload-links': {
      status: 201,
      body: { data: {
        links: [
          { index: 0, upload_url: 'https://storage.example.test/private/tmp/a', finish_url: 'https://api.listspace.app/v1/uploads/lsu_a/' },
          { index: 1, upload_url: 'https://storage.example.test/private/tmp/b', finish_url: 'https://api.listspace.app/v1/uploads/lsu_b/' },
        ],
        refused: [],
      } },
    },
    'PUT /private/tmp/a': { status: 200 },
    'PUT /private/tmp/b': { status: 200 },
    'POST /uploads/lsu_a/': (sent) => ({ ...attachedBody({ ...sent, body: { filename: 'a.mov' } }) }),
    'POST /uploads/lsu_b/': (sent) => ({ ...attachedBody({ ...sent, body: { filename: 'b.mov' } }) }),
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.sent.map((s) => `${s.method} ${s.path}`), ['POST /upload-links', 'PUT /private/tmp/a', 'POST /uploads/lsu_a/', 'PUT /private/tmp/b', 'POST /uploads/lsu_b/'])
  assert.deepEqual(result.sent[0]?.body, { files: [
    { item_id: ITEM_ID, filename: 'a.mov', size_bytes: MAX_FILE_BYTES + 1 },
    { item_id: ITEM_ID, filename: 'b.mov', size_bytes: MAX_FILE_BYTES + 2 },
  ] })
})

test('attach: a large file that got no link is named at the end; the others are still sent', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'a.mov'), new Uint8Array(MAX_FILE_BYTES + 1))
  await writeFile(join(dir, 'b.mov'), new Uint8Array(MAX_FILE_BYTES + 2))
  const result = await runCli(['attach', ITEM_ID, join(dir, 'a.mov'), join(dir, 'b.mov')], {
    'POST /upload-links': {
      status: 201,
      body: { data: {
        links: [{ index: 0, upload_url: 'https://storage.example.test/private/tmp/a', finish_url: 'https://api.listspace.app/v1/uploads/lsu_a/' }],
        refused: [{ index: 1, filename: 'b.mov', message: 'You have 20 large files uploading.' }],
      } },
    },
    'PUT /private/tmp/a': { status: 200 },
    'POST /uploads/lsu_a/': (sent) => ({ ...attachedBody({ ...sent, body: { filename: 'a.mov' } }) }),
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Attached a\.mov; not attached: b\.mov \(You have 20 large files uploading\.\)/)
  assert.deepEqual(result.sent.map((s) => `${s.method} ${s.path}`), ['POST /upload-links', 'PUT /private/tmp/a', 'POST /uploads/lsu_a/'])
})

test('attach: files that are small together share one call for their links, each PUT after the one before', async () => {
  const dir = await tempDir()
  const names = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'].map((n) => `${n}.mov`)
  for (const name of names) await writeFile(join(dir, name), new Uint8Array(MAX_FILE_BYTES + 1))
  const routes: Routes = {
    'POST /upload-links': (sent) => {
      const asked = (sent.body as { files: { filename: string }[] }).files
      return { status: 201, body: { data: { links: asked.map((file, index) => ({ index, upload_url: `https://storage.example.test/private/tmp/${file.filename}`, finish_url: `https://api.listspace.app/v1/uploads/lsu_${file.filename}/` })), refused: [] } } }
    },
  }
  for (const name of names) {
    routes[`PUT /private/tmp/${name}`] = { status: 200 }
    routes[`POST /uploads/lsu_${name}/`] = (sent) => ({ ...attachedBody({ ...sent, body: { filename: name } }) })
  }
  const result = await runCli(['attach', ITEM_ID, ...names.map((name) => join(dir, name))], routes)
  assert.equal(result.code, 0, result.stderr)
  const order = result.sent.map((s) => (s.path === '/upload-links' ? `links:${(s.body as { files: unknown[] }).files.length}` : `${s.method}`))
  assert.deepEqual(order, ['links:7', ...Array(7).fill(['PUT', 'POST']).flat()])
})

test('attach: an older server without POST /upload-links gets one link a file', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'a.mov'), new Uint8Array(MAX_FILE_BYTES + 1))
  await writeFile(join(dir, 'b.mov'), new Uint8Array(MAX_FILE_BYTES + 2))
  const single = (name: string): Reply => ({ status: 201, body: { data: { upload_url: `https://storage.example.test/private/tmp/${name}`, finish_url: `https://api.listspace.app/v1/uploads/lsu_${name}/` } } })
  const result = await runCli(['attach', ITEM_ID, join(dir, 'a.mov'), join(dir, 'b.mov')], {
    [`POST /items/${ITEM_ID}/upload-links`]: (sent) => single((sent.body as { filename: string }).filename),
    'PUT /private/tmp/a.mov': { status: 200 },
    'PUT /private/tmp/b.mov': { status: 200 },
    'POST /uploads/lsu_a.mov/': (sent) => ({ ...attachedBody({ ...sent, body: { filename: 'a.mov' } }) }),
    'POST /uploads/lsu_b.mov/': (sent) => ({ ...attachedBody({ ...sent, body: { filename: 'b.mov' } }) }),
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.sent.map((s) => `${s.method} ${s.path}`).filter((p) => p.includes('upload-links')), ['POST /upload-links', `POST /items/${ITEM_ID}/upload-links`, `POST /items/${ITEM_ID}/upload-links`])
})

test('a refused upload call says when to try again, from the body, without a second wait sentence', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'a.mov'), new Uint8Array(MAX_FILE_BYTES + 1))
  const result = await runCli(['attach', ITEM_ID, join(dir, 'a.mov')], {
    [`POST /items/${ITEM_ID}/upload-links`]: {
      status: 429,
      headers: { 'Retry-After': '720' },
      body: { error: { code: 'rate_limited', message: 'Too many upload links in the last hour. Try again after 14:32 UTC (in 12 minutes), or send fewer files.', retry_after_seconds: 720, retry_at: '2026-11-10T14:32:10.000Z' } },
    },
  })
  assert.equal(result.code, 4)
  assert.match(result.stderr, /Try again after 14:32 UTC \(in 12 minutes\)/)
  assert.doesNotMatch(result.stderr, /Wait 720 seconds/)
})

// ---- Chunks by bytes, links that went stale, and a 404 that is a real answer ----

const MB = 1024 * 1024
/** A large file for attachCommand that is not on disk: the CLI sends its blob, and it says it is `sizeBytes` big. */
const large = (name: string, sizeBytes: number): FileToAttach => ({ path: name, fileName: name, mimeType: 'video/quicktime', content: { kind: 'blob', blob: new Blob([new Uint8Array(10)]), sizeBytes } })

function storageRoutes(names: readonly string[], routes: Routes = {}): Routes {
  for (const name of names) {
    routes[`PUT /private/tmp/${name}`] = { status: 200 }
    routes[`POST /uploads/lsu_${name}/`] = (sent) => ({ ...attachedBody({ ...sent, body: { filename: name } }) })
  }
  return routes
}

const linkFor = (name: string, extra: Record<string, unknown> = {}) => ({ upload_url: `https://storage.example.test/private/tmp/${name}`, finish_url: `https://api.listspace.app/v1/uploads/lsu_${name}/`, ...extra })

async function attach(files: FileToAttach[], routes: Routes) {
  const api = fakeApi(routes)
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1', token: parseToken(TOKEN) as ApiToken, fetch: api.fetch })
  const output = await attachCommand(client, { item: ITEM_ID, files })
  return { output, sent: api.sent }
}

test('attach: a chunk of links holds files only while the bytes queued ahead of each stay under 500 MB; a bigger file goes on its own', async () => {
  const names = ['a.mov', 'b.mov', 'c.mov', 'd.mov', 'e.mov']
  const files = [large('a.mov', 400 * MB), large('b.mov', 400 * MB), large('c.mov', 400 * MB), large('d.mov', 600 * MB), large('e.mov', 10 * MB)]
  const routes = storageRoutes(names, {
    'POST /upload-links': (sent) => {
      const asked = (sent.body as { files: { filename: string }[] }).files
      return { status: 201, body: { data: { links: asked.map((file, index) => ({ index, ...linkFor(file.filename) })), refused: [] } } }
    },
    [`POST /items/${ITEM_ID}/upload-links`]: (sent) => ({ status: 201, body: { data: linkFor((sent.body as { filename: string }).filename) } }),
  })
  const { sent } = await attach(files, routes)
  const asks = sent.filter((s) => s.path.endsWith('/upload-links')).map((s) => (s.path === '/upload-links' ? (s.body as { files: { filename: string }[] }).files.map((x) => x.filename).join('+') : `single:${(s.body as { filename: string }).filename}`))
  // a (0 ahead) and b (400 MB ahead) share a call; c would have 800 MB ahead. c (0) and d (400 MB ahead) share the next; e is alone
  assert.deepEqual(asks, ['a.mov+b.mov', 'c.mov+d.mov', 'single:e.mov'])
  // Each call for links comes right before its files are sent, not all at the start
  const order = sent.map((s) => (s.path.endsWith('/upload-links') ? 'links' : s.method))
  assert.deepEqual(order, ['links', 'PUT', 'POST', 'PUT', 'POST', 'links', 'PUT', 'POST', 'PUT', 'POST', 'links', 'PUT', 'POST'])
})

test('attach: a link that has run out, or runs out within a minute, is replaced by a fresh single link before its PUT', async () => {
  const files = [large('a.mov', 20 * MB), large('b.mov', 20 * MB), large('c.mov', 20 * MB)]
  const soon = new Date(Date.now() + 30_000).toISOString()
  const later = new Date(Date.now() + 14 * 60_000).toISOString()
  const routes = storageRoutes(['a.mov', 'b.mov', 'c.mov'], {
    'POST /upload-links': {
      status: 201,
      body: { data: { links: [
        { index: 0, ...linkFor('a.mov', { expires_at: later }) },
        { index: 1, ...linkFor('b.mov', { expires_at: new Date(Date.now() - 1000).toISOString() }) },
        { index: 2, ...linkFor('c.mov', { expires_at: soon }) },
      ], refused: [] } },
    },
    [`POST /items/${ITEM_ID}/upload-links`]: (sent) => ({ status: 201, body: { data: linkFor((sent.body as { filename: string }).filename, { expires_at: later }) } }),
  })
  const { sent } = await attach(files, routes)
  const calls = sent.map((s) => `${s.method} ${s.path}`)
  assert.deepEqual(calls, [
    'POST /upload-links',
    'PUT /private/tmp/a.mov', 'POST /uploads/lsu_a.mov/',
    `POST /items/${ITEM_ID}/upload-links`, 'PUT /private/tmp/b.mov', 'POST /uploads/lsu_b.mov/',
    `POST /items/${ITEM_ID}/upload-links`, 'PUT /private/tmp/c.mov', 'POST /uploads/lsu_c.mov/',
  ])
  // The fresh link is asked for one file at a time, with its size
  assert.deepEqual(sent[3]?.body, { filename: 'b.mov', size_bytes: 20 * MB })
})

test('attach: a 404 for the items of a batch is an answer, not a missing route: no fall back to single links', async () => {
  const files = [large('a.mov', 20 * MB), large('b.mov', 20 * MB)]
  const routes: Routes = {
    'POST /upload-links': { status: 404, body: { error: { code: 'not_found', message: 'No file got a link. a.mov: Item not found. b.mov: Item not found.' } } },
  }
  await assert.rejects(() => attach(files, routes), (error: unknown) => error instanceof CliFailure && /Item not found/.test(error.error.message))
  const api = fakeApi(routes)
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1', token: parseToken(TOKEN) as ApiToken, fetch: api.fetch })
  await assert.rejects(() => attachCommand(client, { item: ITEM_ID, files }))
  assert.deepEqual(api.sent.map((s) => `${s.method} ${s.path}`), ['POST /upload-links'])
})
