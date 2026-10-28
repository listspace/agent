# Listspace for coding agents

The pieces that let an agent use a Listspace board as its project memory. This folder is public as github.com/listspace/agent, and the CLI is on npm as [`listspace`](https://www.npmjs.com/package/listspace). Install and sign in with:

```bash
npx listspace login     # paste a personal token from Listspace: Settings > Your AI > API tokens
npx listspace boards
```

| Path | What it is |
|---|---|
| `skills/listspace/` | The skill: `SKILL.md` (the work loop) plus `reference/` (tools, agent access, CLI), loaded only when needed. Follows the Agent Skills format, so `npx skills add` can install it. This is the source copy. |
| `cli/` | `listspace`, a small Node CLI for agents without the MCP server: short commands over the REST API (`https://api.listspace.app/v1`), and `call` for every MCP tool through the MCP server (`https://mcp.listspace.app`). TypeScript bundled into one ESM file, no runtime dependencies, Node 20 or later. |
| `claude-code-plugin/` | A Claude Code plugin: the skill (a copied file set) and `.mcp.json`, which registers the remote MCP server `https://mcp.listspace.app`. |
| `.claude-plugin/marketplace.json` | A marketplace file listing the plugin, so this folder can be added as a local marketplace now and as a GitHub one later. |
| `AGENTS.md.snippet` | Lines a user pastes into a repo's AGENTS.md or CLAUDE.md to point agents at the right board. |
| `scripts/` | `sync-skill.mjs` copies the skill into the plugin; `check-agent.mjs` (in CI) checks the copy, the frontmatter, the versions and the MCP entry. |

The MCP server is also listed in the [MCP Registry](https://registry.modelcontextprotocol.io) as `app.listspace/listspace` and on [Smithery](https://smithery.ai/servers/jordibuskermolen/listspace).

## Editing the skill

Edit `skills/listspace/` only, then run:

```bash
node agent/scripts/sync-skill.mjs
node agent/scripts/check-agent.mjs
```

The plugin gets a real copy, not a symlink, so the plugin folder still works when it is copied or downloaded on its own. CI fails when the two differ. Keep `SKILL.md` short: steps and rules there, detail in `reference/`.

One version runs through `cli/package.json`, `cli/src/version.ts`, `plugin.json` and the skill's `metadata.version`; the check fails when they differ.

## Try it locally

### The CLI

```bash
cd agent/cli
npm ci
npm run build
node dist/listspace.mjs login            # paste a token from Listspace: Settings > Your AI > API tokens
node dist/listspace.mjs whoami
node dist/listspace.mjs session "<board title or id>"
node dist/listspace.mjs add "<board>" ideas "Try dark mode" --description "Seen in **settings**"
```

`npm link` in `agent/cli` puts `listspace` on the PATH. `LISTSPACE_TOKEN` overrides the saved token for one run, and `LISTSPACE_API_URL` and `LISTSPACE_MCP_URL` point the CLI at another server. Every command takes `--json`. The token is saved in the OS config directory (`%APPDATA%\listspace` on Windows, `~/Library/Application Support/listspace` on macOS, `~/.config/listspace` elsewhere) as `credentials.json`, mode 600.

Tests: `npm test` (node:test with a fake fetch, no network). `npm run typecheck` runs the strict type check.

### The skill on its own

Any agent that reads Agent Skills:

```bash
npx skills add ./agent -s listspace     # the skills CLI reads skills/ in a local folder
```

or copy `agent/skills/listspace` to `~/.claude/skills/listspace` for Claude Code. Connect the MCP server separately (`claude mcp add --transport http listspace https://mcp.listspace.app`), or use the CLI above.

### The Claude Code plugin

For one session:

```bash
claude --plugin-dir ./agent/claude-code-plugin
```

Or as a local marketplace, which keeps it installed:

```bash
claude plugin marketplace add ./agent
claude plugin install listspace@listspace
```

Then run `/mcp`, pick the `listspace` server and sign in (OAuth through Listspace). The skill shows up as `/listspace:listspace` and Claude loads it on its own when the project has a board. `claude plugin validate ./agent/claude-code-plugin` checks the manifest.

If you already added the Listspace MCP server yourself, Claude Code may show both; remove one.

#### The decision check

The plugin also has a small check that runs at the end of each of Claude's turns (`hooks/hooks.json`, `hooks/decision-check.mjs`). When the user picks an option, says yes to a proposal or corrects a fact, and Claude records no decision in that turn, Claude is sent back once with one line: if it was a decision that affects future work, record it with `record_decision` as Proposed; otherwise end the turn without comment.

The rules lean to silence. A yes to an offer to act ("Want me to commit?" "yes"), a maybe, and a bug report or a place in the code ("no, it's still failing", "the bug is in the parser") are not decisions. A yes counts only when Claude's last message offered a choice or made a proposal (recommend, suggest, propose, options, which one, a lettered list).

- It does nothing in a session that has not used a Listspace tool, and never blocks twice in a turn (`stop_hook_active`), so it cannot loop.
- It is plain rules on the user's words, with no model call and no network, so it costs nothing and answers in milliseconds (timeout 5 seconds).
- It needs Node.js 18 or later on the computer (Windows, macOS or Linux). Each command ends in `; exit 0`, so without Node.js the check does nothing and Claude Code shows no hook error (sh, Git Bash and PowerShell).
- It keeps a few small files per session in the plugin's data folder (`CLAUDE_PLUGIN_DATA`, readable only by the user) and removes them after a week. An ordinary prompt writes nothing. A prompt that reads like a decision leaves its first line, cut at 80 characters, for that turn only. Of Claude's last message it keeps only whether it offered a choice. Without the data folder the check does nothing.
- Tests: `node --test agent/scripts/decision-check.test.mjs`. `check-agent.mjs` checks `hooks.json`.

#### The progress check

A second check at the end of each turn (`hooks/progress-check.mjs`) keeps the board in step with the work. When a turn changed files (Edit, Write, MultiEdit, NotebookEdit), committed, pushed or merged with git, opened or merged a pull request with `gh`, or deployed, and Claude made no Listspace write after that work, Claude is sent back once with one line: "Update the Listspace board: what did you start or finish this turn? Move the item, add a short comment."

- It does nothing in a session that has not used a Listspace tool, and never blocks twice in a row (`stop_hook_active`), so it cannot loop.
- After a nudge it waits at least 3 turns before the next one, and only nudges again for new work, so it does not nag.
- Any Listspace write counts as the update (`move_item`, `add_comment`, `complete_item`, `record_decision`, `capture` and the rest); reads do not.
- It keeps only the facts (work done, board updated, the turn of the last nudge) in the plugin's data folder, never a command or a file name, and removes them after a week. Same Node.js and `; exit 0` rules as the decision check.
- Tests: `node --test agent/scripts/progress-check.test.mjs`.

#### Board context

The board rules arrive with the Listspace server's instructions at the start of a session, and a long session, most of all one whose conversation was compacted, can lose them. `hooks/board-hooks.mjs` adds them back to Claude's context at the moments that matter. It only adds context: it never blocks anything and never changes a command or its output.

- **Session start** (SessionStart: startup, resume, clear): one line that names the project's board and says to start with `get_account` and `start_session`, update the items in `unfinished_from_last_sessions` first, and keep the board current.
- **After a compaction** (SessionStart with source `compact`): the board rule, and to call `get_account` (or `start_session`) before going on, since `claimed_by_you` and `started_by_you` list the items Claude was working on.
- **After a pull request or a deploy** (PostToolUse on Bash and PowerShell): after `gh pr create`, `gh pr merge` or a deploy command that worked, one line says to move the matching item (to Doing for a new pull request, to Done after a merge or a deploy) and add a short comment.
- It does this only in a project whose CLAUDE.md or AGENTS.md has a `Listspace board:` line (in the folder or one above it, up to the repository root), or in a session that used a Listspace tool (the progress check's note). From the file it takes only a link to a Listspace board, never other text.
- It writes nothing and makes no network call. Same Node.js and `; exit 0` rules as the decision check.
- Tests: `node --test agent/scripts/board-hooks.test.mjs`.

## What is left out, and why

- **Device pairing for `login`**: the API has it (`POST /auth/device`), but the CLI does not use it yet. `login` already separates "how the token is obtained" from saving it; a TODO in `cli/src/cli.ts` marks where pairing goes. `--token` and a piped token stay for scripts.
- **A token in the plugin**: `.mcp.json` has no headers on purpose. A token would ship to every user; sign-in through `/mcp` is per user. The check script refuses headers there.
- **The CLI inside the plugin** (`bin/`): left out, because claude.ai and Cowork do not install plugins with a top-level `bin/` and the MCP server covers Claude Code.

## Publishing

1. **Skill via `npx skills add`**: published. The public repository `listspace/agent` holds this folder at its root, so `npx skills add listspace/agent` works.
2. **CLI on npm**: published as the unscoped `listspace` (0.5.0; 0.6.0 is ready to publish). To release a new version: bump the one version (see "Editing the skill"), check the package contents with `npm pack --dry-run`, then `npm publish` from `agent/cli` with an npm account with 2FA. `prepublishOnly` runs the type check, tests and build.
3. **Claude Code plugin**: the public repo doubles as a marketplace (`.claude-plugin/marketplace.json`), so users run `/plugin marketplace add listspace/agent` and `/plugin install listspace@listspace`. Listing in Anthropic's plugin directory is a separate submission; the owner decides on it, with privacy policy and terms URLs for that listing.

Sources: Claude Code plugin manifest reference (https://code.claude.com/docs/en/plugins-reference), plugin loading and `--plugin-dir` (https://code.claude.com/docs/en/plugins/loading), marketplace reference (https://code.claude.com/docs/en/plugins/marketplace-reference), skills (https://code.claude.com/docs/en/skills), Agent Skills specification (https://agentskills.io/specification), the skills CLI (https://github.com/vercel-labs/skills), and Postiz's agent repo as the model (https://github.com/gitroomhq/postiz-agent).
