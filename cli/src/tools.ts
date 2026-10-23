// Every MCP tool from the command line: `call` runs any tool by name through
// the MCP server, `tools` lists them, and the short commands below are named
// calls of one tool each. Nothing here knows a tool's logic: the server runs
// it, with the token's agent and the board's agent access level, exactly as
// it does for an MCP client. A new tool on the server works here at once.

import { fail, type ApiClient, type ToolInfo } from './api.js'
import { inboxFields, resolveBoardId, type InboxChoice, type Output } from './commands.js'
import { DecodeError, array, isRecord, object, string, type Decoder } from './decode.js'
import { formatWrite } from './format.js'
import { writeOutcome, type ListKind, type WriteOutcome } from './schema.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The arguments of `call`: one JSON object, or none. */
export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {}
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return fail({ kind: 'usage', message: 'The arguments are not valid JSON. Pass one object, for example \'{"board_id": "..."}\', in single quotes.' })
  }
  if (!isRecord(value)) return fail({ kind: 'usage', message: 'The arguments must be one JSON object, for example \'{"board_id": "..."}\'.' })
  return value
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value, null, 2))

/**
 * Runs one tool with the arguments as given. A call that carries an
 * idempotency_key is sent once more after a lost answer, as the MCP server
 * asks; without one it is sent once, since a write could happen twice.
 */
export async function callCommand(client: ApiClient, input: { tool: string; args: Readonly<Record<string, unknown>> }): Promise<Output> {
  const answer = await client.callTool(input.tool, input.args, typeof input.args.idempotency_key === 'string')
  return { raw: answer.value, text: asText(answer.value) }
}

/** The longest line `tools` prints for one tool; `tools <name>` has the rest. */
const SUMMARY_MAX = 100

/** The first sentence of a description, cut at a word when it is long, for the list of tools. */
export function firstSentence(description: string): string {
  const end = description.search(/\.(\s|$)/)
  const sentence = end === -1 ? description : description.slice(0, end + 1)
  if (sentence.length <= SUMMARY_MAX) return sentence
  const cut = sentence.slice(0, SUMMARY_MAX)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[,;:(]$/, '')}...`
}

/** Every tool with one line each, or one tool with its description and input schema. */
export async function toolsCommand(client: ApiClient, input: { name: string | null }): Promise<Output> {
  const tools = await client.listTools()
  if (input.name === null) {
    const width = Math.max(0, ...tools.map((tool) => tool.name.length))
    const lines = tools.map((tool) => `${tool.name.padEnd(width)}  ${firstSentence(tool.description)}`)
    lines.push('', `${tools.length} tools. \`listspace tools <name>\` shows one with its arguments; \`listspace call <name> '<json>'\` runs it.`)
    return { raw: { tools: tools.map(({ name, title, description }) => ({ name, title, description })) }, text: lines.join('\n') }
  }
  const tool = tools.find((candidate) => candidate.name === input.name)
  if (tool === undefined) return fail({ kind: 'usage', message: `No tool called "${input.name}" for this token. Run \`listspace tools\` to see them.` })
  return { raw: tool, text: formatTool(tool) }
}

function formatTool(tool: ToolInfo): string {
  return [
    tool.title === null ? tool.name : `${tool.name}: ${tool.title}`,
    '',
    tool.description,
    '',
    'Arguments (JSON Schema):',
    JSON.stringify(tool.inputSchema, null, 2),
  ].join('\n')
}

// ---- Short commands: one tool each, through the same path as `call` ----

/** A write tool's result: applied (with its undo id) or waiting in the Inbox. */
async function write(client: ApiClient, tool: string, args: Readonly<Record<string, unknown>>, done: string, keyed: boolean): Promise<Output> {
  // A tool that makes something gets a key, so the one retry after a lost answer never makes it twice
  const sent = keyed ? { ...args, idempotency_key: client.newKey() } : args
  const answer = await client.callTool(tool, sent, keyed)
  const outcome = outcomeOf(answer.value)
  return { raw: answer.value, text: outcome === null ? asText(answer.value) : formatWrite(outcome, done) }
}

function outcomeOf(value: unknown): WriteOutcome | null {
  try {
    return writeOutcome(value, 'result')
  } catch (error) {
    if (error instanceof DecodeError) return null
    throw error
  }
}

export function commentCommand(client: ApiClient, input: { item: string; text: string; choice: InboxChoice }): Promise<Output> {
  return write(client, 'add_comment', { item_id: input.item, text: input.text, ...inboxFields(input.choice) }, 'Commented', true)
}

export function updateCommand(
  client: ApiClient,
  input: { item: string; title: string | null; description: string | null; choice: InboxChoice },
): Promise<Output> {
  if (input.title === null && input.description === null) {
    return fail({ kind: 'usage', message: '`update` needs --title, --description or both.' })
  }
  const args = {
    item_id: input.item,
    ...(input.title === null ? {} : { title: input.title }),
    ...(input.description === null ? {} : { description: input.description }),
    ...inboxFields(input.choice),
  }
  return write(client, 'update_item', args, 'Updated the item', false)
}

export async function listAddCommand(
  client: ApiClient,
  input: { board: string; title: string; kind: ListKind | null; choice: InboxChoice },
): Promise<Output> {
  const boardId = await resolveBoardId(client, input.board)
  const args = { board_id: boardId, title: input.title, ...(input.kind === null ? {} : { kind: input.kind }), ...inboxFields(input.choice) }
  return write(client, 'create_list', args, `Added the list "${input.title}"`, true)
}

export function listRenameCommand(client: ApiClient, input: { list: string; title: string; choice: InboxChoice }): Promise<Output> {
  return write(client, 'update_list', { list_id: input.list, title: input.title, ...inboxFields(input.choice) }, `Renamed the list to "${input.title}"`, false)
}

const templates: Decoder<{ id: string; name: string }[]> = (value, path) =>
  object({ templates: array(object({ id: string, name: string })) })(value, path).templates

function decodeOrFail<T>(decoder: Decoder<T>, value: unknown): T {
  try {
    return decoder(value, 'result')
  } catch (error) {
    if (error instanceof DecodeError) return fail({ kind: 'unexpected', message: error.message })
    throw error
  }
}

/** A template id as given, or the one template whose name matches (exactly, then by start), from list_templates. */
export async function resolveTemplateId(client: ApiClient, ref: string): Promise<string> {
  if (UUID.test(ref)) return ref
  const answer = await client.callTool('list_templates', {}, true)
  const all = decodeOrFail(templates, answer.value)
  const wanted = ref.trim().toLowerCase()
  const exact = all.filter((template) => template.name.toLowerCase() === wanted)
  const matches = exact.length > 0 ? exact : all.filter((template) => template.name.toLowerCase().startsWith(wanted))
  const [first, ...others] = matches
  if (first === undefined) {
    return fail({ kind: 'usage', message: `No template called "${ref}". Run \`listspace call list_templates\` to see them.` })
  }
  if (others.length > 0) {
    return fail({ kind: 'usage', message: `"${ref}" matches ${matches.length} templates: ${matches.map((t) => `${t.name} (${t.id})`).join(', ')}. Use the id.` })
  }
  return first.id
}
