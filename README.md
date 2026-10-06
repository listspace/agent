# Listspace for coding agents

The pieces that let an agent use a Listspace board as its project memory. This folder is public as github.com/listspace/agent, and the CLI is on npm as [`listspace`](https://www.npmjs.com/package/listspace). Install and sign in with:

```bash
npx listspace login     # paste a personal token from Listspace: Settings > API
npx listspace boards
```

| Path | What it is |
|---|---|
| `skills/listspace/` | The skill: `SKILL.md` (the work loop) plus `reference/` (tools, freedom levels, CLI), loaded only when needed. Follows the Agent Skills format, so `npx skills add` can install it. This is the source copy. |
| `cli/` | `listspace`, a small Node CLI over the REST API (`https://api.listspace.app/v1`) for agents without the MCP server. TypeScript bundled into one ESM file, no runtime dependencies, Node 20 or later. |
| `claude-code-plugin/` | A Claude Code plugin: the skill (a copied file set) and `.mcp.json`, which registers the remote MCP server `https://mcp.listspace.app`. |
| `.claude-plugin/marketplace.json` | A marketplace file listing the plugin, so this folder can be added as a local marketplace now and as a GitHub one later. |
| `AGENTS.md.snippet` | Lines a user pastes into a repo's AGENTS.md or CLAUDE.md to point agents at their board. |
| `scripts/` | `sync-skill.mjs` copies the skill into the plugin; `check-agent.mjs` (in CI) checks the copy, the frontmatter, the versions and the MCP entry. |

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
node dist/listspace.mjs login            # paste a token from Listspace: Settings > API
node dist/listspace.mjs whoami
node dist/listspace.mjs session "<board title or id>"
node dist/listspace.mjs add "<board>" ideas "Try dark mode" --description "Seen in **settings**"
```

`npm link` in `agent/cli` puts `listspace` on the PATH. `LISTSPACE_TOKEN` overrides the saved token for one run, and `LISTSPACE_API_URL` points the CLI at another server. Every command takes `--json`. The token is saved in the OS config directory (`%APPDATA%\listspace` on Windows, `~/Library/Application Support/listspace` on macOS, `~/.config/listspace` elsewhere) as `credentials.json`, mode 600.

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

## What is left out, and why

- **`comment`** and **`attach`**: the API has them now (`POST /v1/items/:id/comments`, `POST /v1/items/:id/attachments`, MCP `add_comment`, `attach_file`), but the CLI does not yet. Agents on the CLI log progress in a Project info item (the skill says so).
- **Device pairing for `login`**: comes with sign-up (PR 9). `login` already separates "how the token is obtained" from saving it; a TODO in `cli/src/cli.ts` marks where pairing goes. `--token` and a piped token stay for scripts.
- **A token in the plugin**: `.mcp.json` has no headers on purpose. A token would ship to every user; sign-in through `/mcp` is per user. The check script refuses headers there.
- **The CLI inside the plugin** (`bin/`): left out, because claude.ai and Cowork do not install plugins with a top-level `bin/` and the MCP server covers Claude Code.

## Publishing

1. **Skill via `npx skills add`**: published. The public repository `listspace/agent` holds this folder at its root, so `npx skills add listspace/agent` works.
2. **CLI on npm**: published as the unscoped `listspace` (0.1.0). To release a new version: bump the one version (see "Editing the skill"), check the package contents with `npm pack --dry-run`, then `npm publish` from `agent/cli` with an npm account with 2FA. `prepublishOnly` runs the type check, tests and build.
3. **Claude Code plugin**: the public repo doubles as a marketplace (`.claude-plugin/marketplace.json`), so users run `/plugin marketplace add listspace/agent` and `/plugin install listspace@listspace`. Listing in Anthropic's plugin directory is a separate submission; the owner decides on it, with privacy policy and terms URLs for that listing.

Sources: Claude Code plugin manifest reference (https://code.claude.com/docs/en/plugins-reference), plugin loading and `--plugin-dir` (https://code.claude.com/docs/en/plugins/loading), marketplace reference (https://code.claude.com/docs/en/plugins/marketplace-reference), skills (https://code.claude.com/docs/en/skills), Agent Skills specification (https://agentskills.io/specification), the skills CLI (https://github.com/vercel-labs/skills), and Postiz's agent repo as the model (https://github.com/gitroomhq/postiz-agent).
