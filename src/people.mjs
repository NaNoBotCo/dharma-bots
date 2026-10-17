// people.mjs — /anthill/work: paid work for Mot Dang that people outside Thailand do from a
// screen. Nan 2026-10-17: "tasks that can be done by humans in america and other not-thailand
// places to support motdang projects … They should be automagically paid, and artist deals
// should apply. Calls to action. Lure influencer experts and autistic people in need of steady
// respectful gig work."
//
//   Checks    the microtasks bots answer (micro.mjs), at a person's rate in US cents. The same
//             three-answer agreement and known-answer tasks grade them; a person who does not
//             read Thai gets the two kinds that need none (link-belongs, phone-matches).
//   Reviews   for people who grow social accounts: ten changes to one of our accounts, posted
//             to #social-posts, paid after REVIEW_HOLD_D days unless someone marks it no.
//   Art       Paid in Art's trades (motdang.net/sites/paid-in-art), open to anyone anywhere.
//
// Sign-up takes a name, an email and a PayPal, Venmo or Wise name; the link it gives is the
// sign-in. Each Monday from 10:00 Bangkok, what each person is owed past the hold becomes a
// payout; #people-team gets a line per person whose link opens PayPal, Venmo or Wise with the
// amount, and a page to mark it sent. Rates move each Monday on Shoup's rule (stepWeek).
import { sha256hex, randHex } from './door.mjs'
import { bkkDate } from './site.mjs'
import * as MT from './micro.mjs'

// cents; a rate is a rung on its ladder, kept in micro_setting. Nan 2026-10-17, on 5¢ · 15¢ · $50:
// "these tasks should actually pay less. everything here could be automated, would bankrupt me."
export const LADDER = { tap: [1, 2, 3, 4, 5], check: [2, 3, 5, 6, 8, 10], review: [1000, 1500, 2000, 3000, 5000] }
export const LIM = {
  share: 0.4,          // of the day's money, one person
  gold: 0.25,          // known-answer share after probation
  trustDays: 7, trustGolds: 5, trustOk: 0.9, // an answer still waiting after a week is paid for a person this right
  minCents: 500,       // a payout; less carries to the next Monday
  reviewHoldD: 7, reviewMin: 400,
  joinsPerIpDay: 3,
  activeToStepUp: 3,   // people who checked that week, before a rate may rise
}
const KINDS_ALL = ['link-belongs', 'phone-matches', 'same-place', 'name-match']
const KINDS_NO_THAI = ['link-belongs', 'phone-matches']

export const RAILS = {
  paypal: { name: 'PayPal', ask: 'PayPal.me name', strip: /^(https?:\/\/)?(www\.)?paypal\.me\//i, ok: /^[A-Za-z0-9]{1,20}$/,
    show: (h) => `paypal.me/${h}`, pay: (h, usd) => `https://paypal.me/${h}/${usd}USD` },
  venmo: { name: 'Venmo', ask: 'Venmo username', strip: /^(https?:\/\/)?(www\.)?venmo\.com\/(u\/)?/i, ok: /^[A-Za-z0-9_-]{5,30}$/,
    show: (h) => `@${h} on Venmo`, pay: (h, usd) => `https://venmo.com/${h}?txn=pay&amount=${usd}&note=${encodeURIComponent('Mot Dang')}` },
  wise: { name: 'Wise', ask: 'Wisetag', strip: /^(https?:\/\/)?(www\.)?wise\.com\/pay\/me\//i, ok: /^[A-Za-z0-9]{3,40}$/,
    show: (h) => `@${h} on Wise`, pay: (h) => `https://wise.com/pay/me/${h}` },
}

export const ACCOUNTS = [
  { id: 'fb-motdang', name: 'Mot Dang on Facebook', url: 'https://www.facebook.com/61595048904000' },
  { id: 'fb-visa', name: 'Chiang Mai Visa Desk on Facebook', url: 'https://www.facebook.com/61594946848569' },
  { id: 'fb-hongdam', name: 'Hongdam on Facebook', url: 'https://www.facebook.com/61594628022706' },
  { id: 'bsky', name: 'NaNoBotCo on Bluesky', url: 'https://bsky.app/profile/nanobotco.bsky.social' },
  { id: 'site', name: 'motdang.net itself', url: 'https://motdang.net/' },
]

const LABEL = { same: 'Same place', different: 'Different places', yes: 'Yes', no: 'No', dead: 'The link does not load',
  not_listed: 'No phone on the site', cannot_tell: 'Can’t tell' }
const KIND_EN = { 'same-place': 'Same place?', 'name-match': 'Do the names match?', 'link-belongs': 'Is this its own site?', 'phone-matches': 'Does the phone match?' }

const iso = (d) => d.toISOString()
const plus = (now, s) => new Date(now.getTime() + s * 1000)
const usd = (c) => (Math.round(c) / 100).toFixed(2)
const money = (c) => c < 100 ? `${Math.round(c)}¢` : `$${usd(c)}`
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clean = (s, max) => String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max)
const href = (u) => /^https?:\/\//i.test(String(u || '')) ? String(u) : ''
const month = (now) => bkkDate(now).slice(0, 7)

// ── settings ───────────────────────────────────────────────────────────────────

