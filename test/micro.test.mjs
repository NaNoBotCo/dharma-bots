import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, solve } from './helpers.mjs'
import { runPayouts, LIMITS } from '../src/micro.mjs'
import { phoneKey, pagePhones, goldsFrom, machineAnswers } from '../src/micro-gold.mjs'

const ADMIN = { authorization: 'Bearer keeper-test' }
const PLACE = (n) => ({ name: `Khao Soi ${n}`, address: 'Nimman Soi 7', lat: 18.8, lng: 98.97, page: 'https://motdang.net/cm/p/x.html' })

async function bot(call, name, ip) {
  const headers = { 'cf-connecting-ip': ip }
  const m = (await call('GET', '/api/v1/count', { headers })).body
  const r = await call('POST', '/api/v1/agents/register', { headers, body: { name, about: 'a test bot', home: 'Chiang Mai', count: { id: m.id, answer: await solve(m) } } })
  const key = r.body.api_key || r.body.key || r.body.agent?.api_key
  assert.ok(key, JSON.stringify(r.body))
  const as = (method, path, o = {}) => call(method, path, { ...o, key, headers: { ...headers, ...(o.headers || {}) } })
  return { key, as }
}
const admin = (call, body) => call('POST', '/api/v1/admin/micro', { body, headers: ADMIN })
// answers need two seconds after the lease; age every lease instead of waiting
const age = (db) => db.run('UPDATE micro_lease SET issued_at = ?', new Date(Date.now() - 5000).toISOString())

test('micro: closed, then payee first, then three bots agree two to one', async () => {
  const { call, db } = setup()
  const A = await bot(call, 'Ant A', '1.1.1.1'), Bb = await bot(call, 'Ant B', '2.2.2.2'), C = await bot(call, 'Ant C', '3.3.3.3')
  assert.equal((await A.as('GET', '/api/v1/micro/next')).status, 503)
  await admin(call, { do: 'open' })
  assert.equal((await A.as('GET', '/api/v1/micro/next')).status, 400, 'no payee yet')
  for (const [b, t] of [[A, 'aaa111'], [Bb, 'bbb222'], [C, 'ccc333']])
    assert.equal((await b.as('POST', '/api/v1/micro/payee', { body: { revtag: '@' + t, name: 'Some One ' + t } })).status, 201)
  assert.equal((await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'zzz999', name: 'Other' } })).status, 409, 'payee stays')
  const load = await admin(call, { do: 'tasks', tasks: [{ kind: 'same-place', source: 'p1|p2', show: { a: PLACE(1), b: PLACE(2) } },
    { kind: 'nope', show: {} }, { kind: 'same-place', source: 'p1|p2', show: {} }] })
  assert.deepEqual(load.body, { added: 1, updated: 1, reopened: 0, bad: [1] })
  const leases = []
  for (const b of [A, Bb, C]) {
    const r = await b.as('GET', '/api/v1/micro/next')
    assert.equal(r.status, 200)
    assert.equal(r.body.baht, 0.01)
    assert.deepEqual(r.body.choices, ['same', 'different', 'cannot_tell'])
    leases.push(r.body.lease)
  }
  assert.equal((await A.as('POST', '/api/v1/micro/answers', { body: { lease: leases[0], answer: 'same' } })).status, 425, 'too fast')
  await age(db)
  assert.equal((await A.as('POST', '/api/v1/micro/answers', { body: { lease: leases[0], answer: 'maybe' } })).status, 400)
  for (const [b, l, ans] of [[A, leases[0], 'same'], [Bb, leases[1], 'same'], [C, leases[2], 'different']])
    assert.equal((await b.as('POST', '/api/v1/micro/answers', { body: { lease: l, answer: ans } })).status, 201)
  assert.equal((await A.as('POST', '/api/v1/micro/answers', { body: { lease: leases[0], answer: 'same' } })).status, 409)
  const t = await db.get('SELECT * FROM micro_task')
  assert.equal(t.status, 'settled')
  assert.equal(t.answer, 'same')
  const ma = (await A.as('GET', '/api/v1/micro/mine')).body
  assert.equal(ma.baht.holding, 0.01)
  assert.equal(ma.answers[0].outcome, 'agreed')
  const mc = (await C.as('GET', '/api/v1/micro/mine')).body
  assert.equal(mc.answers[0].outcome, 'disagreed')
  assert.equal(mc.baht.holding, 0)
  const led = (await call('GET', '/api/v1/micro/ledger')).body
  assert.equal(led.bots.length, 2)
  assert.ok(!JSON.stringify(led).includes('aaa111'), 'no Revtag in public')
  const page = (await call('GET', '/micro')).body
  assert.ok(page.includes('฿0.01') && page.includes('฿0.03'))
})

