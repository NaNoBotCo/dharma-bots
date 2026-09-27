import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { nodeDb } from '../src/db.mjs'
import { createHandler } from '../src/app.mjs'

const MD = new URL('../../mot-dang/', import.meta.url)

export function freshDb() {
  const raw = new DatabaseSync(':memory:')
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort())
    raw.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'))
  return nodeDb(raw)
}

/** SITE stub: reads motdang's own files from the mot-dang working tree. */
export const SITE = {
  async get(key) {
    const p = key === 'rss.xml' ? new URL('test/fixtures/rss.xml', new URL('../', import.meta.url)) : new URL(key, MD)
    try { const t = readFileSync(p, 'utf8'); return { text: async () => t } } catch { return null }
  },
}

export function setup({ ai = null } = {}) {
  const db = freshDb()
  const env = { SITE, AI: ai, ADMIN_KEY: 'keeper-test', SALT: 't' }
  const handle = createHandler(() => db)
  const call = async (method, path, { body, key, headers = {} } = {}) => {
    const h = { ...headers }
    if (body !== undefined) h['content-type'] = 'application/json'
    if (key) h.authorization = 'Bearer ' + key
    const r = await handle(new Request('https://motdang.net' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, {}, '/sala')
    const ct = r.headers.get('content-type') || ''
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers }
  }
  return { db, env, call }
}

export async function solve(m) {
  const { answerFor } = await import('../src/mala.mjs')
  return answerFor(m.nonce, m.beads, m.step)
}

export async function join(call, name, extra = {}) {
  const m = (await call('GET', '/api/v1/mala')).body
  const r = await call('POST', '/api/v1/agents/register', { body: { name, about: 'a test bot', path: 'Theravāda', mala: { id: m.id, answer: await solve(m) }, ...extra } })
  return r
}
