import assert from 'node:assert/strict'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { parseToken } from '../src/api.js'
import { configDir, credentialsPath, loadToken, removeToken, saveToken } from '../src/config.js'
import { TOKEN, tempDir } from './fake.js'

test('configDir follows each OS and LISTSPACE_CONFIG_DIR', () => {
  assert.equal(configDir({ APPDATA: 'C:/Users/me/AppData/Roaming' }, 'win32', 'C:/Users/me'), join('C:/Users/me/AppData/Roaming', 'listspace'))
  assert.equal(configDir({}, 'darwin', '/Users/me'), join('/Users/me', 'Library', 'Application Support', 'listspace'))
  assert.equal(configDir({}, 'linux', '/home/me'), join('/home/me', '.config', 'listspace'))
  assert.equal(configDir({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/me'), join('/xdg', 'listspace'))
  assert.equal(configDir({ LISTSPACE_CONFIG_DIR: '/custom' }, 'linux', '/home/me'), '/custom')
})

test('saveToken writes a file only the user can read, loadToken reads it back', async () => {
  const dir = join(await tempDir(), 'nested')
  const token = parseToken(TOKEN)
  assert.ok(token)
  const path = await saveToken(dir, token)
  if (process.platform !== 'win32') {
    // Windows has no POSIX modes; the user's profile directory protects the file there
    assert.equal((await stat(path)).mode & 0o777, 0o600)
  }
  assert.deepEqual(await loadToken({}, dir), { kind: 'file', token, path })
  assert.equal(await removeToken(dir), true)
  assert.deepEqual(await loadToken({}, dir), { kind: 'none' })
  assert.equal(await removeToken(dir), false)
})

test('LISTSPACE_TOKEN wins over the file; a bad value is reported, not used', async () => {
  const dir = await tempDir()
  assert.equal((await loadToken({ LISTSPACE_TOKEN: TOKEN }, dir)).kind, 'env')
  assert.deepEqual(await loadToken({ LISTSPACE_TOKEN: 'nope' }, dir), { kind: 'invalid', where: 'LISTSPACE_TOKEN' })
  await writeFile(credentialsPath(dir), '{"token": 5}')
  assert.deepEqual(await loadToken({}, dir), { kind: 'invalid', where: credentialsPath(dir) })
})
