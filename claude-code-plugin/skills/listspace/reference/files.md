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

One link takes one file, once, within 10 minutes. The upload's answer says in `attachment.is_cover` whether the file became the item's cover, so there is no need to list the files afterwards. A used or expired link answers 404: ask for a new one. Level 4 (Act) is checked when you ask and again when the file arrives.

In claude.ai, a 403 from curl that is not a JSON answer from Listspace means the sandbox's network filter blocks the site. Tell the user to add `listspace.app` under Settings > Capabilities > Create and edit files > Use the internet while making files (on) > Allowed websites > Manage > Add a website (for a file over 8 MB, also `*.r2.cloudflarestorage.com`), then try again. For a file up to 8 MB you can use `attach_file` instead, when writing it out as base64 is practical.

A file over 8 MB (up to the plan's size of one file, at most 4 GB):

1. `get_upload_link` with `item_id`, `filename` and `size_bytes`, the exact size (`wc -c < film.mov`).
2. Run its `command`: `curl --fail-with-body --upload-file film.mov '<upload_url>'`. It sends the file straight to file storage. Start it within 15 minutes; storage takes exactly `size_bytes` bytes.
3. Then run its `finish_command`: `curl --fail-with-body -X POST '<finish_url>'` (no file). The answer is the attachment; check its `size_bytes`. `sha256` is null for such a file. If it says the file has not arrived yet, run it again once the upload is done.

A file over 4 GB is added in the Listspace app, which sends it in parts.

Several files, for one item or many: one `get_upload_link` call with `files`, a list of up to 25 entries, each with `item_id`, `filename` and `size_bytes` (and optionally `mime_type` and `replaces_attachment_id`). Never one call per file. The answer has `links`, one per file with its `index` (its place in `files`) and the same `upload_url`, `command` and, for a file over 8 MB, `finish_command` as a single link, and `refused`: the files that got no link (no access to that item, storage full), with the reason. The others are not affected: fix the reason and ask again for those only. Every link works once, as above. Over REST it is `POST /v1/upload-links` with the same body: `201` when at least one file got a link (the others are in `refused`), and the status of the first refusal (`404`, `403`, `400`, `429`) when none did.

Files over 8 MB hold room in storage: each `upload_url` must be started within 15 minutes of the answer, and at most 20 large files can wait at once. So ask for large files in small batches (about 5), right before you send them, not all at the start.

The limit counts files and bytes, not calls: 200 upload links or 10 GB of files an hour per account. A call that would pass it makes no links and says when to come back: `Try again after 14:32 UTC (in 12 minutes)`, with `retry_after_seconds` and `retry_at` in the error (REST: the `Retry-After` header too). Wait that long instead of retrying at once.

Send the files themselves one after another, in the order they should show on the item (01, 02, 03), not all at once. A file is dated when it arrives, and the item lists its files by that time.

## The same picture or file in a second place

Do not upload a file twice. For a file that is already on an item of the same board:

- `copy_attachment` with `item_id` (gets the copy), `from_item_id` and `attachment_id` (from `list_attachments` of that item), and optionally `filename`. The server makes the copy: no upload link, nothing counted against the upload limit. It is a file of its own (changing or removing one does not touch the other), it counts against the plan's storage and gets its own virus check. Files up to 8 MB; a file held back by the virus scan cannot be copied. An item on another board is refused: attach the file there from disk. It reads one file at a time and about 50 MB a minute, so for dozens of files copy a few at a time and wait when the answer says `rate_limited`.
- To show a picture inside an item's text (an overview with the screenshots of other items): write `![what it shows](attachment:ATTACHMENT_ID)` for a picture of the item itself, or `![what it shows](attachment:ITEM_ID/ATTACHMENT_ID)` for one of another item of the same board, in the `description` of `update_item`. Listspace stores a copy in that item's text, the same picture the app stores when the user pastes one, so it keeps showing and no link runs out. JPEG, PNG, GIF or WebP, up to 10 MB each, at most 25 new pictures per change, and it counts against the plan's storage. It needs level 4 or 5 (a picture is stored when the change is written, so below that, or with `inbox: true`, the call is refused and nothing waits in the Inbox). Not in `create_item`: create the item first, then update it. Never write a picture as base64 or as a link.
- Reading an item gives its pictures as `![what it shows](picture:NAME)`. Keep those lines when you write the description again, or the pictures are removed (the description replaces the whole text). Writing `picture:NAME` back keeps the picture without copying it again (it must be a picture the item's text holds now). Each `attachment:` reference stores a new copy when it is written, so write the `picture:NAME` back instead of the `attachment:` reference once the picture is in the text.

## Other ways

- A file on the web: `attach_url` with its public https address. Listspace downloads it.
- A document you write yourself (a report, a quote, notes) as a PDF, a Word file or markdown: `attach_document` with `format` (`pdf`, `docx` or `md`), a `title` and the text as markdown in `content`. Listspace makes the file and attaches it; you never handle bytes. This works in chat apps too. `from_item: true` makes the file from the item's own description or document instead, so you do not send the text again.
- In ChatGPT, a file the user put in the chat: `attach_chat_file` with `item_id` and the file as `file`, one call per file. ChatGPT passes the file's download link and Listspace downloads it; the code sandbox there cannot reach listspace.app, so never try `get_upload_link` and curl in ChatGPT. When the call says ChatGPT did not hand the file over (the phone apps can do this), ask the user to attach it again in ChatGPT on the web or the desktop app, or to drop it on the item in Listspace.
- Another chat app without a shell and a file the user already has: ask the user to drop the file on the item in the Listspace app.
- A tiny text file you wrote yourself: `attach_file` with base64 is fine.
- Every attach answer has `sha256`, the SHA-256 of the stored bytes: compare it with your copy when it matters.
- Every file is checked for viruses after it is added. The answer's `virus_scan` is `clean`, `checking` (other people can open it once the check is done, usually within a minute), `not_checked` (it could not be checked, for example a locked zip, or a file too complex for the scan to check fully whatever its size: only you can open it), `blocked` (a virus was found: nobody can open it) or `not_scanned_too_large` (over 250 MB, too large for the scan: everyone on the board can download it, and the app asks before each download). Tell the user when a file comes back `blocked` or `not_scanned_too_large`.
- Later: chunked uploads for sandboxes that cannot reach listspace.app. Until then, use `attach_document` or ask the user to drop the file in the app.

## Read a CSV file or look at a picture

A price list or an export on an item: `read_attachment` with `item_id` and `attachment_id` (from `list_attachments`) gives a CSV or TSV file as text, one table as CSV.

- At most the first 1000 rows and 100 columns and 200000 characters; `truncated` says something was left out. For the whole file, download it with its link from `list_attachments`.
- Files up to 10 MB, one at a time, and about 50 MB of files a minute. A file that is still being checked for viruses opens only for whoever added it, and a blocked file never opens.
- A picture (PNG, JPEG, GIF or WebP, up to 3 MB and 8000 pixels on a side) comes back as the picture itself, beside a text part with its name, size, type and link. This also works for a picture in a comment: its id is in `images` of the comment (`list_comments`). A larger picture, or one whose content is not the type it says, is not shown; the text says so and gives the link.
- Spreadsheets (.xlsx, .xlsm, .xls, .ods), SVG and AVIF pictures and every other kind of file (PDF, Word) are not read this way: the call is refused and the refusal carries the file link, valid for 10 minutes. Open or download the file with it. `sheet` is not used.

## A new version of a file

When a file on the item gets a new draft (a report, a contract, a design), attach the new one with `replaces_attachment_id` set to the current file's id (from `list_attachments`). It becomes the current file and the old one is kept as an older version, with its comments; the user can open, restore or delete older versions in the app. `list_attachments` shows each file's `version` and `older_versions`.
