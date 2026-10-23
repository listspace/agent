# Agent access

The user sets a level per account (default 4 for new accounts) and can give a board its own. Free goes up to 4; 5 comes with Pro. The server decides on every call; nothing is cached, so follow the `level` in each result.

| Level | Name | Made directly | Sent to the Inbox |
|---|---|---|---|
| 1 | Read only | nothing (writes are refused) | nothing |
| 2 | Suggest | nothing (a capture into a space's Unsorted applies) | every write that can wait there; files, labels, links, claims, spaces and new boards are refused |
| 3 | Capture | items in `info` and `capture` lists, checklist items, comments, links on items (`add_link`, `remove_link`), answers to requests, new boards, new spaces | everything else that can wait there; files, labels, claims and space changes are refused |
| 4 | Act | also items in other lists, edits, dependencies (`add_dependency`, `remove_dependency`), labels, spaces, files, moves, lists, board details, claims (`next_item`, `claim_item`, `release_item`) | completing, archiving, adding or moving to a `done` list, removing checklist items, moving or copying a list to another board, deleting a custom field; deleting a label is refused |
| 5 | Full | everything, including completing and archiving, deleting an unused label or a custom field (undo brings a field back with its values) and removing checklist items you added; never deleting items, lists, boards, comments or files | what you send with `inbox: true`, decisions, and removing a checklist item someone else added |

A list without a kind counts as a to do list. A move to another board follows the lower of the two levels. Some writes cannot wait in an Inbox: files, labels, spaces, links on items, claims and new boards. Below their level they are refused, not sent to the Inbox, and `inbox: true` does not change that.

## `allowed`: the table for your level

`get_account` (account default), `start_session` and `get_board` (that board) return `allowed`: each action key with `direct` (it happens), `inbox` (it waits in the Inbox) or `no` (refused). Keys include `create_item_capture`, `create_item`, `create_item_done`, `update_item`, `move_item`, `move_item_done`, `copy_item`, `complete_item`, `archive_item`, `add_checklist_item`, `create_checklist`, `update_checklist`, `remove_checklist_item`, `add_comment`, `link` (add or remove a link), `attach`, the list, board, space and label actions, `claim_item`, `release_item` and `next_item`. Read it once per session instead of guessing; the result of each call still decides. The full table for every level: [What agents can do](https://listspace.app/docs/agents)

## What to do with each answer

- `applied`: carry on. Keep `undo.request_id` in mind in case the change was wrong.
- `suggested`: the change waits for the user in the board's Inbox (a column on the board in the app). Say so in one line. Do not send it again, and do not reach the same result another way (such as a new item instead of a move).
- Refused (an error naming the level): stop and tell the user which setting allows it (the board's menu under Agent access, or Settings > Your AI).
- Rate limited (429): wait for `Retry-After` seconds. A full Inbox (200 waiting) or the hourly suggestion cap also answers 429; tell the user rather than retrying.

## Undo

`undo` with a `request_id` takes back everything that call changed. It works for changes to items, lists and boards: comments, files, covers, stars, list order, list groups, labels, checklist renames, a list moved to another board, requests and decisions are not undone (their results have `undo` null). Only your own changes; refused when someone changed the same thing since, and refused where the change itself would have needed the Inbox. Undoing a new item archives it. Changes can be undone for 30 days.

## Never through an agent

Deleting items, lists, boards, spaces, checklists, comments or files, changing levels, guidance or instructions, share links, inbound email addresses, tokens and webhooks are only for the user in the app. Taking an item another agent has claimed is never allowed.
