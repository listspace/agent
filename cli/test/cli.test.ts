import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { credentialsPath } from '../src/config.js'
import {
  BOARD_ID,
  ITEM_ID,
  TOKEN,
  accountBody,
  appliedBody,
  boardBody,
  boardsBody,
  itemBody,
  level3,
  runCli,
  suggestedBody,
  tempDir,
} from './fake.js'

const sessionBody = {
  data: {
    guidance: 'Write in British English.',
    board: { id: BOARD_ID, title: 'Website', url: 'https://listspace.app/board/b' },
    instructions: 'Record decisions in Project info.',
    level: level3,
    lists: [{ id: 'l-todo', title: 'To do', kind: 'todo', open_items: 1 }],
    work: [{ id: ITEM_ID, title: 'Fix the footer', list_id: 'l-todo', list_title: 'To do', due_date: null, url: 'u' }],
    captured: [],
    recently_done: [],
    due_soon: [],
    today: '2026-10-05',
    truncated: false,
  },
}

test('session by board title prints guidance and instructions before the work', async () => {
  const result = await runCli(['session', 'Website'], {
    'GET /boards': { body: boardsBody },
    [`GET /boards/${BOARD_ID}/session`]: { body: sessionBody },
  })
  assert.equal(result.code, 0)
  const text = result.stdout
  assert.ok(text.indexOf('Guidance for agents') < text.indexOf('Board instructions'))
  assert.ok(text.indexOf('Board instructions') < text.indexOf('Fix the footer'))
  assert.match(text, /level 3 \(Capture\)/)
})

test('--json prints the server data as is', async () => {
  const result = await runCli(['session', BOARD_ID, '--json'], { [`GET /boards/${BOARD_ID}/session`]: { body: sessionBody } })
  assert.equal(result.code, 0)
  assert.deepEqual(JSON.parse(result.stdout), sessionBody.data)
})

test('add resolves the list by name and sends title, markdown description and reason', async () => {
  const result = await runCli(['add', BOARD_ID, 'bugs', 'Footer overlaps', '--description', 'On **mobile**', '--reason', 'Seen while testing'], {
    [`GET /boards/${BOARD_ID}`]: { body: boardBody },
    'POST /items': { status: 201, body: appliedBody({ title: 'Footer overlaps' }) },
  })
  assert.equal(result.code, 0, result.stderr)
  const post = result.sent.find((sent) => sent.method === 'POST')
  assert.deepEqual(post?.body, {
    list_id: 'l-bugs',
    title: 'Footer overlaps',
    description: 'On **mobile**',
    description_format: 'markdown',
    reason: 'Seen while testing',
  })
  assert.match(result.stdout, /Added "Footer overlaps" to Bugs/)
  assert.match(result.stdout, /listspace undo req-1/)
})

test('add --inbox needs a reason and sends inbox: true', async () => {
  const missing = await runCli(['add', BOARD_ID, 'todo', 'Redo the header', '--inbox'], {})
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /--inbox needs --reason/)
  assert.equal(missing.sent.length, 0)

  const result = await runCli(['add', BOARD_ID, 'todo', 'Redo the header', '--inbox', '--reason', 'Not sure it is wanted'], {
    [`GET /boards/${BOARD_ID}`]: { body: boardBody },
    'POST /items': { status: 202, body: suggestedBody },
  })
  assert.equal(result.code, 0)
  const post = result.sent.find((sent) => sent.method === 'POST')
  assert.deepEqual(post?.body, { list_id: 'l-todo', title: 'Redo the header', inbox: true, reason: 'Not sure it is wanted' })
  assert.match(result.stdout, /Suggested, not made/)
  assert.match(result.stdout, /Do not send it again/)
})

