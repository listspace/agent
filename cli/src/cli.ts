// Argument parsing, the token, output and exit codes. `run` takes all its
// effects as arguments so tests can drive it without a network or a disk.

import { parseArgs } from 'node:util'

import { ApiClient, CliFailure, DEFAULT_API_URL, LOGIN_HINT, fail, parseToken, type ApiToken, type CliError, type FetchFn } from './api.js'
import {
  INBOX_STATUSES,
  accountCommand,
  addCommand,
  boardCommand,
  boardsCommand,
  claimCommand,
  doneCommand,
  inboxCommand,
  moveCommand,
  newBoardCommand,
  nextCommand,
  parseClaimMinutes,
  releaseCommand,
  sessionCommand,
  undoCommand,
  type ClaimMinutes,
  type InboxChoice,
  type Output,
} from './commands.js'
import { configDir, loadToken, removeToken, saveToken, type Env } from './config.js'
import { LIST_KINDS, account, type ListKind } from './schema.js'
import { VERSION } from './version.js'

export interface Io {
  readonly env: Env
  readonly fetch: FetchFn
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** Reads a token typed or piped in for `login`; null when there is none. */
  readonly readSecret: (prompt: string) => Promise<string | null>
  /** Overrides the OS config directory (tests). */
  readonly configDir?: string
}

export const HELP = `listspace ${VERSION}: ListSpace from the command line, for people and coding agents.

Usage: listspace <command> [arguments] [--json]

Sign in
  login [--token ls_...]    Save a personal token (ListSpace: Settings > API).
                            Without --token it reads the token from stdin.
  logout                    Forget the saved token.
  whoami                    Plan, freedom levels, guidance and boards (alias: account).

Read
  boards                    Your boards with their ids.
  session <board>           Start a work session: guidance, board instructions,
                            level, open work. Run this first.
  board <board>             Lists and items with their ids.
  inbox <board> [--status pending|accepted|rejected|withdrawn|expired|failed|all]

Write (the board's freedom level decides what is made and what waits in the Inbox)
  new-board <title> [--description <text>]   A board from "Project (for agents)".
  add <board> <list> <title> [--description <markdown>]
  move <item> <list>
  done <item>               Move to the board's done list.
  undo <request_id>         Take back one of your own calls.
  Writes take --inbox --reason "<why>" to suggest instead of change.

Work on your own (needs level 4, Act; other agents leave a claimed item alone)
  next <board> [--kinds todo,backlog] [--label <id>] [--no-move] [--ttl <minutes>]
                            Claim the top open item no one is working on and
                            move it to Doing. --kinds: lists to take from, in
                            order (default todo, then backlog). --label: only
                            items with this label (repeat or comma list).
                            --no-move: leave it in its list.
  claim <item> [--ttl <minutes>]   Claim an item, or renew your claim.
  release <item>            Release your claim when you stop (done or not).
  A claim lasts --ttl minutes (5 to 1440, default 120); any write of yours on
  the item renews it.

<board> is an id or a title, <list> an id, a title or a kind (todo, doing, done,
info, capture, backlog), <item> an item id.

Options
  --json      Print the API's JSON (for agents and scripts).
  --help      This help.  --version  The version.

Environment
  LISTSPACE_TOKEN        A token for this run (wins over the saved one).
  LISTSPACE_API_URL      Default ${DEFAULT_API_URL}
  LISTSPACE_CONFIG_DIR   Where credentials.json is kept.

Exit codes: 0 ok, 1 failed, 2 usage, 3 sign in needed, 4 rate limited (wait and retry).`

const EXIT: Record<CliError['kind'], number> = {
  usage: 2,
  auth: 3,
  rate_limited: 4,
  api: 1,
  network: 1,
  unexpected: 1,
}

const OPTIONS = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  token: { type: 'string' },
  description: { type: 'string' },
  inbox: { type: 'boolean' },
  reason: { type: 'string' },
  status: { type: 'string' },
  kinds: { type: 'string' },
  label: { type: 'string', multiple: true },
  'no-move': { type: 'boolean' },
  ttl: { type: 'string' },
} as const

type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values']

const usage = (message: string): never => fail({ kind: 'usage', message: `${message} Run \`listspace --help\`.` })

/** Exactly `names.length` positionals, or a usage error naming them. */
function positionals<const N extends readonly string[]>(command: string, given: readonly string[], names: N): { -readonly [K in keyof N]: string } {
  if (given.length !== names.length) {
    const wanted = names.length === 0 ? 'no arguments' : names.map((name) => `<${name}>`).join(' ')
    usage(`\`${command}\` takes ${wanted}${given.length > names.length && names.length > 0 ? ' (quote text with spaces)' : ''}.`)
  }
  // The length was checked just above: one string per name
  return [...given] as { -readonly [K in keyof N]: string }
}

