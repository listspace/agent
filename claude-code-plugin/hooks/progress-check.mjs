#!/usr/bin/env node
// Listspace progress check for Claude Code (hooks.json runs it on two events).
//
// Agents keep the Listspace board up to date while they work (the server
// instructions say so), but in a long coding turn the board is easy to
// forget. This check catches a turn that did work and told the board
// nothing:
//
//   tool   (PostToolUse) notes work: a file changed (Edit, Write, MultiEdit,
//          NotebookEdit), or a shell command that commits, pushes or merges
//          with git, creates or merges a pull request with gh, or deploys.
//          For a Listspace tool it notes that Listspace is in use in this
//          session, and for a Listspace write (anything that is not a read)
//          that the board was updated. Only the fact is kept, never the
//          command or the file.
//   stop   (Stop) blocks the stop once with one line when Listspace is in use
//          in this session, work was done since the last check, and no
//          Listspace write came after it. Then it waits at least NUDGE_EVERY
//          turns before it nudges again, so it never nags. Never on a stop
//          that a block already continued (stop_hook_active), so it cannot
//          loop, and never in a session that has not used Listspace.
//
// No model call and no network. State is a few small files per session in
// the plugin's data folder (CLAUDE_PLUGIN_DATA, only the user can read them),
// removed after a week. Without that folder the check does nothing. Any error
// lets the turn end as usual: this check must never get in the way.

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listspaceTool } from './decision-check.mjs'

/** The line that sends the agent back. */
export const NUDGE = 'Update the Listspace board: what did you start or finish this turn? Move the item, add a short comment.'

/** Turns (stops) to wait after a nudge before the next one. */
export const NUDGE_EVERY = 3

