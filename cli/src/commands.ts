// One function per command. Each calls the REST API through ApiClient and
// returns the server's JSON (for --json) and a readable text.

import { fail, type ApiClient } from './api.js'
import { isRecord } from './decode.js'
import {
  formatAccount,
  formatBoard,
  formatBoards,
  formatClaim,
  formatCreatedBoard,
  formatInbox,
  formatNext,
  formatRelease,
  formatSession,
  formatUndo,
  formatWrite,
} from './format.js'
import {
  LIST_KINDS,
  account,
  boardDetail,
  boardSummary,
  claimResult,
  createdBoard,
  inbox,
  item,
  nextResult,
  page,
  releaseResult,
  session,
  undoResult,
  writeOutcome,
  type BoardDetail,
  type BoardSummary,
  type ListKind,
} from './schema.js'

export interface Output {
  /** The server's JSON, printed as is with --json. */
  readonly raw: unknown
  readonly text: string
}

/**
 * How a write is sent: made directly (the board's freedom level still
 * decides, and may send it to the Inbox anyway) or put in the Inbox on purpose.
 */
export type InboxChoice = { readonly kind: 'direct'; readonly reason: string | null } | { readonly kind: 'inbox'; readonly reason: string }

const inboxFields = (choice: InboxChoice): Record<string, unknown> => {
  switch (choice.kind) {
    case 'inbox':
      return { inbox: true, reason: choice.reason }
    case 'direct':
      return choice.reason === null ? {} : { reason: choice.reason }
    default: {
      const exhaustive: never = choice
      return exhaustive
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const path = (id: string): string => encodeURIComponent(id)

// ---- Looking things up by name ----

/** Every board (not archived), following next_cursor; capped so a loop cannot run away. */
async function allBoards(client: ApiClient): Promise<{ boards: BoardSummary[]; raw: unknown[] }> {
  const boards: BoardSummary[] = []
  const raw: unknown[] = []
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const answer = await client.body('GET', '/boards', page(boardSummary), { query: { limit: 100, cursor } })
    boards.push(...answer.value.data)
    // The page was decoded above, so its data is the list of boards as sent
    if (isRecord(answer.raw) && Array.isArray(answer.raw.data)) raw.push(...answer.raw.data)
    if (answer.value.next_cursor === null) break
    cursor = answer.value.next_cursor
  }
  return { boards, raw }
}

/** A board id as given, or the one board whose title matches (exactly, then by start). */
export async function resolveBoardId(client: ApiClient, ref: string): Promise<string> {
  if (UUID.test(ref)) return ref
  const { boards } = await allBoards(client)
  const wanted = ref.trim().toLowerCase()
  const exact = boards.filter((board) => board.title.toLowerCase() === wanted)
  const matches = exact.length > 0 ? exact : boards.filter((board) => board.title.toLowerCase().startsWith(wanted))
  const [first, ...others] = matches
  if (first === undefined) return fail({ kind: 'usage', message: `No board called "${ref}". Run \`listspace boards\` to see them.` })
  if (others.length > 0) {
    return fail({ kind: 'usage', message: `"${ref}" matches ${matches.length} boards: ${matches.map((b) => `${b.title} (${b.id})`).join(', ')}. Use the id.` })
  }
  return first.id
}

type BoardList = BoardDetail['lists'][number]

/** A list on the board by id, title or kind (todo, doing, done, ...). */
export function resolveList(board: BoardDetail, ref: string): BoardList {
  const wanted = ref.trim().toLowerCase()
  const byId = board.lists.find((list) => list.id === ref)
  if (byId !== undefined) return byId
  const byTitle = board.lists.filter((list) => list.title.toLowerCase() === wanted)
  const kind = LIST_KINDS.find((candidate) => candidate === wanted)
  const candidates = byTitle.length > 0 ? byTitle : kind === undefined ? [] : board.lists.filter((list) => list.kind === kind)
  const [first, ...others] = candidates
  const names = board.lists.map((list) => list.title).join(', ')
  if (first === undefined) return fail({ kind: 'usage', message: `No list "${ref}" on ${board.title}. Its lists: ${names}.` })
  if (others.length > 0) {
    return fail({ kind: 'usage', message: `"${ref}" matches ${candidates.length} lists on ${board.title}: ${candidates.map((l) => l.title).join(', ')}. Use the title or id.` })
  }
  return first
}

const getBoard = (client: ApiClient, boardId: string) => client.data('GET', `/boards/${path(boardId)}`, boardDetail)

// ---- Commands ----

export async function accountCommand(client: ApiClient): Promise<Output> {
  const answer = await client.data('GET', '/account', account)
  return { raw: answer.raw, text: formatAccount(answer.value) }
}

export async function boardsCommand(client: ApiClient): Promise<Output> {
  const { boards, raw } = await allBoards(client)
  return { raw: { data: raw }, text: formatBoards(boards) }
}

export async function sessionCommand(client: ApiClient, input: { board: string }): Promise<Output> {
  const boardId = await resolveBoardId(client, input.board)
  const answer = await client.data('GET', `/boards/${path(boardId)}/session`, session)
  return { raw: answer.raw, text: formatSession(answer.value) }
}

export async function boardCommand(client: ApiClient, input: { board: string }): Promise<Output> {
  const boardId = await resolveBoardId(client, input.board)
  const answer = await getBoard(client, boardId)
  return { raw: answer.raw, text: formatBoard(answer.value) }
}

export async function newBoardCommand(client: ApiClient, input: { title: string; description: string | null }): Promise<Output> {
  // No template_id and no lists: the server uses "Project (for agents)"
  const body = input.description === null ? { title: input.title } : { title: input.title, description: input.description }
  const answer = await client.data('POST', '/boards', createdBoard, { body })
  return { raw: answer.raw, text: formatCreatedBoard(answer.value) }
}

export async function addCommand(
  client: ApiClient,
  input: { board: string; list: string; title: string; description: string | null; choice: InboxChoice },
): Promise<Output> {
  const boardId = await resolveBoardId(client, input.board)
  const board = (await getBoard(client, boardId)).value
  const list = resolveList(board, input.list)
  const body = {
    list_id: list.id,
    title: input.title,
    ...(input.description === null ? {} : { description: input.description, description_format: 'markdown' }),
    ...inboxFields(input.choice),
  }
  const answer = await client.data('POST', '/items', writeOutcome, { body })
  return { raw: answer.raw, text: formatWrite(answer.value, `Added "${input.title}" to ${list.title}`) }
}

async function moveTo(client: ApiClient, itemId: string, pickList: (board: BoardDetail) => BoardList, choice: InboxChoice): Promise<Output> {
  const current = (await client.data('GET', `/items/${path(itemId)}`, item)).value
  const board = (await getBoard(client, current.board_id)).value
  const list = pickList(board)
  const body = { list_id: list.id, position: 'top', ...inboxFields(choice) }
  const answer = await client.data('POST', `/items/${path(itemId)}/move`, writeOutcome, { body })
  return { raw: answer.raw, text: formatWrite(answer.value, `Moved "${current.title}" to ${list.title}`) }
}

export function moveCommand(client: ApiClient, input: { item: string; list: string; choice: InboxChoice }): Promise<Output> {
  return moveTo(client, input.item, (board) => resolveList(board, input.list), input.choice)
}

/** Done means: moved to the board's done list (the "done" tick in Listspace is for due dates). */
export function doneCommand(client: ApiClient, input: { item: string; choice: InboxChoice }): Promise<Output> {
  return moveTo(
    client,
    input.item,
    (board) => {
      const doneList = board.lists.find((list) => list.kind === 'done')
      if (doneList === undefined) {
        return fail({ kind: 'usage', message: `${board.title} has no done list. Use \`listspace move <item> <list>\` instead.` })
      }
      return doneList
    },
    input.choice,
  )
}

export const INBOX_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'failed', 'all'] as const
export type InboxStatus = (typeof INBOX_STATUSES)[number]

export async function inboxCommand(client: ApiClient, input: { board: string; status: InboxStatus }): Promise<Output> {
  const boardId = await resolveBoardId(client, input.board)
  const answer = await client.data('GET', `/boards/${path(boardId)}/inbox`, inbox, { query: { status: input.status } })
  return { raw: answer.raw, text: formatInbox(answer.value) }
}

export async function undoCommand(client: ApiClient, input: { requestId: string }): Promise<Output> {
  const answer = await client.data('POST', `/activity/${path(input.requestId)}/undo`, undoResult)
  return { raw: answer.raw, text: formatUndo(answer.value) }
}

// ---- Claims: working through a board on your own ----

/** Claim minutes as the API takes them: 5 to 1440 (the server's default is 120). */
export type ClaimMinutes = number & { readonly __brand: 'ClaimMinutes' }

export function parseClaimMinutes(raw: string): ClaimMinutes | null {
  if (!/^\d+$/.test(raw.trim())) return null
  const minutes = Number(raw.trim())
  return minutes >= 5 && minutes <= 1440 ? (minutes as ClaimMinutes) : null
}

export interface NextInput {
  readonly board: string
  /** The kinds of list to take from, in order; empty: the server's default (todo, then backlog). */
  readonly kinds: readonly ListKind[]
  readonly labelIds: readonly string[]
  readonly moveToDoing: boolean
  readonly ttl: ClaimMinutes | null
}

export async function nextCommand(client: ApiClient, input: NextInput): Promise<Output> {
  const boardId = await resolveBoardId(client, input.board)
  const body = {
    ...(input.kinds.length === 0 ? {} : { kinds: input.kinds }),
    ...(input.labelIds.length === 0 ? {} : { label_ids: input.labelIds }),
    move_to_doing: input.moveToDoing,
    ...(input.ttl === null ? {} : { ttl_minutes: input.ttl }),
  }
  const answer = await client.data('POST', `/boards/${path(boardId)}/next`, nextResult, { body })
  return { raw: answer.raw, text: formatNext(answer.value) }
}

export async function claimCommand(client: ApiClient, input: { item: string; ttl: ClaimMinutes | null }): Promise<Output> {
  const body = input.ttl === null ? {} : { ttl_minutes: input.ttl }
  const answer = await client.data('POST', `/items/${path(input.item)}/claim`, claimResult, { body })
  return { raw: answer.raw, text: formatClaim(answer.value) }
}

export async function releaseCommand(client: ApiClient, input: { item: string }): Promise<Output> {
  const answer = await client.data('DELETE', `/items/${path(input.item)}/claim`, releaseResult)
  return { raw: answer.raw, text: formatRelease(answer.value) }
}