function choiceFrom(flags: Flags): InboxChoice {
  const reason = flags.reason ?? null
  if (reason !== null && reason.length > 500) usage('--reason is at most 500 characters.')
  if (flags.inbox === true) {
    if (reason === null || reason.trim() === '') return usage('--inbox needs --reason "<why>": the user reads it when deciding.')
    return { kind: 'inbox', reason }
  }
  return { kind: 'direct', reason }
}

function ttlFrom(flags: Flags): ClaimMinutes | null {
  if (flags.ttl === undefined) return null
  const minutes = parseClaimMinutes(flags.ttl)
  if (minutes === null) return usage('--ttl is a whole number of minutes from 5 to 1440.')
  return minutes
}

/** --kinds todo,backlog: list kinds in order, each known and given once. */
function kindsFrom(flags: Flags): ListKind[] {
  if (flags.kinds === undefined) return []
  const kinds: ListKind[] = []
  for (const part of flags.kinds.split(',')) {
    const wanted = part.trim().toLowerCase()
    const kind = LIST_KINDS.find((candidate) => candidate === wanted)
    if (kind === undefined) return usage(`--kinds takes a comma list of ${LIST_KINDS.join(', ')}; "${part.trim()}" is not one.`)
    if (!kinds.includes(kind)) kinds.push(kind)
  }
  return kinds
}

/** --label <id>, repeated or as a comma list. */
const labelsFrom = (flags: Flags): string[] => [
  ...new Set((flags.label ?? []).flatMap((value) => value.split(',')).map((id) => id.trim()).filter((id) => id !== '')),
]