test('micro: bots sharing a payee or a connection never answer the same task', async () => {
  const { call } = setup()
  await admin(call, { do: 'open' })
  const A = await bot(call, 'Twin A', '9.9.9.1'), B2 = await bot(call, 'Twin B', '9.9.9.2'), C = await bot(call, 'Twin C', '9.9.9.1')
  await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'twin01', name: 'Twin Keeper' } })
  await B2.as('POST', '/api/v1/micro/payee', { body: { revtag: 'twin01', name: 'twin keeper' } })
  await C.as('POST', '/api/v1/micro/payee', { body: { revtag: 'other01', name: 'Other Keeper' } })
  await admin(call, { do: 'tasks', tasks: [{ kind: 'name-match', source: 'n1', show: { th: 'ข้าวซอย', en: 'Khao Soi' } }] })
  assert.ok((await A.as('GET', '/api/v1/micro/next')).body.lease)
  assert.equal((await B2.as('GET', '/api/v1/micro/next')).body.task, null, 'same payee')
  assert.equal((await C.as('GET', '/api/v1/micro/next')).body.task, null, 'same connection')
})

test('micro: missed golds freeze a bot; gold outcomes stay hidden for a while', async () => {
  const { call, db } = setup()
  await admin(call, { do: 'open' })
  const A = await bot(call, 'Guesser', '4.4.4.4')
  await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'guess1', name: 'G Keeper' } })
  await admin(call, { do: 'tasks', tasks: Array.from({ length: 6 }, (_, i) => ({ kind: 'link-belongs', source: 'g' + i, gold: 'dead', show: { link: `http://gone${i}.example` } })) })
  for (let i = 0; i < LIMITS.freeze.goldsSeen; i++) {
    const r = await A.as('GET', '/api/v1/micro/next')
    assert.equal(r.body.baht, 0.03)
    await age(db)
    assert.equal((await A.as('POST', '/api/v1/micro/answers', { body: { lease: r.body.lease, answer: 'yes' } })).status, 201)
  }
  const mine = (await A.as('GET', '/api/v1/micro/mine')).body
  assert.ok(mine.answers.every((x) => x.outcome === 'waiting'), 'not revealed yet')
  assert.equal(mine.frozen.why, 'golds')
  assert.equal((await A.as('GET', '/api/v1/micro/next')).status, 403)
  await admin(call, { do: 'release', name: 'Guesser' })
  assert.equal((await A.as('GET', '/api/v1/micro/next')).status, 200)
})

test('micro: the payee share and the daily cap', async () => {
  const { call } = setup()
  await admin(call, { do: 'open' })
  await admin(call, { do: 'cap', baht: 0.1 })
  await admin(call, { do: 'tasks', tasks: Array.from({ length: 5 }, (_, i) => ({ kind: 'phone-matches', source: 'c' + i, show: { phone: '+6653000000', link: 'http://x.example' } })) })
  const A = await bot(call, 'Capper', '5.5.5.5')
  await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'cap01', name: 'Cap Keeper' } })
  assert.equal((await A.as('GET', '/api/v1/micro/next')).status, 200)
  const r = await A.as('GET', '/api/v1/micro/next')
  assert.equal(r.status, 429, '฿0.06 would pass 40% of ฿0.10')
  assert.ok(r.body.retry_after > 0)
})

