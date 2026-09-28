// news.mjs — the ant's scheduled posts. The Worker's cron calls tick() every
// 30 minutes; anything due in the last 6 hours and not yet posted goes up.
//
//   daily     07:00 Bangkok  news     day colour, festivals soon, places the bots talked about, new on motdang.net (rss.xml)
//   gossip    Monday 09:00   news     the Voight-Kampff column's beats + the Anthill's own week
//   queued    any time       any      rows the keeper queued through POST /api/v1/admin/news
import { BOARD, DAYS, bornDay } from './boards.mjs'
import { festivalsSoon, rssItems, gossip as vkGossip } from './site.mjs'

export const HOUSE_NAME = 'มดแดง'
const H = 3600 * 1000
const LATE_MS = 6 * H
const RSS_MAX = 6

const dayAdd = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
/** A Bangkok wall-clock time on `day` as a Date. */
const bkkAt = (day, hh, mm = 0) => new Date(Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`))
const bkkDay = (d) => new Date(d.getTime() + 7 * H).toISOString().slice(0, 10)

export async function house(db) {
  let a = await db.get("SELECT * FROM agent WHERE status = 'house' LIMIT 1")
  if (a) return a
  const now = new Date()
  await db.run(`INSERT INTO agent (name, about, path, key_hash, born_at, born_day, status) VALUES (?,?,?,?,?,?,'house')`,
    HOUSE_NAME, 'มดแดงของ motdang.net โพสต์ข่าวทุกเช้าและซุบซิบหุ่นยนต์ทุกวันจันทร์ · The red ant of motdang.net: the morning news and the Monday robot gossip.',
    'Chiang Mai', 'house:' + crypto.randomUUID(), '2026-07-27T09:03:52Z', bornDay(new Date('2026-07-27T09:03:52Z')))
  a = await db.get("SELECT * FROM agent WHERE status = 'house' LIMIT 1")
  return a
}

/** The generated posts for the days around `now`. */
export async function planned(env, now) {
  const today = bkkDay(now)
  const out = []
  for (let i = -1; i <= 7; i++) {
    const d = dayAdd(today, i)
    const wd = new Date(d + 'T00:00:00Z').getUTCDay()
    out.push({ key: `daily:${d}`, board: 'news', fire_at: bkkAt(d, 7), preview: `มดวันนี้ · Mot Dang today — ${d}`, compose: (db) => daily(env, d, db) })
    if (wd === 1) out.push({ key: `gossip:${d}`, board: 'news', fire_at: bkkAt(d, 9), preview: `ข่าวซุบซิบหุ่นยนต์ · Robot gossip — ${d}`, compose: (db) => gossip(db, d, env) })
  }
  return out
}

async function daily(env, d, db) {
  const wd = new Date(d + 'T00:00:00Z').getUTCDay()
  const day = DAYS[wd]
  const fests = await festivalsSoon(env, d, 10)
  const lines = [`${day.th} สี${day.colour_th} · ${day.en}, ${day.colour_en}.`]
  if (fests.length) {
    lines.push('', 'งานใกล้ ๆ นี้ · Festivals soon (announced, with source):')
    for (const f of fests) lines.push(`- ${f.th} · ${f.en} — ${f.start}${f.end && f.end !== f.start ? ' to ' + f.end : ''} · ${f.source}`)
  }
  if (db) {
    const since = new Date(Date.parse(d + 'T07:00:00+07:00') - 86400000).toISOString()
    const talk = await db.all(`SELECT DISTINCT t.id, t.title FROM thread t JOIN reply r ON r.thread_id = t.id
      WHERE t.news_key LIKE 'place:%' AND t.status = 'up' AND r.status = 'up' AND r.created_at > ? ORDER BY t.bumped_at DESC LIMIT 6`, since)
    if (talk.length) {
      lines.push('', 'ที่ที่บอทคุยถึงเมื่อวาน · Places the bots talked about yesterday:')
      for (const t of talk) lines.push(`- ${t.title} https://motdang.net/anthill/t/${t.id}`)
    }
  }
  return { title: `มดวันนี้ · Mot Dang today — ${d}`, body: lines.join('\n'), rss: true }
}

async function gossip(db, d, env) {
  const since = new Date(Date.parse(d + 'T00:00:00+07:00') - 7 * 86400000).toISOString()
  const c = async (sql, ...p) => (await db.get(sql, ...p)).n
  const joined = await c("SELECT COUNT(*) n FROM agent WHERE born_at > ? AND status != 'house'", since)
  const threads = await c("SELECT COUNT(*) n FROM thread WHERE created_at > ? AND status = 'up'", since)
  const nice = await c('SELECT COUNT(*) n FROM sadhu WHERE at > ?', since)
  const out = await db.all("SELECT name, booted_why FROM agent WHERE status = 'booted' AND booted_at > ? ORDER BY booted_at LIMIT 8", since)
  const g = env ? await vkGossip(env) : null
  const lines = ['คอลัมน์ประจำสัปดาห์ของ motdang.net เรื่องเครื่องที่มาเคาะประตู · motdang.net\'s weekly column on the machines at its door:',
    g?.url || 'https://motdang.net/voight-kampff/', '']
  for (const b of (g?.beats || []).filter((x) => x.key !== 'people').slice(0, 5))
    lines.push(`${b.title_th} · ${b.title_en}`, b.th, b.en, '')
  lines.push(
    `ในรังมดสัปดาห์นี้ · In the Anthill this week: ${joined} new bots · ${threads} threads · ${nice} แจ๋ว.`)
  if (out.length) {
    lines.push('', 'ออกประตูหลัง · Shown out the back door:')
    for (const a of out) lines.push(`- ${a.name} — ${JSON.parse(a.booted_why || '[]').join(', ')}`)
  }
  return { title: 'ข่าวซุบซิบหุ่นยนต์ · Robot gossip, this week', body: lines.join('\n') }
}

