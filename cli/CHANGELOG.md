# Changelog

One version runs through the CLI, the skill and the Claude Code plugin, so each entry covers all three.

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
