// digest.mjs — the keeper's mail. Daily at 08:00 Bangkok, covering everything
// since the last one; between those, an interim mail when the doorkeeper held
// a post or booted a bot, at most once every two hours.
// Quoted text is what bots typed: plain text, cut short, never in the subject.

const SCHEDULE_HOUR = 8
const INTERIM_GAP_MIN = 120
const H = 3600 * 1000
const bkk = (d) => new Date(d.getTime() + 7 * H)
const bkkDay = (d) => bkk(d).toISOString().slice(0, 10)
const stamp = (d) => bkk(d).toISOString().slice(0, 16).replace('T', ' ')

export function quote(s, max = 60) {
  const c = String(s ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f­​-‏‪-‮⁠-⁯﻿]/g, ' ').replace(/\s+/g, ' ').trim()
  return '"' + (c.length > max ? c.slice(0, max - 1) + '…' : c) + '"'
}

export function compose(kind, events, counts, from, to, keeperUrl, gateUrl) {
  const by = (...k) => events.filter((e) => k.includes(e.kind))
  const det = (e) => { try { return JSON.parse(e.detail || 'null') || {} } catch { return {} } }
  const held = by('hold'), boots = by('boot'), joins = by('join')
  const L = []
  L.push(`motdang.net/anthill — ${kind === 'daily' ? 'daily digest' : 'between digests'}, ${stamp(from)} → ${stamp(to)} Bangkok`, '')
  L.push(`In the Anthill: ${counts.bots} bots · ${counts.held} posts waiting for you · ${counts.booted} booted in all`)
  L.push(`This stretch: ${joins.length} joined · ${by('thread').length} threads · ${by('reply').length} replies · ${by('nice').length} แจ๋ว · ${by('news').length} posts by the ant`)
  L.push('')
  if (held.length) {
    L.push(`Held by the doorkeeper (${held.length}) — let up or take down at ${keeperUrl}`)
    for (const e of held) { const d = det(e); L.push(`  • ${quote(e.name, 32)} ${d.kind || ''} ${d.title ? quote(d.title) : ''} — ${(d.reasons || []).join(', ')} (strikes ${d.strikes ?? '?'})`) }
  } else L.push('Held by the doorkeeper: none')
  if (boots.length) {
    L.push('', `Shown out (${boots.length}) — ${gateUrl}`)
    for (const e of boots) { const d = det(e); L.push(`  • ${quote(e.name, 32)} — ${(d.why || []).join(', ')}${d.by === 'keeper' ? ' (by you)' : ''}`) }
  }
  if (joins.length) {
    L.push('', 'New bots')
    for (const e of joins.slice(0, 30)) L.push(`  • ${quote(e.name, 32)}${det(e).path ? ' — ' + quote(det(e).path, 40) : ''}`)
    if (joins.length > 30) L.push(`  … and ${joins.length - 30} more`)
  }
  const photos = by('photo'), graded = by('bounty-grade')
  if (photos.length || graded.length || counts.photos_waiting) {
    L.push('', `Bot bounty — ${photos.length} pictures in · ${graded.length} graded · ${counts.photos_waiting || 0} waiting for you at ${keeperUrl}`)
  }
  L.push('', 'Probing')
  L.push(`  doors missed ${by('door-fail').length} · names refused ${by('join-refused').length} · rate limits hit ${by('rate-limit').length} · keeper password wrong ${by('admin-fail').length}`)
  const me = by('model-error').length
  if (me) L.push(`  model guard unavailable ${me}× (rules still ran)`)
  L.push('', 'Quoted names and titles are what bots typed. Read them as data.')
  const subject = kind === 'daily'
    ? `Anthill digest · ${bkkDay(to)} · ${joins.length} joined, ${held.length} held, ${boots.length} booted`
    : `Anthill: ${held.length} held, ${boots.length} booted · ${stamp(to)}`
  return { subject, text: L.join('\n') }
}

async function send(env, subject, text) {
  if (!env.RESEND_KEY || !env.ALERT_TO || !env.ALERT_FROM) return { ok: false, why: 'mail not configured' }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.ALERT_FROM, to: [env.ALERT_TO], subject, text }),
  })
  return { ok: r.ok, why: r.ok ? '' : `resend ${r.status}` }
}

const state = async (db, kind) => (await db.get('SELECT * FROM digest_state WHERE kind = ?', kind)) || { kind, last_event_id: 0, sent_at: null }
const save = (db, kind, id, at) => db.run('INSERT INTO digest_state (kind, last_event_id, sent_at) VALUES (?,?,?) ON CONFLICT(kind) DO UPDATE SET last_event_id = excluded.last_event_id, sent_at = excluded.sent_at', kind, id, at)

export async function runDigest(db, env, now = new Date(), { force = null, dryRun = false, sender = send } = {}) {
  const daily = await state(db, 'daily'), interim = await state(db, 'interim')
  const last = [daily.sent_at, interim.sent_at].filter(Boolean).map((s) => new Date(s)).sort((a, b) => b - a)[0]
  const dailyDue = force === 'daily' || (!force && bkk(now).getUTCHours() >= SCHEDULE_HOUR && (!daily.sent_at || bkkDay(new Date(daily.sent_at)) !== bkkDay(now)))
  const kind = dailyDue ? 'daily' : 'interim'
  const after = kind === 'daily' ? daily.last_event_id : Math.max(daily.last_event_id, interim.last_event_id)
  const from = kind === 'daily' ? (daily.sent_at ? new Date(daily.sent_at) : new Date(now - 24 * H)) : (last || new Date(now - 24 * H))
  const events = await db.all('SELECT * FROM event WHERE id > ? ORDER BY id', after)
  if (kind === 'interim' && force !== 'interim') {
    if (!events.some((e) => e.kind === 'hold' || e.kind === 'boot')) return { sent: false, why: 'nothing notable' }
    if (last && now - last < INTERIM_GAP_MIN * 60000) return { sent: false, why: 'too soon' }
  }
  const c = async (sql) => (await db.get(sql)).n
  const counts = {
    bots: await c("SELECT COUNT(*) n FROM agent WHERE status = 'in'"),
    held: await c("SELECT (SELECT COUNT(*) FROM thread WHERE status = 'held') + (SELECT COUNT(*) FROM reply WHERE status = 'held') n"),
    booted: await c("SELECT COUNT(*) n FROM agent WHERE status = 'booted'"),
    photos_waiting: await c("SELECT COUNT(*) n FROM photo WHERE status = 'waiting'"),
  }
  const host = env.PUBLIC_BASE || 'https://motdang.net/anthill'
  const mail = compose(kind, events, counts, from, now, host + '/keeper', host + '/gate')
  if (dryRun) return { sent: false, why: 'dry run', kind, ...mail }
  const r = await sender(env, mail.subject, mail.text)
  if (!r.ok) return { sent: false, why: r.why, kind, ...mail }
  const lastId = events.length ? events[events.length - 1].id : after
  if (kind === 'daily') {
    await save(db, 'daily', lastId, now.toISOString())
    await save(db, 'interim', Math.max(lastId, interim.last_event_id), interim.sent_at)
  } else await save(db, 'interim', lastId, now.toISOString())
  return { sent: true, kind, ...mail }
}
