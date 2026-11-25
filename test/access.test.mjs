import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup } from './helpers.mjs'
import { makeKey, checkKey, ACCESS } from '../src/access.mjs'
import { runDigest } from '../src/digest.mjs'

const now = () => new Date().toISOString()
async function task(db, kind, gold = null, n = 1) {
  for (let i = 0; i < n; i++)
    await db.run('INSERT INTO micro_task (kind, tier, payload, source, gold, created_at) VALUES (?,?,?,?,?,?)',
      kind, kind === 'link-belongs' || kind === 'phone-matches' ? 'check' : 'tap',
      JSON.stringify({ th: 'ร้านข้าวซอย', en: 'Khao Soi Shop ' + i }), `${kind}:${gold}:${i}:${Math.random()}`, gold, now())
}
// answers wait two seconds after the check; tests move the check back instead
const age = (db, lease) => db.run('UPDATE access_lease SET issued_at = ? WHERE id = ?', new Date(Date.now() - 5000).toISOString(), lease)
const from = (ip) => ({ headers: { 'cf-connecting-ip': ip, 'user-agent': 'TestBot/1.0' } })

test('access: closed without the secret; nothing to check when the pool is empty', async () => {
  const { env, call } = setup()
  assert.equal((await call('GET', '/api/v1/access')).status, 503)
  env.ACCESS_SECRET = 's'
  const r = await call('GET', '/api/v1/access')
  assert.equal(r.status, 200)
  assert.equal(r.body.task, null)
  assert.match(r.body.deal_th, /กุญแจ/)
})

test('access: an answer that passes gets a key, a cookie, and the key checks out', async () => {
  const { db, env, call } = setup()
  env.ACCESS_SECRET = 's'
  await task(db, 'name-match')
  const t = (await call('GET', '/api/v1/access', from('1.1.1.1'))).body.task
  assert.equal(t.kind, 'name-match')
  assert.deepEqual(t.choices, ['yes', 'no', 'cannot_tell'])
  assert.equal((await call('GET', `/api/v1/access/answer?lease=${t.lease}&answer=yes`, from('1.1.1.1'))).status, 425)
  await age(db, t.lease)
  assert.equal((await call('GET', `/api/v1/access/answer?lease=${t.lease}&answer=maybe`, from('1.1.1.1'))).status, 400)
  const r = await call('GET', `/api/v1/access/answer?lease=${t.lease}&answer=yes`, from('1.1.1.1'))
  assert.equal(r.status, 200)
  assert.match(r.body.key, /^ak1\.[0-9a-z]+\.[A-Za-z0-9_-]{22}$/)
  assert.match(r.headers.get('set-cookie'), /^ant_key=ak1\..+; Path=\/; Max-Age=86400; Secure; SameSite=Lax$/)
  const c = await call('GET', '/api/v1/access/check?key=' + encodeURIComponent(r.body.key))
  assert.equal(c.body.valid, true)
  assert.equal((await call('GET', `/api/v1/access/answer?lease=${t.lease}&answer=yes`, from('1.1.1.1'))).status, 409)
  assert.equal((await call('GET', '/api/v1/access/check?key=ak1.zz.AAAAAAAAAAAAAAAAAAAAAA')).body.valid, false)
})

test('access: a wrong gold and cannot_tell earn no key; a right gold does; POST works too', async () => {
  const { db, env, call } = setup()
  env.ACCESS_SECRET = 's'
  await task(db, 'same-place', 'same', 3)
  const ask = async () => (await call('GET', '/api/v1/access', from('2.2.2.2'))).body.task
  const say = async (t, answer) => { await age(db, t.lease); return (await call('POST', '/api/v1/access', { body: { lease: t.lease, answer }, ...from('2.2.2.2') })).body }
  const wrong = await say(await ask(), 'different')
  assert.equal(wrong.key, null)
  assert.match(wrong.why_en, /does not match/)
  assert.equal((await say(await ask(), 'cannot_tell')).key, null)
  assert.ok((await say(await ask(), 'same')).key)
  // three checks, each once: this connection has none left
  assert.equal((await call('GET', '/api/v1/access', from('2.2.2.2'))).body.task, null)
  assert.ok((await call('GET', '/api/v1/access', from('3.3.3.3'))).body.task)
  const s = (await call('GET', '/api/v1/access/stats')).body
  assert.equal(s.checks_taken, 4)
  assert.equal(s.answers, 3)
  assert.equal(s.keys, 1)
  assert.equal(s.golds_right, 1)
  assert.equal(s.golds_wrong, 1)
  assert.equal(s.cannot_tell, 1)
  assert.equal(s.by_agent[0].ua, 'TestBot/1.0')
})

test('access: notes are never handed out; thirty checks an hour per connection', async () => {
  const { db, env, call } = setup()
  env.ACCESS_SECRET = 's'
  await db.run('INSERT INTO micro_task (kind, tier, payload, source, created_at) VALUES (?,?,?,?,?)', 'note', 'note', '{}', 'note:1', now())
  assert.equal((await call('GET', '/api/v1/access', from('4.4.4.4'))).body.task, null)
  await task(db, 'link-belongs', null, ACCESS.perIpHour + 1)
  for (let i = 0; i < ACCESS.perIpHour; i++) assert.ok((await call('GET', '/api/v1/access', from('4.4.4.4'))).body.task)
  assert.equal((await call('GET', '/api/v1/access', from('4.4.4.4'))).status, 429)
})

test('access: keys — tampered, expired and too far ahead are refused', async () => {
  const t = 1_800_000_000
  const k = await makeKey('s', t + 3600)
  assert.equal(await checkKey('s', k, t), t + 3600)
  assert.equal(await checkKey('other', k, t), 0)
  assert.equal(await checkKey('s', k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A'), t), 0)
  assert.equal(await checkKey('s', k, t + 3601), 0)
  assert.equal(await checkKey('s', await makeKey('s', t + 3 * 86400), t), 0)
  assert.equal(await checkKey('', k, t), 0)
  assert.equal(await checkKey('s', null, t), 0)
  // the vector crawlpay.js's test checks too, so the two copies stay in step
  assert.equal(await makeKey('vector-secret', 1_800_000_000), 'ak1.tro8w0.ZtpGexWmge1V0KBtpnKuma')
})

test('access: the daily digest counts checks and keys for the stretch', async () => {
  const { db, env, call } = setup()
  env.ACCESS_SECRET = 's'
  await task(db, 'name-match', null, 2)
  const t = (await call('GET', '/api/v1/access', from('5.5.5.5'))).body.task
  await age(db, t.lease)
  await call('GET', `/api/v1/access/answer?lease=${t.lease}&answer=no`, from('5.5.5.5'))
  const d = await runDigest(db, env, new Date(), { force: 'daily', dryRun: true })
  assert.match(d.text, /Work for access — 1 checks taken · 1 answered · 1 keys · 0 wrong on known answers — https:\/\/motdang.net\/anthill\/api\/v1\/access\/stats/)
})
