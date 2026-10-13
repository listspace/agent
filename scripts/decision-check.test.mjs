// Tests for the Claude Code plugin's decision check (claude-code-plugin/hooks/decision-check.mjs).
// Run: node --test agent/scripts/decision-check.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardIn, classify, decisionIn, decisionsSwitch, excerpt, handle, listspaceTool, offers, reasonLine, recordsDecision } from '../claude-code-plugin/hooks/decision-check.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'claude-code-plugin', 'hooks', 'decision-check.mjs')
const PLUGIN_TOOL = (name) => `mcp__plugin_listspace_listspace__${name}`

test('listspaceTool: the plugin server and a server the user named listspace; nothing else', () => {
  assert.equal(listspaceTool(PLUGIN_TOOL('get_board')), 'get_board')
  assert.equal(listspaceTool('mcp__listspace__record_decision'), 'record_decision')
  assert.equal(listspaceTool('mcp__other__record_decision'), null)
  assert.equal(listspaceTool('mcp__plugin_other_listspace__get_board'), null)
  assert.equal(listspaceTool('Bash'), null)
  assert.equal(listspaceTool(undefined), null)
})

test('recordsDecision: record, propose, and end_session with decisions', () => {
  assert.equal(recordsDecision('record_decision', {}), true)
  assert.equal(recordsDecision('propose_decision_change', {}), true)
  assert.equal(recordsDecision('end_session', { decisions: [{ title: 'x' }] }), true)
  assert.equal(recordsDecision('end_session', { decisions: [] }), false)
  assert.equal(recordsDecision('end_session', {}), false)
  assert.equal(recordsDecision('create_item', { title: 'x' }), false)
})

const OFFER = 'Two ways to do payments: Stripe or Paddle. I recommend Stripe for the lower fees. Which do you prefer?'
const ASK = 'Done: the tests pass. Shall I commit?'

test('decisionIn: picks an option, says yes to a proposal, corrects a fact, or says it was decided', () => {
  // Picks an option
  assert.equal(decisionIn("Let's go with Stripe", null), 'picks an option')
  assert.equal(decisionIn('go with the second one', null), 'picks an option')
  assert.equal(decisionIn('Use Stripe', OFFER), 'picks an option')
  assert.equal(decisionIn('B', OFFER), 'picks an option')
  assert.equal(decisionIn('option 2 please', OFFER), 'picks an option')
  assert.equal(decisionIn('the first one', OFFER), 'picks an option')
  // Says yes to a proposal
  assert.equal(decisionIn('yes', OFFER), 'says yes to a proposal')
  assert.equal(decisionIn('Sounds good, do that', OFFER), 'says yes to a proposal')
  assert.equal(decisionIn('yes build it', 'I recommend we build it now, before the freeze. Build it?'), 'says yes to a proposal')
  assert.equal(decisionIn('B', 'Two ways:\n**A.** Stripe\n**B.** Paddle'), 'picks an option')
  assert.equal(decisionIn('ok', 'Option B is cheaper. Go with it?'), 'says yes to a proposal')
  // Corrects a fact
  assert.equal(decisionIn('No, we launch on the 18th', null), 'corrects a fact')
  assert.equal(decisionIn('Actually the price is $12, not $9', null), 'corrects a fact')
  assert.equal(decisionIn('Correction: Sara is the design owner', null), 'corrects a fact')
  // Said outright
  assert.equal(decisionIn('We decided to drop the iOS app for now', null), 'decided')
  assert.equal(decisionIn('Final answer: monthly billing only', null), 'decided')
})

test('decisionIn: ordinary prompts are not decisions', () => {
  for (const [prompt, previous] of [
    ['yes', ASK],
    ['ok', null],
    ['Fix the failing test in utils', null],
    ['Use the helper in utils/date.ts for this', null],
    ['B', null],
    ['No, wait', null],
    ["No, don't push yet", null],
    ['Actually, can you also fix the header?', null],
    ['no', null],
    ['/review', OFFER],
    ['', OFFER],
    [`We decided ${'x'.repeat(700)}`, null],
    [undefined, null],
  ]) {
    assert.equal(decisionIn(prompt, previous), null, `${prompt} after ${previous}`)
  }
})

