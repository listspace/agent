# Listspace MCP tools

Server: `https://mcp.listspace.app` (Streamable HTTP). Sign in with OAuth, or send `Authorization: Bearer ls_...` with a personal token from Settings > Developers. Arguments use the same field names as the REST API (`https://api.listspace.app/v1`, snake_case, UUID ids).

## Read

| Tool | Use it for |
|---|---|
| `get_account` | First call: guidance, default level and its `allowed`, boards with their level, Inbox count and whether they have instructions |
| `start_session` | `board_id`: guidance, instructions, level, `allowed` for this board, lists with kinds, `work`, `captured`, `recently_done`, `due_soon`, `last_sessions` (the latest 3 session summaries) |
| `board_report` | `board_id`, optional `period` (`week`, `two_weeks`, `month`, `quarter`) and `stalled_days`: the data for a status report (finished, added, in progress, overdue, due soon, stalled, open requests, decisions, who made the changes). Write the report yourself from it; never invent numbers. Offer `attach_document` to keep it as a PDF on an item |
| `end_session` | `board_id`, `summary` (at most 2000 characters): what changed, what is open, the next step. Returned by the next `start_session`. `decisions` (up to 10, `title` and `because`): the decisions of the session; the ones the board does not have yet are recorded as Proposed in the Inbox (with decisions off on the board: added as normal items). Level 3; no `inbox` |
| `get_board` | Every list (with `kind`) and item id on a board, and `allowed` |
| `get_item` | One item in full; description as markdown; `link_previews` (title, image, site, and for books ISBN, authors and summary) |
| `export_item` | A 15-minute download link to one item or document as a markdown file, for the user only |
| `search_items` | Items by words across boards; run it before adding to avoid duplicates |
| `list_due_items` | Items with due dates, soonest first |
| `list_important_items` | Everything the user marked important (items, and the items of important lists), grouped by board |
| `my_items` | For you: items due, items agents are working on, Inbox suggestions and requests for the user (as their kinds, with `request`), across all boards, grouped overdue, today, this week, later, no date; `waiting` lists what the user waits for. `needs_action: true` for only what needs the user now |
| `my_requests` | Requests both ways: `for_you` (with the `answers` the user can give, and `context` on the first 10: a briefing with a `summary`), `waiting` and `recent` (with `request_outcome`), each with `status_line` ("Asked of Sara, by Fri") |
| `list_board_members` | Who is on a board (the owner, the members of its team on a team board, and guests, with `user_id`, `kind` and `team_role`): the people a request can go to |
| `get_overview` | Every board: open items per list kind, overdue, due soon |
| `list_templates` | Board templates with their category, description, lists and instructions: the gallery (sales, clients, professions, product, meetings, personal) plus "Project (for agents)" and "Ops (private)" |
| `list_labels` | Labels and their ids |
| `list_spaces` | The user's spaces (groups of boards, such as Personal and Work) in order, with board counts. `list_boards` takes `space_id` |
| `list_suggestions` | A board's Inbox and what happened to your suggestions |
| `get_history` | Who changed what on a board or item, with `request_id` and `can_undo`; `since` leaves out older changes |
| `catch_up` | What happened since a moment (default: since the user last opened the board), summed up for a short briefing: counts, who did what, the few items that matter, the Inbox, overdue. One board or all |
| `list_versions` | A document's saved versions, newest first: who, when, size, note |
| `get_version` | `item_id`, `version`: one version's title and text (markdown), and `current_version` |
| `list_unsorted` | `space_id`: the items captured in a space's Unsorted (on no board yet), with any proposal waiting, plus the space's boards, their lists, your level on each and the routing hints. Follow the hints; leave an item there when unsure |

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
| `add_comment` | `item_id`, `text` (markdown): progress notes on the item you work on; `attachment_id` puts it on one file of the item (feedback on a design), `anchor` (`quote`, optional `occurrence`) on a passage of a document (a review of a PRD); with `attachment_id`, `pin` (`x`, `y` from 0 to 1, `page` on a PDF) puts it at a spot of an image, and `anchor` with `page` on a passage of a PDF; `parent_id` makes it a reply; `mentions` (user ids from `list_board_members`) mentions people on the board, who are told at once |
| `send_request` | `item_id`, `to_user_id` (someone on the board), `kind` (`do`, `look`, `question`, `approve`), `message`, `due_date` (needed for `do`). Owner and Edit guests send any kind, Comment guests `question` and `look`. Sends in the user's name: confirm it with the user in one line first. `check: true` sends nothing and returns the receiver's `load` (open requests, items due this week, away until) and a `warning` to put in that line; never a block |
| `answer_request` | `request_id`, `answer` (by kind: `do` accept, decline, pass, then done; `look` and `question` reply, decline, pass; `approve` approve, reject, pass), `text` (the reason or reply), `to_user_id` (for `pass`), `outcome` (for an answer that closes it: a result for the asker in at most 2 lines). Only for a request for the user, with the user's own answer |
| `create_board` | `title`, optional `description` and `space_id`; no template and no lists gives "Project (for agents)" |
| `create_list`, `update_list`, `update_board` | Lists and board details; rarely needed. `create_list` and `update_list` take `kind` for what a list is for (null for none). `create_list` takes `before_list_id` or `after_list_id` to place the new list next to another one (default: at the end), so no `reorder_lists` call is needed. `update_board` with `space_id` moves a board to another space |
| `withdraw_suggestion` | Take back one of your own pending suggestions |
| `undo` | `request_id` from a result's `undo`: takes back that whole call |
| `attach_url` | `item_id`, `url` (public https): Listspace downloads the file (at most 8 MB). Level 4; no `inbox` |
| `attach_file` | `item_id`, `filename`, `mime_type`, `content_base64`. For a file on the user's computer use the CLI instead: `listspace attach` (see [files.md](files.md)) |
| `attach_document` | `item_id`, `format` (`pdf`, `docx`, `md`), `content` (markdown, at most 200000 characters, 40000 for a PDF) or `from_item: true`, optional `title` and `filename`: Listspace makes the file and attaches it. A PDF uses a standard font (Western European letters); use `docx` for other scripts. A `busy` error means another file is being made: try again in a few seconds. Level 4; no `inbox` |
| `get_upload_link` | `item_id`, optional `filename`, `replaces_attachment_id`: a one-time link (10 minutes) for `curl --upload-file <file> '<upload_url>'`; the upload answers with the attachment and `sha256`. Level 4; no `inbox` |
| `restore_version` | `item_id`, `version`: puts that version back as a new version; nothing is deleted. Level 4 |
| `route_item` | `item_id` (in Unsorted), `board_id`, optional `list_id`, `reason`: sorts it onto a board. At level 4 and up it applies; below that, into a done list or with `inbox: true` it waits in that board's Inbox |
| `record_decision` | `list_id` and `title` (the decision in one sentence; context in `description`), or `item_id` (a short item); `because` (the reason), optional `claim_key`, `source_item_id` (the plan it was found in). Proposed: waits in the Inbox at every level (`outcome: "suggested"`, `confirm_url`), or Confirmed at once when the user says yes on the app's confirm screen (`outcome: "confirmed"`). Decisions off on the board (`decisions.on` false): no decision; `list_id` and `title` add a normal item at your level, `item_id` stays as it is, and the result says `decisions_on: false` |
| `propose_decision_change` | `item_id` (a decision), `change` (`settle`, `replace` or `dispute`), `with_item_id` (for replace and dispute), `because`. Always waits for the user (or the confirm screen for settle and replace). At most 5 wait per board. Refused on a board with decisions off |

Every attach answer has `sha256`, the SHA-256 of the stored bytes.

`attach_url`, `attach_file`, `attach_document` and `get_upload_link` take `replaces_attachment_id` (a current file of the item): the new file becomes that file's newest version and the old one is kept as an older version, with its comments. Use it for a new draft of a file you or the user attached before, so the item does not collect report-v1, report-v2 and report-final side by side.

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
| `send_feedback` | Only after a `feedback_request` in `get_account` or `start_session`. `likes`, `missing` (the user's own words, at most 2000 characters each), optional `rating` (1 to 5), `may_quote` (default false; true only when the user said yes to being quoted by first name), or `declined: true` and nothing else. About the user's account, so no agent access level applies. Takes no `inbox` or `reason` |

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

The user can set webhooks in the app (Settings > Developers > Webhooks) to wake an agent when items change. Agents never create, see or change them; there is no tool for it.