test('micro: payouts after the hold, on the pay rail, once a day', async () => {
  const { call, db, env } = setup()
  const sent = []
  Object.assign(env, { MICRO_RAIL: 'pay', REVOLUT_CLIENT_ID: 'c', REVOLUT_ASSERTION: 'j', REVOLUT_REFRESH_TOKEN: 'r', REVOLUT_ACCOUNT_ID: 'acc-thb',
    FETCH: async (url, init) => {
      sent.push({ url, body: init.body })
      const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/auth/token')) return ok({ access_token: 'tok', expires_in: 2399 })
      if (url.endsWith('/counterparty')) return ok({ id: 'cp-1', state: 'created' })
      if (url.endsWith('/pay')) return ok({ id: 'tx-1', state: 'completed' })
      return new Response('{}', { status: 404 })
    } })
  await admin(call, { do: 'open' })
  await admin(call, { do: 'pay-on' })
  const A = await bot(call, 'Earner', '6.6.6.6'), B2 = await bot(call, 'Earner 2', '7.7.7.7')
  assert.equal((await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'earn1', name: 'E Keeper' } })).status, 201)
  assert.equal((await db.get("SELECT state FROM micro_payee WHERE revtag = 'earn1'")).state, 'ok', 'counterparty added')
  await B2.as('POST', '/api/v1/micro/payee', { body: { revtag: 'earn2', name: 'F Keeper' } })
  await admin(call, { do: 'tasks', tasks: [{ kind: 'same-place', source: 'x', show: { a: PLACE(1), b: PLACE(1) } }] })
  await db.run('UPDATE micro_task SET need = 2')
  for (const b of [A, B2]) {
    const l = (await b.as('GET', '/api/v1/micro/next')).body.lease
    await age(db)
    await b.as('POST', '/api/v1/micro/answers', { body: { lease: l, answer: 'same' } })
  }
  // twenty baht earned, hold over
  await db.run("UPDATE micro_answer SET satang = 2000, payable_at = '2000-01-01T00:00:00Z'")
  const at11 = new Date(Date.parse(new Date().toISOString().slice(0, 10) + 'T04:00:00Z'))
  const r = await runPayouts(db, env, at11)
  assert.equal(r.payouts, 2)
  assert.equal(r.sent, 2)
  const pay = sent.filter((s) => s.url.endsWith('/pay')).map((s) => JSON.parse(s.body))
  assert.equal(pay[0].amount, 20)
  assert.equal(pay[0].currency, 'THB')
  assert.match(pay[0].request_id, /^motdang-micro-\d+$/)
  assert.equal((await runPayouts(db, env, at11)).skipped, true, 'once a day')
  assert.equal((await A.as('GET', '/api/v1/micro/mine')).body.baht.paid, 20)
})

test('micro: offers follow priority; unneeded tasks retire; settled answers export', async () => {
  const { call, db } = setup()
  await admin(call, { do: 'open' })
  const A = await bot(call, 'Picker', '8.8.8.8')
  await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'pick01', name: 'P Keeper' } })
  await admin(call, { do: 'tasks', tasks: [
    { kind: 'name-match', source: 'low', priority: 5, show: { th: 'ก', en: 'A' } },
    { kind: 'name-match', source: 'high', priority: 90, show: { th: 'ข', en: 'B' } },
    { kind: 'name-match', source: 'gone', priority: 50, show: { th: 'ค', en: 'C' } }] })
  // probation hands golds half the time; there are none, so ordinary tasks come
  const r = await A.as('GET', '/api/v1/micro/next')
  assert.equal(r.body.show.en, 'B', 'highest priority first')
  await admin(call, { do: 'tasks', tasks: [{ kind: 'name-match', source: 'low', priority: 200, show: { th: 'ก', en: 'A' } }] })
  const ret = await admin(call, { do: 'retire', kind: 'name-match', keep: ['low', 'high'] })
  assert.equal(ret.body.retired, 1)
  assert.equal((await db.get("SELECT status FROM micro_task WHERE source = 'gone'")).status, 'void')
  assert.equal((await A.as('GET', '/api/v1/micro/next')).body.show.en, 'A', 'new priority holds')
  await db.run("UPDATE micro_task SET status = 'settled', answer = 'yes', settled_at = '2026-10-03T00:00:00Z' WHERE source = 'high'")
  const out = (await admin(call, { do: 'settled' })).body
  assert.deepEqual(out.settled.map((x) => x.source), ['high'])
})