test('decisionIn: coding chat is not a decision (a yes to an action, a maybe, a bug report, a place in the code)', () => {
  for (const [prompt, previous] of [
    // A yes to an offer to act
    ['yes', 'Do you want me to run the tests?'],
    ['yes', 'Do you want me to commit and open a PR?'],
    ['yes', 'Would you like me to run the tests?'],
    ['ok', 'Would you like me to fix the lint warnings too?'],
    ['ok', 'Should I run the tests?'],
    ['ok', 'Should we run the tests?'],
    ['yes', 'Want me to commit?'],
    ['yes', 'Want me to commit and push?'],
    ['ok go ahead', 'Next I plan to fix the lint errors.'],
    ['yes', 'Here is the plan: update the parser, then the tests. Shall I start?'],
    ['go ahead', 'Here is my plan:\n1. Fix the parser\n2. Update the tests\nShall I go ahead?'],
    // Pick words that pick nothing, without an offer
    ["let's keep going", null],
    ["let's keep going", OFFER],
    ["I'll take a look later", null],
    ['I will use git rebase', null],
    ["let's use a Map here", null],
    ['use the existing helper', ASK],
    // A bug report or a place in the code
    ['No, the build is still failing', null],
    ["no, it's still failing", null],
    ['Actually there are 3 errors left', null],
    ['No, the error is in service.ts line 40', null],
    ['no, the bug is in the parser', null],
    ['actually the file is in src/lib', null],
    ['No, it works now', null],
    // A maybe
    ['maybe later', OFFER],
    ['let me think', OFFER],
    ['No, not yet', null],
  ]) {
    assert.equal(decisionIn(prompt, previous), null, `${prompt} after ${previous}`)
  }
})

test('offers: a choice or a proposal, not an offer to act', () => {
  assert.equal(offers(OFFER), true)
  assert.equal(offers('I suggest $9 a month for Pro.'), true)
  assert.equal(offers('Which one do you want, the short or the long name?'), true)
  assert.equal(offers('Two ways:\nA) Stripe\nB) Paddle'), true)
  assert.equal(offers(ASK), false)
  assert.equal(offers('Do you want me to run the tests?'), false)
  assert.equal(offers('Next I plan to fix the lint errors.'), false)
  assert.equal(offers('Should we run the tests?'), false)
  assert.equal(offers(null), false)
  assert.equal(classify('yes', true), 'says yes to a proposal')
  assert.equal(classify('yes', false), null)
})

test('excerpt and reasonLine: one line, a check rather than a claim, the user\'s first line cut at 80 characters', () => {
  assert.equal(excerpt("  Let's go with Stripe\nand more  "), "Let's go with Stripe")
  assert.equal(excerpt('x'.repeat(100)).length, 80)
  assert.equal(excerpt(excerpt('x'.repeat(100))), excerpt('x'.repeat(100)), 'an excerpt of an excerpt is the same')
  const reason = reasonLine("Let's go with Stripe")
  assert.equal(reason, 'If the user\'s message ("Let\'s go with Stripe") was a decision that affects future work (a price, scope, design, date or owner), record it with record_decision as Proposed; otherwise end the turn without comment.')
  assert.ok(!/user decided/i.test(reason))
  assert.ok(!reason.includes('\n'))
  assert.ok(!/[\u2013\u2014]/.test(reason))
})

async function session() {
  const dir = await mkdtemp(join(tmpdir(), 'ls-decision-check-'))
  const env = { CLAUDE_PLUGIN_DATA: dir }
  const id = 'sess-1'
  const run = (event, input) => handle(event, { session_id: id, ...input }, env)
  return { dir, run, done: () => rm(dir, { recursive: true, force: true }) }
}

const blockOf = (out) => (out === '' ? null : JSON.parse(out))

test('handle: no Listspace in the session, no check', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: "Let's go with Stripe" })
    await s.run('tool', { tool_name: 'Bash', tool_input: {} })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Done.' }), '')
  } finally {
    await s.done()
  }
})

test('handle: a decision and nothing recorded blocks once with the reason; the stop it continued goes through', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: 'Look at the board' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: {} })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: OFFER }), '')

    await s.run('prompt', { prompt: 'yes, Stripe' })
    const block = blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Going with Stripe.' }))
    assert.equal(block.decision, 'block')
    assert.equal(block.reason, reasonLine('yes, Stripe'))
    // The continuation's stop: never blocked again
    assert.equal(await s.run('stop', { stop_hook_active: true, last_assistant_message: 'Recorded.' }), '')
    // Once per turn, even if the next stop does not say stop_hook_active
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Done.' }), '')
  } finally {
    await s.done()
  }
})

