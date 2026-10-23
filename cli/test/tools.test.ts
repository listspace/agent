import assert from 'node:assert/strict'
import { test } from 'node:test'

import { firstSentence, parseToolArgs } from '../src/tools.js'
import { BOARD_ID, ITEM_ID, TOKEN, boardsBody, level3, mcpRoute, runCli, suggestedBody, type Sent } from './fake.js'

const LIST_ID = '44444444-4444-4444-8444-444444444444'
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555'

const applied = (extra: Record<string, unknown> = {}) => ({ outcome: 'applied', level: level3, undo: { request_id: 'req-9' }, ...extra })

/** The JSON-RPC messages the CLI sent to the MCP server. */
const rpcSent = (sent: readonly Sent[]) => sent.filter((s) => s.path === '/').map((s) => s.body)

const callOf = (sent: readonly Sent[], index = 0): { name: unknown; arguments: Record<string, unknown> } => {
  const body = rpcSent(sent)[index]
  assert.ok(typeof body === 'object' && body !== null && 'params' in body)
  const params = body.params
  assert.ok(typeof params === 'object' && params !== null && 'name' in params && 'arguments' in params)
  const args = params.arguments
  assert.ok(typeof args === 'object' && args !== null)
  return { name: params.name, arguments: { ...args } }
}

test('call runs any tool by name with the JSON arguments and prints its result', async () => {
  const result = await runCli(['call', 'get_item', '--json', `{"item_id": "${ITEM_ID}"}`], {
    'POST /': mcpRoute({ get_item: (args) => ({ result: { id: args.item_id, title: 'Fix the footer' } }) }),
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { id: ITEM_ID, title: 'Fix the footer' })
  const [request] = result.sent
  assert.equal(request?.headers.get('Authorization'), `Bearer ${TOKEN}`)
  assert.equal(request?.headers.get('MCP-Protocol-Version'), '2025-06-18')
  const body = request?.body
  assert.ok(typeof body === 'object' && body !== null && 'method' in body && 'jsonrpc' in body)
  assert.equal(body.jsonrpc, '2.0')
  assert.equal(body.method, 'tools/call')
  assert.deepEqual(callOf(result.sent), { name: 'get_item', arguments: { item_id: ITEM_ID } })
})

test('call goes to LISTSPACE_MCP_URL when it is set', async () => {
  const urls: string[] = []
  const result = await runCli(['call', 'get_item', `{"item_id": "${ITEM_ID}"}`], {
    'POST /mcp': (sent) => {
      urls.push(sent.path)
      return mcpRoute({ get_item: () => ({ result: { id: ITEM_ID } }) })(sent)
    },
  }, { env: { LISTSPACE_TOKEN: TOKEN, LISTSPACE_MCP_URL: 'https://mcp.example.test/mcp' } })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(urls, ['/mcp'])
})

test('a refusal from the tool (the agent access level) exits 1 with the server message', async () => {
  const refusal = 'At level 1 (Read only) agents cannot make changes on this board. The user can raise it in the board settings.'
  const route = { 'POST /': mcpRoute({ add_comment: () => ({ error: refusal }) }) }

  const text = await runCli(['comment', ITEM_ID, 'Done, see the PR'], route)
  assert.equal(text.code, 1)
  assert.match(text.stderr, /level 1 \(Read only\)/)
  assert.equal(text.stdout, '')

  const json = await runCli(['call', 'add_comment', '--json', `{"item_id": "${ITEM_ID}", "text": "x"}`], route)
  assert.equal(json.code, 1)
  assert.deepEqual(JSON.parse(json.stdout), { error: { kind: 'tool', tool: 'add_comment', message: refusal } })
})

test('an unknown tool is a usage error that points to `listspace tools`', async () => {
  const result = await runCli(['call', 'make_coffee'], { 'POST /': mcpRoute({}) })
  assert.equal(result.code, 2)
  assert.match(result.stderr, /Unknown tool: make_coffee.*listspace tools/)
})

test('call refuses arguments that are not one JSON object, before sending anything', async () => {
  for (const raw of ['{item_id: 1}', '[1, 2]', '"text"']) {
    const result = await runCli(['call', 'get_item', raw], {})
    assert.equal(result.code, 2, raw)
    assert.equal(result.sent.length, 0)
  }
  assert.deepEqual(parseToolArgs(undefined), {})
})

test('a 401 from the MCP server asks to sign in, and the token is never printed', async () => {
  const result = await runCli(['call', 'get_account'], {
    'POST /': { status: 401, body: { error: { code: 'unauthorized', message: 'This API token is not valid.' } } },
  })
  assert.equal(result.code, 3)
  assert.match(result.stderr, /listspace login/)
  assert.ok(!result.stderr.includes(TOKEN) && !result.stdout.includes(TOKEN))
})

test('a call with an idempotency_key is retried once after a 502; one without is not', async () => {
  let calls = 0
  const flaky = (sent: Sent) => (++calls % 2 === 1 ? { status: 502 } : mcpRoute({ add_comment: () => ({ result: applied() }) })(sent))
  const keyed = await runCli(['call', 'add_comment', `{"item_id": "${ITEM_ID}", "text": "x", "idempotency_key": "k-1"}`], { 'POST /': flaky })
  assert.equal(keyed.code, 0, keyed.stderr)
  assert.equal(keyed.sent.length, 2)

  calls = 0
  const unkeyed = await runCli(['call', 'add_comment', `{"item_id": "${ITEM_ID}", "text": "x"}`], { 'POST /': flaky })
  assert.equal(unkeyed.code, 1)
  assert.equal(unkeyed.sent.length, 1)
})

test('tools lists names with one line each; tools <name> shows the input schema', async () => {
  const route = { 'POST /': mcpRoute({}) }
  const all = await runCli(['tools'], route)
  assert.equal(all.code, 0, all.stderr)
  assert.match(all.stdout, /^get_item\s+One item in full\.$/m)
  assert.match(all.stdout, /2 tools\./)

  const one = await runCli(['tools', 'get_item', '--json'], route)
  assert.equal(one.code, 0)
  assert.deepEqual(JSON.parse(one.stdout).inputSchema.required, ['item_id'])

  const missing = await runCli(['tools', 'nope'], route)
  assert.equal(missing.code, 2)
})

test('firstSentence keeps the first sentence only', () => {
  assert.equal(firstSentence('Add a list. Optional kind.'), 'Add a list.')
  assert.equal(firstSentence('No full stop'), 'No full stop')
  assert.equal(firstSentence('Version 1.2 is out. Next.'), 'Version 1.2 is out.')
  const long = firstSentence(`${'word '.repeat(40)}end.`)
  assert.ok(long.length <= 103 && long.endsWith('word...'), long)
})

test('comment sends add_comment with an idempotency_key and the Inbox choice', async () => {
  const result = await runCli(['comment', ITEM_ID, 'Shipped in **PR 12**', '--reason', 'Progress'], {
    'POST /': mcpRoute({ add_comment: () => ({ result: applied() }) }),
  })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^Commented \(level 3 \(Capture\)\)\./m)
  assert.match(result.stdout, /listspace undo req-9/)
  const { name, arguments: args } = callOf(result.sent)
  assert.equal(name, 'add_comment')
  assert.equal(args.item_id, ITEM_ID)
  assert.equal(args.text, 'Shipped in **PR 12**')
  assert.equal(args.reason, 'Progress')
  assert.equal(typeof args.idempotency_key, 'string')
})

