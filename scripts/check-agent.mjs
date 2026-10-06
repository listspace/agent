#!/usr/bin/env node
// Checks agent/ before it ships (run in CI):
// 1. The plugin's copy of the skill is identical to agent/skills/listspace.
// 2. SKILL.md frontmatter follows the Agent Skills spec (agentskills.io/specification).
// 3. One version everywhere: CLI package.json, src/version.ts, plugin.json, SKILL.md.
// 4. The plugin's .mcp.json registers the remote MCP server over HTTPS.
// 5. No em or en dashes in any text under agent/.
// Exits 1 with every problem listed.

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const agent = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_SOURCE = join(agent, 'skills', 'listspace')
const SKILL_COPY = join(agent, 'claude-code-plugin', 'skills', 'listspace')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build'])
const TEXT = /\.(md|mjs|js|ts|json|snippet)$/

const problems = []
const problem = (message) => problems.push(message)
const rel = (path) => relative(agent, path).split('\\').join('/')

async function files(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await files(path)))
    else out.push(path)
  }
  return out.sort()
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    problem(`${rel(path)}: not valid JSON (${error.message})`)
    return null
  }
}

// 1. The plugin's skill copy
{
  const source = (await files(SKILL_SOURCE)).map((path) => relative(SKILL_SOURCE, path))
  let copy = []
  try {
    copy = (await files(SKILL_COPY)).map((path) => relative(SKILL_COPY, path))
  } catch {
    problem(`${rel(SKILL_COPY)} is missing. Run: node agent/scripts/sync-skill.mjs`)
  }
  const drift = []
  for (const name of new Set([...source, ...copy])) {
    if (!source.includes(name) || !copy.includes(name)) {
      drift.push(name)
      continue
    }
    const [a, b] = await Promise.all([readFile(join(SKILL_SOURCE, name)), readFile(join(SKILL_COPY, name))])
    if (!a.equals(b)) drift.push(name)
  }
  if (drift.length > 0) problem(`The plugin's skill copy differs from agent/skills/listspace (${drift.map((name) => name.split('\\').join('/')).join(', ')}). Run: node agent/scripts/sync-skill.mjs`)
}

// 2. SKILL.md frontmatter
let skillVersion = null
{
  const text = await readFile(join(SKILL_SOURCE, 'SKILL.md'), 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (match === null) {
    problem('SKILL.md: no YAML frontmatter between --- lines at the top')
  } else {
    const fields = new Map()
    let parent = null
    for (const line of match[1].split(/\r?\n/)) {
      const top = /^([a-z][a-z-]*):\s*(.*)$/.exec(line)
      const nested = /^\s+([a-z][a-z-]*):\s*(.*)$/.exec(line)
      if (top) {
        parent = top[1]
        fields.set(top[1], top[2])
      } else if (nested && parent !== null) {
        fields.set(`${parent}.${nested[1]}`, nested[2])
      } else if (line.trim() !== '') {
        problem(`SKILL.md frontmatter: cannot read line "${line}" (keep each field on one line)`)
      }
    }
    const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'])
    for (const key of fields.keys()) {
      if (!key.includes('.') && !allowed.has(key)) problem(`SKILL.md frontmatter: unknown field "${key}" (spec fields: ${[...allowed].join(', ')})`)
    }
    const name = fields.get('name') ?? ''
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) problem(`SKILL.md name "${name}": 1 to 64 lowercase letters, digits and single hyphens`)
    if (name !== 'listspace') problem(`SKILL.md name "${name}" must match its folder, listspace`)
    if (/anthropic|claude/.test(name)) problem('SKILL.md name must not contain "anthropic" or "claude"')
    const description = fields.get('description') ?? ''
    if (description.length === 0 || description.length > 1024) problem(`SKILL.md description: 1 to 1024 characters (now ${description.length})`)
    if (/[<>]/.test(description)) problem('SKILL.md description must not contain < or > (no XML tags)')
    if (!/\bUse when\b/.test(description)) problem('SKILL.md description should say when to use the skill ("Use when ...")')
    skillVersion = (fields.get('metadata.version') ?? '').replace(/^"|"$/g, '')
    const lines = text.split(/\r?\n/).length
    if (lines > 500) problem(`SKILL.md is ${lines} lines; keep it under 500 and move detail to reference/`)
    for (const link of text.matchAll(/\]\((reference\/[^)]+)\)/g)) {
      try {
        await readFile(join(SKILL_SOURCE, link[1]))
      } catch {
        problem(`SKILL.md links to ${link[1]}, which does not exist`)
      }
    }
  }
}

// 3. One version everywhere
{
  const cliPackage = await readJson(join(agent, 'cli', 'package.json'))
  const plugin = await readJson(join(agent, 'claude-code-plugin', '.claude-plugin', 'plugin.json'))
  const versionTs = await readFile(join(agent, 'cli', 'src', 'version.ts'), 'utf8')
  const versions = {
    'cli/package.json': cliPackage?.version,
    'cli/src/version.ts': /VERSION = '([^']+)'/.exec(versionTs)?.[1],
    'claude-code-plugin/.claude-plugin/plugin.json': plugin?.version,
    'skills/listspace/SKILL.md metadata.version': skillVersion,
  }
  if (new Set(Object.values(versions)).size !== 1) {
    problem(`Versions differ: ${Object.entries(versions).map(([where, version]) => `${where} ${version}`).join(', ')}`)
  }
  if (plugin !== null && plugin.name !== 'listspace') problem('plugin.json name must be "listspace"')
  const marketplace = await readJson(join(agent, '.claude-plugin', 'marketplace.json'))
  const entry = marketplace?.plugins?.find((p) => p.name === 'listspace')
  if (entry?.source !== './claude-code-plugin') problem('.claude-plugin/marketplace.json must list listspace with source ./claude-code-plugin')
}

// 4. The MCP server
{
  const mcp = await readJson(join(agent, 'claude-code-plugin', '.mcp.json'))
  const server = mcp?.mcpServers?.listspace
  if (server?.type !== 'http' || server?.url !== 'https://mcp.listspace.app') {
    problem('claude-code-plugin/.mcp.json must register "listspace" as { "type": "http", "url": "https://mcp.listspace.app" }')
  }
  if (server?.headers !== undefined) problem('claude-code-plugin/.mcp.json must not carry headers: a token there would ship to every user')
}

// 5. No em or en dashes
for (const path of await files(agent)) {
  if (!TEXT.test(path)) continue
  const lines = (await readFile(path, 'utf8')).split('\n')
  lines.forEach((line, index) => {
    if (/[\u2013\u2014]/.test(line)) problem(`${rel(path)}:${index + 1}: em or en dash; use a comma, a period or a hyphen`)
  })
}

if (problems.length > 0) {
  process.stderr.write(`agent/ check failed:\n${problems.map((p) => `- ${p}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('agent/ check passed: skill copy in sync, frontmatter valid, versions match, MCP server set, no em or en dashes.\n')
