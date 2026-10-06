# ListSpace MCP tools

Server: `https://mcp.listspace.app` (Streamable HTTP). Sign in with OAuth, or send `Authorization: Bearer ls_...` with a personal token from Settings > API. Arguments use the same field names as the REST API (`https://api.listspace.app/v1`, snake_case, UUID ids).

## Read

| Tool | Use it for |
|---|---|
| `get_account` | First call: guidance, default level and its `allowed`, boards with their level, Inbox count and whether they have instructions |
| `start_session` | `board_id`: guidance, instructions, level, `allowed` for this board, lists with kinds, `work`, `captured`, `recently_done`, `due_soon` |
| `get_board` | Every list (with `kind`) and item id on a board, and `allowed` |
| `get_item` | One item in full; description as markdown |
| `search_items` | Items by words across boards; run it before adding to avoid duplicates |
| `list_due_items` | Items with due dates, soonest first |
| `get_overview` | Every board: open items per list kind, overdue, due soon |
| `list_templates` | Board templates with their lists and instructions |
| `list_labels` | Labels and their ids |
| `list_suggestions` | A board's Inbox and what happened to your suggestions |
| `get_history` | Who changed what on a board or item, with `request_id` and `can_undo` |
| `list_versions` | A document's saved versions, newest first: who, when, size, note |
| `get_version` | `item_id`, `version`: one version's title and text (markdown), and `current_version` |

## Write

Each takes `inbox` (true: suggest, do not change) and `reason` (at most 500 characters, shown to the user).

| Tool | Main fields |
|---|---|
| `create_item` | `list_id`, `title`, `description` (markdown), `due_date` (YYYY-MM-DD), `position` (`top` or `bottom`), `type` (`item` or `document`) |
| `update_item` | `item_id`, then only what changes: `title`, `description`, `due_date`, `done`, `label_ids`; on a document `version_note` |
| `move_item` | `item_id`, `list_id` (may be on another board), `position` or `before_item_id` |
| `complete_item` | `item_id`: ticks the due date as met. Needs a due date. Finishing work is a move to the `done` list instead |
| `archive_item` | `item_id`; `archived: false` restores. Only when the user asks |
| `add_checklist_item` | `item_id`, `text` |
| `add_comment` | `item_id`, `text` (markdown): progress notes on the item you work on |
| `create_board` | `title`, optional `description`; no template and no lists gives "Project (for agents)" |
| `create_list`, `update_list`, `update_board` | Lists and board details; rarely needed |
| `withdraw_suggestion` | Take back one of your own pending suggestions |
| `undo` | `request_id` from a result's `undo`: takes back that whole call |
| `restore_version` | `item_id`, `version`: puts that version back as a new version; nothing is deleted. Level 4 |

## Documents

A document is an item with `type: "document"`: a longer text (up to 200000 characters of markdown) whose every saved change of title or text is a version. Use documents for PRDs, specs, schemas and decision records, and update them in place with `update_item` and a `version_note` rather than adding new items. `get_item` shows `type` and the current `version`. A document keeps its latest 200 versions.

## Claims

Need level 4 (Act); below it they are refused, since a claim cannot wait in the Inbox. They take no `inbox` or `reason`. The loop that uses them: [autonomy.md](autonomy.md).

| Tool | Fields | Result |
|---|---|---|
| `next_item` | `board_id`; optional `kinds` (default `["todo", "backlog"]`), `label_ids` (all must match), `move_to_doing` (default true), `ttl_minutes` (5 to 1440, default 120) | `outcome: "claimed"` with `item` (description as markdown, checklists, `claim`), `expires_at`, `moved_to` (null: not moved, `note` says why) and `undo`; or `outcome: "empty"` with `message` |
| `claim_item` | `item_id`, optional `ttl_minutes` | `claimed` or `renewed` with `expires_at`; or `taken` with `claimed_by` (`agent_name`, `expires_at`): do not work on it |
| `release_item` | `item_id` | `released` or `not_claimed`; `taken` when another agent holds it |

Items in `get_item`, `get_board` and `start_session` carry `claim`: null, or `agent_name`, `claimed_at`, `expires_at` and `yours`. A claim runs out at `expires_at` unless you write on the item or claim it again.

## Results

- Writes: `outcome` (`applied` or `suggested`) and `level` (`effective`, `name`). Applied writes add `undo.request_id`.
- A refused write is `isError: true` with a message naming the level and where the user changes it.
- `get_board` keeps each list's items in a `cards` array.
- Old tool names (`create_card`, `move_card`, ...) still work until 5 October 2027; use the item names.

## Webhooks

The user can set webhooks in the app (Settings > Agents > Webhooks) to wake an agent when items change. Agents never create, see or change them; there is no tool for it.
