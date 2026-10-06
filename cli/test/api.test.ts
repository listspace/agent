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
