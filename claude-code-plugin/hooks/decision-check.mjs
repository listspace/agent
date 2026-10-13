#!/usr/bin/env node
// Listspace decision check for Claude Code (hooks.json runs it on three events).
//
// When the user picks an option, says yes to a proposal or corrects a fact,
// the agent should record it on the Listspace board as a Proposed decision
// (record_decision). This check catches a turn where that did not happen:
//
//   prompt      (UserPromptSubmit) reads the user's words against what the
//               agent said last, and starts the turn with nothing recorded.
//               Only a prompt that reads like a decision leaves a note: its
//               first line, cut at 80 characters. Nothing else is written.
//   tool        (PostToolUse, Listspace tools only) notes that Listspace is in
//               use in this session, and that a decision was recorded in this
//               turn (record_decision, propose_decision_change, or end_session
//               with decisions). It also notes the board the session is on
//               (the call's board_id, or the board get_board or start_session
//               returns) and the boards where the owner switched decisions
//               off. The switch is read from its own fields only
//               (decisions.on in get_board and start_session, decisions_on
//               false in the result of record_decision, which then adds a
//               normal item, and the refusal of a decision tool), never from
//               item text, and kept per board.
//   stop        (Stop) blocks the stop once, with a one-line check, when
//               Listspace is in use, nothing was recorded this turn, and the
//               prompt left a note, unless decisions are off on the board the
//               session is on. Never on a stop that a block already
//               continued (stop_hook_active), so it cannot loop. It also notes
//               whether the agent's last message offered a choice (yes or no,
//               not the text), for the next prompt to read a "yes" against.
//
// No model call and no network: plain rules on the user's words, so it costs
// nothing and answers in milliseconds. The rules lean to silence: a yes to an
// action ("Shall I run the tests?" "yes"), a maybe or a bug report is not a
// decision. State is a few small files per session in the plugin's data folder
// (CLAUDE_PLUGIN_DATA, only the user can read them), removed after a week.
// Without that folder the check does nothing. Any error lets the turn end as
// usual: this check must never get in the way.

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Listspace's MCP tools: from this plugin (mcp__plugin_listspace_listspace__) or a server the user added as listspace. */
const LISTSPACE_TOOL = /^mcp__(?:plugin_listspace_)?listspace__([a-z_]+)$/

/** The longest prompt read for decision words; a longer one (a pasted log, a spec) is not a quick answer. */
const PROMPT_MAX = 600

/** How long a session's files are kept. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000

// ---- The rules (pure) ----------------------------------------------------------------------------

/** The Listspace tool a tool name is, or null. */
export function listspaceTool(toolName) {
  const match = typeof toolName === 'string' ? LISTSPACE_TOOL.exec(toolName) : null
  return match === null ? null : match[1]
}

/** Whether a successful Listspace tool call recorded or proposed a decision. */
export function recordsDecision(tool, toolInput) {
  if (tool === 'record_decision' || tool === 'propose_decision_change') return true
  return tool === 'end_session' && Array.isArray(toolInput?.decisions) && toolInput.decisions.length > 0
}

/** How propose_decision_change (and record_decision before it added a normal item instead) start their refusal when the owner switched decisions off on the board. */
const DECISIONS_OFF_REFUSAL = 'Decisions are off on this board, so nothing was recorded'

/** The tools whose result reports the board's switch (decisions.on), and the decision tools that answer for a board with decisions off. */
const REPORTS_SWITCH = new Set(['get_board', 'start_session'])
const DECISION_TOOLS = new Set(['record_decision', 'propose_decision_change'])

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const idOf = (value) => (typeof value === 'string' && value !== '' ? value : null)

/** The text blocks of an MCP result as Claude Code passes it: a content array, a result object, or a string. */
function textsOf(toolResponse) {
  if (typeof toolResponse === 'string') return [toolResponse]
  const content = Array.isArray(toolResponse) ? toolResponse : isObject(toolResponse) && Array.isArray(toolResponse.content) ? toolResponse.content : []
  return content.filter((block) => isObject(block) && block.type === 'text' && typeof block.text === 'string').map((block) => block.text)
}