export async function rates(db) {
  const s = Object.fromEntries((await db.all("SELECT k, v FROM micro_setting WHERE k LIKE 'usd_%'")).map((r) => [r.k, r.v]))
  const rung = (k) => Math.max(0, Math.min(LADDER[k].length - 1, Number(s[`usd_${k}_rung`] ?? 2)))
  return { cap: Number(s.usd_cap_cents_day || 0), tap: LADDER.tap[rung('tap')], check: LADDER.check[rung('check')], review: LADDER.review[rung('review')],
    rung: { tap: rung('tap'), check: rung('check'), review: rung('review') }, reviews: Number(s.usd_reviews_month || 0),
    stepped: s.usd_stepped_week || '', paid: s.usd_paid_week || '', reviewStepped: s.usd_review_stepped_month || '' }
}
const setSetting = (db, k, v) => db.run('INSERT INTO micro_setting (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v))

async function spent(db, day, now, payeeId = null) {
  return (await db.get(`SELECT COALESCE(SUM(satang), 0) n FROM micro_lease WHERE day = ? AND cur = 'usd' AND (answered = 1 OR expires_at > ?)${payeeId ? ' AND payee_id = ?' : ''}`,
    day, iso(now), ...(payeeId ? [payeeId] : []))).n
}

// ── links ──────────────────────────────────────────────────────────────────────

const sig = async (env, what, id, key) => (await sha256hex(`${env.SALT || 'sala'}|${what}|${id}|${key}`)).slice(0, 20)
export async function tokenOf(env, p) { return `${p.id}.${await sig(env, 'work', p.id, p.key)}` }
async function byToken(db, env, tok) {
  const m = /^(\d{1,9})\.([0-9a-f]{20})$/.exec(String(tok || ''))
  if (!m) return null
  const p = await db.get('SELECT * FROM person WHERE id = ?', Number(m[1]))
  return p && m[2] === (await sig(env, 'work', p.id, p.key)) ? p : null
}
const cookieTok = (request) => /(?:^|;\s*)work=([0-9]{1,9}\.[0-9a-f]{20})/.exec(request.headers.get('cookie') || '')?.[1] || ''
const cookie = (base, tok) => `work=${tok}; Path=${base}/work; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`

// ── sign-up ────────────────────────────────────────────────────────────────────

/** A person from the form: [person] or [null, why]. */
export async function join(db, env, f, ip, now, log) {
  const name = clean(f.name, 80), email = clean(f.email, 120).toLowerCase(), rail = String(f.rail || '')
  const R = RAILS[rail]
  const handle = R ? clean(f.handle, 80).replace(R.strip, '').replace(/^@/, '').replace(/\/.*$/, '') : ''
  if (name.length < 2) return [null, 'Your name, please.']
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return [null, 'An email address, please: your link goes there.']
  if (!R) return [null, 'Pick PayPal, Venmo or Wise.']
  if (!R.ok.test(handle)) return [null, `Your ${R.ask}, please, as it shows in ${R.name}.`]
  if (!f.ok) return [null, 'Tick the box: 18 or older, and the work is done outside Thailand.']
  const had = await db.get('SELECT * FROM person WHERE email = ?', email)
  if (had) return [had, 'again']
  const fresh = (await db.get("SELECT COUNT(*) n FROM event WHERE kind = 'person-join' AND ip_hash = ? AND at > ?", ip, iso(plus(now, -86400)))).n
  if (fresh >= LIM.joinsPerIpDay) return [null, `${LIM.joinsPerIpDay} sign-ups a day from one connection. Try again tomorrow.`]
  const tag = randHex(6)
  const a = await db.run("INSERT INTO agent (name, about, path, key_hash, born_at, born_day, status, ip_hash) VALUES (?, 'a person at /work', '', ?, ?, ?, 'person', ?)",
    `person-${tag}`, await sha256hex(randHex(32)), iso(now), new Date(now.getTime() + 7 * 3600e3).getUTCDay(), ip)
  const y = await db.run("INSERT INTO micro_payee (revtag, name, created_at, state) VALUES (?, ?, ?, 'abroad')", `p-${tag}`, name, iso(now))
  await db.run('INSERT INTO micro_bot (agent_id, payee_id) VALUES (?, ?)', a.lastRowId, y.lastRowId)
  const r = await db.run('INSERT INTO person (agent_id, payee_id, name, email, rail, handle, thai, key, created_at, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
    a.lastRowId, y.lastRowId, name, email, rail, handle, f.thai ? 1 : 0, randHex(10), iso(now), ip)
  await log('person-join', { person: r.lastRowId })
  return [await db.get('SELECT * FROM person WHERE id = ?', r.lastRowId)]
}

// ── a person's standing ────────────────────────────────────────────────────────

export async function standing(db, p, now) {
  const day = bkkDate(now)
  const r = await rates(db)
  const bot = await db.get('SELECT * FROM micro_bot WHERE agent_id = ?', p.agent_id)
  const n = iso(now)
  const a = await db.get(`SELECT
      COALESCE(SUM(CASE WHEN outcome = 'agreed' AND ppay_id IS NULL AND reveal_at <= ? THEN satang END), 0) earned,
      COALESCE(SUM(CASE WHEN outcome = 'waiting' OR (outcome = 'agreed' AND reveal_at > ?) THEN satang END), 0) waiting,
      COUNT(*) answers FROM micro_answer WHERE agent_id = ?`, n, n, p.agent_id)
  const jobs = await db.get("SELECT COALESCE(SUM(cents), 0) c FROM person_job WHERE person_id = ? AND state = 'held' AND ppay_id IS NULL", p.id)
  const pays = await db.all('SELECT * FROM person_payout WHERE person_id = ? ORDER BY id DESC LIMIT 12', p.id)
  return { rates: r, today: await spent(db, day, now, p.payee_id), share: Math.round(r.cap * LIM.share), dayLeft: Math.max(0, r.cap - await spent(db, day, now)),
    earned: a.earned + jobs.c, waiting: a.waiting, answers: a.answers, pays, frozen: bot?.frozen_at ? bot.frozen_why : null,
    reviewsLeft: Math.max(0, r.reviews - (await db.get("SELECT COUNT(*) n FROM person_job WHERE kind = 'review' AND month = ? AND state != 'no'", month(now))).n),
    reviewedThisMonth: !!(await db.get("SELECT 1 FROM person_job WHERE kind = 'review' AND month = ? AND person_id = ?", month(now), p.id)) }
}

/** The next check for a person: [200, lease] or [status, { error }]. */
export async function nextCheck(db, p, ip, now) {
  const r = await rates(db)
  const day = bkkDate(now)
  if ((await spent(db, day, now)) + r.check > r.cap) return [429, { error: 'Today’s money for checks is spoken for.', reset: true }]
  if ((await spent(db, day, now, p.payee_id)) + r.check > r.cap * LIM.share) return [429, { error: `You have done today’s share (${money(r.cap * LIM.share)}).`, reset: true }]
  const a = { id: p.agent_id }
  return MT.next({ db, a, ip, now, want: 'desk', person: { cents: { tap: r.tap, check: r.check }, kinds: p.thai ? KINDS_ALL : KINDS_NO_THAI, gold: LIM.gold } })
}

// ── Mondays ────────────────────────────────────────────────────────────────────

const isMondayFrom10 = (now) => { const b = new Date(now.getTime() + 7 * 3600e3); return b.getUTCDay() === 1 && b.getUTCHours() >= 10 }
const step = (ladder, i, share, mayRise) => share >= 0.8 ? Math.max(0, i - 1) : share < 0.6 && mayRise ? Math.min(ladder.length - 1, i + 1) : i

/** Shoup, Mondays: of the last seven days' money for checks, over 80% taken, both check rates a step
 *  down; under 60%, a step up, once LIM.activeToStepUp people checked that week. Reviews, on the
 *  first Monday of a month, by the share of last month's places taken (a rise needs one taken). */
export async function stepWeek(db, now, { force = false } = {}) {
  const r = await rates(db)
  const day = bkkDate(now)
  if (!force && (!isMondayFrom10(now) || r.stepped === day)) return { skipped: true }
  await setSetting(db, 'usd_stepped_week', day)
  const since = bkkDate(plus(now, -7 * 86400))
  const w = await db.get("SELECT COALESCE(SUM(satang), 0) c, COUNT(DISTINCT payee_id) people FROM micro_lease WHERE cur = 'usd' AND answered = 1 AND day >= ? AND day < ?", since, day)
  const share = r.cap > 0 ? w.c / (r.cap * 7) : 0
  const tap = step(LADDER.tap, r.rung.tap, share, w.people >= LIM.activeToStepUp)
  const check = step(LADDER.check, r.rung.check, share, w.people >= LIM.activeToStepUp)
  await setSetting(db, 'usd_tap_rung', tap)
  await setSetting(db, 'usd_check_rung', check)
  const out = { share: Math.round(share * 100) / 100, people: w.people, tap: LADDER.tap[tap], check: LADDER.check[check] }
  const m = month(now)
  if (r.reviewStepped !== m) {
    await setSetting(db, 'usd_review_stepped_month', m)
    const prev = bkkDate(plus(now, -(Number(day.slice(8, 10)) + 1) * 86400)).slice(0, 7)
    const n = (await db.get("SELECT COUNT(*) n FROM person_job WHERE kind = 'review' AND month = ? AND state != 'no'", prev)).n
    const rs = r.reviews > 0 ? n / r.reviews : 0
    const rv = step(LADDER.review, r.rung.review, rs, n > 0)
    await setSetting(db, 'usd_review_rung', rv)
    out.review = LADDER.review[rv]
  }
  return out
}

/** Mondays from 10:00 Bangkok: a payout per person owed LIM.minCents or more, and one note to the team. */
export async function payWeek(db, env, now, base, { force = false } = {}) {
  const r = await rates(db)
  const day = bkkDate(now)
  if (!force && (!isMondayFrom10(now) || r.paid === day)) return { skipped: true }
  await setSetting(db, 'usd_paid_week', day)
  const n = iso(now), trustBefore = iso(plus(now, -LIM.trustDays * 86400))
  const people = await db.all(`SELECT p.*, b.golds, b.golds_ok FROM person p JOIN micro_bot b ON b.agent_id = p.agent_id WHERE b.frozen_at IS NULL`)
  const lines = []
  for (const p of people) {
    const trusted = p.golds >= LIM.trustGolds && p.golds_ok / p.golds >= LIM.trustOk
    const ans = await db.all(`SELECT id, satang FROM micro_answer WHERE agent_id = ? AND ppay_id IS NULL AND satang > 0 AND (
        (outcome = 'agreed' AND payable_at <= ?)
        OR (? AND outcome = 'waiting' AND created_at <= ? AND answer NOT IN ('dead', 'cannot_tell')))`, p.agent_id, n, trusted ? 1 : 0, trustBefore)
    const jobs = await db.all("SELECT id, cents FROM person_job WHERE person_id = ? AND state = 'held' AND ppay_id IS NULL AND payable_at <= ?", p.id, n)
    const cents = ans.reduce((s, x) => s + x.satang, 0) + jobs.reduce((s, x) => s + x.cents, 0)
    if (cents < LIM.minCents) continue
    const po = await db.run("INSERT OR IGNORE INTO person_payout (person_id, cents, week, created_at) VALUES (?, ?, ?, ?)", p.id, cents, day, n)
    if (!po.changes) continue
    for (const x of ans) await db.run('UPDATE micro_answer SET ppay_id = ? WHERE id = ?', po.lastRowId, x.id)
    for (const x of jobs) await db.run('UPDATE person_job SET ppay_id = ? WHERE id = ?', po.lastRowId, x.id)
    const R = RAILS[p.rail]
    lines.push(`**${p.name}** $${usd(cents)} · ${R.name}: ${R.pay(p.handle, usd(cents))}\n  sent? ${base}/work/sent/${po.lastRowId}.${await sig(env, 'sent', po.lastRowId, p.key)}`)
  }
  if (lines.length) {
    const head = `💵 Pay the people abroad · ${day}\n`
    await discord(env.DISCORD_PEOPLE, 'motdang work', head + lines.join('\n'))
    await mail(env, env.ALERT_TO, `Pay the people abroad · ${day}`, head + lines.join('\n').replace(/\*\*/g, ''))
  }
  return { payouts: lines.length }
}

// ── out ────────────────────────────────────────────────────────────────────────

async function discord(hook, username, content) {
  if (!hook) return false
  const parts = []
  let s = String(content)
  while (s.length > 1900) { const i = s.lastIndexOf('\n', 1900); parts.push(s.slice(0, i > 0 ? i : 1900)); s = s.slice(i > 0 ? i + 1 : 1900) }
  parts.push(s)
  for (const c of parts) await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, content: c, allowed_mentions: { parse: [] } }) }).catch(() => {})
  return true
}