test('done moves the item to the board\'s done list', async () => {
  const result = await runCli(['done', ITEM_ID], {
    [`GET /items/${ITEM_ID}`]: { body: itemBody },
    [`GET /boards/${BOARD_ID}`]: { body: boardBody },
    [`POST /items/${ITEM_ID}/move`]: { body: appliedBody({ list_id: 'l-done' }) },
  })
  assert.equal(result.code, 0, result.stderr)
  const move = result.sent.find((sent) => sent.method === 'POST')
  assert.deepEqual(move?.body, { list_id: 'l-done', position: 'top' })
  assert.match(result.stdout, /Moved "Fix the footer" to Done/)
})

test('move to Doing; a level that routes it to the Inbox is reported as suggested', async () => {
  const result = await runCli(['move', ITEM_ID, 'doing'], {
    [`GET /items/${ITEM_ID}`]: { body: itemBody },
    [`GET /boards/${BOARD_ID}`]: { body: boardBody },
    [`POST /items/${ITEM_ID}/move`]: { status: 202, body: suggestedBody },
  })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /waits in the board's Inbox/)
})

test('inbox lists suggestions and checks --status', async () => {
  const bad = await runCli(['inbox', BOARD_ID, '--status', 'open'], {})
  assert.equal(bad.code, 2)

  const result = await runCli(['inbox', BOARD_ID, '--status', 'all'], {
    [`GET /boards/${BOARD_ID}/inbox`]: {
      body: {
        data: {
          suggestions: [
            {
              id: 'sug-1',
              action: 'create_item',
              item_title: 'Redo the header',
              list_title: 'To do',
              reason: 'Not sure it is wanted',
              agent_name: 'Claude Code',
              status: 'pending',
              stale: false,
              created_at: '2026-10-05T10:00:00Z',
              expires_at: '2026-11-04T10:00:00Z',
            },
          ],
        },
      },
    },
  })
  assert.equal(result.code, 0)
  assert.equal(result.sent[0]?.query.get('status'), 'all')
  assert.match(result.stdout, /pending: create_item Redo the header -> To do/)
})

test('undo posts to /activity/<request_id>/undo', async () => {
  const result = await runCli(['undo', 'req-1'], {
    'POST /activity/req-1/undo': { body: { data: { outcome: 'undone', undone: ['e1', 'e2'], level: level3 } } },
  })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, 'Undone (2 changes).')
})

