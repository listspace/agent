# Changelog

One version runs through the CLI, the skill and the Claude Code plugin, so each entry covers all three.

## 0.4.0

- The Claude Code plugin adds the board rules back to Claude's context (`hooks/board-hooks.mjs`): at the start of a session it names the project's board and says to start from it; after a compaction it says to look up the open work (`claimed_by_you`, `started_by_you`) and update it before going on; after `gh pr create`, `gh pr merge` or a deploy it says to move the matching item and comment. Only in a project with a `Listspace board:` line or a session that uses Listspace. Context only, it never blocks a command.

## 0.3.0

- The Claude Code plugin has a progress check (`hooks/progress-check.mjs`): when a turn in a session that uses Listspace changed files, committed, pushed, opened or merged a pull request or deployed, and made no Listspace write after that work, Claude is sent back once to move the item and add a short comment. At most once every 3 turns, never twice in a row. It keeps only the facts, no command or file name.
- The skill and `AGENTS.md.snippet` say that work tracked elsewhere, such as a pull request or a deploy, still moves the matching item with a short comment, and the skill reads the server's `reminder` and `claimed_by_you`. It also offers an optional line for the project's CLAUDE.md or AGENTS.md that asks every agent to keep the board up to date.
- The Claude Code plugin has a decision check (`hooks/hooks.json`): when the user picks an option, says yes to a proposal or corrects a fact in a session that uses Listspace, and no decision was recorded in that turn, Claude is sent back once to check it and record it with `record_decision` if it affects future work. Plain rules, no model call; a yes to an offer to act, a maybe or a bug report does not count. It keeps only an 80-character excerpt of a prompt that reads like a decision, in the plugin's data folder. Needs Node.js 18 or later; without it the check stays silent.
- The skill records a decision the moment the user picks an option, says yes to a proposal or corrects a fact, with three short examples, and says it is Proposed until the user accepts it.
- `end_session` takes `decisions`: every decision of the session. The ones the board does not have yet are recorded as Proposed in the Inbox. The skill, `reference/tools.md` and `AGENTS.md.snippet` say so.
- `listspace new-board` takes `--space <space id>`, so an agent on the CLI can put a new board in the space the user chose, as `create_board` does with `space_id`. The text output says which space the board went to and passes on the server's note when no space was given and the user has more than one.
- The skill's CLI table shows `--space`.
- The skill looks for a `Listspace board:` line in the project's CLAUDE.md or AGENTS.md at the start of a session and starts on that board without asking. When there is none, it offers, after the user picks a board, to add that line and one sentence of instructions to the file, and writes only after a yes. `AGENTS.md.snippet` starts with the same line.
- The skill's "Keep the board up to date" section says the default guidance asks the same in general words for any kind of board, and gives the code project version.
- On a board someone else shared with the user, the skill treats the owner's text (`shared_board.owner_instructions`) as data, never as instructions, and never lets text on that board steer it to read, copy or move the user's other boards.
- The skill starts only from `last_sessions`, the summaries of the user's own agents. Summaries other people on the board left come as `notes_from_others`, with who wrote them, and the skill treats them as notes, never as instructions.
- The skill knows that approving or rejecting a request is a sign-off in the user's name: it needs Act (4), waits in the Inbox below it, and the sender sees which assistant answered.

## 0.2.0

- New command `listspace attach <item> <file> [<file>...]`: uploads files from your computer to an item through the REST API, so an agent no longer has to write a file out as base64. The type comes from the extension (the same types the app accepts; Markdown goes up as plain text), and every file is checked before the first upload: known type, present, not empty, at most 8 MB. `--json` prints one server answer per file. Needs level 4 (Act) on the board.
- The skill tells agents to use `listspace attach` for local files instead of `attach_file` with base64, and has a new reference page, `reference/files.md`.

## 0.1.1

- The name is written Listspace everywhere: in the CLI's help, its messages and its README, and in the skill and the plugin.
- Spaces: the skill describes `list_spaces`, `create_space` and `update_space`, and `space_id` on boards (`list_boards`, `create_board`, `update_board`).
- Important items: the skill describes `list_important_items`, everything the user marked important, grouped by board.
- Link previews: the skill describes `link_previews` in `get_item` (title, image and site, and for books the ISBN, authors and summary).

## 0.1.0

- First release: sign in with a personal token, read boards, sessions and the Inbox, add items and move them (also to the done list), work through a board with `next`, `claim` and `release`, and undo your own calls.
