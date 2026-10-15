#!/usr/bin/env node
// Listspace board context for Claude Code (hooks.json runs it on two events).
//
// The board rules come with the Listspace server's instructions, which Claude
// reads at the start of a session. In a long session, and most of all after
// the conversation is compacted, they are easy to lose. These hooks put them
// back in Claude's context at the moments that matter:
//
//   session (SessionStart: startup, resume, clear, compact) adds the board
//           rule. At the start it says to start from the board; after a
//           compaction it says to look up the open work (get_account lists
//           claimed_by_you and started_by_you) and update it before going
//           on. Only in a project that names its board (a "Listspace board:"
//           line in CLAUDE.md or AGENTS.md, here or in a folder above, up to
//           the repository root) or a session that used a Listspace tool
//           (the progress check's note).
//   ship    (PostToolUse, Bash and PowerShell) after a command that opens or
//           merges a pull request with gh or deploys, and worked, adds one
//           line: move the matching item and add a short comment. Only where
//           Listspace is in use, as above.
//
// Context only: these hooks never block anything and never change a command
// or its output. No model call and no network. They read the project's
// CLAUDE.md and AGENTS.md (only a board link that matches the Listspace
// address is used, never other text) and the progress check's note in the
// plugin's data folder; they write nothing. Any error prints nothing and the
// session goes on as usual.

import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { failed, shipKind, listspaceInUse } from './progress-check.mjs'

/** The board rule, as the server says it in its reminders. */
export const BOARD_RULE = 'Keep the board current as you work: when you start or finish an item, move it and add a short comment on what you did.'

/** A board link in a "Listspace board:" line; only the Listspace address with a board id. */
const BOARD_LINE = /^\s*(?:[-*]\s*)?Listspace board:\s*<?(https:\/\/listspace\.app\/board\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))\/?>?\s*$/im

/** The files a project names its board in. */
const PROJECT_FILES = ['CLAUDE.md', 'AGENTS.md']

/** How many folders up the search goes, at most (it stops at the repository root). */
const MAX_LEVELS = 8

// ---- The rules (pure) ----------------------------------------------------------------------------

/** The board a project file names: { url, id }, or null. */
export function boardIn(text) {
  const match = typeof text === 'string' ? BOARD_LINE.exec(text) : null
  return match === null ? null : { url: match[1], id: match[2] }
}

/** The line for a session start. source: startup, resume, clear, compact or fork. board: { url, id } or null. */
export function sessionText(source, board) {
  const where = board === null ? 'the Listspace board you work on' : `the project's Listspace board (${board.url})`
  if (source === 'compact') {
    return [
      `Listspace: your context was just compacted, so the board rules may be gone from it. ${BOARD_RULE}`,
      `Before you go on, call get_account (or start_session on ${where}): claimed_by_you and started_by_you list the items you were working on. Move each finished one to Done with a short comment on what you did, comment on the ones still going, and act on any board_reminder in a result.`,
    ].join(' ')
  }
  return [
    `Listspace: this project keeps its work on ${where}.`,
    `Start with get_account, then start_session on that board, and update the items in unfinished_from_last_sessions first. ${BOARD_RULE}`,
  ].join(' ')
}

/** The line after a pull request or a deploy. */
export function shipText(kind) {
  switch (kind) {
    case 'pr_opened':
      return `Listspace: you opened a pull request. Move the matching item to Doing (or keep it there) and add a short comment with the link. ${BOARD_RULE}`
    case 'pr_merged':
      return `Listspace: you merged a pull request. Move the matching item to Done and add a short comment with the link. ${BOARD_RULE}`
    case 'deployed':
      return `Listspace: you deployed. Move the matching item to Done (or comment on where it stands) and say what went live. ${BOARD_RULE}`
    default:
      return ''
  }
}

/** The JSON that adds context for Claude, for a hook event. */
export function contextOutput(hookEventName, text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } })
}

// ---- The project and the session ------------------------------------------------------------------

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** The board the project names, looking in cwd and the folders above it up to the repository root. */
export async function projectBoard(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return null
  let dir = cwd
  for (let level = 0; level < MAX_LEVELS; level++) {
    for (const name of PROJECT_FILES) {
      const board = boardIn(await readFile(join(dir, name), 'utf8').catch(() => null))
      if (board !== null) return board
    }
    const parent = dirname(dir)
    if (parent === dir || (await exists(join(dir, '.git')))) break
    dir = parent
  }
  return null
}

/**
 * Handles one hook event. Returns what to print on stdout ('' for nothing).
 */
export async function handle(event, input, env = process.env) {
  if (typeof input !== 'object' || input === null) return ''
  const board = await projectBoard(input.cwd)
  const inUse = board !== null || (await listspaceInUse(input.session_id, env))
  if (!inUse) return ''
  switch (event) {
    case 'session':
      return contextOutput('SessionStart', sessionText(input.source, board))
    case 'ship': {
      if (failed(input.tool_response)) return ''
      const kind = shipKind(input.tool_input?.command)
      return kind === null ? '' : contextOutput('PostToolUse', shipText(kind))
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
    // Never in the way: any problem prints nothing and the session goes on
  }
  process.exit(0)
}
