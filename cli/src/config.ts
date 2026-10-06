// Where the CLI keeps the token: one JSON file in the OS config directory,
// readable only by the user (mode 600; on Windows the file sits in the
// user's own profile, which is what protects it there).

import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isRecord } from './decode.js'
import { parseToken, type ApiToken } from './api.js'

export type Env = Readonly<Record<string, string | undefined>>

/** The directory for credentials.json; LISTSPACE_CONFIG_DIR overrides it. */
export function configDir(env: Env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const override = env.LISTSPACE_CONFIG_DIR
  if (override !== undefined && override !== '') return override
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'listspace')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'listspace')
  const xdg = env.XDG_CONFIG_HOME
  return join(xdg !== undefined && xdg !== '' ? xdg : join(home, '.config'), 'listspace')
}

export const credentialsPath = (dir: string): string => join(dir, 'credentials.json')

/** Where the token for this run comes from. */
export type TokenSource =
  | { readonly kind: 'env'; readonly token: ApiToken }
  | { readonly kind: 'file'; readonly token: ApiToken; readonly path: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly where: string }

/** LISTSPACE_TOKEN wins over the saved file, so CI and agents can pass one per run. */
export async function loadToken(env: Env, dir: string): Promise<TokenSource> {
  const fromEnv = env.LISTSPACE_TOKEN
  if (fromEnv !== undefined && fromEnv !== '') {
    const token = parseToken(fromEnv)
    return token === null ? { kind: 'invalid', where: 'LISTSPACE_TOKEN' } : { kind: 'env', token }
  }
  const path = credentialsPath(dir)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { kind: 'none' }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'invalid', where: path }
  }
  if (!isRecord(json) || typeof json.token !== 'string') return { kind: 'invalid', where: path }
  const token = parseToken(json.token)
  return token === null ? { kind: 'invalid', where: path } : { kind: 'file', token, path }
}

export async function saveToken(dir: string, token: ApiToken): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = credentialsPath(dir)
  await writeFile(path, `${JSON.stringify({ token, saved_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 })
  // writeFile's mode only applies to a new file; tighten an existing one too
  await chmod(path, 0o600)
  return path
}

export async function removeToken(dir: string): Promise<boolean> {
  const path = credentialsPath(dir)
  try {
    await readFile(path)
  } catch {
    return false
  }
  await rm(path)
  return true
}
