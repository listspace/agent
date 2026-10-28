// The client: one place that sends requests to the REST API and the MCP
// server, reads their answers and turns failures into CliError values with a
// next step.

import { DecodeError, array, boolean, isRecord, nullable, object, record, string, withDefault, type Decoded, type Decoder } from './decode.js'
import { errorBody } from './schema.js'
import { VERSION } from './version.js'

export const DEFAULT_API_URL = 'https://api.listspace.app/v1'

/** The MCP server: `call`, `tools` and the commands built on them run its tools, with the same token. */
export const DEFAULT_MCP_URL = 'https://mcp.listspace.app'

/**
 * The MCP protocol version the CLI speaks. The server is stateless, so each
 * tools/call stands alone: no initialize first, and the answer is plain JSON.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

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
  /** The tool ran and refused or failed (isError): a level refusal, a wrong argument, a missing item. */
  | { readonly kind: 'tool'; readonly tool: string; readonly message: string; readonly details: Readonly<Record<string, unknown>> | null }

export class CliFailure extends Error {
  constructor(readonly error: CliError) {
    super(error.message)
    this.name = 'CliFailure'
  }
}

export const fail = (error: CliError): never => {
  throw new CliFailure(error)
}

export const LOGIN_HINT = 'Run `listspace login` with a personal token (Listspace: Settings > Your AI > API tokens), or set LISTSPACE_TOKEN.'

export interface ApiClientOptions {
  readonly baseUrl: string
  /** The MCP server for callTool and listTools. Default DEFAULT_MCP_URL. */
  readonly mcpUrl?: string
  readonly token: ApiToken
  readonly fetch: FetchFn
  /** A new Idempotency-Key for each POST; tests pass a fixed one. Default: a random UUID. */
  readonly newKey?: () => string
  /** Waits before the one retry; tests pass one that does not wait. */
  readonly sleep?: (ms: number) => Promise<void>
}

/** Answers that may hide a write that happened (a proxy or a restart): a POST is sent again once, with the same key. */
const RETRY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504])