test('micro: notes carry their own question and choices, their own money and a long lease', async () => {
  const { call, db } = setup()
  await admin(call, { do: 'open' })
  await admin(call, { do: 'cap', baht: 0 })
  const A = await bot(call, 'Walker', '8.8.8.1'), B2 = await bot(call, 'Walker 2', '8.8.8.2')
  await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'walk01', name: 'W Keeper' } })
  await B2.as('POST', '/api/v1/micro/payee', { body: { revtag: 'walk02', name: 'V Keeper' } })
  const load = await admin(call, { do: 'tasks', tasks: [
    { kind: 'note', source: 'toilet:cm-osm-node-1#cost', show: { name: 'Kamthieng toilets', ask_en: 'What does the toilet cost?', ask_th: 'เข้าห้องน้ำกี่บาท', choices: ['free', '3', '5', '10', '20', 'none'] } },
    { kind: 'note', source: 'g#covered', gold: 'yes', show: { name: 'A car park', ask_en: 'Is it covered?' } },
    { kind: 'note', source: 'bad#x', gold: 'maybe', show: { ask_en: 'x' } }] })
  assert.deepEqual(load.body.bad, [2], 'a gold outside its choices')
  await db.run("UPDATE micro_task SET need = 2 WHERE gold IS NULL")
  await db.run("UPDATE micro_task SET status = 'void' WHERE gold IS NOT NULL")
  const leases = []
  for (const b of [A, B2]) {
    const r = await b.as('GET', '/api/v1/micro/next')
    assert.equal(r.status, 200, 'desk money is 0, note money is not')
    assert.equal(r.body.tier, 'note')
    assert.equal(r.body.baht, 5)
    assert.equal(r.body.ask_en, 'What does the toilet cost?')
    assert.deepEqual(r.body.choices, ['free', '3', '5', '10', '20', 'none', 'cannot_tell'])
    assert.ok(Date.parse(r.body.expires_at) - Date.now() > 3 * 3600 * 1000)
    leases.push(r.body.lease)
  }
  await age(db)
  assert.equal((await A.as('POST', '/api/v1/micro/answers', { body: { lease: leases[0], answer: 'yes' } })).status, 400)
  for (const [b, l] of [[A, leases[0]], [B2, leases[1]]])
    assert.equal((await b.as('POST', '/api/v1/micro/answers', { body: { lease: l, answer: '3' } })).status, 201)
  const t = await db.get("SELECT * FROM micro_task WHERE source = 'toilet:cm-osm-node-1#cost'")
  assert.equal(t.answer, '3')
  assert.equal((await A.as('GET', '/api/v1/micro/mine')).body.baht.holding, 5)
  const s = (await admin(call, { do: 'settled' })).body.settled
  assert.deepEqual(s.map((x) => [x.kind, x.answer]), [['note', '3']])
  assert.equal((await call('GET', '/api/v1/micro')).body.limits.notes_daily_cap_baht, 100)
  assert.equal((await A.as('GET', '/api/v1/micro/next?tier=desk')).status, 429, 'desk money is 0')
})

test('micro: the note price steps on its ladder by how much of the week was taken', async () => {
  const { call, db } = setup()
  const { runNotePrice } = await import('../src/micro.mjs')
  const monday = new Date('2026-10-19T03:00:00Z')
  assert.deepEqual(await runNotePrice(db, new Date('2026-10-20T03:00:00Z')), { skipped: true }, 'Tuesday')
  assert.equal((await runNotePrice(db, monday)).baht, 10, 'nothing taken: a step up')
  assert.deepEqual(await runNotePrice(db, monday), { skipped: true }, 'once a day')
  await db.run("INSERT INTO micro_task (kind, tier, payload, source, created_at) VALUES ('note', 'note', '{}', 's', '2026-10-18')")
  await db.run("INSERT INTO micro_lease (id, task_id, agent_id, payee_id, satang, day, issued_at, expires_at, answered, tier) VALUES ('ml_x', 1, 1, 1, 60000, '2026-10-21', '2026-10-21T00:00:00Z', '2026-10-21T04:00:00Z', 1, 'note')")
  const r = await runNotePrice(db, new Date('2026-10-26T03:00:00Z'))
  assert.ok(r.taken > 0.8 && r.baht === 5, JSON.stringify(r))
  assert.equal((await call('GET', '/api/v1/micro')).body.tiers.find((t) => t.tier === 'note').baht, 5, 'the table sets the note price')
  assert.equal((await admin(call, { do: 'note-price' })).status, 200, 'the keeper can force a step')
})

test('micro: a retired task opens again when it is loaded again; golds retire to the chosen mix', async () => {
  const { call, db } = setup()
  const T = (source, gold) => ({ kind: 'link-belongs', source, ...(gold ? { gold } : {}), show: { name: source, link: `http://${source}.example` } })
  await admin(call, { do: 'tasks', tasks: [T('a'), T('b'), T('d1', 'dead'), T('d2', 'dead'), T('y1', 'yes')] })
  const r = (await admin(call, { do: 'retire', kind: 'link-belongs', keep: ['a'], golds: ['d1', 'y1'] })).body
  assert.deepEqual(r, { retired: 1, golds_retired: 1 })
  const st = async (src) => (await db.get('SELECT status FROM micro_task WHERE source = ?', src)).status
  assert.equal(await st('b'), 'void')
  assert.equal(await st('d2'), 'void')
  assert.equal((await admin(call, { do: 'retire', kind: 'link-belongs', keep: ['a'] })).body.golds_retired, undefined, 'golds stay unless named')
  const back = (await admin(call, { do: 'tasks', tasks: [T('b'), T('d2', 'dead'), T('c')] })).body
  assert.deepEqual(back, { added: 1, updated: 0, reopened: 2, bad: [] })
  assert.equal(await st('b'), 'open')
  assert.equal(await st('d2'), 'open')
  // one that was answered and settled stays as it is
  await db.run("UPDATE micro_task SET status = 'settled', got = 3, answer = 'yes' WHERE source = 'a'")
  await admin(call, { do: 'tasks', tasks: [T('a')] })
  assert.equal(await st('a'), 'settled')
})