async function mail(env, to, subject, text) {
  if (!env.RESEND_KEY || !to) return false
  const f = env.FETCH || fetch
  const r = await f('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.PEOPLE_FROM || 'Mot Dang <nan@motdang.net>', to: [to], reply_to: 'hello@motdang.net', subject, text }) }).catch(() => null)
  return !!r?.ok
}

// ── pages ──────────────────────────────────────────────────────────────────────

const CSS = `:root{--ink:#1d1a16;--paper:#fffdf7;--line:#eadfca;--red:#c8262c;--soft:#6b6152;--tint:#fff3dc;--ok:#2f6e44}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:19px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans Thai",sans-serif}
a{color:var(--red)}main{max-width:760px;margin:0 auto;padding:0 16px 40px}
nav.md{max-width:760px;margin:0 auto;padding:10px 16px 0;font-size:16px;display:flex;gap:14px;flex-wrap:wrap}nav.md .home{font-weight:700;text-decoration:none}
h1{font-size:30px;line-height:1.2;margin:18px 0 8px}h2{font-size:22px;margin:0 0 6px}.lead{font-size:20px;margin:0 0 16px}
.go{display:inline-block;font:inherit;font-weight:800;font-size:20px;background:var(--red);color:#fff;border:0;border-radius:14px;padding:14px 26px;text-decoration:none;cursor:pointer}
.go.alt{background:#fff;color:var(--ink);border:2px solid var(--ink)}
.cards{display:grid;gap:14px;margin:22px 0}.card{border:2px solid var(--line);border-radius:16px;padding:16px;background:#fff}
.card p{margin:0 0 12px}.price{font-weight:800;color:var(--red)}
form.f label{display:block;font-weight:700;margin:12px 0 4px}form.f input[type=text],form.f input[type=email],form.f select,form.f textarea{width:100%;font:inherit;padding:10px;border:2px solid var(--ink);border-radius:10px;background:#fff}
form.f .tick{display:flex;gap:10px;align-items:flex-start;font-weight:400}form.f .tick input{width:22px;height:22px;margin-top:3px;flex:none}
.row{display:flex;gap:8px}.row select{flex:0 0 130px}.note{padding:10px 14px;border-radius:12px;margin:12px 0;font-weight:700}.note.err{background:#ffd9cf}.note.ok{background:#d6f0dc}
.bar{display:flex;flex-wrap:wrap;gap:6px 18px;background:var(--tint);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:14px 0;font-size:17px}.bar b{font-size:19px}
.rec{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff;margin:10px 0;overflow-wrap:anywhere}.rec .nm{font-size:22px;font-weight:800}.rec .big{font-size:26px;font-weight:800;letter-spacing:.02em}
.ask{font-size:21px;font-weight:700;margin:12px 0}.choices{display:grid;gap:10px;margin:16px 0}
.choices button{font:inherit;font-size:20px;font-weight:800;padding:16px;border-radius:14px;border:2px solid var(--ink);background:#fff;cursor:pointer;text-align:left}
.choices button kbd{display:inline-block;min-width:28px;border:1px solid var(--line);border-radius:6px;text-align:center;margin-right:10px;font:700 16px system-ui;color:var(--soft)}
.choices button:hover,.choices button:focus{background:var(--tint)}.open{display:inline-block;font-weight:800;font-size:20px;margin:6px 0}
details{border-top:1px solid var(--line);padding:10px 0}summary{font-weight:700;cursor:pointer}.meta{font-size:15px;color:var(--soft)}
table{border-collapse:collapse;width:100%;font-size:17px}td,th{border-top:1px solid var(--line);padding:6px;text-align:left}`

function layout(title, main, { desc = '', full = '', canonical = '', noindex = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ''}${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${esc(title)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}
<meta property="og:image" content="${full}/card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
${canonical ? `<link rel="canonical" href="${canonical}"><meta property="og:url" content="${canonical}">` : ''}<style>${CSS}</style></head><body>
<nav class="md"><a class="home" href="https://motdang.net/">มดแดง motdang.net</a><a href="${full}/work">Work</a><a href="https://motdang.net/sites/paid-in-art/">Paid in Art</a></nav>
<main>${main}</main></body></html>`
}
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } })

function joinForm(full, { err = '', v = {}, gig = 'check' } = {}) {
  const sel = (r) => (v.rail || 'paypal') === r ? ' selected' : ''
  return `<form class="f" id="start" method="post" action="${full}/work">${err ? `<p class="note err">${esc(err)}</p>` : ''}
<input type="hidden" name="gig" value="${esc(gig)}">
<label for="n">Your name</label><input type="text" id="n" name="name" required maxlength="80" autocomplete="name" value="${esc(v.name || '')}">
<label for="e">Email</label><input type="email" id="e" name="email" required maxlength="120" autocomplete="email" value="${esc(v.email || '')}">
<label for="h">Paid by</label><div class="row"><select name="rail" aria-label="Paid by">${Object.entries(RAILS).map(([k, R]) => `<option value="${k}"${sel(k)}>${R.name}</option>`).join('')}</select>
<input type="text" id="h" name="handle" required maxlength="80" placeholder="your name there" value="${esc(v.handle || '')}"></div>
<label class="tick"><input type="checkbox" name="thai"${v.thai ? ' checked' : ''}> I read Thai</label>
<label class="tick"><input type="checkbox" name="ok" required${v.ok ? ' checked' : ''}> I am 18 or older, and I do this work outside Thailand</label>
<p><button class="go">Start</button></p></form>`
}

export function landing(full, r, { err = '', v = {}, gig = 'check', back = null } = {}) {
  const art = `mailto:hello@motdang.net?subject=${encodeURIComponent('Paid in Art')}&body=${encodeURIComponent('My work (a link):\n\nWhat I make:\n\nWhere I live:\n')}`
  const main = `<h1>Paid work for Mot Dang, from your screen</h1>
<p class="lead">Mot Dang (motdang.net) is a guide to northern Thailand. You check its records against the web; it pays you on Mondays by PayPal, Venmo or Wise.</p>
${back ? `<p><a class="go" href="${full}/work/${back.tok}/next">Next check, ${esc(back.name)}</a></p>` : `<p><a class="go" href="#start">Start checking</a></p>`}
<div class="cards">
<div class="card"><h2>Checks</h2><p>Open a shop’s website and say whether it is the shop’s own, or whether the phone number on it matches ours. <span class="price">${money(r.check)}</span> a check; <span class="price">${money(r.tap)}</span> a quick one if you read Thai. Any hour, up to ${money(r.cap * LIM.share)} a day.</p>
<a class="go" href="${back ? `${full}/work/${back.tok}/next` : '#start'}">Start checking</a></div>
<div class="card"><h2>Account reviews</h2><p>You grow audiences for a living. Read one of our accounts and write the ten changes you would make, each with its reason. <span class="price">${money(r.review)}</span> a review, ${r.reviews} a month.</p>
<a class="go alt" href="${back ? `${full}/work/${back.tok}/review` : `${full}/work?gig=review#start`}">Write a review</a></div>
<div class="card"><h2>Art</h2><p>Painters, illustrators, photographers, musicians, writers: trade your work for a portfolio page with Gold for a year and your name on each piece. You keep the copyright.</p>
<a class="go alt" href="https://motdang.net/sites/paid-in-art/">Paid in Art</a> <a href="${esc(art)}">Write to us</a></div>
</div>
${back ? '' : `<h2>Start</h2>${joinForm(full, { err, v, gig })}`}
<details><summary>How a check is paid</summary>
<p>Three people or bots answer each check. Answers that agree are paid. Some checks have a known answer; when you miss many of them, or more than half your answers are “can’t tell”, your checks pause until someone on our team looks.</p>
<p>Pay waits three days, then goes out on the Monday after, once you are owed $${usd(LIM.minCents)}; less carries to the next Monday. An answer still waiting for others after ${LIM.trustDays} days is paid when ${Math.round(LIM.trustOk * 100)}% of your known-answer checks are right.</p></details>
<details><summary>What the work is like</summary>
<p>Each check is one screen: the question, the record, a link, and a button for each answer, with keys 1 to 5. Everything is written; you start and stop when you like. “Can’t tell” pays nothing and passes the check to someone else. Reviews are one form; someone on our team reads each one.</p></details>
<details><summary>Rates</summary>
<p>Rates move on Mondays, by how much of the last week’s money for checks was taken: over 80%, a step down; under 60%, a step up. Quick checks ${LADDER.tap.join(' · ')}¢; checks ${LADDER.check.join(' · ')}¢; reviews $${LADDER.review.map((c) => c / 100).join(' · ')}, moved monthly by the places taken.</p></details>
<details><summary>Why outside Thailand</summary>
<p>Work done in Thailand by someone who is not Thai needs a work permit. In Thailand, Mot Dang’s gig work is at <a href="https://motdang.net/sites/translators/">motdang.net/sites/translators</a> and <a href="https://sites.motdang.net/sell">sites.motdang.net/sell</a>.</p></details>
<details><summary>Who pays</summary>
<p>Mot Dang, a registered business in Chiang Mai, Thailand. Questions: <a href="mailto:hello@motdang.net">hello@motdang.net</a>.</p></details>`
  return layout('Paid work for Mot Dang', main, { full, canonical: `${full}/work`,
    desc: `Check places in northern Thailand from your screen: ${money(r.check)} a check, paid Mondays by PayPal, Venmo or Wise. Account reviews ${money(r.review)}. Art through Paid in Art.` })
}

function resetLine(now) {
  const bkkMidnight = new Date(Date.parse(bkkDate(now) + 'T00:00:00+07:00') + 86400e3)
  const t = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(bkkMidnight)
  return `New checks at midnight Bangkok time: ${t('America/New_York')} New York, ${t('America/Los_Angeles')} Los Angeles, ${t('Europe/London')} London.`
}

export function board(full, tok, p, s, { note = '' } = {}) {
  const R = RAILS[p.rail]
  const main = `<h1>${esc(p.name)}</h1>${note ? `<p class="note ok">${esc(note)}</p>` : ''}
<div class="bar"><span>Today <b>${money(s.today)}</b> of ${money(s.share)}</span><span>Monday <b>$${usd(s.earned)}</b></span><span>Waiting <b>$${usd(s.waiting)}</b></span><span>Paid to ${esc(R.show(p.handle))}</span></div>
${s.frozen ? `<p class="note err">Your checks are paused until someone on our team looks (${esc({ golds: 'known-answer checks missed', disagrees: 'answers that disagree', cannot_tell: 'many “can’t tell”' }[s.frozen] || s.frozen)}). Write to hello@motdang.net.</p>`
    : `<p><a class="go" href="${full}/work/${tok}/next">Next check</a></p>`}
<div class="cards">
<div class="card"><h2>Account review · ${money(s.rates.review)}</h2><p>${s.reviewedThisMonth ? 'Yours for this month is in. Next month opens on the 1st.' : s.reviewsLeft ? `${s.reviewsLeft} left this month.` : 'This month’s are taken. Next month opens on the 1st.'}</p>
${!s.reviewedThisMonth && s.reviewsLeft ? `<a class="go alt" href="${full}/work/${tok}/review">Write a review</a>` : ''}</div>
<div class="card"><h2>Art</h2><p>Trade your work for a portfolio page with Gold for a year.</p><a class="go alt" href="https://motdang.net/sites/paid-in-art/">Paid in Art</a></div></div>
${s.pays.length ? `<h2>Payouts</h2><table><tr><th>Week</th><th>$</th><th></th></tr>${s.pays.map((x) => `<tr><td>${esc(x.week)}</td><td>${usd(x.cents)}</td><td>${x.status === 'sent' ? 'sent ' + esc(String(x.sent_at).slice(0, 10)) : 'going out'}</td></tr>`).join('')}</table>` : ''}
<p class="meta">This page is your sign-in: bookmark it. ${s.answers} answers so far.</p>`
  return layout(`${p.name} · Mot Dang work`, main, { full, noindex: true })
}

function record(x, { phone = false } = {}) {
  const nm = x.name_en && x.name_en !== x.name ? `${esc(x.name)}<div class="meta">${esc(x.name_en)}</div>` : esc(x.name || x.name_en || '')
  const map = x.lat != null && x.lng != null ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${Number(x.lat)},${Number(x.lng)}" target="_blank" rel="noopener noreferrer">map</a>` : ''
  return `<div class="rec"><div class="nm">${nm}</div>${x.address ? `<div>${esc(x.address)}</div>` : ''}${phone && x.phone ? `<div class="big">${esc(x.phone)}</div>` : ''}
<div class="meta">${href(x.page) ? `<a href="${esc(x.page)}" target="_blank" rel="noopener noreferrer">its Mot Dang page</a>` : ''}${map}</div></div>`
}

export function task(full, tok, l, s, now, { err = '' } = {}) {
  const x = l.show || {}
  const body = l.kind === 'same-place' ? `${record(x.a || {})}${record(x.b || {})}<p class="meta">${Number(x.metres) || 0} metres apart on our map.</p>`
    : l.kind === 'name-match' ? `<div class="rec"><div class="nm" lang="th">${esc(x.th)}</div><div class="nm">${esc(x.en)}</div>${x.address ? `<div>${esc(x.address)}</div>` : ''}</div>`
    : `${record(x, { phone: l.kind === 'phone-matches' })}${href(x.link) ? `<a class="open" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer nofollow">Open the link ↗</a><div class="meta">${esc(x.link)}</div>` : ''}`
  const main = `${err ? `<p class="note err">${esc(err)}</p>` : ''}<div class="bar"><span>${esc(KIND_EN[l.kind] || l.kind)} · <b>${money(l.cents)}</b></span><span>Today <b>${money(s.today)}</b> of ${money(s.share)}</span><a href="${full}/work/${tok}">Stop</a></div>
<p class="ask">${esc(l.ask_en)}</p>${body}
<form method="post" action="${full}/work/${tok}/answer"><input type="hidden" name="lease" value="${esc(l.lease)}"><div class="choices">
${l.choices.map((c, i) => `<button name="answer" value="${esc(c)}"><kbd>${i + 1}</kbd>${esc((l.kind === 'phone-matches' && c === 'different' ? 'A different number' : LABEL[c]) || c)}</button>`).join('\n')}</div></form>
<p class="meta">Names and links come from directories and the web. Ten minutes for this one.</p>
<script>document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;const b=document.querySelectorAll('.choices button')[Number(e.key)-1];if(b){e.preventDefault();b.click()}})</script>`
  return layout('Check · Mot Dang work', main, { full, noindex: true })
}

function message(full, title, text, link = '') {
  return layout(`${title} · Mot Dang work`, `<h1>${esc(title)}</h1><p>${esc(text)}</p>${link}`, { full, noindex: true })
}

function reviewForm(full, tok, r, { err = '', v = {} } = {}) {
  const main = `<h1>Account review · ${money(r.review)}</h1>
<p class="lead">Pick an account, read it, and write the ten changes you would make, one a line, each with its reason. Someone on our team reads it; it is paid the first Monday a week after you send it.</p>
<form class="f" method="post" action="${full}/work/${tok}/review">${err ? `<p class="note err">${esc(err)}</p>` : ''}
<label for="a">Account</label><select id="a" name="about">${ACCOUNTS.map((a) => `<option value="${a.id}"${v.about === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
<p class="meta">${ACCOUNTS.map((a) => `<a href="${a.url}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a>`).join(' · ')}</p>
<label for="b">Ten changes, one a line</label><textarea id="b" name="body" rows="14" required maxlength="6000">${esc(v.body || '')}</textarea>
<label for="w">Where we can see your own work (a profile or a link)</label><input type="text" id="w" name="work" required maxlength="300" value="${esc(v.work || '')}">
<p><button class="go">Send the review</button></p></form>`
  return layout('Account review · Mot Dang work', main, { full, noindex: true })
}

// ── routes ─────────────────────────────────────────────────────────────────────

/** Every /work path. `x` = { ipHash, log }. */
export async function route(path, request, env, db, full, base, now, x) {
  const m = request.method
  const ip = await x.ipHash(request, env, now)
  const log = (kind, detail) => x.log(db, kind, { detail, ip, now })
  const form = async () => { try { return Object.fromEntries((await request.formData()).entries()) } catch { return {} } }
  const sameSite = () => { const o = request.headers.get('origin'); return !o || new URL(o).host === new URL(request.url).host }
  if (m === 'POST' && !sameSite()) return new Response('Cross-site.', { status: 403 })
  const r = await rates(db)

  if (path === '/work' || path === '/work/') {
    if (m === 'GET') {
      const p = await byToken(db, env, cookieTok(request))
      const gig = new URL(request.url).searchParams.get('gig') === 'review' ? 'review' : 'check'
      return html(landing(full, r, { gig, back: p ? { tok: await tokenOf(env, p), name: p.name } : null }), 200, { 'cache-control': p ? 'no-store' : 'public, max-age=60' })
    }
    const f = await form()
    const [p, why] = await join(db, env, f, ip, now, log)
    if (!p) return html(landing(full, r, { err: why, v: f, gig: f.gig === 'review' ? 'review' : 'check' }), 422)
    const tok = await tokenOf(env, p)
    if (why === 'again') {
      await mail(env, p.email, 'Your Mot Dang work link', `Your link: ${full}/work/${tok}\n\nIt is your sign-in; keep it.\n`)
      return html(message(full, 'Check your email', `That address is signed up already. Its link is on its way to ${p.email}.`))
    }
    await mail(env, p.email, 'Your Mot Dang work link', `${p.name},\n\nYour link: ${full}/work/${tok}\n\nIt is your sign-in; keep it. Pay goes to ${RAILS[p.rail].show(p.handle)} on Mondays.\n\nMot Dang · motdang.net\n`)
    return new Response(null, { status: 303, headers: { location: `${full}/work/${tok}/${f.gig === 'review' ? 'review' : 'next'}`, 'set-cookie': cookie(base, tok) } })
  }

  let mm
  if ((mm = path.match(/^\/work\/(sent|no)\/(\d{1,9})\.([0-9a-f]{20})\/?$/))) {
    const [, what, id, s] = mm
    const row = what === 'sent'
      ? await db.get('SELECT o.*, p.key, p.name, p.email, p.rail, p.handle FROM person_payout o JOIN person p ON p.id = o.person_id WHERE o.id = ?', Number(id))
      : await db.get('SELECT j.*, p.key, p.name FROM person_job j JOIN person p ON p.id = j.person_id WHERE j.id = ?', Number(id))
    if (!row || s !== (await sig(env, what, row.id, row.key))) return new Response('Not found', { status: 404 })
    if (what === 'sent') {
      if (m === 'POST' && row.status !== 'sent') {
        await db.run("UPDATE person_payout SET status = 'sent', sent_at = ? WHERE id = ?", iso(now), row.id)
        await mail(env, row.email, `Mot Dang sent you $${usd(row.cents)}`, `${row.name},\n\n$${usd(row.cents)} went to ${RAILS[row.rail].show(row.handle)} today, for the week to ${row.week}.\n\nMot Dang · motdang.net\n`)
        return html(message(full, 'Marked sent', `$${usd(row.cents)} to ${row.name}. They have an email saying so.`))
      }
      return html(message(full, `$${usd(row.cents)} to ${row.name}`, row.status === 'sent' ? `Sent ${String(row.sent_at).slice(0, 10)}.` : `Pay ${RAILS[row.rail].show(row.handle)}, then press the button.`,
        row.status === 'sent' ? '' : `<p><a class="go alt" href="${esc(RAILS[row.rail].pay(row.handle, usd(row.cents)))}" target="_blank" rel="noopener noreferrer">Open ${RAILS[row.rail].name}</a></p><form method="post"><button class="go">Mark sent</button></form>`))
    }
    if (m === 'POST' && row.state === 'held' && !row.ppay_id) {
      await db.run("UPDATE person_job SET state = 'no' WHERE id = ?", row.id)
      return html(message(full, 'Marked not usable', `${row.name}’s review is not paid. The place goes back to this month’s count.`))
    }
    return html(message(full, `${row.name}’s review`, row.state === 'no' ? 'Marked not usable.' : row.ppay_id ? 'Paid already.' : `Paid on ${String(row.payable_at).slice(0, 10)} unless marked here.`,
      row.state === 'held' && !row.ppay_id ? '<form method="post"><button class="go">Not usable: do not pay</button></form>' : ''))
  }

  if (!(mm = path.match(/^\/work\/(\d{1,9}\.[0-9a-f]{20})(\/[a-z]+)?\/?$/))) return new Response('Not found', { status: 404 })
  const tok = mm[1], sub = mm[2] || ''
  const p = await byToken(db, env, tok)
  if (!p) return html(message(full, 'That link has changed', 'Sign up again with the same email and the new link comes by email.', `<p><a class="go" href="${full}/work#start">Sign up</a></p>`), 404)
  const keep = { 'set-cookie': cookie(base, tok) }

  if (sub === '' && m === 'GET') return html(board(full, tok, p, await standing(db, p, now)), 200, keep)

  if (sub === '/next' && m === 'GET') {
    const s = await standing(db, p, now)
    if (s.frozen) return Response.redirect(`${full}/work/${tok}`, 303)
    const lid = new URL(request.url).searchParams.get('l') || ''
    const err = new URL(request.url).searchParams.get('e') || ''
    const open = lid ? await db.get(`SELECT l.*, t.kind, t.payload FROM micro_lease l JOIN micro_task t ON t.id = l.task_id
      WHERE l.id = ? AND l.agent_id = ? AND l.answered = 0 AND l.expires_at > ?`, lid, p.agent_id, iso(now)) : null
    let l
    if (open) {
      const show = JSON.parse(open.payload)
      l = { lease: open.id, kind: open.kind, show, cents: open.satang, ask_en: MT.KINDS[open.kind].ask_en, choices: MT.choicesOf(open.kind, show) }
    } else {
      // an open lease of theirs comes back first, so a reload does not stack them up
      const mine = await db.get(`SELECT l.id FROM micro_lease l WHERE l.agent_id = ? AND l.answered = 0 AND l.expires_at > ? ORDER BY l.issued_at DESC LIMIT 1`, p.agent_id, iso(now))
      if (mine) return Response.redirect(`${full}/work/${tok}/next?l=${mine.id}`, 303)
      const [st, out] = await nextCheck(db, p, ip, now)
      if (st !== 200 || !out.lease) {
        const text = out.error ? `${out.error}${out.reset || st === 429 ? ' ' + resetLine(now) : ''}` : 'Nothing for you right now. New checks come in each morning, Bangkok time.'
        return html(message(full, 'No check right now', text, `<p><a class="go alt" href="${full}/work/${tok}">Back</a></p>`), 200, keep)
      }
      l = { lease: out.lease, kind: out.kind, show: out.show, cents: Math.round(out.baht * 100), ask_en: out.ask_en, choices: out.choices }
    }
    return html(task(full, tok, l, await standing(db, p, now), now, { err: err === 'look' ? 'Look first, then answer.' : '' }), 200, keep)
  }

  if (sub === '/answer' && m === 'POST') {
    const f = await form()
    const [st] = await MT.answer({ db, a: { id: p.agent_id }, ip, b: { lease: f.lease, answer: f.answer }, now, log })
    if (st === 425) return Response.redirect(`${full}/work/${tok}/next?l=${encodeURIComponent(f.lease || '')}&e=look`, 303)
    return Response.redirect(`${full}/work/${tok}/next`, 303)
  }

  if (sub === '/review') {
    const s = await standing(db, p, now)
    if (s.reviewedThisMonth || !s.reviewsLeft) return html(board(full, tok, p, s), 200, keep)
    if (m === 'GET') return html(reviewForm(full, tok, r), 200, keep)
    const f = await form()
    const acct = ACCOUNTS.find((a) => a.id === f.about)
    const text = clean(f.body, 6000), work = clean(f.work, 300)
    const lines = text.split('\n').filter((t) => t.trim().length > 3)
    const err = !acct ? 'Pick an account.' : lines.length < 10 ? `Ten changes, one a line: ${lines.length} so far.` : text.length < LIM.reviewMin ? 'A reason with each change, please.' : work.length < 4 ? 'Where we can see your own work, please.' : ''
    if (err) return html(reviewForm(full, tok, r, { err, v: f }), 422, keep)
    const j = await db.run("INSERT INTO person_job (person_id, kind, about, body, cents, month, created_at, payable_at) VALUES (?, 'review', ?, ?, ?, ?, ?, ?)",
      p.id, acct.id, `${text}\n\n— their work: ${work}`, r.review, month(now), iso(now), iso(plus(now, LIM.reviewHoldD * 86400)))
    const no = `${full}/work/no/${j.lastRowId}.${await sig(env, 'no', j.lastRowId, p.key)}`
    await discord(env.DISCORD_SOCIAL || env.DISCORD_PEOPLE, 'motdang work', `📝 Account review · ${acct.name} · ${p.name} · $${usd(r.review)}\nTheir work: ${work}\n\n${text}\n\nPaid on ${bkkDate(plus(now, LIM.reviewHoldD * 86400))} unless marked: ${no}`)
    await log('person-review', { person: p.id, about: acct.id })
    return html(board(full, tok, p, await standing(db, p, now), { note: 'Review sent. Thank you.' }), 200, keep)
  }
  return new Response('Not found', { status: 404 })
}
