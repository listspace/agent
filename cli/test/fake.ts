// A fake ListSpace API for the tests: answers by "METHOD /path" and records
// every request, so tests check both what the CLI sent and what it printed.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FetchFn } from '../src/api.js'
import { run, type Io } from '../src/cli.js'

export const TOKEN = `ls_${'a'.repeat(43)}`
export const BOARD_ID = '11111111-1111-4111-8111-111111111111'
export const ITEM_ID = '22222222-2222-4222-8222-222222222222'

export interface Sent {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Headers
  readonly body: unknown
}

export interface Reply {
  readonly status?: number
  readonly body?: unknown
  readonly headers?: Record<string, string>
}

export type Routes = Record<string, Reply | ((sent: Sent) => Reply)>

export function fakeApi(routes: Routes): { fetch: FetchFn; sent: Sent[] } {
  const sent: Sent[] = []
  const fetch: FetchFn = async (url, init) => {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\/v1/, '')
    const bodyText = typeof init.body === 'string' ? init.body : null
    const request: Sent = {
      method: init.method ?? 'GET',
      path,
      query: parsed.searchParams,
      headers: new Headers(init.headers),
      body: bodyText === null ? undefined : JSON.parse(bodyText),
    }
    sent.push(request)
    const route = routes[`${request.method} ${path}`]
    if (route === undefined) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'No such endpoint.' } }), { status: 404 })
    }
    const reply = typeof route === 'function' ? route(request) : route
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...reply.headers },
    })
  }
  return { fetch, sent }
}

export interface Run {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly sent: Sent[]
}

/** Runs the CLI against fake routes with a token in the environment. */
export async function runCli(
  argv: string[],
  routes: Routes,
  options: { env?: Record<string, string>; secret?: string | null; configDir?: string } = {},
): Promise<Run> {
  const api = fakeApi(routes)
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    env: options.env ?? { LISTSPACE_TOKEN: TOKEN },
    fetch: api.fetch,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readSecret: async () => options.secret ?? null,
    configDir: options.configDir ?? (await tempDir()),
  }
  const code = await run(argv, io)
  return { code, stdout: out.join('\n'), stderr: err.join('\n'), sent: api.sent }
}

export const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'listspace-cli-test-'))

// ---- Sample answers, shaped like docs/API.md ----

export const level3 = { effective: 3, name: 'Capture' }

export const accountBody = {
  data: {
    guidance: 'Write in British English.',
    default_level: { effective: 3, name: 'Capture', desired: 3, limited_by_plan: false },
    plan: { name: 'Free', max_agent_level: 5 },
    max_suggestions_per_hour: 50,
    boards: [{ id: BOARD_ID, title: 'Website', url: 'https://listspace.app/board/b', level: level3, follows_account: true, inbox_pending: 2, has_instructions: true }],
    levels: [],
  },
}

export const boardsBody = {
  data: [
    { id: BOARD_ID, title: 'Website', description: '', website_url: null, archived: false, created_at: '', updated_at: '', url: 'https://listspace.app/board/b' },
    { id: '33333333-3333-4333-8333-333333333333', title: 'Web shop', description: '', website_url: null, archived: false, created_at: '', updated_at: '', url: 'u' },
  ],
  next_cursor: null,
}

const list = (id: string, title: string, kind: string | null) => ({ id, board_id: BOARD_ID, title, position: 0, archived: false, kind, cards: [] })

export const boardBody = {
  data: {
    guidance: null,
    instructions: 'Capture ideas and bugs freely.',
    level: level3,
    id: BOARD_ID,
    title: 'Website',
    url: 'https://listspace.app/board/b',
    lists: [
      list('l-info', 'Project info', 'info'),
      list('l-ideas', 'Ideas', 'capture'),
      list('l-bugs', 'Bugs', 'capture'),
      list('l-todo', 'To do', 'todo'),
      list('l-doing', 'Doing', 'doing'),
      list('l-done', 'Done', 'done'),
    ],
    labels: [],
    truncated: false,
  },
}

export const itemBody = {
  data: { id: ITEM_ID, board_id: BOARD_ID, list_id: 'l-todo', title: 'Fix the footer', url: 'https://listspace.app/board/b/card/i' },
}

export const appliedBody = (extra: Record<string, unknown> = {}) => ({
  data: { outcome: 'applied', level: level3, undo: { request_id: 'req-1' }, ...itemBody.data, ...extra },
})

export const suggestedBody = {
  data: { outcome: 'suggested', level: level3, message: 'At level 3 this waits in the Inbox.', suggestion: { id: 'sug-1', status: 'pending' } },
}