test('handle: a recorded decision lets the turn end; the next prompt starts a new turn', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: "Let's go with Stripe" })
    await s.run('tool', { tool_name: PLUGIN_TOOL('record_decision'), tool_input: { title: 'Use Stripe' } })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Recorded as Proposed.' }), '')

    await s.run('prompt', { prompt: 'No, we launch on the 18th' })
    assert.equal(blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }))?.decision, 'block')

    await s.run('prompt', { prompt: 'We decided monthly billing only' })
    await s.run('tool', { tool_name: 'mcp__listspace__end_session', tool_input: { board_id: 'b', summary: 's', decisions: [{ title: 'Monthly billing only' }] } })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Session ended.' }), '')
  } finally {
    await s.done()
  }
})

test('handle: no session id, an unknown event, or an ordinary prompt does nothing', async () => {
  const s = await session()
  try {
    assert.equal(await handle('stop', { stop_hook_active: false }, { CLAUDE_PLUGIN_DATA: s.dir }), '')
    assert.equal(await s.run('SessionStart', {}), '')
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: {} })
    await s.run('prompt', { prompt: 'Fix the failing test' })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Fixed.' }), '')
  } finally {
    await s.done()
  }
})

test('handle: session files older than a week are removed on the next prompt', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: "Let's go with Stripe" })
    const stateDir = join(s.dir, 'decision-check')
    const old = join(stateDir, 'old-session.decision')
    await writeFile(old, 'x')
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(old, eightDaysAgo, eightDaysAgo)
    await s.run('prompt', { prompt: 'Final answer: monthly billing only' })
    assert.deepEqual((await readdir(stateDir)).sort(), ['sess-1.decision'])
  } finally {
    await s.done()
  }
})

test('handle: an ordinary prompt writes nothing; a decision keeps only its first line, cut at 80 characters, for the user only', async () => {
  const s = await session()
  try {
    const secret = 'Fix this: API_KEY=sk-live-123 fails\n' + 'log line\n'.repeat(50)
    await s.run('prompt', { prompt: secret })
    assert.deepEqual(await readdir(s.dir), [], 'not even the folder')
    const long = `We decided to ${'keep going with the long plan '.repeat(5)}\nsecond line with a password`
    await s.run('prompt', { prompt: long })
    const stateDir = join(s.dir, 'decision-check')
    assert.deepEqual(await readdir(stateDir), ['sess-1.decision'])
    const kept = await readFile(join(stateDir, 'sess-1.decision'), 'utf8')
    assert.equal(kept, excerpt(long))
    assert.ok(kept.length <= 80 && !kept.includes('password'))
    if (process.platform !== 'win32') {
      assert.equal((await stat(stateDir)).mode & 0o777, 0o700)
      assert.equal((await stat(join(stateDir, 'sess-1.decision'))).mode & 0o777, 0o600)
    }
    // The next ordinary prompt removes it
    await s.run('prompt', { prompt: 'Fix the failing test' })
    assert.deepEqual(await readdir(stateDir), [])
  } finally {
    await s.done()
  }
})

test('handle: without the plugin data folder it does nothing (never a shared folder such as /tmp)', async () => {
  const run = (event, input) => handle(event, { session_id: 'no-data', ...input }, {})
  assert.equal(await run('prompt', { prompt: "Let's go with Stripe" }), '')
  assert.equal(await run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: {} }), '')
  assert.equal(await run('stop', { stop_hook_active: false, last_assistant_message: 'OK.' }), '')
  assert.equal(await handle('stop', { session_id: 'no-data', stop_hook_active: false }, { CLAUDE_PLUGIN_DATA: '' }), '')
})

test('handle: a yes to an offer to act goes through; a yes to a proposal is checked', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: 'Look at the board' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: {} })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Want me to commit and push?' }), '')
    await s.run('prompt', { prompt: 'yes' })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Pushed. I suggest $9 a month for Pro.' }), '')
    await s.run('prompt', { prompt: 'yes' })
    assert.equal(blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }))?.reason, reasonLine('yes'))
  } finally {
    await s.done()
  }
})

