import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './helpers.mjs'
import { payWeek, stepWeek, rates } from '../src/people.mjs'
import { runPayouts } from '../src/micro.mjs'

const ADMIN = { authorization: 'Bearer keeper-test' }
const admin = (call, body) => call('POST', '/api/v1/admin/micro', { body, headers: ADMIN })
const age = (db) => db.run('UPDATE micro_lease SET issued_at = ?', new Date(Date.now() - 5000).toISOString())
const SHOP = (n) => ({ name: `ร้าน ${n}`, name_en: `Shop ${n}`, address: 'Nimman', lat: 18.8, lng: 98.97, page: 'https://motdang.net/cm/p/x.html', link: `https://shop${n}.example/` })

function fd(o) { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f }
async function person(call, name, ip, extra = {}) {
  const r = await call('POST', '/work', { headers: { 'cf-connecting-ip': ip }, body: fd({ name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`, rail: 'paypal', handle: name.replace(/\W/g, ''), ok: 'on', ...extra }) })
  assert.equal(r.status, 303, String(r.body).slice(0, 300))
  const tok = /\/work\/(\d+\.[0-9a-f]{20})\//.exec(r.headers.get('location'))[1]
  const as = (method, path, o = {}) => call(method, path.replace('~', `/work/${tok}`), { ...o, headers: { 'cf-connecting-ip': ip, ...(o.headers || {}) } })
  return { tok, as, r }
}
const leaseOf = (page) => /name="lease" value="(ml_[0-9a-f]+)"/.exec(page)?.[1]

test('work: the page, a sign-up that needs its fields, then straight into a check', async () => {
  const { call } = setup()
  const land = await call('GET', '/work')
  assert.equal(land.status, 200)
  assert.match(land.body, /Start checking/)
  assert.match(land.body, /Paid in Art/)
  const bad = await call('POST', '/work', { body: fd({ name: 'Ann', email: 'nope', rail: 'paypal', handle: 'ann', ok: 'on' }) })
  assert.equal(bad.status, 422)
  assert.match(bad.body, /email address/)
  const noTick = await call('POST', '/work', { body: fd({ name: 'Ann', email: 'ann@example.com', rail: 'paypal', handle: 'ann' }) })
  assert.equal(noTick.status, 422)
  const A = await person(call, 'Ann Arbor', '1.1.1.1')
  assert.match(A.r.headers.get('location'), /\/next$/)
  assert.match(A.r.headers.get('set-cookie'), /^work=/)
  const again = await call('POST', '/work', { body: fd({ name: 'Ann Arbor', email: 'annarbor@example.com', rail: 'paypal', handle: 'x', ok: 'on' }) })
  assert.match(again.body, /Check your email/, 'a second sign-up with an email gets no link on screen')
  const closed = await A.as('GET', '~/next')
  assert.match(closed.body, /closed|No check/i)
})

test('work: three people agree, are paid in cents, and the Monday payout skips the Revolut rail', async () => {
  const { call, db, env } = setup()
  await admin(call, { do: 'open' })
  await admin(call, { do: 'tasks', tasks: [{ kind: 'link-belongs', source: 's1', show: SHOP(1) }, { kind: 'same-place', source: 'a|b', show: { a: SHOP(2), b: SHOP(3), metres: 9 } }] })
  await db.run('UPDATE micro_bot SET answers = 100') // past probation: ordinary tasks first
  const P = [await person(call, 'Bea', '2.2.2.2'), await person(call, 'Cal', '3.3.3.3'), await person(call, 'Dee', '4.4.4.4')]
  await db.run('UPDATE micro_bot SET answers = 100')
  for (const x of P) {
    const page = (await x.as('GET', '~/next')).body
    assert.match(page, /Open the link/, 'a person who does not read Thai gets a link check')
    assert.doesNotMatch(page, /metres apart/)
    assert.match(page, /\b5¢/)
    x.lease = leaseOf(page)
  }
  const look = await P[0].as('POST', '~/answer', { body: fd({ lease: P[0].lease, answer: 'yes' }) })
  assert.match(look.headers.get('location'), /e=look/, 'too fast: look first')
  await age(db)
  for (const [i, x] of P.entries()) await x.as('POST', '~/answer', { body: fd({ lease: x.lease, answer: i < 2 ? 'yes' : 'no' }) })
  const rows = await db.all("SELECT a.outcome, a.satang, l.cur FROM micro_answer a JOIN micro_lease l ON l.task_id = a.task_id AND l.agent_id = a.agent_id ORDER BY a.id")
  assert.deepEqual(rows.map((r) => [r.outcome, r.satang, r.cur]), [['agreed', 5, 'usd'], ['agreed', 5, 'usd'], ['disagreed', 0, 'usd']])

  // the baht rail never sees people
  await db.run('UPDATE micro_answer SET payable_at = ?, reveal_at = ?', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z')
  await runPayouts(db, { ...env, MICRO_RAIL: 'list' }, new Date('2026-10-19T04:00:00Z'))
  assert.equal((await db.get('SELECT COUNT(*) n FROM micro_payout')).n, 0)

  // under $5 waits; at $5 a payout and a sent page
  assert.deepEqual(await payWeek(db, env, new Date('2026-10-19T04:00:00Z'), 'https://motdang.net/anthill'), { payouts: 0 })
  await db.run("UPDATE micro_answer SET satang = 600 WHERE outcome = 'agreed'")
  await db.run("UPDATE micro_setting SET v = '' WHERE k = 'usd_paid_week'")
  const posted = []
  const hook = { ...env, DISCORD_PEOPLE: 'https://discord.test/hook' }
  const real = globalThis.fetch
  globalThis.fetch = async (u, o) => { posted.push(JSON.parse(o.body).content); return new Response('{}') }
  try {
    assert.deepEqual(await payWeek(db, hook, new Date('2026-10-19T04:00:00Z'), 'https://motdang.net/anthill'), { payouts: 2 })
    assert.deepEqual(await payWeek(db, hook, new Date('2026-10-19T05:00:00Z'), 'https://motdang.net/anthill'), { skipped: true }, 'once a Monday')
  } finally { globalThis.fetch = real }
  assert.match(posted.at(-1), /https:\/\/paypal\.me\/Bea\/6\.00USD/)
  const sent = /sent\? (\S+)/.exec(posted.at(-1))[1].replace('https://motdang.net/anthill', '')
  assert.match((await call('GET', sent)).body, /Mark sent/, 'a GET (a link preview) marks nothing')
  assert.equal((await db.get("SELECT COUNT(*) n FROM person_payout WHERE status = 'sent'")).n, 0)
  await call('POST', sent, { body: fd({}) })
  assert.equal((await db.get("SELECT COUNT(*) n FROM person_payout WHERE status = 'sent'")).n, 1)
  assert.match((await P[0].as('GET', '~')).body, /sent 20/)
})

test('work: Thai readers get Thai kinds; the day share stops a person', async () => {
  const { call, db } = setup()
  await admin(call, { do: 'open' })
  await admin(call, { do: 'tasks', tasks: [{ kind: 'same-place', source: 'a|b', show: { a: SHOP(2), b: SHOP(3), metres: 9 } }] })
  const T = await person(call, 'Thai Reader', '5.5.5.5', { thai: 'on' })
  await db.run('UPDATE micro_bot SET answers = 100')
  const page = (await T.as('GET', '~/next')).body
  assert.match(page, /metres apart/)
  assert.match(page, /\b3¢/)
  const N = await person(call, 'No Thai', '6.6.6.6')
  assert.match((await N.as('GET', '~/next')).body, /Nothing for you/)
  await db.run("UPDATE micro_setting SET v = '10' WHERE k = 'usd_cap_cents_day'")
  await admin(call, { do: 'tasks', tasks: [{ kind: 'link-belongs', source: 's9', show: SHOP(9) }] })
  assert.match((await N.as('GET', '~/next')).body, /share|spoken for/)
})

test('work: an answer still waiting after a week is paid to a person whose known answers are right', async () => {
  const { db, env, call } = setup()
  await admin(call, { do: 'open' })
  await admin(call, { do: 'tasks', tasks: [{ kind: 'link-belongs', source: 's1', show: SHOP(1) }] })
  const A = await person(call, 'Eve', '7.7.7.7')
  await db.run('UPDATE micro_bot SET answers = 100')
  const lease = leaseOf((await A.as('GET', '~/next')).body)
  await age(db)
  await A.as('POST', '~/answer', { body: fd({ lease, answer: 'yes' }) })
  await db.run("UPDATE micro_answer SET created_at = '2026-10-01T00:00:00Z', satang = 600")
  const mon = new Date('2026-10-19T04:00:00Z')
  assert.deepEqual(await payWeek(db, env, mon, 'x'), { payouts: 0 }, 'no known answers seen yet')
  await db.run('UPDATE micro_bot SET golds = 5, golds_ok = 5')
  await db.run("UPDATE micro_setting SET v = '' WHERE k = 'usd_paid_week'")
  assert.deepEqual(await payWeek(db, env, mon, 'x'), { payouts: 1 })
})

test('work: reviews, ten lines, places a month, and a no before payday', async () => {
  const { call, db, env } = setup()
  const A = await person(call, 'Fay', '8.8.8.8', { gig: 'review' })
  assert.match(A.r.headers.get('location'), /\/review$/)
  assert.match((await A.as('GET', '~/review')).body, /Ten changes/)
  const short = await A.as('POST', '~/review', { body: fd({ about: 'fb-motdang', body: 'one\ntwo', work: 'https://x.example' }) })
  assert.equal(short.status, 422)
  const ten = Array.from({ length: 10 }, (_, i) => `Change ${i + 1}: post at 7pm Bangkok, because the reels watched most were posted then`).join('\n')
  const ok = await A.as('POST', '~/review', { body: fd({ about: 'fb-motdang', body: ten, work: 'https://x.example' }) })
  assert.match(ok.body, /Review sent/)
  assert.doesNotMatch((await A.as('GET', '~')).body, /Write a review/, 'one a month each')
  const j = await db.get('SELECT * FROM person_job')
  assert.equal(j.cents, 2000)
  await db.run("UPDATE person_job SET payable_at = '2000-01-01T00:00:00Z'")
  assert.deepEqual(await payWeek(db, env, new Date('2026-10-19T04:00:00Z'), 'x'), { payouts: 1 })
})

test('work: Shoup on Mondays — no rise without people, a step down when the money is taken', async () => {
  const { db } = setup()
  const mon = new Date('2026-10-19T04:00:00Z')
  assert.deepEqual((await stepWeek(db, new Date('2026-10-18T04:00:00Z'))).skipped, true, 'Sundays nothing')
  const r0 = await rates(db)
  await stepWeek(db, mon)
  const r1 = await rates(db)
  assert.equal(r1.check, r0.check, 'no takers yet is not a price signal')
  db.exec('PRAGMA foreign_keys = OFF')
  await db.run("INSERT INTO micro_lease (id, task_id, agent_id, payee_id, satang, day, issued_at, expires_at, answered, cur) VALUES ('ml_x', 1, 1, 1, 9000, '2026-10-22', '', '', 1, 'usd')")
  await stepWeek(db, new Date('2026-10-26T04:00:00Z'))
  assert.equal((await rates(db)).check, 3)
})
