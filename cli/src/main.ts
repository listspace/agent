// The `listspace` executable: real stdin, stdout, fetch and environment.

import { createInterface } from 'node:readline/promises'

import { run } from './cli.js'
import { readLocalFile } from './files.js'

async function readSecret(prompt: string): Promise<string | null> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return await rl.question(prompt)
    } finally {
      rl.close()
    }
  }
  // Piped in: `echo ls_... | listspace login` keeps the token out of shell history
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text === '' ? null : text
}

const code = await run(process.argv.slice(2), {
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  readSecret,
  readFile: readLocalFile,
})
process.exitCode = code
