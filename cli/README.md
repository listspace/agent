# listspace

The command line for [Listspace](https://listspace.app), the project board your AI agents keep up to date. People and coding agents use it to read boards, add and move items, work through a board on their own, and undo their own changes. It talks to the Listspace REST API (`https://api.listspace.app/v1`).

Node 20 or later. No runtime dependencies.

## Install

Run it without installing:

```bash
npx listspace --help
```

Or install it once and use `listspace` everywhere:

```bash
npm install -g listspace
```

## Sign in

Create a personal token in Listspace under **Settings > API**, then save it:

```bash
npx listspace login --token ls_...
```

Without `--token`, `login` reads the token from stdin, so it stays out of your shell history:

```bash
cat token.txt | npx listspace login
```

The token is saved as `credentials.json` (mode 600) in your OS config directory: `%APPDATA%\listspace` on Windows, `~/Library/Application Support/listspace` on macOS and `~/.config/listspace` elsewhere. `listspace logout` removes it. A read-only token works for the read commands only.

## Commands

```text
Sign in
  login [--token ls_...]    Save a personal token (Listspace: Settings > API).
  logout                    Forget the saved token.
  whoami                    Plan, freedom levels, guidance and boards (alias: account).

Read
  boards                    Your boards with their ids.
  session <board>           Start a work session: guidance, board instructions,
                            level, open work. Run this first.
  board <board>             Lists and items with their ids.
  inbox <board> [--status pending|accepted|rejected|withdrawn|expired|failed|all]

Write (the board's freedom level decides what is made and what waits in the Inbox)
  new-board <title> [--description <text>]
  add <board> <list> <title> [--description <markdown>]
  move <item> <list>
  done <item>               Move to the board's done list.
  undo <request_id>         Take back one of your own calls.
  Writes take --inbox --reason "<why>" to suggest instead of change.

Files from this computer (needs level 4, Act)
  attach <item> <file> [<file>...]   At most 8 MB each.

Work on your own (needs level 4, Act)
  next <board> [--kinds todo,backlog] [--label <id>] [--no-move] [--ttl <minutes>]
  claim <item> [--ttl <minutes>]
  release <item>
```

`<board>` is an id or a title. `<list>` is an id, a title or a kind (`todo`, `doing`, `done`, `info`, `capture`, `backlog`). `<item>` is an item id. Run `listspace --help` for every option.

Example:

```bash
npx listspace session "Website"
npx listspace add "Website" ideas "Try dark mode" --description "Seen in **settings**"
```

## Attach files

`attach` uploads files from your computer to an item, one after another:

```bash
npx listspace attach 2b6f0c1e-... ./contract.pdf ./screenshots/footer.png
```

The type comes from the extension: images (jpg, png, gif, webp, svg), PDF, Word, Excel and PowerPoint files, text, Markdown, CSV, JSON, archives (zip, rar, 7z), audio and video. Each file can be at most 8 MB. Every file is checked before the first one is sent. Attaching needs level 4 (Act) on the board: a file cannot wait in the Inbox.

## Output for agents and scripts

Every command takes `--json` and then prints the API's JSON instead of text:

```bash
npx listspace boards --json
```

Exit codes: 0 ok, 1 failed, 2 usage error, 3 sign-in needed, 4 rate limited (wait and retry).

## Environment

| Variable | What it does |
|---|---|
| `LISTSPACE_TOKEN` | A token for this run. It wins over the saved one. |
| `LISTSPACE_API_URL` | Another API address. Default `https://api.listspace.app/v1`. |
| `LISTSPACE_CONFIG_DIR` | Where `credentials.json` is kept. |

## What agents may do

Each board has a freedom level that decides what an agent may change on its own. Changes that need your approval wait in the board's Inbox, and every change shows who made it. The rules are in [What AI agents can do](https://listspace.app/docs/agents). Agents that support MCP can also connect to `https://mcp.listspace.app` instead of using this CLI ([setup](https://listspace.app/docs/mcp)).

## License

MIT, Sjenkie B.V. (Yellow House Digital). See `LICENSE`.
