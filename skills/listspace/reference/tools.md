# Listspace MCP tools

Server: `https://mcp.listspace.app` (Streamable HTTP). Sign in with OAuth, or send `Authorization: Bearer ls_...` with a personal token from Settings > API. Arguments use the same field names as the REST API (`https://api.listspace.app/v1`, snake_case, UUID ids).

## Read

| Tool | Use it for |
|---|---|
| `get_account` | First call: guidance, default level and its `allowed`, boards with their level, Inbox count and whether they have instructions |
| `start_session` | `board_id`: guidance, instructions, level, `allowed` for this board, lists with kinds, `work`, `captured`, `recently_done`, `due_soon` |
| `get_board` | Every list (with `kind`) and item id on a board, and `allowed` |
| `get_item` | One item in full; description as markdown; `link_previews` (title, image, site, and for books ISBN, authors and summary) |
| `search_items` | Items by words across boards; run it before adding to avoid duplicates |
| `list_due_items` | Items with due dates, soonest first |
| `list_important_items` | Everything the user marked important (items, and the items of important lists), grouped by board |
| `get_overview` | Every board: open items per list kind, overdue, due soon |
| `list_templates` | Board templates with their category, description, lists and instructions: the gallery (sales, clients, professions, product, meetings, personal) plus "Project (for agents)" and "Ops (private)" |
| `list_labels` | Labels and their ids |
| `list_spaces` | The user's spaces (groups of boards, such as Personal and Work) in order, with board counts. `list_boards` takes `space_id` |
| `list_suggestions` | A board's Inbox and what happened to your suggestions |
| `get_history` | Who changed what on a board or item, with `request_id` and `can_undo` |
| `list_versions` | A document's saved versions, newest first: who, when, size, note |
| `get_version` | `item_id`, `version`: one version's title and text (markdown), and `current_version` |

## Write

Each takes `inbox` (true: suggest, do not change) and `reason` (at most 500 characters, shown to the user).

| Tool | Main fields |
|---|---|
| `create_item` | `list_id`, `title`, `description` (markdown), `due_date` (YYYY-MM-DD), `position` (`top` or `bottom`), `type` (`item` or `document`); links in it get their previews right after |
| `update_item` | `item_id`, then only what changes: `title`, `description`, `due_date`, `done`, `label_ids`; on a document `version_note` |
| `move_item` | `item_id`, `list_id` (may be on another board), `position` or `before_item_id` |
| `complete_item` | `item_id`: ticks the due date as met. Needs a due date. Finishing work is a move to the `done` list instead |
| `archive_item` | `item_id`; `archived: false` restores. Only when the user asks |
| `add_checklist_item` | `item_id`, `text` |
| `add_comment` | `item_id`, `text` (markdown): progress notes on the item you work on |
| `create_board` | `title`, optional `description` and `space_id`; no template and no lists gives "Project (for agents)" |
| `create_list`, `update_list`, `update_board` | Lists and board details; rarely needed. `update_list` with `kind` sets what a list is for (null for none). `update_board` with `space_id` moves a board to another space |
| `withdraw_suggestion` | Take back one of your own pending suggestions |
| `undo` | `request_id` from a result's `undo`: takes back that whole call |
| `attach_url` | `item_id`, `url` (public https): Listspace downloads the file (at most 8 MB). Level 4; no `inbox` |
| `attach_file` | `item_id`, `filename`, `mime_type`, `content_base64`. For a file on the user's computer use the CLI instead: `listspace attach` (see [files.md](files.md)) |
| `restore_version` | `item_id`, `version`: puts that version back as a new version; nothing is deleted. Level 4 |

## Checklists, list groups and many items

One tool per change. Each takes `inbox` and `reason` like the writes above.

| Tool | Fields |
|---|---|
| `create_checklist` | `item_id`, `title`, optional `items` (its first checklist items). For one more item on a checklist, use `add_checklist_item` |
| `rename_checklist` | `item_id`, `checklist_id`, `title` |
| `check_checklist_item` | `item_id`, `checklist_item_id`, `done` (true or false) |
| `edit_checklist_item` | `item_id`, `checklist_item_id`, `text` |
| `move_checklist_item` | `item_id`, `checklist_item_id`, `position` (0 first) |
| `remove_checklist_item` | `item_id`, `checklist_item_id`. Removes only items you added; any other waits in the Inbox. To finish one, check it instead |
| `create_list_group` | `board_id`, `title`, optional `color` |
| `update_list_group` | `board_id`, `group_id`, then only what changes: `title`, `color`, `collapsed` |
| `move_list_to_group` | `board_id`, `list_id`, `group_id` (null: out of any group) |
| `reorder_list_groups` | `board_id`, `group_ids` (all of them, in order) |
| `bulk_move_items` | `item_ids` (up to 100), `list_id`, optional `position` |
| `bulk_add_label`, `bulk_remove_label` | `item_ids`, `label_id` |
| `bulk_set_due` | `item_ids`, `due_date` (null removes it) |
| `bulk_complete_items` | `item_ids`: ticks their due dates as met |
| `bulk_archive_items` | `item_ids`; `archived: false` restores. Only when the user asks |

A bulk call needs the level the same change needs for one item, and its `undo.request_id` takes the whole call back. Items on two boards cannot be suggested in one call: send one call per board.

## Labels

Labels belong to the account, so the account's level decides and they never wait in the Inbox. They take no `inbox` or `reason`.

| Tool | Fields |
|---|---|
| `create_label` | `name`, optional `color` (default `blue`). Level 4 |
| `update_label` | `label_id`, then `name`, `color` or both. Level 4 |
| `delete_label` | `label_id`. Only a label on no item: take it off first with `bulk_remove_label`. Level 5 |

## Spaces

A space groups boards, like a desktop. Every board is in one; boards in results carry `space_id`. Spaces belong to the account, so the account's level decides and they never wait in the Inbox. They take no `inbox` or `reason`. Agents never delete spaces.

| Tool | Fields |
|---|---|
| `create_space` | `name` (1 to 40 characters), optional `color` (default `blue`). Level 3 |
| `update_space` | `space_id`, then only what changes: `name`, `color`, `position` (0 first). Level 4 |

## Feedback

| Tool | Fields |
|---|---|
| `send_feedback` | Only after a `feedback_request` in `get_account` or `start_session`. `likes`, `missing` (the user's own words, at most 2000 characters each), optional `rating` (1 to 5), `may_quote` (default false; true only when the user said yes to being quoted with their first name), or `declined: true` and nothing else. About the user's account, so no freedom level applies. Takes no `inbox` or `reason` |

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
