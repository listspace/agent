# Files from the user's computer

The user asks you to put a file on an item: "attach the contract PDF to the onboarding item", "add these screenshots to the bug".

## Use the CLI

```bash
npx listspace attach <item_id> <file> [<file>...] --json
```

The CLI reads each file from disk, checks it and uploads it to the item. You never handle the bytes. Use it whenever the file is on the computer you run on, even when the Listspace MCP tools are connected: `attach_file` asks you to write the whole file out as base64 in a tool call, which is slow and breaks on anything larger than a few kilobytes.

- One time setup by the user: create a token in Listspace (Settings > Your AI > API tokens, read and write), then run `npx listspace login` and paste it. Never ask for the token in the chat. Exit code 3 means this has not been done yet: ask the user to do it.
- Get the item id from `get_board`, `search_items` or `listspace board <board> --json`.
- Each file can be as large as the board's plan allows (Free 25 MB, Pro 2 GB, a team's boards 5 GB), at most 4 GB from the CLI; a file over 8 MB goes straight to file storage. It has one of these extensions: jpg, jpeg, png, gif, webp, svg, pdf, txt, md, markdown, csv, doc, docx, xls, xlsx, ppt, pptx, zip, rar, 7z, mp3, wav, ogg, mp4, mpeg, mpg, mov, json, js, html, htm, css. Every file is checked before the first one is sent, so a wrong path uploads nothing.
- It needs level 4 (Act) on the board. A file cannot wait in the Inbox: below level 4 the API refuses it (exit 1). Tell the user; do not try another route.
- `--json` prints `{ "data": [ ... ] }`, one entry per file, each with `attachment.id`, `filename`, `size_bytes` and a short-lived `url`.
- If an upload fails partway, the error names the files that were attached already. Do not send those again.

## No CLI: an upload link

With the MCP tools and a shell that can reach listspace.app, but no `listspace login` done:

1. `get_upload_link` with `item_id` (and `filename` or `replaces_attachment_id` when you need them).
2. Run its `command` with the file's path: `curl --fail-with-body --upload-file report.pdf '<upload_url>'`.
3. The answer is the attachment and `sha256`. Compare it with `sha256sum report.pdf` (macOS: `shasum -a 256 report.pdf`).

One link takes one file, once, within 10 minutes. A used or expired link answers 404: ask for a new one. Level 4 (Act) is checked when you ask and again when the file arrives.

A file over 8 MB (up to the plan's size of one file, at most 4 GB):

1. `get_upload_link` with `item_id`, `filename` and `size_bytes`, the exact size (`wc -c < film.mov`).
2. Run its `command`: `curl --fail-with-body --upload-file film.mov '<upload_url>'`. It sends the file straight to file storage. Start it within 15 minutes; storage takes exactly `size_bytes` bytes.
3. Then run its `finish_command`: `curl --fail-with-body -X POST '<finish_url>'` (no file). The answer is the attachment; check its `size_bytes`. `sha256` is null for such a file. If it says the file has not arrived yet, run it again once the upload is done.

A file over 4 GB is added in the Listspace app, which sends it in parts.

Several files: send them one after another, in the order they should show on the item (01, 02, 03), not all at once. A file is dated when it arrives, and the item lists its files by that time.

## Other ways

- A file on the web: `attach_url` with its public https address. Listspace downloads it.
- A document you write yourself (a report, a quote, notes) as a PDF, a Word file or markdown: `attach_document` with `format` (`pdf`, `docx` or `md`), a `title` and the text as markdown in `content`. Listspace makes the file and attaches it; you never handle bytes. This works in chat apps too. `from_item: true` makes the file from the item's own description or document instead, so you do not send the text again.
- In ChatGPT, a file the user put in the chat: `attach_chat_file` with `item_id` and the file as `file`, one call per file. ChatGPT passes the file's download link and Listspace downloads it; the code sandbox there cannot reach listspace.app, so never try `get_upload_link` and curl in ChatGPT. When the call says ChatGPT did not hand the file over (the phone apps can do this), ask the user to attach it again in ChatGPT on the web or the desktop app, or to drop it on the item in Listspace.
- Another chat app without a shell (such as Claude on claude.ai) and a file the user already has: ask the user to drop the file on the item in the Listspace app.
- A tiny text file you wrote yourself: `attach_file` with base64 is fine.
- Every attach answer has `sha256`, the SHA-256 of the stored bytes: compare it with your copy when it matters.
- Every file is checked for viruses after it is added. The answer's `virus_scan` is `clean`, `checking` (other people can open it once the check is done, usually within a minute), `not_checked` (it could not be checked, for example a locked zip: only you can open it), `blocked` (a virus was found: nobody can open it) or `not_scanned_too_large` (over 250 MB, too large for the scan: everyone on the board can download it, and the app asks before each download). Tell the user when a file comes back `blocked` or `not_scanned_too_large`.
- Later: chunked uploads for sandboxes that cannot reach listspace.app. Until then, use `attach_document` or ask the user to drop the file in the app.

## Read a spreadsheet

A budget, a price list or a content calendar on an item: `read_attachment` with `item_id` and `attachment_id` (from `list_attachments`) gives the file as text, each sheet as CSV. It reads .xlsx, .xlsm, .xls and .ods workbooks and CSV or TSV files.

- `sheet_names` lists every sheet; `sheet` reads one sheet by name.
- Each cell is the value as the sheet shows it. A formula gives the result the file saved; formulas and macros never run.
- At most the first 1000 rows and 100 columns of each sheet, and 200000 characters in all. `truncated` says something was left out and `range` gives the full size of the sheet (such as `A1:F5432`). For the whole file, download it with its link from `list_attachments`.
- Files up to 10 MB. A file that is still being checked for viruses opens only for whoever added it, and a blocked file never opens.
- Other files (PDF, Word, images) are not read this way: open them with their link.

## A new version of a file

When a file on the item gets a new draft (a report, a contract, a design), attach the new one with `replaces_attachment_id` set to the current file's id (from `list_attachments`). It becomes the current file and the old one is kept as an older version, with its comments; the user can open, restore or delete older versions in the app. `list_attachments` shows each file's `version` and `older_versions`.
