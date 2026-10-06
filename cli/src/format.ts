// Readable output for people. Agents pass --json and get the server's JSON.

import type {
  Account,
  BoardDetail,
  BoardSummary,
  ClaimResult,
  CreatedBoard,
  Inbox,
  ItemBrief,
  Level,
  NextResult,
  ReleaseResult,
  Session,
  Taken,
  UndoResult,
  WriteOutcome,
} from './schema.js'

const levelText = (level: Level): string => `level ${level.effective} (${level.name})`

function block(title: string, text: string | null): string[] {
  if (text === null || text.trim() === '') return []
  return [`${title}:`, ...text.trim().split('\n').map((line) => `  ${line}`)]
}

function items(title: string, list: readonly ItemBrief[], showList: boolean): string[] {
  if (list.length === 0) return []
  return [
    `${title}:`,
    ...list.map((entry) => {
      const where = showList ? ` [${entry.list_title}]` : ''
      const due = entry.due_date === null ? '' : ` (due ${entry.due_date})`
      return `  - ${entry.title}${where}${due}  ${entry.id}`
    }),
  ]
}

export function formatAccount(account: Account): string {
  const lines = [
    `Plan: ${account.plan.name}`,
    `Default ${levelText(account.default_level)}${account.default_level.limited_by_plan ? ', limited by the plan' : ''}`,
    ...block('Guidance for agents', account.guidance),
    `Boards (${account.boards.length}):`,
    ...account.boards.map((board) => {
      const notes = [levelText(board.level)]
      if (board.inbox_pending > 0) notes.push(`${board.inbox_pending} in Inbox`)
      if (board.has_instructions) notes.push('has instructions')
      return `  - ${board.title}  ${board.id}  (${notes.join(', ')})`
    }),
  ]
  return lines.join('\n')
}

export function formatBoards(boards: readonly BoardSummary[]): string {
  if (boards.length === 0) return 'No boards yet. Create one with `listspace new-board "<title>"`.'
  return boards.map((board) => `${board.title}  ${board.id}`).join('\n')
}

export function formatSession(session: Session): string {
  const lists = session.lists.map((list) => `${list.title}${list.kind === null ? '' : ` (${list.kind})`}: ${list.open_items}`)
  return [
    `${session.board.title}  ${session.board.id}`,
    `${session.board.url}`,
    `Agent ${levelText(session.level)}. Today is ${session.today}.`,
    ...block('Guidance for agents (read first)', session.guidance),
    ...block('Board instructions (follow these)', session.instructions),
    `Lists: ${lists.join(', ')}`,
    ...items('Work', session.work, true),
    ...items('Captured', session.captured, true),
    ...items('Due soon', session.due_soon, true),
    ...items('Recently done', session.recently_done, false),
    ...(session.truncated ? ['(Some sections were cut; run `listspace board <id>` for everything.)'] : []),
  ].join('\n')
}

export function formatBoard(board: BoardDetail): string {
  return [
    `${board.title}  ${board.id}`,
    board.url,
    ...(board.level === null ? [] : [`Agent ${levelText(board.level)}.`]),
    ...block('Guidance for agents (read first)', board.guidance),
    ...block('Board instructions (follow these)', board.instructions),
    ...board.lists.flatMap((list) => [
      `${list.title}${list.kind === null ? '' : ` (${list.kind})`}  ${list.id}`,
      ...list.cards.map((card) => `  - ${card.title}${card.due_date === null ? '' : ` (due ${card.due_date}${card.done ? ', done' : ''})`}  ${card.id}`),
    ]),
    ...(board.truncated ? ['(Only the first 1,000 items are shown.)'] : []),
  ].join('\n')
}

/** What a write did: made (with how to undo it) or waiting in the Inbox. */
export function formatWrite(outcome: WriteOutcome, done: string): string {
  if (outcome.outcome === 'suggested') {
    return [
      `Suggested, not made: ${outcome.message}`,
      `It waits in the board's Inbox for the user to accept or reject (${levelText(outcome.level)}). Do not send it again.`,
      `Suggestion ${outcome.suggestion.id}`,
    ].join('\n')
  }
  const undo = outcome.undo === null ? [] : [`Undo: listspace undo ${outcome.undo.request_id}`]
  return [`${done} (${levelText(outcome.level)}).`, ...undo].join('\n')
}

export function formatCreatedBoard(board: CreatedBoard): string {
  return [
    `Created board "${board.title}"  ${board.id}`,
    board.url,
    `Lists: ${board.lists.map((list) => list.title).join(', ')}`,
    ...block('Board instructions (follow these)', board.instructions),
    ...(board.undo === null ? [] : [`Undo: listspace undo ${board.undo.request_id}`]),
  ].join('\n')
}

export function formatInbox(inbox: Inbox): string {
  if (inbox.suggestions.length === 0) return 'The Inbox is empty.'
  return inbox.suggestions
    .map((suggestion) => {
      const target = [suggestion.item_title, suggestion.list_title].filter((part) => part !== null).join(' -> ')
      const lines = [`${suggestion.status}: ${suggestion.action}${target === '' ? '' : ` ${target}`}  ${suggestion.id}`]
      if (suggestion.reason !== null) lines.push(`  Reason: ${suggestion.reason}`)
      lines.push(`  By ${suggestion.agent_name}, ${suggestion.created_at.slice(0, 10)}, expires ${suggestion.expires_at.slice(0, 10)}${suggestion.stale ? ', item changed since' : ''}`)
      return lines.join('\n')
    })
    .join('\n')
}

export function formatUndo(result: UndoResult): string {
  if (result.outcome === 'already_undone') return 'Nothing left to undo: it was undone already.'
  return `Undone (${result.undone.length} change${result.undone.length === 1 ? '' : 's'}).`
}

/** Another agent holds the item: say who and until when, and not to work on it. */
function formatTaken(result: Taken): string {
  return [
    `Taken: ${result.claimed_by.agent_name ?? 'another app or assistant'} is working on this item until ${result.claimed_by.expires_at}.`,
    result.message,
  ].join('\n')
}

export function formatNext(result: NextResult): string {
  switch (result.outcome) {
    case 'empty':
      return `Nothing left: ${result.message}`
    case 'claimed': {
      const lines = [
        `Claimed "${result.item.title}"  ${result.item.id}`,
        result.item.url,
        result.moved_to === null ? 'Not moved.' : `Moved to ${result.moved_to.list_title}.`,
        `Claim runs out at ${result.expires_at} (${levelText(result.level)}); any write of yours on the item renews it.`,
      ]
      if (result.note !== null) lines.push(`Note: ${result.note}`)
      if (result.undo !== null) lines.push(`Undo the move: listspace undo ${result.undo.request_id}`)
      lines.push(`When done: listspace release ${result.item.id}`)
      return lines.join('\n')
    }
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

export function formatClaim(result: ClaimResult): string {
  switch (result.outcome) {
    case 'claimed':
    case 'renewed':
      return `${result.outcome === 'claimed' ? 'Claimed' : 'Renewed'} ${result.item_id} until ${result.expires_at} (${levelText(result.level)}).`
    case 'taken':
      return formatTaken(result)
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

export function formatRelease(result: ReleaseResult): string {
  switch (result.outcome) {
    case 'released':
      return `Released ${result.item_id}.`
    case 'not_claimed':
      return `${result.item_id} had no claim to release.`
    case 'taken':
      return formatTaken(result)
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}
