import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiClient, CliFailure, parseToken } from '../src/api.js'
import { resolveBoardId, resolveList } from '../src/commands.js'
import { boardDetail } from '../src/schema.js'
import { BOARD_ID, TOKEN, boardBody, boardsBody, fakeApi } from './fake.js'

const board = boardDetail(boardBody.data, 'data')

const usageMessage = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof CliFailure)
    assert.equal(error.error.kind, 'usage')
    return error.error.message
  }
  assert.fail('expected a usage error')
}

test('resolveList finds a list by id, title (any case) or a kind with one list', () => {
  assert.equal(resolveList(board, 'l-doing').title, 'Doing')
  assert.equal(resolveList(board, 'to do').id, 'l-todo')
  assert.equal(resolveList(board, 'BUGS').id, 'l-bugs')
  assert.equal(resolveList(board, 'done').id, 'l-done')
  assert.equal(resolveList(board, 'info').title, 'Project info')
})

test('resolveList refuses a kind shared by two lists and an unknown name', () => {
  assert.match(usageMessage(() => resolveList(board, 'capture')), /matches 2 lists.*Ideas, Bugs/)
  assert.match(usageMessage(() => resolveList(board, 'Later')), /No list "Later".*Project info, Ideas/)
})

test('resolveBoardId: an id is used as is, a title is looked up, a shared prefix is refused', async () => {
  const api = fakeApi({ 'GET /boards': { body: boardsBody } })
  const token = parseToken(TOKEN)
  assert.ok(token)
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1', token, fetch: api.fetch })

  assert.equal(await resolveBoardId(client, BOARD_ID), BOARD_ID)
  assert.equal(api.sent.length, 0)

  assert.equal(await resolveBoardId(client, 'website'), BOARD_ID)
  await assert.rejects(resolveBoardId(client, 'web'), /matches 2 boards/)
  await assert.rejects(resolveBoardId(client, 'Garden'), /No board called "Garden"/)
})

test('resolveBoardId follows next_cursor', async () => {
  const second = { ...boardsBody.data[0], id: '44444444-4444-4444-8444-444444444444', title: 'Garden' }
  const api = fakeApi({
    'GET /boards': (sent) =>
      sent.query.get('cursor') === null ? { body: { data: boardsBody.data, next_cursor: 'page2' } } : { body: { data: [second], next_cursor: null } },
  })
  const token = parseToken(TOKEN)
  assert.ok(token)
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1', token, fetch: api.fetch })
  assert.equal(await resolveBoardId(client, 'garden'), second.id)
  assert.equal(api.sent.length, 2)
})
