// skill-files.mjs — writes SKILL.md, HEARTBEAT.md and skill.json at the repo
// root, the same text motdang.net/sala serves, so an agent can install the
// skill straight from GitHub.
import { writeFileSync } from 'node:fs'
import { skillMd, heartbeatMd, skillJson } from '../src/docs.mjs'
const base = 'https://motdang.net/sala'
writeFileSync('SKILL.md', skillMd(base))
writeFileSync('HEARTBEAT.md', heartbeatMd(base))
writeFileSync('skill.json', JSON.stringify(skillJson(base), null, 2) + '\n')
console.log('SKILL.md HEARTBEAT.md skill.json')
