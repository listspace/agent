# Freedom levels

The user sets a level per account (default 3) and can give a board its own. The server decides on every call; nothing is cached, so follow the `level` in each result.

| Level | Name | Made directly | Sent to the Inbox |
|---|---|---|---|
| 1 | Read only | nothing (writes are refused) | nothing |
| 2 | Suggest | nothing | every write; new boards are refused |
| 3 | Capture | items in `info` and `capture` lists, checklist items, comments, new boards, new spaces | everything else (claims are refused) |
| 4 | Act | also items in other lists, edits, labels, spaces, moves, lists, board details, claims (`next_item`, `claim_item`, `release_item`) | completing, archiving, adding or moving to a `done` list |
| 5 | Full | everything | only what you send with `inbox: true` |

A list without a kind counts as a to do list. A move to another board follows the lower of the two levels. Claims change no content and cannot wait in the Inbox, so below level 4 they are refused.

## `allowed`: the table for your level

`get_account` (account default), `start_session` and `get_board` (that board) return `allowed`: each action key with `direct` (it happens), `inbox` (it waits in the Inbox) or `no` (refused). Keys include `create_item_capture`, `create_item`, `create_item_done`, `update_item`, `move_item`, `move_item_done`, `copy_item`, `complete_item`, `archive_item`, `add_checklist_item`, `create_checklist`, `update_checklist`, `remove_checklist_item`, `add_comment`, `attach`, the list, board, space and label actions, `claim_item`, `release_item` and `next_item`. Read it once per session instead of guessing; the result of each call still decides. The full table for every level: [What agents can do](https://listspace.app/docs/agents)

## What to do with each answer

- `applied`: carry on. Keep `undo.request_id` in mind in case the change was wrong.
- `suggested`: the change waits for the user in the board's Inbox (Agents window in the app). Say so in one line. Do not send it again, and do not reach the same result another way (such as a new item instead of a move).
- Refused (an error naming the level): stop and tell the user which setting allows it (the board's menu under Agent access, or Settings > Agents).
- Rate limited (429): wait for `Retry-After` seconds. A full Inbox (200 waiting) or the hourly suggestion cap also answers 429; tell the user rather than retrying.

## Undo

`undo` with a `request_id` takes back everything that call changed. Only your own changes; refused when someone changed the same thing since, and refused where the change itself would have needed the Inbox. Undoing a new item archives it. Changes can be undone for 30 days.

## Never through an agent

Deleting, changing levels, guidance or instructions, share links, inbound email addresses, tokens and webhooks are only for the user in the app. Taking an item another agent has claimed is never allowed.