async function clientFor(io: Io, dir: string): Promise<ApiClient> {
  const source = await loadToken(io.env, dir)
  switch (source.kind) {
    case 'env':
    case 'file':
      return new ApiClient({ baseUrl: apiUrl(io.env), token: source.token, fetch: io.fetch })
    case 'none':
      return fail({ kind: 'auth', message: `Not signed in. ${LOGIN_HINT}` })
    case 'invalid':
      return fail({ kind: 'auth', message: `The token in ${source.where} is not a ListSpace token (ls_ and 43 characters). ${LOGIN_HINT}` })
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}

const apiUrl = (env: Env): string => {
  const url = env.LISTSPACE_API_URL
  return url !== undefined && url !== '' ? url : DEFAULT_API_URL
}

/**
 * How `login` gets its token. Today: --token, or a token typed or piped in.
 * TODO(PR 9, device pairing): without --token, start pairing instead (show a
 * code and a listspace.app link, poll until the user approves, save the token
 * the server issues). The 'pairing' kind is where that goes; --token and a
 * piped token stay for scripts and CI.
 */
type LoginMethod = { readonly kind: 'token'; readonly raw: string } | { readonly kind: 'pairing' }

async function loginMethod(flags: Flags, io: Io): Promise<LoginMethod> {
  if (flags.token !== undefined) return { kind: 'token', raw: flags.token }
  const typed = await io.readSecret('Paste a personal token from ListSpace (Settings > API): ')
  if (typed === null || typed.trim() === '') return { kind: 'pairing' }
  return { kind: 'token', raw: typed }
}

async function login(flags: Flags, io: Io, dir: string): Promise<Output> {
  const method = await loginMethod(flags, io)
  if (method.kind === 'pairing') {
    return usage('No token given. Pass --token ls_... or pipe one in (signing in from the browser comes later).')
  }
  const token: ApiToken | null = parseToken(method.raw)
  if (token === null) return usage('That is not a ListSpace token: it starts with ls_ and has 43 more characters.')
  // Check the token before saving it, so a typo never replaces a working one
  const client = new ApiClient({ baseUrl: apiUrl(io.env), token, fetch: io.fetch })
  const answer = await client.data('GET', '/account', account)
  const path = await saveToken(dir, token)
  const text = [`Signed in (plan ${answer.value.plan.name}, ${answer.value.boards.length} boards). Token saved in ${path}.`]
  if (io.env.LISTSPACE_TOKEN !== undefined && io.env.LISTSPACE_TOKEN !== '') text.push('Note: LISTSPACE_TOKEN is set and wins over the saved token.')
  return { raw: { signed_in: true, path }, text: text.join('\n') }
}

async function dispatch(command: string, args: readonly string[], flags: Flags, io: Io, dir: string): Promise<Output> {
  switch (command) {
    case 'login':
      positionals(command, args, [])
      return login(flags, io, dir)
    case 'logout': {
      positionals(command, args, [])
      const removed = await removeToken(dir)
      return { raw: { signed_out: removed }, text: removed ? 'Signed out: the saved token is gone (revoke it in Settings > API if it leaked).' : 'No saved token.' }
    }
    case 'whoami':
    case 'account':
      positionals(command, args, [])
      return accountCommand(await clientFor(io, dir))
    case 'boards':
      positionals(command, args, [])
      return boardsCommand(await clientFor(io, dir))
    case 'session': {
      const [board] = positionals(command, args, ['board'])
      return sessionCommand(await clientFor(io, dir), { board })
    }
    case 'board': {
      const [board] = positionals(command, args, ['board'])
      return boardCommand(await clientFor(io, dir), { board })
    }
    case 'new-board': {
      const [title] = positionals(command, args, ['title'])
      return newBoardCommand(await clientFor(io, dir), { title, description: flags.description ?? null })
    }
    case 'add': {
      const [board, list, title] = positionals(command, args, ['board', 'list', 'title'])
      const choice = choiceFrom(flags)
      return addCommand(await clientFor(io, dir), { board, list, title, description: flags.description ?? null, choice })
    }
    case 'move': {
      const [item, list] = positionals(command, args, ['item', 'list'])
      const choice = choiceFrom(flags)
      return moveCommand(await clientFor(io, dir), { item, list, choice })
    }
    case 'done': {
      const [item] = positionals(command, args, ['item'])
      const choice = choiceFrom(flags)
      return doneCommand(await clientFor(io, dir), { item, choice })
    }
    case 'inbox': {
      const [board] = positionals(command, args, ['board'])
      const wanted = flags.status ?? 'pending'
      const status = INBOX_STATUSES.find((candidate) => candidate === wanted)
      if (status === undefined) return usage(`--status is one of ${INBOX_STATUSES.join(', ')}.`)
      return inboxCommand(await clientFor(io, dir), { board, status })
    }
    case 'next': {
      const [board] = positionals(command, args, ['board'])
      const input = { board, kinds: kindsFrom(flags), labelIds: labelsFrom(flags), moveToDoing: flags['no-move'] !== true, ttl: ttlFrom(flags) }
      return nextCommand(await clientFor(io, dir), input)
    }
    case 'claim': {
      const [item] = positionals(command, args, ['item'])
      const ttl = ttlFrom(flags)
      return claimCommand(await clientFor(io, dir), { item, ttl })
    }
    case 'release': {
      const [item] = positionals(command, args, ['item'])
      return releaseCommand(await clientFor(io, dir), { item })
    }
    case 'undo': {
      const [requestId] = positionals(command, args, ['request_id'])
      return undoCommand(await clientFor(io, dir), { requestId })
    }
    default:
      return usage(`Unknown command "${command}".`)
  }
}

/** Runs one invocation and returns the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  let json = argv.includes('--json')
  try {
    let parsed
    try {
      parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
    } catch (error) {
      return usage(error instanceof Error ? error.message : String(error))
    }
    const flags = parsed.values
    json = flags.json === true
    const [command, ...args] = parsed.positionals
    if (flags.version === true) {
      io.stdout(json ? JSON.stringify({ version: VERSION }) : VERSION)
      return 0
    }
    if (command === undefined || command === 'help' || flags.help === true) {
      io.stdout(HELP)
      return 0
    }
    const dir = io.configDir ?? configDir(io.env)
    const output = await dispatch(command, args, flags, io, dir)
    io.stdout(json ? JSON.stringify(output.raw, null, 2) : output.text)
    return 0
  } catch (error) {
    if (!(error instanceof CliFailure)) throw error
    const failure = error.error
    if (json) {
      io.stdout(JSON.stringify({ error: errorJson(failure) }, null, 2))
    } else {
      io.stderr(`listspace: ${failure.message}`)
    }
    return EXIT[failure.kind]
  }
}

function errorJson(error: CliError): Record<string, unknown> {
  switch (error.kind) {
    case 'api':
      return { kind: error.kind, status: error.status, code: error.code, message: error.message }
    case 'rate_limited':
      return { kind: error.kind, message: error.message, retry_after_seconds: error.retryAfterSeconds }
    case 'usage':
    case 'auth':
    case 'network':
    case 'unexpected':
      return { kind: error.kind, message: error.message }
    default: {
      const exhaustive: never = error
      return exhaustive
    }
  }
}
