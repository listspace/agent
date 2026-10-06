# The listspace CLI

Use it when the MCP tools are not connected. Always pass `--json` and read the JSON. It calls the REST API with a personal token.

## Sign in

The user runs `listspace login` once and pastes a token from ListSpace (Settings > API), or sets `LISTSPACE_TOKEN`. Never ask the user to paste a token into the chat, and never write one into a file in the project.

## Commands

| Command | Same as |
|---|---|
| `listspace whoami --json` | `get_account` |
| `listspace boards --json` | `list_boards` |
| `listspace session <board> --json` | `start_session` |
| `listspace board <board> --json` | `get_board` |
| `listspace new-board "<title>" --json` | `create_board` (Project for agents) |
| `listspace add <board> <list> "<title>" --description "<markdown>" --json` | `create_item` |
| `listspace move <item> <list> --json` | `move_item` |
| `listspace done <item> --json` | `move_item` to the board's `done` list |
| `listspace inbox <board> [--status all] --json` | `list_suggestions` |
| `listspace undo <request_id> --json` | `undo` |
| `listspace next <board> [--kinds todo,backlog] [--label <id>] [--no-move] [--ttl <minutes>] --json` | `next_item` |
| `listspace claim <item> [--ttl <minutes>] --json` | `claim_item` |
| `listspace release <item> --json` | `release_item` |

`next`, `claim` and `release` need level 4 (Act). `--kinds` is a comma list of list kinds in order of preference (default `todo`, then `backlog`); `--label` takes a label id and can be repeated or given as a comma list (items must have all of them); `--no-move` leaves the item in its list instead of moving it to Doing; `--ttl` is 5 to 1440 minutes (default 120). Read `outcome`: `empty` means nothing is left, `taken` means another agent holds the item, so leave it. The loop: [autonomy.md](autonomy.md).

`<board>` is an id or a title; `<list>` is an id, a title or a kind (`todo`, `doing`, `done`, `info`, `backlog`; `capture` needs the title, since Ideas and Bugs share it); `<item>` is an item id.

Writes take `--inbox --reason "<why>"` to suggest instead of change, or `--reason` alone to explain a change the level may send to the Inbox.

## Exit codes

| Code | Meaning | Do |
|---|---|---|
| 0 | Done; the JSON has `outcome` for writes | Check `outcome`: `suggested` waits in the Inbox |
| 1 | The API refused or failed | Read `error.message`; a level refusal goes to the user |
| 2 | Wrong arguments | Fix the command (`listspace --help`) |
| 3 | Not signed in or token revoked | Ask the user to run `listspace login` |
| 4 | Rate limited | Wait `error.retry_after_seconds`, then retry once. If the message says the Inbox is full or the hourly cap is reached, tell the user instead |

Comments and attachments are not in the CLI yet. Without the MCP tools, log progress in a Project info item (`listspace add <board> info "<title>" --description "<markdown>"`) and say so in your summary.
