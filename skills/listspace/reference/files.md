# Files from the user's computer

The user asks you to put a file on an item: "attach the contract PDF to the onboarding item", "add these screenshots to the bug".

## Use the CLI

```bash
npx listspace attach <item_id> <file> [<file>...] --json
```

The CLI reads each file from disk, checks it and uploads it to the item. You never handle the bytes. Use it whenever the file is on the computer you run on, even when the Listspace MCP tools are connected: `attach_file` asks you to write the whole file out as base64 in a tool call, which is slow and breaks on anything larger than a few kilobytes.

- One time setup by the user: create a token in Listspace (Settings > Developers, read and write), then run `npx listspace login` and paste it. Never ask for the token in the chat. Exit code 3 means this has not been done yet: ask the user to do it.
- Get the item id from `get_board`, `search_items` or `listspace board <board> --json`.
- Each file is at most 8 MB and has one of these extensions: jpg, jpeg, png, gif, webp, svg, pdf, txt, md, markdown, csv, doc, docx, xls, xlsx, ppt, pptx, zip, rar, 7z, mp3, wav, ogg, mp4, mpeg, mpg, mov, json, js, html, htm, css. Every file is checked before the first one is sent, so a wrong path uploads nothing.
- It needs level 4 (Act) on the board. A file cannot wait in the Inbox: below level 4 the API refuses it (exit 1). Tell the user; do not try another route.
- `--json` prints `{ "data": [ ... ] }`, one entry per file, each with `attachment.id`, `filename`, `size_bytes` and a short-lived `url`.
- If an upload fails partway, the error names the files that were attached already. Do not send those again.

## No CLI: an upload link

With the MCP tools and a shell that can reach listspace.app, but no `listspace login` done:

1. `get_upload_link` with `item_id` (and `filename` or `replaces_attachment_id` when you need them).
2. Run its `command` with the file's path: `curl --fail-with-body --upload-file report.pdf '<upload_url>'`.
3. The answer is the attachment and `sha256`. Compare it with `sha256sum report.pdf` (macOS: `shasum -a 256 report.pdf`).

One link takes one file, once, within 10 minutes. A used or expired link answers 404: ask for a new one. Level 4 (Act) is checked when you ask and again when the file arrives.

## Other ways

- A file on the web: `attach_url` with its public https address. Listspace downloads it.
- A document you write yourself (a report, a quote, notes) as a PDF, a Word file or markdown: `attach_document` with `format` (`pdf`, `docx` or `md`), a `title` and the text as markdown in `content`. Listspace makes the file and attaches it; you never handle bytes. This works in chat apps too. `from_item: true` makes the file from the item's own description or document instead, so you do not send the text again.
- No shell (a chat app such as Claude or ChatGPT) and a file the user already has: ask the user to drop the file on the item in the Listspace app.
- A tiny text file you wrote yourself: `attach_file` with base64 is fine.
- Every attach answer has `sha256`, the SHA-256 of the stored bytes: compare it with your copy when it matters.
- Every file is checked for viruses after it is added. The answer's `virus_scan` is `clean`, `checking` (other people can open it once the check is done, usually within a minute), `not_checked` (it could not be checked, for example a locked zip: only you can open it) or `blocked` (a virus was found: nobody can open it). Tell the user when a file comes back `blocked`.
- Later: chunked uploads for sandboxes that cannot reach listspace.app. Until then, use `attach_document` or ask the user to drop the file in the app.

## A new version of a file

When a file on the item gets a new draft (a report, a contract, a design), attach the new one with `replaces_attachment_id` set to the current file's id (from `list_attachments`). It becomes the current file and the old one is kept as an older version, with its comments; the user can open, restore or delete older versions in the app. `list_attachments` shows each file's `version` and `older_versions`.