/** The structured result: structuredContent, or the JSON of the first text block. */
function structuredOf(toolResponse) {
  if (isObject(toolResponse) && isObject(toolResponse.structuredContent)) return toolResponse.structuredContent
  const [text] = textsOf(toolResponse)
  if (text === undefined) return null
  try {
    const parsed = JSON.parse(text)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * What a Listspace result says about decisions on its board: { on, boardId },
 * or null when it does not say. Only the fields that report the switch
 * count: decisions.on in get_board and start_session (with the board's id),
 * decisions_on false at the top of a record_decision result (the item's
 * board_id when it has one), and the refusal of record_decision or
 * propose_decision_change (boardId null: the board the session is on). Text
 * anywhere else in a result, such as an item that quotes the refusal, is
 * data and says nothing here.
 */
export function decisionsSwitch(tool, toolResponse) {
  if (REPORTS_SWITCH.has(tool)) {
    const result = structuredOf(toolResponse)
    if (result === null || !isObject(result.decisions) || typeof result.decisions.on !== 'boolean') return null
    // start_session puts the board under board; get_board is the board
    const boardId = isObject(result.board) ? idOf(result.board.id) : idOf(result.id)
    return { on: result.decisions.on, boardId }
  }
  if (DECISION_TOOLS.has(tool)) {
    // Added as a normal item: the server's own field, never an item's text
    const result = structuredOf(toolResponse)
    if (result !== null && result.decisions_on === false) return { on: false, boardId: idOf(result.board_id) }
    const [text] = textsOf(toolResponse)
    return text !== undefined && text.startsWith(DECISIONS_OFF_REFUSAL) ? { on: false, boardId: null } : null
  }
  return null
}

/** The board a tool call names in its input (board_id), or null. */
export function boardIn(toolInput) {
  return isObject(toolInput) ? idOf(toolInput.board_id) : null
}

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|agreed|approved|correct|exactly|perfect|deal|sounds good|looks good|lgtm|go ahead|go for it|do it|do that|ship it|let'?s do (it|that|this)|that works|works for me|fine by me)\b/i
/** Picking, after a message that offered a choice. */
const PICK = /^(let'?s|we'?ll|we will|i'?ll|i will|i'?d|i would)?\s*(go with|use|pick|choose|take|keep|stick with|switch to|prefer)\b/i
/** Picking without an offer: only the words that say it outright. */
const PICK_OUTRIGHT = /^(let'?s|we'?ll|we will|i'?ll|i will|i'?d|i would)?\s*(go with|stick with)\b/i
/** "Let's keep going", "I'll take a look": the pick verbs in phrases that pick nothing. */
const PICKS_NOTHING = /\b(keep (going|on|at it|working|it up)|take a (look|break|stab|pass|minute|second)|take (it|this) (from here|slow))\b/i
const PICK_ALONE = /^(option\s+)?([a-e]|[1-5])\s*[.)!]?\s*(please)?[.!]?$|^(the\s+)?(first|second|third|fourth|last|other)( one| option)?\b/i
const DECIDED = /\b(we|i) (have |'ve )?decided\b|\b(my|our|the) decision is\b|\bfinal (answer|call|decision)\b|\bdecision:/i
const CORRECTION = /^(no|nope|actually|correction|wrong|not quite|that'?s (not right|wrong|incorrect))\b[\s,.:!]*/i
const NOT_A_FACT = /^(don'?t|do not|stop|wait|hold on|please|can you|could you|would you|let me|just|never ?mind|thanks|thank you|i'?ll|i will|give me|one (sec|second|minute)|later|not now|not yet)\b/i
/** A bug report or a place in the code, not a fact the work depends on: "still failing", "3 errors", "service.ts line 40", "src/lib". */
const STATUS = /\b(still|again|fail(s|ed|ing|ure)?|errors?|broken|breaks?|crash(es|ed|ing)?|bugs?|works?|working|worked|pass(es|ed|ing)|warnings?|exception|lint|typo|line \d+)\b|\w\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|rb|java|sql|css|scss|html|yml|yaml|toml|sh)\b|\w[\\/]\w/i
/** The value a correction gives: a number (a price, a date, a count), a date in words, "X, not Y", or a name. */
const VALUE_WORDS = /\d|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next (week|month|year))\b|,\s*not\s+\w|\binstead of\b|\brather than\b|\bnot\b.+\bbut\b/i
const NAME = /\b(?!(?:The|It|Its|It's|This|That|These|Those|We|We're|They|They're|There|You|He|She|A|An|My|Our|Your|Their|And|But|Or|So|If|In|On|At|To|For|Of|With|No|Not|Yes|Ok|Okay|Actually)\b)[A-Z][a-z]+/
/** What a reply to "which one?" is about: the previous message offered a choice or made a proposal. An offer to act ("Shall I run the tests?", "Want me to commit?") is not one. */
const OFFERED = /\b(recommend|recommendation|suggest|suggestion|propose|proposal|options?|which (one|do you|would you)|either|or (would|do) you|alternatively|my (pick|vote)|i'?d go with|i would go with)\b/i
/** A lettered list of choices: a line that starts with "B." or "B)" (also in bold). */
const LETTERED = /(^|\n)\s*(?:[-*]\s*)?(?:\*\*)?(?:option\s+)?b(?:\*\*)?\s*[.):]/i

const firstLine = (text) => text.trim().split(/\r?\n/)[0].trim()

/** The user's words for the reason line: the first line, cut at 80 characters. */
export function excerpt(prompt) {
  const line = firstLine(prompt).replace(/\s+/g, ' ')
  return line.length > 80 ? `${line.slice(0, 77).trimEnd()}...` : line
}

/** Whether what the agent said last offered a choice or made a proposal (null: nothing said yet). */
export function offers(previousAssistant) {
  if (typeof previousAssistant !== 'string') return false
  const tail = previousAssistant.slice(-1500)
  return OFFERED.test(tail) || LETTERED.test(tail)
}

/** Whether the rest of a "No, ..." line gives a fact: a value, and not a bug report or a place in the code. */
function correctsAFact(rest) {
  if (rest.length === 0 || NOT_A_FACT.test(rest) || STATUS.test(rest)) return false
  return VALUE_WORDS.test(rest) || NAME.test(rest)
}

/**
 * Whether the user's words in this turn read like a decision: picking an
 * option, saying yes to a proposal, correcting a fact, or saying it was
 * decided. offered: the agent's last message offered a choice or made a
 * proposal (offers), which tells a reply to it from a plain "ok". Returns
 * the kind, or null.
 */
export function classify(prompt, offered) {
  if (typeof prompt !== 'string') return null
  const text = prompt.trim()
  if (text.length === 0 || text.length > PROMPT_MAX || text.startsWith('/')) return null
  const line = firstLine(text)
  if (DECIDED.test(text)) return 'decided'
  if (!PICKS_NOTHING.test(line) && (PICK_OUTRIGHT.test(line) || (offered && PICK.test(line)))) return 'picks an option'
  if (offered && PICK_ALONE.test(line)) return 'picks an option'
  if (offered && YES.test(line)) return 'says yes to a proposal'
  const correction = CORRECTION.exec(line)
  if (correction !== null && correctsAFact(line.slice(correction[0].length))) return 'corrects a fact'
  return null
}

/** classify, with the agent's last message as text (null at the start). */
export function decisionIn(prompt, previousAssistant) {
  return classify(prompt, offers(previousAssistant))
}

/** The one line that sends the agent back: a check, not a claim. */
export function reasonLine(prompt) {
  return `If the user's message ("${excerpt(prompt)}") was a decision that affects future work (a price, scope, design, date or owner), record it with record_decision as Proposed; otherwise end the turn without comment.`
}

// ---- The state (a few files per session) ---------------------------------------------------------

/** The plugin's data folder, or null without one: never a shared folder such as /tmp. */
const stateDir = (env) => (typeof env.CLAUDE_PLUGIN_DATA === 'string' && env.CLAUDE_PLUGIN_DATA !== '' ? join(env.CLAUDE_PLUGIN_DATA, 'decision-check') : null)
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
 * Each event writes its own file, so two tool calls finishing at once never
 * overwrite each other's note.
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
    case 'prompt': {
      await rm(file('recorded'), { force: true })
      await rm(file('decision'), { force: true })
      const kind = classify(input.prompt, (await readText(file('offered'))) === '1')
      if (kind !== null) await write('decision', excerpt(input.prompt))
      await prune(dir, now)
      return ''
    }
    case 'tool': {
      const tool = listspaceTool(input.tool_name)
      if (tool === null) return ''
      await write('listspace', '1')
      if (recordsDecision(tool, input.tool_input)) await write('recorded', tool)
      // The board the session is on now: the one the call names, or the one its result reports
      const decisions = decisionsSwitch(tool, input.tool_response)
      const named = boardIn(input.tool_input) ?? decisions?.boardId ?? null
      if (named !== null) await write('board', named)
      if (decisions === null) return ''
      // One file per board with decisions off, so one board never mutes the check on another
      const board = safeId(decisions.boardId ?? named ?? (await readText(file('board'))))
      if (board === '') return ''
      if (decisions.on) await rm(file(`off-${board}`), { force: true })
      else await write(`off-${board}`, '1')
      return ''
    }
    case 'stop': {
      const listspace = await exists(file('listspace'))
      // Whether the agent's last message offered a choice: the next prompt reads a "yes" against it
      if (listspace && typeof input.last_assistant_message === 'string') await write('offered', offers(input.last_assistant_message) ? '1' : '0')
      if (input.stop_hook_active === true || !listspace) return ''
      if (await exists(file('recorded'))) return ''
      // Decisions off on the board the session is on: no check there
      const board = safeId(await readText(file('board')))
      if (board !== '' && await exists(file(`off-${board}`))) return ''
      const decision = await readText(file('decision'))
      if (decision === null) return ''
      // Once per turn: the next stop of this turn goes through even if nothing was recorded
      await write('recorded', 'reminded')
      return JSON.stringify({ decision: 'block', reason: reasonLine(decision) })
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