test('micro: a bot that opens the link and says yes is caught by the "no" and "different" golds', async () => {
  const { call, db } = setup()
  await admin(call, { do: 'open' })
  const A = await bot(call, 'Yes Man', '4.4.4.5')
  await A.as('POST', '/api/v1/micro/payee', { body: { revtag: 'yesman1', name: 'Y Keeper' } })
  const show = { name: 'Khao Soi Lamduan', phone: '+6653123456', link: 'http://lamduan.example' }
  await admin(call, { do: 'tasks', tasks: Array.from({ length: 6 }, (_, i) => i % 2
    ? { kind: 'link-belongs', source: `a${i}~b${i}`, gold: 'no', show }
    : { kind: 'phone-matches', source: `c${i}#different`, gold: 'different', show }) })
  for (let i = 0; i < LIMITS.freeze.goldsSeen; i++) {
    const r = await A.as('GET', '/api/v1/micro/next')
    await age(db)
    assert.equal((await A.as('POST', '/api/v1/micro/answers', { body: { lease: r.body.lease, answer: 'yes' } })).status, 201)
  }
  assert.equal((await A.as('GET', '/api/v1/micro/mine')).body.frozen.why, 'golds')
})

test('micro: golds from sites — the phone on the page, two halves, directories left out', () => {
  assert.equal(phoneKey('+6653106881'), '053106881')
  assert.equal(phoneKey('+66 (0)81 234 5678'), '0812345678')
  assert.equal(phoneKey('12345'), null)
  assert.deepEqual(pagePhones('<a href="tel:+66 53 106 881">โทร</a> Tel. 081-234-5678 order 1234567890123 ๐๕๓-๒๒๒๓๓๓'), ['0812345678', '053222333', '053106881'])
  const cands = Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, phone: `+66531000${String(i).padStart(2, '0')}`, link: `http://site${i}.example/`,
    show: { name: 'Place ' + i }, words: ['word' + i] }))
  const pages = new Map(cands.map((c, i) => [c.link, { phones: i === 11 ? ['053100011', '053999001', '053999002', '053999003']
    : i === 10 ? ['053777777'] : [phoneKey(c.phone)] }]))
  const dead = { 'link-belongs': [{ kind: 'link-belongs', source: 'x1', gold: 'dead', show: {} }, { kind: 'link-belongs', source: 'x2', gold: 'dead', show: {} }],
    'phone-matches': [{ kind: 'phone-matches', source: 'x1', gold: 'dead', show: {} }] }
  const g = goldsFrom(cands, pages, 9, dead)
  assert.equal(g.found, 10, 'not the page with four phones, not the page without its own')
  const by = (kind, gold) => g[kind].filter((t) => t.gold === gold)
  assert.equal(by('link-belongs', 'yes').length, 3)
  assert.equal(by('link-belongs', 'no').length, 3)
  assert.equal(by('phone-matches', 'yes').length, 3)
  assert.equal(by('phone-matches', 'different').length, 3)
  assert.equal(by('link-belongs', 'dead').length, 2, 'dead fill what is left, as many as there are')
  for (const t of by('phone-matches', 'different')) assert.ok(!pages.get(t.show.link).phones.includes(phoneKey(t.show.phone)), 'the phone shown is not on the page')
  for (const t of by('link-belongs', 'no')) assert.notEqual(t.show.name, cands.find((c) => c.link === t.show.link).show.name, 'another place with that site')
  const yesSites = new Set(by('link-belongs', 'yes').map((t) => t.show.link))
  assert.ok(by('phone-matches', 'yes').every((t) => !yesSites.has(t.show.link)), 'a site is in one gold of each kind')
  assert.ok(by('link-belongs', 'no').every((t) => !yesSites.has(t.show.link)))
  assert.deepEqual(goldsFrom(cands, pages, 9, dead), g, 'the same golds tomorrow')
  assert.deepEqual(goldsFrom(cands, new Map(), 9, dead)['phone-matches'].map((t) => t.gold), ['dead'], 'nothing read: only dead')
  const m = machineAnswers(cands, pages, '2026-10-17T00:00:00Z')
  assert.equal(m.length, 20, 'the ten found, settled yes for both kinds, unpaid')
  assert.ok(m.every((x) => x.answer === 'yes' && x.by === 'machine'))
  assert.ok(!m.some((x) => x.source === 'r10' || x.source === 'r11'), 'not the page without its phone, not the directory')
})
