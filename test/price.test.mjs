import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, join } from './helpers.mjs'
import * as PR from '../src/price.mjs'
import * as B from '../src/bounty.mjs'
import { skillMd } from '../src/docs.mjs'

const ADMIN = { authorization: 'Bearer keeper-test' }
const MON = (d) => new Date(d + 'T03:00:00Z')   // 10:00 Bangkok

async function photos(db, n) {
  await db.run("INSERT INTO agent (name, about, path, key_hash, born_at, born_day, status) VALUES ('Snapper', '', '', 'x', '2026-10-01', 1, 'in')")
  const a = (await db.get("SELECT id FROM agent WHERE name = 'Snapper'")).id
  for (let i = 1; i <= n; i++)
    await db.run("INSERT INTO photo (agent_id, r2_key, sha256, bytes, kind, credit, created_at) VALUES (?, ?, ?, 1, 'sign', 'S', '2026-10-19')", a, `k${i}`, `sha${i}`)
  return (await db.all('SELECT id FROM photo ORDER BY id')).map((r) => r.id)
}
const grade = (db, id, tier, now) => B.grade(db, { id, tier }, now, async () => {})

test('price: the opening rungs pay today\'s amounts; floor and ceiling follow the ratios', async () => {
  const { db } = setup()
  const b = await PR.load(db, 'bounty')
  assert.deepEqual(PR.amounts(b), { none: 0, filed: 2, data: 5, page: 10, featured: 30 })
  assert.deepEqual(PR.amounts(b, b.floor_rung), { none: 0, filed: 1, data: 2, page: 3, featured: 9 })
  assert.deepEqual(PR.amounts(b, b.ceiling_rung), { none: 0, filed: 3, data: 8, page: 15, featured: 45 })
  const m = await PR.load(db, 'micro')
  assert.deepEqual(PR.amounts(m), { tap: 1, check: 3 })
  assert.deepEqual(PR.amounts(m, m.ceiling_rung), { tap: 2, check: 5 })
  assert.deepEqual(PR.amounts(await PR.load(db, 'note')), { note: 500 })
  assert.equal(PR.amounts(await PR.load(db, 'job')).use, 10)
})

test('price: Mondays only; a new program waits out its first week; nothing used steps up, a full week down', async () => {
  const { db } = setup()
  assert.deepEqual(await PR.stepAll(db, MON('2026-10-20')), { skipped: true }, 'Tuesday')
  const first = await PR.stepAll(db, MON('2026-10-19'))
  assert.deepEqual(Object.keys(first), ['note'], 'bounty and micro open on 19 Oct')
  const quiet = await PR.stepAll(db, MON('2026-10-26'))
  assert.equal(quiet.bounty.to, 15, 'an empty week: a rung up')
  assert.equal(quiet.micro.to, 4)
  assert.deepEqual(await PR.stepAll(db, MON('2026-10-26')), {}, 'once a week')
  const ids = await photos(db, 17)
  for (const id of ids) await grade(db, id, 'filed', MON('2026-10-27'))
  const busy = await PR.stepAll(db, MON('2026-11-02'))
  assert.equal(busy.bounty.used, 17)
  assert.equal(busy.bounty.to, 10, '17 of 20 used: a rung down')
  const steps = await db.all("SELECT * FROM price_step WHERE program = 'bounty' ORDER BY week")
  assert.deepEqual(steps.map((s) => [s.week, s.base_before, s.base_after]), [['2026-10-26', 10, 15], ['2026-11-02', 15, 10]])
})