/** How long to wait before that retry. */
export const RETRY_DELAY_MS = 1500

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
    if (!isRecord(json) || !('data' in json)) return fail({ kind: 'unexpected', message: 'Unexpected response from Listspace: no data.' })
    return { value: decodeOrFail(decoder, json.data, 'data'), raw: json.data }
  }

  /** Sends one request and decodes the whole body (list endpoints with next_cursor). */
  async body<T>(method: Method, path: string, decoder: Decoder<T>, init: { query?: Query; body?: unknown } = {}): Promise<Answer<T>> {
    const json = await this.send(method, path, init)
    return { value: decodeOrFail(decoder, json, 'body'), raw: json }
  }

  /**
   * PUTs a file to a signed storage link (get_upload_link for a large file).
   * The link is the credential: no token is sent with it. The Blob's size
   * is the Content-Length, which the link signed.
   */
  async putToStorage(url: string, file: Blob): Promise<void> {
    let response: Response
    try {
      response = await this.options.fetch(url, { method: 'PUT', body: file, headers: { 'User-Agent': `listspace-cli/${VERSION}` } })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      return fail({ kind: 'network', message: `Could not send the file to Listspace's file storage: ${reason}` })
    }
    await response.body?.cancel()
    if (!response.ok) {
      return fail({ kind: 'api', status: response.status, code: 'upload_failed', message: `Listspace's file storage refused the file (HTTP ${response.status}). Run the command again for a new link.` })
    }
  }

  /** POSTs to an upload link's finish address (no body; the link is the credential) and decodes `data`. */
  async finishUpload<T>(url: string, decoder: Decoder<T>): Promise<Answer<T>> {
    const { response, json } = await this.exchange(new URL(url), { method: 'POST', headers: { Accept: 'application/json', 'User-Agent': `listspace-cli/${VERSION}` } }, false)
    if (!response.ok) return fail(errorFor(response, json))
    if (!isRecord(json) || !('data' in json)) return fail({ kind: 'unexpected', message: 'Unexpected response from Listspace: no data.' })
    return { value: decodeOrFail(decoder, json.data, 'data'), raw: json.data }
  }

  /** A new idempotency key: a random UUID, or the tests' own. */
  newKey(): string {
    return (this.options.newKey ?? (() => crypto.randomUUID()))()
  }

  /**
   * Runs one MCP tool by name, as the MCP server runs it for any client: the
   * same token, agent access level checks and result. `retry`: the call is
   * safe to send once more after a lost answer (a read, or a write with an
   * idempotency_key).
   */
  async callTool(name: string, args: Readonly<Record<string, unknown>>, retry: boolean): Promise<ToolAnswer> {
    const result = decodeOrFail(toolResult, await this.rpc('tools/call', { name, arguments: args }, retry), 'result')
    const text = result.content.flatMap((part) => (part.text === null ? [] : [part.text])).join('\n')
    if (result.isError) {
      return fail({ kind: 'tool', tool: name, message: text === '' ? `${name} failed.` : text, details: result.structuredContent })
    }
    return { value: result.structuredContent ?? parseText(text) }
  }

  /** The tools this token can use, as the MCP server lists them (a read-only token sees no write tools). */
  async listTools(): Promise<ToolInfo[]> {
    return decodeOrFail(toolList, await this.rpc('tools/list', {}, true), 'result').tools
  }

  /** One JSON-RPC request to the MCP server: its result, or a CliError for its error. */
  private async rpc(method: string, params: Readonly<Record<string, unknown>>, retry: boolean): Promise<unknown> {
    const url = new URL(this.options.mcpUrl ?? DEFAULT_MCP_URL)
    const request: RequestInit = {
      method: 'POST',
      headers: {
        ...this.identity(),
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }
    const { response, json } = await this.exchange(url, request, retry)
    const rpcError = isRecord(json) && isRecord(json.error) && typeof json.error.message === 'string' && typeof json.error.code === 'number' ? json.error : null
    if (rpcError !== null) {
      const message = String(rpcError.message)
      if (message.startsWith('Unknown tool')) return fail({ kind: 'usage', message: `${message}. Run \`listspace tools\` to see the tools.` })
      if (rpcError.code === INVALID_PARAMS) return fail({ kind: 'usage', message })
      return fail({ kind: 'unexpected', message: `The Listspace MCP server answered: ${message}` })
    }
    if (!response.ok) return fail(errorFor(response, json))
    if (!isRecord(json) || !('result' in json)) return fail({ kind: 'unexpected', message: 'Unexpected response from the Listspace MCP server: no result.' })
    return json.result
  }

  /** The headers that say who is asking. The token goes only here, never into a message. */
  private identity(): Record<string, string> {
    return { Authorization: `Bearer ${this.options.token}`, 'User-Agent': `listspace-cli/${VERSION}` }
  }

  private async send(method: Method, path: string, init: { query?: Query; body?: unknown }): Promise<unknown> {
    const url = new URL(this.options.baseUrl.replace(/\/+$/, '') + path)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = { ...this.identity(), Accept: 'application/json' }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'

    // Every POST carries its own Idempotency-Key, so the retry below (or the agent's own) never makes a second copy
    if (method === 'POST') headers['Idempotency-Key'] = this.newKey()
    const request = init.body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(init.body) }

    const { response, json } = await this.exchange(url, request, method === 'POST')
    if (response.ok) return json
    return fail(errorFor(response, json))
  }

  /** Sends one request (once more when `retry` allows) and parses its JSON; the caller reads the status. */
  private async exchange(url: URL, request: RequestInit, retry: boolean): Promise<{ response: Response; json: unknown }> {
    let response: Response
    try {
      response = await this.attempt(url, request, retry)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      return fail({ kind: 'network', message: `Could not reach Listspace at ${url.origin}: ${reason}` })
    }

    const text = await response.text()
    let json: unknown = null
    if (text !== '') {
      try {
        json = JSON.parse(text)
      } catch {
        if (response.ok) return fail({ kind: 'unexpected', message: `Listspace answered ${response.status} with something that is not JSON.` })
      }
    }
    return { response, json }
  }

  /** One request; a write is sent once more, with the same key, after a network error or a 502, 503 or 504. */
  private async attempt(url: URL, request: RequestInit, retry: boolean): Promise<Response> {
    let first: Response
    try {
      first = await this.options.fetch(url.toString(), request)
    } catch (cause) {
      if (!retry) throw cause
      await this.wait()
      return await this.options.fetch(url.toString(), request)
    }
    if (!retry || !RETRY_STATUSES.has(first.status) || (await isMaintenance(first))) return first
    await this.wait()
    return await this.options.fetch(url.toString(), request)
  }

  private async wait(): Promise<void> {
    await (this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(RETRY_DELAY_MS)
  }
}

/** JSON-RPC "Invalid params": a tools/call the server could not take. */
const INVALID_PARAMS = -32602

/** What a tool returned: its structured result, or its text (as JSON when it is JSON) when it has none. */
export interface ToolAnswer {
  readonly value: unknown
}

const toolResult = object({
  content: array(object({ type: string, text: withDefault(nullable(string), null) })),
  structuredContent: withDefault(nullable(record), null),
  isError: withDefault(boolean, false),
})

const toolInfo = object({
  name: string,
  title: withDefault(nullable(string), null),
  description: withDefault(string, ''),
  inputSchema: record,
})
export type ToolInfo = Decoded<typeof toolInfo>

const toolList = object({ tools: array(toolInfo) })

function parseText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** A 503 for maintenance changed nothing and lasts longer than a retry: it is passed on as it is. */
async function isMaintenance(response: Response): Promise<boolean> {
  if (response.status !== 503) return false
  try {
    return errorBody(JSON.parse(await response.clone().text()), 'body').error.code === 'maintenance'
  } catch {
    return false
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
  let message = `Listspace answered ${response.status}.`
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
    return { kind: 'api', status: 403, code, message: `${message} This token is read only; create a read and write token in Settings > Your AI > API tokens.` }
  }
  return { kind: 'api', status: response.status, code, message }
}