test('a comment that waits in the Inbox says so', async () => {
  const result = await runCli(['comment', ITEM_ID, 'Note', '--inbox', '--reason', 'Check first'], {
    'POST /': mcpRoute({ add_comment: () => ({ result: suggestedBody.data }) }),
  })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /Suggested, not made/)
  assert.equal(callOf(result.sent).arguments.inbox, true)
})

test('update sends only the fields given, and needs at least one', async () => {
  const route = { 'POST /': mcpRoute({ update_item: () => ({ result: applied() }) }) }
  const result = await runCli(['update', ITEM_ID, '--title', 'Fix the footer on mobile'], route)
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(callOf(result.sent).arguments, { item_id: ITEM_ID, title: 'Fix the footer on mobile' })

  const nothing = await runCli(['update', ITEM_ID], route)
  assert.equal(nothing.code, 2)
  assert.equal(nothing.sent.length, 0)
})

test('list add resolves the board by title and sends create_list with the kind', async () => {
  const result = await runCli(['list', 'add', 'Website', 'Waiting', '--kind', 'backlog'], {
    'GET /boards': { body: boardsBody },
    'POST /': mcpRoute({ create_list: () => ({ result: applied({ id: LIST_ID }) }) }),
  })
  assert.equal(result.code, 0, result.stderr)
  const { name, arguments: args } = callOf(result.sent)
  assert.equal(name, 'create_list')
  assert.equal(args.board_id, BOARD_ID)
  assert.equal(args.title, 'Waiting')
  assert.equal(args.kind, 'backlog')
  assert.equal(typeof args.idempotency_key, 'string')

  const badKind = await runCli(['list', 'add', BOARD_ID, 'X', '--kind', 'later'], {})
  assert.equal(badKind.code, 2)
})

test('list rename sends update_list; a missing subcommand is a usage error', async () => {
  const result = await runCli(['list', 'rename', LIST_ID, 'Shipped'], {
    'POST /': mcpRoute({ update_list: () => ({ result: applied() }) }),
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(callOf(result.sent).arguments, { list_id: LIST_ID, title: 'Shipped' })

  const bad = await runCli(['list', 'delete', LIST_ID], {})
  assert.equal(bad.code, 2)
})

const createdBoardBody = {
  data: { id: BOARD_ID, title: 'Sales', url: 'u', instructions: null, level: level3, lists: [], undo: null, space: null, space_note: null },
}

test('new-board --template finds the template by name and sends its id', async () => {
  const templates = { templates: [{ id: TEMPLATE_ID, name: 'Sales pipeline' }, { id: 'other', name: 'Project (for agents)' }] }
  const result = await runCli(['new-board', 'Sales', '--template', 'sales'], {
    'POST /': mcpRoute({ list_templates: () => ({ result: templates }) }),
    'POST /boards': (sent) => ({ status: 201, body: { ...createdBoardBody, sent: sent.body } }),
  })
  assert.equal(result.code, 0, result.stderr)
  const post = result.sent.find((s) => s.path === '/boards')
  assert.deepEqual(post?.body, { title: 'Sales', template_id: TEMPLATE_ID })

  const byId = await runCli(['new-board', 'Sales', '--template', TEMPLATE_ID], { 'POST /boards': { status: 201, body: createdBoardBody } })
  assert.equal(byId.code, 0, byId.stderr)
  assert.equal(rpcSent(byId.sent).length, 0)

  const unknown = await runCli(['new-board', 'Sales', '--template', 'Wedding'], { 'POST /': mcpRoute({ list_templates: () => ({ result: templates }) }) })
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /No template called "Wedding"/)
})