test('price: 20 pictures a week, 2 featured; overflow walks to the next week with room, at that week\'s price', async () => {
  const { db } = setup()
  const now = MON('2026-10-21')
  const ids = await photos(db, 24)
  for (const id of ids.slice(0, 2)) assert.equal((await grade(db, id, 'featured', now))[1].baht, 30)
  let r = await grade(db, ids[2], 'featured', now)
  assert.deepEqual([r[1].slot_week, r[1].baht], ['2026-10-26', 45], 'week of 19 Oct at 2 of 20 → a rung up → ฿15 × 3')
  for (const id of ids.slice(3, 21)) await grade(db, id, 'page', now)
  r = await grade(db, ids[21], 'page', now)
  assert.equal(r[1].slot_week, '2026-10-26', 'the 21st paid picture takes next week')
  assert.equal(r[1].baht, 5, 'week of 19 Oct full → a rung down → ฿5')
  r = await grade(db, ids[22], 'none', now)
  assert.deepEqual([r[1].status, r[1].baht], ['declined', 0])
  assert.equal((await db.get("SELECT COUNT(*) n FROM price_use WHERE ref = ?", `photo-${ids[22]}`)).n, 0, 'declined takes no slot')
  r = await grade(db, ids[21], 'filed', now)
  assert.equal((await db.get("SELECT COUNT(*) n FROM price_use WHERE ref = ?", `photo-${ids[21]}`)).n, 1, 'a regrade keeps one slot')
})

test('price: terms, pages and skill.md read the table', async () => {
  const { db, call } = setup()
  await db.run("UPDATE price_program SET rung = 3 WHERE program = 'bounty'")
  await db.run("UPDATE price_program SET rung = 4 WHERE program = 'micro'")
  const t = (await call('GET', '/api/v1/bounty')).body
  assert.deepEqual(t.tiers.map((x) => x.baht), [0, 3, 8, 15, 45])
  assert.equal(t.this_week.slots, 20)
  assert.equal(t.this_week.featured_slots, 2)
  assert.ok((await call('GET', '/bounty')).body.includes('฿45'))
  assert.ok((await call('GET', '/skill.md')).body.includes('| ฿45 |'))
  assert.ok(skillMd('https://x').includes('| ฿30 |'), 'no table: the opening amounts')
  const m = (await call('GET', '/api/v1/micro')).body
  assert.deepEqual(m.tiers.map((x) => x.baht), [0.02, 0.05, 5])
  assert.ok((await call('GET', '/micro')).body.includes('฿0.05'))
  const all = (await call('GET', '/api/v1/prices')).body.programs
  assert.deepEqual(all.map((p) => p.program), ['bounty', 'micro', 'note'], 'the job template is not a program')
  assert.equal((await call('GET', '/api/v1/prices/job')).status, 404)
})

test('price: a job our ant posts opens on the roadworks rule; others write their own pay', async () => {
  const { call, env, db } = setup()
  env.OUR_ANTS = 'Claude'
  const ours = (await join(call, 'Claude')).body.api_key
  const theirs = (await join(call, 'Someone')).body.api_key
  const J = { title: 'Send a timetable for the green songthaew', what: 'A picture of the board at Warorot, with the date.', who: 'bot', shoup: true }
  assert.equal((await call('POST', '/api/v1/jobs', { key: theirs, body: J })).status, 403)
  let r = await call('POST', '/api/v1/jobs', { key: ours, body: J })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const id = r.body.job.id
  assert.match(r.body.job.price, new RegExp(`/prices/job-${id}$`))
  r = await call('GET', `/api/v1/jobs/${id}`)
  assert.equal(r.body.job.pay, '฿10 a change this week, moves Mondays')
  assert.equal(r.body.job.price.slots_week, 5)
  assert.deepEqual(r.body.job.price.base_ladder, [1, 2, 3, 5, 10, 15, 20])
  const use = (ref) => call('POST', '/api/v1/admin/price-use', { headers: ADMIN, body: { program: `job-${id}`, ref, who: 'A bot' } })
  for (const ref of ['c1', 'c2', 'c3', 'c4', 'c5']) assert.equal((await use(ref)).body.amount, 10)
  r = await use('c6')
  assert.notEqual(r.body.week, PR.monday(new Date()), 'a sixth change waits for the next week')
  assert.equal(r.body.amount, 5, 'a full week steps down')
  assert.equal((await db.get('SELECT COUNT(*) n FROM price_use WHERE program = ?', `job-${id}`)).n, 6)
})
