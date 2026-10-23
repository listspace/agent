import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiClient, CliFailure, errorFor, parseToken, type ApiToken } from '../src/api.js'
import { account } from '../src/schema.js'
import { TOKEN, accountBody, fakeApi } from './fake.js'

const token = (): ApiToken => {
  const parsed = parseToken(TOKEN)
  assert.ok(parsed)
  return parsed
}

test('parseToken accepts ls_ plus 43 url-safe characters and trims', () => {
  assert.equal(parseToken(`  ${TOKEN}\n`), TOKEN)
  assert.equal(parseToken('ls_short'), null)
  assert.equal(parseToken(`xx_${'a'.repeat(43)}`), null)
  assert.equal(parseToken(`ls_${'a'.repeat(42)}!`), null)
})

test('sends the bearer token and decodes data', async () => {
  const api = fakeApi({ 'GET /account': { body: accountBody } })
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1/', token: token(), fetch: api.fetch })
  const answer = await client.data('GET', '/account', account)
  assert.equal(answer.value.plan.name, 'Free')
  assert.deepEqual(answer.raw, accountBody.data)
  assert.equal(api.sent[0]?.headers.get('Authorization'), `Bearer ${TOKEN}`)
  assert.match(api.sent[0]?.headers.get('User-Agent') ?? '', /^listspace-cli\//)
})

test('a response of the wrong shape is an unexpected error naming the field', async () => {
  const api = fakeApi({ 'GET /account': { body: { data: { ...accountBody.data, plan: null } } } })
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1', token: token(), fetch: api.fetch })
  await assert.rejects(client.data('GET', '/account', account), (error: unknown) => {
    assert.ok(error instanceof CliFailure)
    assert.equal(error.error.kind, 'unexpected')
    assert.match(error.error.message, /data\.plan should be an object/)
    return true
  })
})

test('a network failure says where it could not connect', async () => {
  const client = new ApiClient({
    baseUrl: 'https://api.example.test/v1',
    token: token(),
    fetch: async () => {
      throw new TypeError('fetch failed')
    },
  })
  await assert.rejects(client.data('GET', '/account', account), (error: unknown) => {
    assert.ok(error instanceof CliFailure)
    assert.equal(error.error.kind, 'network')
    assert.match(error.error.message, /api\.example\.test.*fetch failed/)
    return true
  })
})

test('errorFor: 401 points at login, 429 reads Retry-After, 403 scope explains read only', () => {
  const body = (code: string, message: string) => ({ error: { code, message } })

  const auth = errorFor(new Response(null, { status: 401 }), body('unauthorized', 'Token revoked.'))
  assert.equal(auth.kind, 'auth')
  assert.match(auth.message, /Token revoked\. Run `listspace login`/)

  const limited = errorFor(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }), body('rate_limited', 'Slow down.'))
  assert.deepEqual(limited, { kind: 'rate_limited', message: 'Slow down. Wait 30 seconds before trying again.', retryAfterSeconds: 30 })

  const scope = errorFor(new Response(null, { status: 403 }), body('insufficient_scope', 'Needs write.'))
  assert.equal(scope.kind, 'api')
  assert.match(scope.message, /read only/)

  const odd = errorFor(new Response(null, { status: 502 }), '<html>')
  assert.deepEqual(odd, { kind: 'api', status: 502, code: 'unknown', message: 'Listspace answered 502.' })
})

test('a POST carries an Idempotency-Key; GET does not', async () => {
  const api = fakeApi({ 'GET /account': { body: accountBody }, 'POST /account': { body: accountBody } })
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1', token: token(), fetch: api.fetch, newKey: () => 'key-1' })
  await client.data('GET', '/account', account)
  await client.data('POST', '/account', account, { body: {} })
  assert.equal(api.sent[0]?.headers.get('Idempotency-Key'), null)
  assert.equal(api.sent[1]?.headers.get('Idempotency-Key'), 'key-1')
})

test('a lost answer to a POST (502, or no connection) is retried once with the same key', async () => {
  let calls = 0
  const api = fakeApi({
    'POST /account': () => (++calls === 1 ? { status: 502 } : { body: accountBody }),
  })
  const waits: number[] = []
  const keys = ['key-a', 'key-b']
  const client = new ApiClient({
    baseUrl: 'https://api.example.test/v1',
    token: token(),
    fetch: api.fetch,
    newKey: () => keys.shift() ?? 'none',
    sleep: async (ms) => {
      waits.push(ms)
    },
  })
  const answer = await client.data('POST', '/account', account, { body: { title: 'x' } })
  assert.equal(answer.value.plan.name, 'Free')
  assert.equal(api.sent.length, 2)
  assert.deepEqual(api.sent.map((s) => s.headers.get('Idempotency-Key')), ['key-a', 'key-a'])
  assert.equal(waits.length, 1)

  let tries = 0
  const flaky = new ApiClient({
    baseUrl: 'https://api.example.test/v1',
    token: token(),
    newKey: () => 'key-c',
    sleep: async () => {},
    fetch: async (url, init) => {
      if (++tries === 1) throw new TypeError('socket hang up')
      return api.fetch(url, init)
    },
  })
  await flaky.data('POST', '/account', account, { body: {} })
  assert.equal(tries, 2)
  assert.equal(api.sent.at(-1)?.headers.get('Idempotency-Key'), 'key-c')
})

test('no retry for GET, for a 4xx, or for a 503 during maintenance', async () => {
  const maintenance = { status: 503, body: { error: { code: 'maintenance', message: 'Back at 10:00.' } } }
  const api = fakeApi({
    'GET /account': { status: 502 },
    'POST /bad': { status: 400, body: { error: { code: 'invalid_request', message: 'No.' } } },
    'POST /down': maintenance,
  })
  const client = new ApiClient({ baseUrl: 'https://api.example.test/v1', token: token(), fetch: api.fetch, sleep: async () => {} })
  await assert.rejects(client.data('GET', '/account', account))
  await assert.rejects(client.data('POST', '/bad', account, { body: {} }))
  await assert.rejects(client.data('POST', '/down', account, { body: {} }), (error: unknown) => {
    assert.ok(error instanceof CliFailure && error.error.kind === 'api' && error.error.code === 'maintenance')
    return true
  })
  assert.deepEqual(api.sent.map((s) => `${s.method} ${s.path}`), ['GET /account', 'POST /bad', 'POST /down'])
})
