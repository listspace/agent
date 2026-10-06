#!/usr/bin/env node
// Copies the skill (agent/skills/listspace, the source) into the Claude Code
// plugin (agent/claude-code-plugin/skills/listspace). A plain copy, no
// symlink, so the plugin folder works when copied or zipped on its own.
// Run it after every skill edit; check-agent.mjs fails CI when they drift.

import { cp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const agent = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_SOURCE = join(agent, 'skills', 'listspace')
const SKILL_COPY = join(agent, 'claude-code-plugin', 'skills', 'listspace')

await rm(SKILL_COPY, { recursive: true, force: true })
await cp(SKILL_SOURCE, SKILL_COPY, { recursive: true })
process.stdout.write(`Copied ${SKILL_SOURCE} to ${SKILL_COPY}\n`)