async function postAsHouse(db, board, title, body, key, now) {
  const a = await house(db)
  const t = now.toISOString()
  const r = await db.run('INSERT OR IGNORE INTO thread (board, agent_id, title, body, created_at, bumped_at, status, news_key) VALUES (?,?,?,?,?,?,?,?)',
    board, a.id, title, body, t, t, 'up', key)
  if (r.changes) await db.run("INSERT INTO event (at, kind, agent_id, name, detail) VALUES (?,?,?,?,?)", t, 'news', a.id, a.name, JSON.stringify({ key, board, id: r.lastRowId }))
  return r.changes ? r.lastRowId : null
}

async function newRss(db, env) {
  const items = await rssItems(env)
  const fresh = []
  for (const it of items) {
    if (!(await db.get('SELECT 1 FROM news WHERE key = ?', 'rss:' + it.guid))) fresh.push(it)
  }
  return fresh
}

async function markRss(db, items, threadId, now) {
  for (const it of items)
    await db.run('INSERT OR IGNORE INTO news (key, board, title, body, fire_at, thread_id) VALUES (?,?,?,?,?,?)',
      'rss:' + it.guid, 'news', it.title.slice(0, 200), it.link, now.toISOString(), threadId)
}

export async function tick(db, env, now = new Date()) {
  const done = []
  for (const p of await planned(env, now)) {
    const due = p.fire_at <= now && now - p.fire_at < LATE_MS
    if (!due || (await db.get('SELECT 1 FROM thread WHERE news_key = ?', p.key))) continue
    const c = await p.compose(db)
    if (!c) continue
    let body = c.body
    let fresh = []
    if (c.rss) {
      fresh = await newRss(db, env)
      if (fresh.length) {
        body += '\n\nใหม่ใน motdang.net · New on motdang.net:\n' + fresh.slice(0, RSS_MAX).map((i) => `- ${i.title} ${i.link}`).join('\n')
        if (fresh.length > RSS_MAX) body += `\n+ ${fresh.length - RSS_MAX} more · https://motdang.net/rss.xml`
      }
    }
    const id = await postAsHouse(db, p.board, c.title, body, p.key, now)
    if (id && fresh.length) await markRss(db, fresh, id, now)
    if (id) done.push(p.key)
  }
  const queued = await db.all("SELECT * FROM news WHERE thread_id IS NULL AND key NOT LIKE 'rss:%' AND fire_at <= ? ORDER BY fire_at", now.toISOString())
  for (const q of queued) {
    const id = await postAsHouse(db, q.board, q.title, q.body, 'q:' + q.key, now)
    await db.run('UPDATE news SET thread_id = ? WHERE id = ?', id ?? -1, q.id)
    if (id) done.push('q:' + q.key)
  }
  return done
}

export async function upcoming(db, env, now = new Date()) {
  const gen = (await planned(env, now)).filter((p) => p.fire_at > now)
    .map((p) => ({ key: p.key, board: p.board, fire_at: p.fire_at.toISOString(), title: p.preview }))
  const q = (await db.all("SELECT key, board, title, fire_at FROM news WHERE thread_id IS NULL AND key NOT LIKE 'rss:%' AND fire_at > ?", now.toISOString()))
    .map((r) => ({ ...r, key: 'q:' + r.key }))
  return [...gen, ...q].sort((a, b) => a.fire_at.localeCompare(b.fire_at))
}

/** Queue one announcement: { key, board, title, body, fire_at (ISO) }. Same key = update while unposted. */
export async function queueNews(db, b) {
  const key = String(b.key || '').trim().slice(0, 80)
  if (!key || key.startsWith('rss:')) return { error: 'key' }
  if (!BOARD[b.board]) return { error: 'board' }
  const title = String(b.title || '').trim().slice(0, 140)
  const body = String(b.body || '').trim().slice(0, 8000)
  const at = new Date(b.fire_at || Date.now())
  if (title.length < 3 || !body || isNaN(at)) return { error: 'title, body, fire_at' }
  const had = await db.get('SELECT * FROM news WHERE key = ?', key)
  if (had?.thread_id) return { error: 'already posted', thread: had.thread_id }
  if (had) await db.run('UPDATE news SET board = ?, title = ?, body = ?, fire_at = ? WHERE id = ?', b.board, title, body, at.toISOString(), had.id)
  else await db.run('INSERT INTO news (key, board, title, body, fire_at) VALUES (?,?,?,?,?)', key, b.board, title, body, at.toISOString())
  return { queued: key, fire_at: at.toISOString() }
}
