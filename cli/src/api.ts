// The REST client: one place that sends requests, reads the { data } or
// { error } envelope and turns failures into CliError values with a next step.

import { DecodeError, isRecord, type Decoder } from './decode.js'
import { errorBody } from './schema.js'
import { VERSION } from './version.js'

export const DEFAULT_API_URL = 'https://api.listspace.app/v1'

/** The fetch the client uses; tests pass a fake. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

/** A personal API token: "ls_" and 43 url-safe base64 characters. */
export type ApiToken = string & { readonly __brand: 'ApiToken' }

const TOKEN_PATTERN = /^ls_[A-Za-z0-9_-]{43}$/

export function parseToken(raw: string): ApiToken | null {
  const trimmed = raw.trim()
  return TOKEN_PATTERN.test(trimmed) ? (trimmed as ApiToken) : null
}

/** Why a command failed, with what to do about it. Exit codes are in main.ts. */
export type CliError =
  | { readonly kind: 'usage'; readonly message: string }
  | { readonly kind: 'auth'; readonly message: string }
  | { readonly kind: 'rate_limited'; readonly message: string; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'api'; readonly status: number; readonly code: string; readonly message: string }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'unexpected'; readonly message: string }

export class CliFailure extends Error {
  constructor(readonly error: CliError) {
    super(error.message)
    this.name = 'CliFailure'
  }
}

export const fail = (error: CliError): never => {
  throw new CliFailure(error)
}

export const LOGIN_HINT = 'Run `listspace login` with a personal token (ListSpace: Settings > API), or set LISTSPACE_TOKEN.'

export interface ApiClientOptions {
  readonly baseUrl: string
  readonly token: ApiToken
  readonly fetch: FetchFn
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Query = Record<string, string | number | boolean | undefined>

export interface Answer<T> {
  /** The parsed `data` (or the whole page for list endpoints). */
  readonly value: T
  /** The server's JSON as sent, for --json. */
  readonly raw: unknown
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  /** Sends one request and decodes `data` from the answer. */
  async data<T>(method: Method, path: string, decoder: Decoder<T>, init: { query?: Query; body?: unknown } = {}): Promise<Answer<T>> {
    const json = await this.send(method, path, init)
    if (!isRecord(json) || !('data' in json)) return fail({ kind: 'unexpected', message: 'Unexpected response from ListSpace: no data.' })
    return { value: decodeOrFail(decoder, json.data, 'data'), raw: json.data }
  }

  /** Sends one request and decodes the whole body (list endpoints with next_cursor). */
  async body<T>(method: Method, path: string, decoder: Decoder<T>, init: { query?: Query; body?: unknown } = {}): Promise<Answer<T>> {
    const json = await this.send(method, path, init)
    return { value: decodeOrFail(decoder, json, 'body'), raw: json }
  }

  private async send(method: Method, path: string, init: { query?: Query; body?: unknown }): Promise<unknown> {
    const url = new URL(this.options.baseUrl.replace(/\/+$/, '') + path)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.token}`,
      Accept: 'application/json',
      'User-Agent': `listspace-cli/${VERSION}`,
    }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await this.options.fetch(
        url.toString(),
        init.body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(init.body) },
      )
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      return fail({ kind: 'network', message: `Could not reach ListSpace at ${url.origin}: ${reason}` })
    }

    const text = await response.text()
    let json: unknown = null
    if (text !== '') {
      try {
        json = JSON.parse(text)
      } catch {
        if (response.ok) return fail({ kind: 'unexpected', message: `ListSpace answered ${response.status} with something that is not JSON.` })
      }
    }
    if (response.ok) return json
    return fail(errorFor(response, json))
  }
}

function decodeOrFail<T>(decoder: Decoder<T>, value: unknown, path: string): T {
  try {
    return decoder(value, path)
  } catch (error) {
    if (error instanceof DecodeError) return fail({ kind: 'unexpected', message: error.message })
    throw error
  }
}

/** Turns a failed answer into a CliError with the server's message and a next step. */
export function errorFor(response: Response, json: unknown): CliError {
  let code = 'unknown'
  let message = `ListSpace answered ${response.status}.`
  try {
    const parsed = errorBody(json, 'body')
    code = parsed.error.code
    message = parsed.error.message
  } catch {
    // Not the usual error envelope (a proxy page, say): keep the status message
  }

  if (response.status === 401) return { kind: 'auth', message: `${message} ${LOGIN_HINT}` }
  if (response.status === 429) {
    const header = response.headers.get('Retry-After')
    const seconds = header !== null && /^\d+$/.test(header) ? Number(header) : null
    const wait = seconds === null ? 'Wait a minute' : `Wait ${seconds} seconds`
    return { kind: 'rate_limited', message: `${message} ${wait} before trying again.`, retryAfterSeconds: seconds }
  }
  if (response.status === 403 && code === 'insufficient_scope') {
    return { kind: 'api', status: 403, code, message: `${message} This token is read only; create a read and write token in Settings > API.` }
  }
  return { kind: 'api', status: response.status, code, message }
}
