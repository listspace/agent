// The parts of the ListSpace REST API responses (docs/API.md) the CLI reads.
// Each decoder checks only the fields used here; --json prints the server's
// full answer, so nothing is lost for agents.

import {
  array,
  boolean,
  literal,
  nullable,
  number,
  object,
  string,
  union,
  withDefault,
  type Decoded,
  type Decoder,
} from './decode.js'

export const LIST_KINDS = ['info', 'capture', 'backlog', 'todo', 'doing', 'done'] as const
export type ListKind = (typeof LIST_KINDS)[number]

const listKind = nullable(literal(...LIST_KINDS))

export const level = object({
  effective: literal(1, 2, 3, 4, 5),
  name: string,
})
export type Level = Decoded<typeof level>

export const account = object({
  guidance: nullable(string),
  default_level: object({ effective: literal(1, 2, 3, 4, 5), name: string, limited_by_plan: boolean }),
  plan: object({ name: string, max_agent_level: number }),
  boards: array(
    object({
      id: string,
      title: string,
      url: string,
      level,
      follows_account: boolean,
      inbox_pending: number,
      has_instructions: boolean,
    }),
  ),
})
export type Account = Decoded<typeof account>

export const boardSummary = object({ id: string, title: string, url: string, archived: boolean })
export type BoardSummary = Decoded<typeof boardSummary>

const cardBrief = object({ id: string, title: string, due_date: nullable(string), done: boolean })

export const boardDetail = object({
  id: string,
  title: string,
  url: string,
  guidance: withDefault(nullable(string), null),
  instructions: withDefault(nullable(string), null),
  level: withDefault(nullable(level), null),
  lists: array(object({ id: string, title: string, kind: listKind, cards: array(cardBrief) })),
  truncated: withDefault(boolean, false),
})
export type BoardDetail = Decoded<typeof boardDetail>

const itemBrief = object({
  id: string,
  title: string,
  list_title: string,
  due_date: nullable(string),
  url: string,
})
export type ItemBrief = Decoded<typeof itemBrief>

export const session = object({
  guidance: nullable(string),
  board: object({ id: string, title: string, url: string }),
  instructions: nullable(string),
  level,
  lists: array(object({ id: string, title: string, kind: listKind, open_items: number })),
  work: array(itemBrief),
  captured: array(itemBrief),
  recently_done: array(itemBrief),
  due_soon: array(itemBrief),
  today: string,
  truncated: boolean,
})
export type Session = Decoded<typeof session>

export const item = object({ id: string, board_id: string, list_id: string, title: string, url: string })
export type Item = Decoded<typeof item>

const applied = object({
  outcome: literal('applied'),
  level,
  undo: nullable(object({ request_id: string })),
})
const suggested = object({
  outcome: literal('suggested'),
  level,
  message: string,
  suggestion: object({ id: string, status: string }),
})

/**
 * The answer to every write that can wait in the Inbox: made (applied, with
 * its undo id) or waiting for the user (suggested).
 */
export const writeOutcome: Decoder<Decoded<typeof applied> | Decoded<typeof suggested>> = union(
  (value) => (value.outcome === 'suggested' ? 'b' : 'a'),
  applied,
  suggested,
)
export type WriteOutcome = Decoded<typeof writeOutcome>

/** POST /boards: the board plus its instructions and undo id; never suggested. */
export const createdBoard = object({
  id: string,
  title: string,
  url: string,
  instructions: nullable(string),
  level,
  lists: array(object({ id: string, title: string, kind: listKind })),
  undo: nullable(object({ request_id: string })),
})
export type CreatedBoard = Decoded<typeof createdBoard>

export const inbox = object({
  suggestions: array(
    object({
      id: string,
      action: string,
      item_title: nullable(string),
      list_title: nullable(string),
      reason: nullable(string),
      agent_name: string,
      status: string,
      stale: boolean,
      created_at: string,
      expires_at: string,
    }),
  ),
})
export type Inbox = Decoded<typeof inbox>

export const undoResult = object({
  outcome: literal('undone', 'already_undone'),
  undone: array(string),
  level: nullable(level),
})
export type UndoResult = Decoded<typeof undoResult>

// ---- Claims: an agent working on an item ----

/** Who holds a claim that is in the way (agent_name null: an app or assistant without a name). */
const claimedBy = object({ agent_name: nullable(string), expires_at: string })

const taken = object({
  outcome: literal('taken'),
  item_id: string,
  claimed_by: claimedBy,
  message: string,
  level,
})
export type Taken = Decoded<typeof taken>

const claimHeld = object({ outcome: literal('claimed', 'renewed'), item_id: string, expires_at: string, level })

/** POST /items/:id/claim: claimed or renewed for you, or taken by another agent. */
export const claimResult: Decoder<Decoded<typeof claimHeld> | Taken> = union(
  (value) => (value.outcome === 'taken' ? 'b' : 'a'),
  claimHeld,
  taken,
)
export type ClaimResult = Decoded<typeof claimResult>

const released = object({ outcome: literal('released', 'not_claimed'), item_id: string, level })

/** DELETE /items/:id/claim: released (or there was none), or held by another agent. */
export const releaseResult: Decoder<Decoded<typeof released> | Taken> = union(
  (value) => (value.outcome === 'taken' ? 'b' : 'a'),
  released,
  taken,
)
export type ReleaseResult = Decoded<typeof releaseResult>

const nextClaimed = object({
  outcome: literal('claimed'),
  item: object({ id: string, title: string, list_id: string, url: string }),
  expires_at: string,
  moved_to: nullable(object({ list_id: string, list_title: string })),
  note: nullable(string),
  level,
  undo: nullable(object({ request_id: string })),
})
const nextEmpty = object({ outcome: literal('empty'), message: string, level })

/** POST /boards/:id/next: the item claimed for you, or nothing left. */
export const nextResult: Decoder<Decoded<typeof nextClaimed> | Decoded<typeof nextEmpty>> = union(
  (value) => (value.outcome === 'empty' ? 'b' : 'a'),
  nextClaimed,
  nextEmpty,
)
export type NextResult = Decoded<typeof nextResult>

/** A page of a list endpoint: { data: [...], next_cursor }. */
export function page<T>(entry: Decoder<T>): Decoder<{ data: T[]; next_cursor: string | null }> {
  return object({ data: array(entry), next_cursor: nullable(string) })
}

export const errorBody = object({ error: object({ code: string, message: string }) })
