# ListSpace for agents

**Stop being your agent's memory.** [ListSpace](https://listspace.app) is the agentic project memory: one board your agents keep up to date while you work. Ideas, bugs, to-dos and what's done, visible to you on any screen, with you in charge of how much they may do on their own.

This repository holds the pieces that teach an agent to use ListSpace:

| Path | What it is |
|---|---|
| `skills/listspace/` | The ListSpace skill: how to start a session, keep the board up to date, respect freedom levels and work through items on its own. |
| `claude-code-plugin/` | A Claude Code plugin: the skill plus the ListSpace MCP server (`https://mcp.listspace.app`). |
| `cli/` | `listspace`, a small command-line tool over the ListSpace REST API, for agents without MCP. |
| `AGENTS.md.snippet` | A few lines to paste into your repo's `AGENTS.md` or `CLAUDE.md`. |

## Install

**The skill** (Claude Code, Codex, Cursor and other agents that read skills):

```bash
npx skills add listspace/agent
```

**The Claude Code plugin** (skill plus MCP server):

```text
/plugin marketplace add listspace/agent
/plugin install listspace@listspace
```

Then run `/mcp`, choose `listspace` and sign in with your ListSpace account.

**Only the MCP server**, without the skill: see [listspace.app/docs/mcp](https://listspace.app/docs/mcp) for Claude, ChatGPT, Claude Code, Codex and Cursor.

**The CLI**: coming to npm as `listspace`. Until then, build it from `cli/` (Node 20 or later).

## What agents can do

Freedom levels 1 to 5, set by you per board, decide what an agent may change directly and what waits in the board's Inbox for your OK. The full table is at [listspace.app/docs/agents](https://listspace.app/docs/agents).

## License

MIT, see [LICENSE](LICENSE). ListSpace and its logo are trademarks of Sjenkie B.V. (Yellow House Digital).