test('new-board sends only the title so the server uses the agent template', async () => {
  const result = await runCli(['new-board', 'Garden'], {
    'POST /boards': {
      status: 201,
      body: {
        data: {
          ...boardBody.data,
          title: 'Garden',
          instructions: 'Capture ideas and bugs freely.',
          undo: { request_id: 'req-9' },
        },
      },
    },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.sent[0]?.body, { title: 'Garden' })
  assert.match(result.stdout, /Lists: Project info, Ideas, Bugs, To do, Doing, Done/)
})

test('401 exits 3 and says to log in; --json puts the error on stdout', async () => {
  const routes = { 'GET /account': { status: 401, body: { error: { code: 'unauthorized', message: 'Token revoked.' } } } }
  const text = await runCli(['whoami'], routes)
  assert.equal(text.code, 3)
  assert.match(text.stderr, /listspace login/)

  const json = await runCli(['whoami', '--json'], routes)
  assert.equal(json.code, 3)
  assert.equal(JSON.parse(json.stdout).error.kind, 'auth')
})

test('429 exits 4 with the wait time', async () => {
  const result = await runCli(['boards'], {
    'GET /boards': { status: 429, headers: { 'Retry-After': '12' }, body: { error: { code: 'rate_limited', message: 'Too many requests.' } } },
  })
  assert.equal(result.code, 4)
  assert.match(result.stderr, /Wait 12 seconds/)
})

test('without a token every API command exits 3 before any request', async () => {
  const result = await runCli(['boards'], {}, { env: {} })
  assert.equal(result.code, 3)
  assert.match(result.stderr, /Not signed in/)
  assert.equal(result.sent.length, 0)
})

test('login checks the token with /account before saving it', async () => {
  const dir = await tempDir()
  const bad = await runCli(['login', '--token', 'ls_nope'], {}, { env: {}, configDir: dir })
  assert.equal(bad.code, 2)

  const revoked = await runCli(['login', '--token', TOKEN], { 'GET /account': { status: 401, body: { error: { code: 'unauthorized', message: 'Revoked.' } } } }, { env: {}, configDir: dir })
  assert.equal(revoked.code, 3)
  await assert.rejects(readFile(credentialsPath(dir), 'utf8'))

  const ok = await runCli(['login'], { 'GET /account': { body: accountBody } }, { env: {}, configDir: dir, secret: `${TOKEN}\n` })
  assert.equal(ok.code, 0, ok.stderr)
  assert.equal(JSON.parse(await readFile(credentialsPath(dir), 'utf8')).token, TOKEN)

  const later = await runCli(['boards'], { 'GET /boards': { body: boardsBody } }, { env: {}, configDir: dir })
  assert.equal(later.code, 0)
  assert.equal(later.sent[0]?.headers.get('Authorization'), `Bearer ${TOKEN}`)
})

test('usage errors exit 2: unknown command, unknown flag, wrong argument count', async () => {
  assert.equal((await runCli(['fly'], {})).code, 2)
  assert.equal((await runCli(['boards', '--color'], {})).code, 2)
  const result = await runCli(['add', BOARD_ID, 'todo'], {})
  assert.equal(result.code, 2)
  assert.match(result.stderr, /takes <board> <list> <title>/)
})

test('--help and --version', async () => {
  assert.match((await runCli(['--help'], {})).stdout, /Usage: listspace/)
  assert.match((await runCli(['--version'], {})).stdout, /^\d+\.\d+\.\d+$/)
})

// ---- next, claim, release ----

const LABEL_A = '55555555-5555-4555-8555-555555555555'
const LABEL_B = '66666666-6666-4666-8666-666666666666'

const nextClaimedBody = {
  data: {
    outcome: 'claimed',
    item: {
      ...itemBody.data,
      list_id: 'l-doing',
      description: 'Steps in **markdown**',
      checklists: [],
      claim: { agent_name: 'Claude Code', claimed_at: '2026-10-05T10:00:00Z', expires_at: '2026-10-05T12:00:00Z', yours: true },
    },
    expires_at: '2026-10-05T12:00:00Z',
    moved_to: { list_id: 'l-doing', list_title: 'Doing' },
    note: null,
    level: { effective: 4, name: 'Act' },
    undo: { request_id: 'req-7' },
  },
}

const takenBody = {
  data: {
    outcome: 'taken',
    item_id: ITEM_ID,
    claimed_by: { agent_name: 'Cursor', expires_at: '2026-10-05T11:30:00Z' },
    message: 'Cursor is working on this item (claimed until 2026-10-05T11:30:00Z). Do not work on it: pick another item (next_item), or ask the user.',
    level: { effective: 4, name: 'Act' },
  },
}

test('next sends kinds, labels (repeated and comma list), move_to_doing and ttl, and prints the claimed item', async () => {
  const result = await runCli(
    ['next', 'Website', '--kinds', 'todo,BACKLOG', '--label', LABEL_A, '--label', `${LABEL_B},${LABEL_A}`, '--ttl', '30'],
    {
      'GET /boards': { body: boardsBody },
      [`POST /boards/${BOARD_ID}/next`]: { body: nextClaimedBody },
    },
  )
  assert.equal(result.code, 0, result.stderr)
  const post = result.sent.find((sent) => sent.method === 'POST')
  assert.deepEqual(post?.body, { kinds: ['todo', 'backlog'], label_ids: [LABEL_A, LABEL_B], move_to_doing: true, ttl_minutes: 30 })
  assert.match(result.stdout, /Claimed "Fix the footer"  22222222/)
  assert.match(result.stdout, /Moved to Doing\./)
  assert.match(result.stdout, /runs out at 2026-10-05T12:00:00Z/)
  assert.match(result.stdout, /listspace undo req-7/)
  assert.match(result.stdout, new RegExp(`listspace release ${ITEM_ID}`))
})

test('next --no-move sends only move_to_doing false and shows the note', async () => {
  const result = await runCli(['next', BOARD_ID, '--no-move'], {
    [`POST /boards/${BOARD_ID}/next`]: {
      body: { data: { ...nextClaimedBody.data, moved_to: null, undo: null, note: 'This board has no doing list, so the item stays in its list.' } },
    },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.sent[0]?.body, { move_to_doing: false })
  assert.match(result.stdout, /Not moved\./)
  assert.match(result.stdout, /Note: This board has no doing list/)
})

test('next says "Nothing left" when the board is empty; --json prints the server data', async () => {
  const empty = { data: { outcome: 'empty', message: 'No open item in the todo, backlog lists.', level: { effective: 4, name: 'Act' } } }
  const routes = { [`POST /boards/${BOARD_ID}/next`]: { body: empty } }
  const text = await runCli(['next', BOARD_ID], routes)
  assert.equal(text.code, 0)
  assert.match(text.stdout, /^Nothing left: No open item/)

  const json = await runCli(['next', BOARD_ID, '--json'], routes)
  assert.deepEqual(JSON.parse(json.stdout), empty.data)
})

test('next checks --kinds and --ttl before any request', async () => {
  const kinds = await runCli(['next', BOARD_ID, '--kinds', 'todo,later'], {})
  assert.equal(kinds.code, 2)
  assert.match(kinds.stderr, /"later" is not one/)
  for (const ttl of ['4', '1441', '2h', '']) {
    const result = await runCli(['next', BOARD_ID, '--ttl', ttl], {})
    assert.equal(result.code, 2, ttl)
    assert.match(result.stderr, /--ttl is a whole number of minutes/)
  }
  assert.equal(kinds.sent.length, 0)
})

test('a level below Act refuses next with exit 1 and the server message', async () => {
  const result = await runCli(['next', BOARD_ID], {
    [`POST /boards/${BOARD_ID}/next`]: { status: 403, body: { error: { code: 'level', message: 'Claiming needs level 4 (Act).' } } },
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /needs level 4/)
})

test('claim sends ttl, prints claimed or renewed, and says who holds a taken item', async () => {
  const claimed = await runCli(['claim', ITEM_ID, '--ttl', '60'], {
    [`POST /items/${ITEM_ID}/claim`]: { body: { data: { outcome: 'renewed', item_id: ITEM_ID, expires_at: '2026-10-05T11:00:00Z', level: { effective: 4, name: 'Act' } } } },
  })
  assert.equal(claimed.code, 0, claimed.stderr)
  assert.deepEqual(claimed.sent[0]?.body, { ttl_minutes: 60 })
  assert.match(claimed.stdout, /^Renewed 22222222.* until 2026-10-05T11:00:00Z/)

  const taken = await runCli(['claim', ITEM_ID], { [`POST /items/${ITEM_ID}/claim`]: { body: takenBody } })
  assert.equal(taken.code, 0)
  assert.deepEqual(taken.sent[0]?.body, {})
  assert.match(taken.stdout, /Taken: Cursor is working on this item until 2026-10-05T11:30:00Z/)
  assert.match(taken.stdout, /Do not work on it/)
})

test('release sends DELETE and reports released, not claimed or taken', async () => {
  const route = `DELETE /items/${ITEM_ID}/claim`
  const released = await runCli(['release', ITEM_ID], { [route]: { body: { data: { outcome: 'released', item_id: ITEM_ID, level: { effective: 4, name: 'Act' } } } } })
  assert.equal(released.code, 0, released.stderr)
  assert.equal(released.sent[0]?.method, 'DELETE')
  assert.equal(released.sent[0]?.body, undefined)
  assert.equal(released.stdout, `Released ${ITEM_ID}.`)

  const none = await runCli(['release', ITEM_ID], { [route]: { body: { data: { outcome: 'not_claimed', item_id: ITEM_ID, level: { effective: 4, name: 'Act' } } } } })
  assert.match(none.stdout, /had no claim to release/)

  const taken = await runCli(['release', ITEM_ID], { [route]: { body: takenBody } })
  assert.match(taken.stdout, /Taken: Cursor/)
})
