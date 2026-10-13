// Tests for the Claude Code plugin's progress check (claude-code-plugin/hooks/progress-check.mjs).
// Run: node --test agent/scripts/progress-check.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { failed, handle, isListspaceWrite, isWork, isWorkCommand, NUDGE, NUDGE_EVERY, shouldNudge } from '../claude-code-plugin/hooks/progress-check.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'claude-code-plugin', 'hooks', 'progress-check.mjs')
const PLUGIN_TOOL = (name) => `mcp__plugin_listspace_listspace__${name}`

test('isWorkCommand: git commit, push and merge, gh pr create and merge, deploys', () => {
  for (const command of [
    'git commit -m "Fix the parser"',
    'git add -A && git commit -m x',
    'git -C ../repo push origin main',
    'git --no-pager merge feature',
    'cd app; git push',
    'gh pr create --title x --body y',
    'gh pr merge 12 --rebase',
    './deploy.sh',
    'bash deploy/selfhost/deploy-functions.sh',
    'npm run deploy',
    'vercel --prod',
    'netlify deploy --prod',
    'fly deploy',
    'wrangler deploy',
    'firebase deploy --only hosting',
    'kubectl apply -f k8s.yaml',
    'terraform apply -auto-approve',
  ]) assert.equal(isWorkCommand(command), true, command)
  for (const command of [
    'git status',
    'git log --oneline -5',
    'git diff --stat',
    'git log --grep merge',
    'gh pr list',
    'gh pr view 12',
    'npm test',
    'npm run build',
    'ls deploy',
    'cat deploy.md',
    'echo commit',
    undefined,
  ]) assert.equal(isWorkCommand(command), false, String(command))
})

test('isWork: file changes and work commands; reads and other tools are not', () => {
  assert.equal(isWork('Edit', { file_path: 'a.ts' }), true)
  assert.equal(isWork('Write', {}), true)
  assert.equal(isWork('MultiEdit', {}), true)
  assert.equal(isWork('NotebookEdit', {}), true)
  assert.equal(isWork('Bash', { command: 'git commit -m x' }), true)
  assert.equal(isWork('PowerShell', { command: 'git push' }), true)
  assert.equal(isWork('Bash', { command: 'npm test' }), false)
  assert.equal(isWork('Read', { file_path: 'a.ts' }), false)
  assert.equal(isWork('Grep', {}), false)
  assert.equal(isWork(PLUGIN_TOOL('create_item'), {}), false)
})

test('isListspaceWrite: writes update the board; reads and feedback do not', () => {
  for (const tool of ['create_item', 'update_item', 'move_item', 'complete_item', 'add_comment', 'record_decision', 'capture', 'claim_item', 'release_item', 'next_item', 'end_session', 'bulk_move_items', 'attach_document', 'propose_decision_change']) {
    assert.equal(isListspaceWrite(tool), true, tool)
  }
  for (const tool of ['get_board', 'get_item', 'get_account', 'list_boards', 'search_items', 'export_board', 'start_session', 'catch_up', 'my_items', 'my_requests', 'board_report', 'send_feedback', '', null]) {
    assert.equal(isListspaceWrite(tool), false, String(tool))
  }
})

test('failed: an MCP error result', () => {
  assert.equal(failed({ isError: true, content: [] }), true)
  assert.equal(failed({ isError: false, content: [] }), false)
  assert.equal(failed([{ type: 'text', text: '{}' }]), false)
  assert.equal(failed('ok'), false)
})

test('shouldNudge: Listspace in use, work with no update after it, and not within NUDGE_EVERY turns of the last nudge', () => {
  assert.equal(shouldNudge({ listspace: true, work: true, turn: 1, nudgedAt: null }), true)
  assert.equal(shouldNudge({ listspace: false, work: true, turn: 1, nudgedAt: null }), false)
  assert.equal(shouldNudge({ listspace: true, work: false, turn: 1, nudgedAt: null }), false)
  assert.equal(shouldNudge({ listspace: true, work: true, turn: 2, nudgedAt: 1 }), false)
  assert.equal(shouldNudge({ listspace: true, work: true, turn: 1 + NUDGE_EVERY, nudgedAt: 1 }), true)
})

test('NUDGE: one line, no dashes, says items not cards', () => {
  assert.equal(NUDGE, 'Update the Listspace board: what did you start or finish this turn? Move the item, add a short comment.')
  assert.ok(!/[\u2013\u2014]/.test(NUDGE) && !/\bcards?\b/i.test(NUDGE))
})

async function session() {
  const dir = await mkdtemp(join(tmpdir(), 'ls-progress-check-'))
  const env = { CLAUDE_PLUGIN_DATA: dir }
  const id = 'sess-1'
  const run = (event, input) => handle(event, { session_id: id, ...input }, env)
  const tool = (tool_name, tool_input = {}, tool_response = { content: [] }) => run('tool', { tool_name, tool_input, tool_response })
  const stop = async (active = false) => {
    const out = await run('stop', { stop_hook_active: active, last_assistant_message: 'Done.' })
    return out === '' ? null : JSON.parse(out)
  }
  return { dir, run, tool, stop, done: () => rm(dir, { recursive: true, force: true }) }
}

test('handle: no Listspace in the session, never a nudge', async () => {
  const s = await session()
  try {
    await s.tool('Edit', { file_path: 'a.ts' })
    await s.tool('Bash', { command: 'git commit -m x' })
    assert.equal(await s.stop(), null)
  } finally {
    await s.done()
  }
})