/** How long a session's files are kept. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000

// ---- The rules (pure) ----------------------------------------------------------------------------

/** Tools that change files. */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Shell tools whose command is read. */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/** git commit, push or merge, with options before the subcommand (git -C dir commit). */
const GIT_WORK = /(?:^|[\s;&|(])git(?:\s+-[cC]\s+\S+|\s+--?[A-Za-z][\w-]*(?:=\S+)?)*\s+(?:commit|push|merge)\b/
/** gh pr create or merge. */
const GH_WORK = /(?:^|[\s;&|(])gh\s+pr\s+(?:create|merge)\b/
/** A deploy: a deploy script or a deploy command of a common tool. */
const DEPLOY = /(?:^|[\s;&|(/\\])(?:deploy(?:[-_.\w]*)?\.(?:sh|ps1|mjs|js|py)\b|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?deploy\b|vercel\s+(?:deploy|--prod)\b|netlify\s+deploy\b|fly(?:ctl)?\s+deploy\b|wrangler\s+(?:deploy|publish)\b|firebase\s+deploy\b|kubectl\s+(?:apply|rollout)\b|helm\s+(?:install|upgrade)\b|terraform\s+apply\b|railway\s+up\b|(?:serverless|sls)\s+deploy\b|cdk\s+deploy\b|gcloud\s+(?:app|run)\s+deploy\b|eb\s+deploy\b)/i

/** Whether a shell command commits, pushes, merges, opens or merges a pull request, or deploys. */
export function isWorkCommand(command) {
  if (typeof command !== 'string') return false
  return GIT_WORK.test(command) || GH_WORK.test(command) || DEPLOY.test(command)
}

/** Whether a tool call (not a Listspace one) is work the board should hear about. */
export function isWork(toolName, toolInput) {
  if (FILE_TOOLS.has(toolName)) return true
  if (SHELL_TOOLS.has(toolName)) return isWorkCommand(toolInput?.command)
  return false
}

/** Listspace tools that only read. send_feedback writes to the Listspace team, not the board. */
const READS = /^(?:get_|list_|search_|export_)/
const OTHER_READS = new Set(['start_session', 'catch_up', 'my_items', 'my_requests', 'board_report', 'send_feedback'])

/** Whether a Listspace tool updates the board: create_item, move_item, add_comment, record_decision, capture and the rest. */
export function isListspaceWrite(tool) {
  return typeof tool === 'string' && tool !== '' && !READS.test(tool) && !OTHER_READS.has(tool)
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A result Claude Code marks as failed (an MCP isError result). */
export function failed(toolResponse) {
  return isObject(toolResponse) && toolResponse.isError === true
}

/**
 * Whether to nudge at this stop. state: { listspace, work, turn, nudgedAt }:
 * Listspace is in use in this session, work was done with no Listspace write
 * after it, this stop's turn number, and the turn of the last nudge (null:
 * none yet).
 */
export function shouldNudge(state) {
  if (!state.listspace || !state.work) return false
  return state.nudgedAt === null || state.turn - state.nudgedAt >= NUDGE_EVERY
}

// ---- The state (a few files per session) ---------------------------------------------------------

/** The plugin's data folder, or null without one: never a shared folder such as /tmp. */
const stateDir = (env) => (typeof env.CLAUDE_PLUGIN_DATA === 'string' && env.CLAUDE_PLUGIN_DATA !== '' ? join(env.CLAUDE_PLUGIN_DATA, 'progress-check') : null)
const safeId = (sessionId) => String(sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100)

/** Only the user reads the folder and the files (on Windows the user's profile already keeps them private). */
const DIR_MODE = 0o700
const FILE_MODE = 0o600

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const readNumber = async (path) => {
  const value = Number.parseInt((await readText(path)) ?? '', 10)
  return Number.isFinite(value) ? value : null
}

/** Removes files of sessions older than a week; best effort. */
async function prune(dir, now) {
  for (const name of await readdir(dir).catch(() => [])) {
    const path = join(dir, name)
    const info = await stat(path).catch(() => null)
    if (info !== null && now - info.mtimeMs > KEEP_MS) await rm(path, { force: true }).catch(() => {})
  }
}

/**
 * Handles one hook event. Returns what to print on stdout ('' for nothing).
 * Work and a board update are separate files, so two tool calls finishing at
 * once never overwrite each other's note.
 */
export async function handle(event, input, env = process.env, now = Date.now()) {
  const id = safeId(input?.session_id)
  const dir = stateDir(env)
  if (id === '' || dir === null) return ''
  const file = (suffix) => join(dir, `${id}.${suffix}`)
  const write = async (suffix, text) => {
    await mkdir(dir, { recursive: true, mode: DIR_MODE })
    await writeFile(file(suffix), text, { mode: FILE_MODE })
  }
  switch (event) {
    case 'tool': {
      if (failed(input.tool_response)) return ''
      const tool = listspaceTool(input.tool_name)
      if (tool !== null) {
        await write('listspace', '1')
        // Work before it is reported now; work after it needs a new update
        if (isListspaceWrite(tool)) await rm(file('work'), { force: true })
        return ''
      }
      if (isWork(input.tool_name, input.tool_input)) await write('work', '1')
      return ''
    }
    case 'stop': {
      if (input.stop_hook_active === true) return ''
      // Every stop, also in a session without Listspace: its work notes are files too
      await prune(dir, now)
      const listspace = await exists(file('listspace'))
      if (!listspace) return ''
      const turn = ((await readNumber(file('turn'))) ?? 0) + 1
      await write('turn', String(turn))
      const state = {
        listspace,
        work: await exists(file('work')),
        turn,
        nudgedAt: await readNumber(file('nudged')),
      }
      if (!shouldNudge(state)) return ''
      // Counted as checked: the next nudge needs new work, and NUDGE_EVERY turns
      await rm(file('work'), { force: true })
      await write('nudged', String(turn))
      return JSON.stringify({ decision: 'block', reason: NUDGE })
    }
    default:
      return ''
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const input = JSON.parse(await readStdin())
    const out = await handle(process.argv[2], input)
    if (out !== '') process.stdout.write(out)
  } catch {
    // Never in the way: any problem lets the turn go on as usual
  }
  process.exit(0)
}