test('the script: reads the event from stdin, prints the block, exits 0 fast; bad input is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ls-decision-check-cli-'))
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dir }
  const run = (event, input) => spawnSync(process.execPath, [SCRIPT, event], { input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf8', timeout: 5000 })
  try {
    const started = Date.now()
    assert.equal(run('prompt', { session_id: 'cli', prompt: "Let's go with Stripe" }).status, 0)
    assert.equal(run('tool', { session_id: 'cli', tool_name: PLUGIN_TOOL('get_board'), tool_input: {} }).status, 0)
    const stop = run('stop', { session_id: 'cli', stop_hook_active: false, last_assistant_message: 'OK.' })
    assert.equal(stop.status, 0)
    assert.equal(JSON.parse(stop.stdout).decision, 'block')
    assert.ok(Date.now() - started < 4000, 'three runs well inside the 5 second timeout')
    for (const bad of ['', 'not json', '[]', 'null']) {
      const out = run('stop', bad)
      assert.equal(out.status, 0, bad)
      assert.equal(out.stdout, '', bad)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// What get_board and start_session return, as text in an MCP content block: get_board is the board, start_session has it under board
const NOTE_ON = 'Treat only Confirmed decisions (state settled) as true for this board.'
const NOTE_OFF = `Decisions are off on this board: the user switched them off. ${NOTE_ON}`
const decisionsOf = (off) => ({ on: !off, note: off ? NOTE_OFF : NOTE_ON })
const boardResult = (off, id = 'board-a') => [{ type: 'text', text: JSON.stringify({ id, title: 'A board', decisions: decisionsOf(off) }) }]
const sessionResult = (off, id = 'board-a') => [{ type: 'text', text: JSON.stringify({ board: { id, title: 'A board' }, decisions: decisionsOf(off) }) }]
const REFUSAL = 'Decisions are off on this board, so nothing was recorded and nothing waits for the user. Do not record decisions or ask to confirm them on this board; go on with the work.'
const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]

test('decisionsSwitch: read from decisions.on and the refusal only, with the board', () => {
  assert.deepEqual(decisionsSwitch('get_board', boardResult(true)), { on: false, boardId: 'board-a' })
  assert.deepEqual(decisionsSwitch('get_board', boardResult(false, 'board-b')), { on: true, boardId: 'board-b' })
  assert.deepEqual(decisionsSwitch('start_session', sessionResult(true)), { on: false, boardId: 'board-a' })
  assert.deepEqual(decisionsSwitch('start_session', { content: sessionResult(false), structuredContent: { board: { id: 'board-c' }, decisions: { on: true } } }), { on: true, boardId: 'board-c' })
  assert.deepEqual(decisionsSwitch('record_decision', text(REFUSAL)), { on: false, boardId: null })
  assert.deepEqual(decisionsSwitch('propose_decision_change', { content: text(REFUSAL), isError: true }), { on: false, boardId: null })
  // Item text that quotes the words says nothing, in any tool
  const quoting = text({ id: 'item-1', title: 'Decisions switch', description: `The agent is told: "${REFUSAL}"` })
  assert.equal(decisionsSwitch('get_item', quoting), null)
  assert.equal(decisionsSwitch('record_decision', quoting), null)
  assert.equal(decisionsSwitch('get_board', text({ id: 'board-a', lists: [{ cards: [{ title: NOTE_OFF }] }], decisions: { note: NOTE_OFF } })), null)
  assert.equal(decisionsSwitch('get_board', 'not json'), null)
  assert.equal(decisionsSwitch('get_board', undefined), null)
  assert.equal(decisionsSwitch('create_item', REFUSAL), null)
})

test('decisionsSwitch: record_decision added a normal item (decisions_on false at the top), on the board of that item', () => {
  const added = { id: 'item-9', board_id: 'board-x', title: 'Use Stripe', decision: null, decisions_on: false, message: 'Decisions are off on this board, so this was added as a normal item.' }
  assert.deepEqual(decisionsSwitch('record_decision', text(added)), { on: false, boardId: 'board-x' })
  assert.deepEqual(decisionsSwitch('record_decision', { content: text(added), structuredContent: added }), { on: false, boardId: 'board-x' })
  // Waiting in the Inbox (Suggest): no item yet, so the board the session is on
  assert.deepEqual(decisionsSwitch('record_decision', text({ outcome: 'suggested', suggestion: { id: 's-1' }, decisions_on: false })), { on: false, boardId: null })
  // Only at the top of a decision tool's result: an item's text or another tool says nothing
  assert.equal(decisionsSwitch('record_decision', text({ id: 'item-9', description: '"decisions_on": false' })), null)
  assert.equal(decisionsSwitch('get_item', text(added)), null)
  assert.equal(decisionsSwitch('create_item', text(added)), null)
})

test('handle: a record_decision that added a normal item mutes the check on its board only', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: 'Look at the board' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('record_decision'), tool_input: { list_id: 'list-1', title: 'Stripe' }, tool_response: text({ id: 'item-9', board_id: 'board-x', decision: null, decisions_on: false }) })
    await s.run('prompt', { prompt: 'No, we launch on the 18th' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_item'), tool_input: { item_id: 'item-9' }, tool_response: text({ id: 'item-9', board_id: 'board-x' }) })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }), '', 'board-x has decisions off')
    await s.run('prompt', { prompt: 'No, we launch on the 19th' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: { board_id: 'board-y' }, tool_response: boardResult(false, 'board-y') })
    assert.equal(blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }))?.decision, 'block', 'board-y keeps the check')
  } finally {
    await s.done()
  }
})