test('handle: work and no board update nudges once; the continued stop and the next turns stay quiet', async () => {
  const s = await session()
  try {
    await s.tool(PLUGIN_TOOL('start_session'), { board_id: 'b1' })
    await s.tool('Edit', { file_path: 'a.ts' })
    const block = await s.stop()
    assert.deepEqual(block, { decision: 'block', reason: NUDGE })
    // The stop the block continued: never twice in a row
    assert.equal(await s.stop(true), null)
    // The work was checked: a turn without new work says nothing
    assert.equal(await s.stop(), null)
    // New work right after a nudge: no nagging for NUDGE_EVERY turns
    await s.tool('Bash', { command: 'git push' })
    assert.equal(await s.stop(), null)
    // Once NUDGE_EVERY turns have passed, the work still unreported gets one nudge
    assert.deepEqual(await s.stop(), { decision: 'block', reason: NUDGE })
  } finally {
    await s.done()
  }
})

test('handle: a Listspace write after the work counts as the update', async () => {
  const s = await session()
  try {
    await s.tool(PLUGIN_TOOL('get_board'), { board_id: 'b1' })
    await s.tool('Write', { file_path: 'a.ts' })
    await s.tool('Bash', { command: 'gh pr create --fill' })
    await s.tool('mcp__listspace__add_comment', { item_id: 'i1', text: 'Opened the PR.' })
    assert.equal(await s.stop(), null)
  } finally {
    await s.done()
  }
})

test('handle: work after the last Listspace write still nudges', async () => {
  const s = await session()
  try {
    await s.tool(PLUGIN_TOOL('move_item'), { item_id: 'i1', list_id: 'doing' })
    await s.tool('Edit', { file_path: 'a.ts' })
    assert.deepEqual(await s.stop(), { decision: 'block', reason: NUDGE })
  } finally {
    await s.done()
  }
})

test('handle: a Listspace read is not an update; a failed write is not either', async () => {
  const s = await session()
  try {
    await s.tool(PLUGIN_TOOL('start_session'), { board_id: 'b1' })
    await s.tool('Bash', { command: 'git commit -m x' })
    await s.tool(PLUGIN_TOOL('get_item'), { item_id: 'i1' })
    await s.tool(PLUGIN_TOOL('move_item'), { item_id: 'i1' }, { isError: true, content: [{ type: 'text', text: 'Read only' }] })
    assert.equal((await s.stop())?.decision, 'block')
  } finally {
    await s.done()
  }
})

test('handle: a turn with only reads and plain commands says nothing', async () => {
  const s = await session()
  try {
    await s.tool(PLUGIN_TOOL('start_session'), { board_id: 'b1' })
    await s.tool('Bash', { command: 'npm test' })
    await s.tool('Read', { file_path: 'a.ts' })
    assert.equal(await s.stop(), null)
  } finally {
    await s.done()
  }
})

test('handle: sessions are kept apart', async () => {
  const s = await session()
  try {
    await s.tool(PLUGIN_TOOL('start_session'), { board_id: 'b1' })
    await handle('tool', { session_id: 'other', tool_name: 'Edit', tool_input: {} }, { CLAUDE_PLUGIN_DATA: s.dir })
    assert.equal(await s.stop(), null, 'the other session\'s work is not this one\'s')
    assert.equal(await handle('stop', { session_id: 'other', stop_hook_active: false }, { CLAUDE_PLUGIN_DATA: s.dir }), '', 'the other session has no Listspace')
  } finally {
    await s.done()
  }
})

test('handle: nothing without the data folder or a session id; old files are removed', async () => {
  assert.equal(await handle('tool', { session_id: 'x', tool_name: 'Edit' }, {}), '')
  assert.equal(await handle('stop', { session_id: 'x', stop_hook_active: false }, { CLAUDE_PLUGIN_DATA: '' }), '')
  const s = await session()
  try {
    await s.tool(PLUGIN_TOOL('start_session'), {})
    const old = join(s.dir, 'progress-check', 'gone.work')
    await writeFile(old, '1')
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(old, weekAgo, weekAgo)
    assert.equal(await handle('stop', { stop_hook_active: false }, { CLAUDE_PLUGIN_DATA: s.dir }), '', 'no session id')
    await s.stop()
    assert.ok(!(await readdir(join(s.dir, 'progress-check'))).includes('gone.work'))
  } finally {
    await s.done()
  }
})

test('handle: a session without Listspace still has its old files removed, and stays silent', async () => {
  const s = await session()
  try {
    await s.tool('Edit', { file_path: 'a.ts' })
    const old = join(s.dir, 'progress-check', 'other.work')
    await writeFile(old, '1')
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(old, weekAgo, weekAgo)
    assert.equal(await s.stop(), null)
    const left = await readdir(join(s.dir, 'progress-check'))
    assert.ok(!left.includes('other.work'), 'pruned')
    assert.deepEqual(left, ['sess-1.work'], 'no turn or nudge files without Listspace')
  } finally {
    await s.done()
  }
})

test('the script: reads the event from stdin, prints the block, exits 0 fast; bad input is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ls-progress-check-cli-'))
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dir }
  const run = (event, input) => spawnSync(process.execPath, [SCRIPT, event], { input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf8', timeout: 5000 })
  try {
    const started = Date.now()
    assert.equal(run('tool', { session_id: 'cli', tool_name: PLUGIN_TOOL('get_board'), tool_input: {} }).status, 0)
    assert.equal(run('tool', { session_id: 'cli', tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }).status, 0)
    const stop = run('stop', { session_id: 'cli', stop_hook_active: false })
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
