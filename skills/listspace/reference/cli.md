# The listspace CLI

Use it when the MCP tools are not connected. Always pass `--json` and read the JSON. It uses a personal token: the commands below call the REST API, and `call` runs any MCP tool through the MCP server, with the same agent access levels and results. It is the `listspace` package on npm: without a global install (`npm install -g listspace`), run each command as `npx listspace ...`.

## Sign in

The user runs `npx listspace login` once and pastes a token from Listspace (Settings > Your AI > API tokens), or sets `LISTSPACE_TOKEN`. Never ask the user to paste a token into the chat, and never write one into a file in the project.

## Commands

| Command | Same as |
|---|---|
| `listspace whoami --json` | `get_account` |
| `listspace boards --json` | `list_boards` |
| `listspace session <board> --json` | `start_session` |
| `listspace board <board> --json` | `get_board` |
| `listspace new-board "<title>" --space <space_id> [--template <id or name>] --json` | `create_board` (default Project for agents); leave out `--space` only when the user has one space |
| `listspace add <board> <list> "<title>" --description "<markdown>" --json` | `create_item` |
| `listspace update <item> [--title "<title>"] [--description "<markdown>"] --json` | `update_item` |
| `listspace comment <item> "<markdown>" --json` | `add_comment` |
| `listspace move <item> <list> --json` | `move_item` |
| `listspace done <item> --json` | `move_item` to the board's `done` list |
| `listspace list add <board> "<title>" [--kind <kind>] --json` | `create_list` |
| `listspace list rename <list_id> "<title>" --json` | `update_list` |
| `listspace inbox <board> [--status all] --json` | `list_suggestions` |
| `listspace undo <request_id> --json` | `undo` |
| `listspace next <board> [--kinds todo,backlog] [--label <id>] [--no-move] [--ttl <minutes>] --json` | `next_item` |
| `listspace claim <item> [--ttl <minutes>] --json` | `claim_item` |
| `listspace release <item> --json` | `release_item` |
| `listspace attach <item> <file> [<file>...] --json` | `attach_file`, reading the files from disk |

`next`, `claim` and `release` need level 4 (Act). `--kinds` is a comma list of list kinds in order of preference (default `todo`, then `backlog`); `--label` takes a label id and can be repeated or given as a comma list (items must have all of them); `--no-move` leaves the item in its list instead of moving it to Doing; `--ttl` is 5 to 1440 minutes (default 120). Read `outcome`: `empty` means nothing is left, `taken` means another agent holds the item, so leave it. The loop: [autonomy.md](autonomy.md).

`<board>` is an id or a title; `<list>` is an id, a title or a kind (`todo`, `doing`, `done`, `info`, `backlog`; `capture` needs the title, since Ideas and Bugs share it); `<item>` is an item id.

Every write sends its own `Idempotency-Key`. After a network error or a 502, 503 or 504 the CLI sends it once more with the same key, so a lost answer never adds a second item. If a write still fails that way, check with `listspace board <board> --json` before you run it again.

Writes take `--inbox --reason "<why>"` to suggest instead of change, or `--reason` alone to explain a change the level may send to the Inbox.

## Exit codes

| Code | Meaning | Do |
|---|---|---|
| 0 | Done; the JSON has `outcome` for writes | Check `outcome`: `suggested` waits in the Inbox |
| 1 | The API refused or failed | Read `error.message`; a level refusal goes to the user |
| 2 | Wrong arguments | Fix the command (`listspace --help`) |
| 3 | Not signed in or token revoked | Ask the user to run `listspace login` |
| 4 | Rate limited | Wait `error.retry_after_seconds`, then retry once. If the message says the Inbox is full or the hourly cap is reached, tell the user instead |

`attach` uploads files from this computer (up to the plan's size of one file, at most 4 GB; see [files.md](files.md)). It needs level 4 (Act); a file cannot wait in the Inbox.

## Every other tool: `call`

Every tool in [tools.md](tools.md) works from the CLI too, by name, with its arguments as one JSON object:

```bash
listspace tools --json                       # the tools this token can use
listspace tools my_items --json              # one tool with its input schema
listspace call my_items --json '{}'
listspace call record_decision --json '{"board_id": "...", "title": "...", "idempotency_key": "<a new UUID>"}'
```

The result is the tool's result as MCP returns it. A refusal (the level, a wrong argument) exits 1 with `error.kind` `tool` and the server's message. Give every call that makes something an `idempotency_key`, a new one per call: the CLI then sends it once more after a network error or a 502, 503 or 504, and nothing is made twice. Without a key it is sent once; check before you run it again.