test('boardIn: the board_id a call names', () => {
  assert.equal(boardIn({ board_id: 'board-a' }), 'board-a')
  assert.equal(boardIn({ board_id: '' }), null)
  assert.equal(boardIn({ item_id: 'item-1' }), null)
  assert.equal(boardIn(undefined), null)
})

test('handle: on a board with decisions off the check stays silent, until a result says they are on again', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: 'Look at the board' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('start_session'), tool_input: {}, tool_response: sessionResult(true) })
    await s.run('stop', { stop_hook_active: false, last_assistant_message: OFFER })
    await s.run('prompt', { prompt: 'yes, Stripe' })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Going with Stripe.' }), '')
    // A later turn on the same board, with item calls only: still off
    await s.run('prompt', { prompt: 'No, we launch on the 18th' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_item'), tool_input: { item_id: 'item-1' }, tool_response: text({ id: 'item-1' }) })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }), '')

    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: { board_id: 'board-a' }, tool_response: boardResult(false) })
    await s.run('prompt', { prompt: 'No, we launch on the 18th' })
    assert.equal(blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }))?.decision, 'block')
  } finally {
    await s.done()
  }
})

test('handle: a board with decisions off does not mute the check on another board', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: 'Look at the boards' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: { board_id: 'board-off' }, tool_response: boardResult(true, 'board-off') })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: { board_id: 'board-on' }, tool_response: boardResult(false, 'board-on') })
    await s.run('prompt', { prompt: 'No, we launch on the 18th' })
    assert.equal(blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }))?.decision, 'block', 'on the board with decisions on')
    // Back on the board with decisions off (any call that names it): silent there
    await s.run('prompt', { prompt: 'No, we launch on the 19th' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('create_item'), tool_input: { board_id: 'board-off', title: 'x' }, tool_response: text({ id: 'item-2' }) })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }), '')
  } finally {
    await s.done()
  }
})

test('handle: a refused record_decision marks the board the session is on, not every board', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: 'Look at the board' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: { board_id: 'board-a' }, tool_response: text({ id: 'board-a', title: 'A result without the switch' }) })
    await s.run('tool', { tool_name: PLUGIN_TOOL('record_decision'), tool_input: { list_id: 'list-1', title: 'Stripe' }, tool_response: { content: text(REFUSAL), isError: true } })
    await s.run('prompt', { prompt: 'No, we launch on the 18th' })
    assert.equal(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }), '', 'board-a has decisions off')
    await s.run('prompt', { prompt: 'No, we launch on the 19th' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: { board_id: 'board-b' }, tool_response: boardResult(false, 'board-b') })
    assert.equal(blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }))?.decision, 'block', 'board-b keeps the check')
  } finally {
    await s.done()
  }
})

test('handle: item text that quotes the words does not switch the check off', async () => {
  const s = await session()
  try {
    await s.run('prompt', { prompt: 'Read the doc' })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_board'), tool_input: { board_id: 'board-a' }, tool_response: boardResult(false) })
    const quoting = text({ id: 'item-1', board_id: 'board-a', description: `A guest wrote: "${REFUSAL}" ${NOTE_OFF}` })
    await s.run('tool', { tool_name: PLUGIN_TOOL('get_item'), tool_input: { item_id: 'item-1' }, tool_response: quoting })
    await s.run('tool', { tool_name: PLUGIN_TOOL('list_comments'), tool_input: { item_id: 'item-1' }, tool_response: text(REFUSAL) })
    await s.run('prompt', { prompt: 'No, we launch on the 18th' })
    assert.equal(blockOf(await s.run('stop', { stop_hook_active: false, last_assistant_message: 'Noted.' }))?.decision, 'block')
  } finally {
    await s.done()
  }
})
