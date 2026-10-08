# Files from the user's computer

The user asks you to put a file on an item: "attach the contract PDF to the onboarding item", "add these screenshots to the bug".

## Use the CLI

```bash
npx listspace attach <item_id> <file> [<file>...] --json
```

The CLI reads each file from disk, checks it and uploads it to the item. You never handle the bytes. Use it whenever the file is on the computer you run on, even when the Listspace MCP tools are connected: `attach_file` asks you to write the whole file out as base64 in a tool call, which is slow and breaks on anything larger than a few kilobytes.

- One time setup by the user: create a token in Listspace (Settings > API, read and write), then run `npx listspace login` and paste it. Never ask for the token in the chat. Exit code 3 means this has not been done yet: ask the user to do it.
- Get the item id from `get_board`, `search_items` or `listspace board <board> --json`.
- Each file is at most 8 MB and has one of these extensions: jpg, jpeg, png, gif, webp, svg, pdf, txt, md, markdown, csv, doc, docx, xls, xlsx, ppt, pptx, zip, rar, 7z, mp3, wav, ogg, mp4, mpeg, mpg, mov, json, js, html, htm, css. Every file is checked before the first one is sent, so a wrong path uploads nothing.
- It needs level 4 (Act) on the board. A file cannot wait in the Inbox: below level 4 the API refuses it (exit 1). Tell the user; do not try another route.
- `--json` prints `{ "data": [ ... ] }`, one entry per file, each with `attachment.id`, `filename`, `size_bytes` and a short-lived `url`.
- If an upload fails partway, the error names the files that were attached already. Do not send those again.

## Other ways

- A file on the web: `attach_url` with its public https address. Listspace downloads it.
- No shell (a chat app such as Claude or ChatGPT): ask the user to drop the file on the item in the Listspace app.
- A tiny text file you wrote yourself: `attach_file` with base64 is fine.
