// micro-tasks.mjs — builds microtasks from the mot-dang working tree and,
// with ADMIN_KEY set, loads them into the Anthill in batches.
//
//   node scripts/micro-tasks.mjs [out.json] [--per-kind 3000] [--abroad 1000] [--gold-fetch 300] [--load]
//
// With --load it first reads what the Anthill has settled: those records drop
// out, their answers land in mot-dang/data/micro_answers.json, and kinds that
// are nearly done sink. Each ordinary task gets a priority from its record
// (featured or a landmark, imported in the last 30 days, few facts held);
// the top --per-kind of each kind go out (--abroad of link-belongs and
// phone-matches, the two people abroad can do), equal priorities in a fixed
// order so the same ones stay out from day to day. Open tasks nobody has started
// that fell out of the top are retired; loaded again later, they open again.
// launchd net.motdang.microtasks runs this daily.
//
// Kinds and their gold tasks (known answers, about one in ten):
//   link-belongs   own website, link checked ok        gold "dead": the domain no longer resolves
//                                                      gold "yes" / "no": the site, fetched, shows the record's phone
//                                                      (src/micro-gold.mjs); "no" shows another record with it
//   phone-matches  phone + own website, link ok        gold "dead": same; "yes" / "different" from the same pages
//                  A link's status is data/linkhealth.json's, or the checker's cache/linkhealth/ verdict when the
//                  morning's bounded check left it out of the file.
//   same-place     two records within 40 m, names alike gold "different": one name, 3 km or more apart
//   name-match     a record's Thai and English names
//                                                      gold "yes": landmarks; gold "no": names swapped across records
//   note           one question from a place's list in mot-dang data/facets.json, or what its toilet costs
//                  (the toilet rows live at motdang.net/data/toilets.json), for places nobody owns: no own
//                  page (data/curated/own_pages.json), no claim, not confirmed by the business. Trades are
//                  asked only where there is a phone to call. Places with the most questions open go first.
//                                                      gold: her own answers in data/curated/enrich.json (field)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { goldsFrom, pagePhones, phoneKey, phonesIn, stable } from '../src/micro-gold.mjs'

const MD = new URL('../../mot-dang/', import.meta.url)
const args = process.argv.slice(2)
const out = args.find((a) => a.endsWith('.json')) || 'micro-tasks.json'
const opt = (k, d) => args.includes(k) ? Number(args[args.indexOf(k) + 1]) || d : d
const per = opt('--per-kind', 3000)
const abroad = opt('--abroad', 1000)
const PER = { 'link-belongs': abroad, 'phone-matches': abroad }
const load = args.includes('--load')
const API = process.env.ANTHILL || 'https://motdang.net/anthill/api/v1'
const KEY = process.env.ADMIN_KEY || (() => {
  try { return JSON.parse(readFileSync(homedir() + '/.config/nanobotco/keys.json', 'utf8')).sala.admin_key } catch { return '' }
})()
async function adm(body) {
  const r = await fetch(API + '/admin/micro', { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`admin ${body.do} ${r.status} ${await r.text()}`)
  return r.json()
}
if (load && !KEY) throw new Error('ADMIN_KEY, or sala.admin_key in ~/.config/nanobotco/keys.json')

// what the Anthill has settled already
const ANSWERS = new URL('data/micro_answers.json', MD)
let done = { answers: [] }
try { done = JSON.parse(readFileSync(ANSWERS, 'utf8')) } catch {}
let counts = []
if (load) {
  const s = await adm({ do: 'settled' })
  const seen = new Set(done.answers.map((a) => a.kind + ' ' + a.source))
  for (const a of s.settled) if (!seen.has(a.kind + ' ' + a.source)) done.answers.push(a)
  counts = s.counts
  writeFileSync(ANSWERS, JSON.stringify({ generated: new Date().toISOString(), note: 'Settled microtask answers from the Anthill: the majority of three bots on different payees.', answers: done.answers }, null, 1))
}
const settledSrc = new Set(done.answers.map((a) => a.kind + ' ' + a.source))
// a kind nearly done sinks: 40 points while nothing is settled, fewer as answers come in
const kindNeed = (kind, open) => {
  const n = done.answers.filter((a) => a.kind === kind).length
  return Math.round(40 * open / Math.max(1, open + n))
}
const DAY = 86400000
const recPriority = (r) => (r.featured || r.landmark ? 25 : 0) + (Date.now() - Date.parse(r.updatedAt || 0) < 30 * DAY ? 15 : 0) + Math.max(0, 9 - (r.antRank ?? 9)) * 3

const health = JSON.parse(readFileSync(new URL('data/linkhealth.json', MD), 'utf8')).links
const recs = []
for (const prov of readdirSync(new URL('docs/', MD)).filter((d) => /^[a-z]{2,6}$/.test(d))) {
  let files
  try { files = readdirSync(new URL(`docs/${prov}/p/`, MD)).filter((f) => f.endsWith('.json')) } catch { continue }
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(new URL(`docs/${prov}/p/${f}`, MD), 'utf8'))
      r._page = `https://motdang.net/${prov}/p/${f.replace(/\.json$/, '')}.html`
      recs.push(r)
    } catch {}
  }
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const STOP = new Set(['the', 'and', 'of', 'house', 'shop', 'home', 'cafe', 'coffee', 'restaurant', 'hotel', 'resort', 'chiang', 'mai', 'rai', 'co', 'ltd', 'thai', 'ร้าน', 'บ้าน', 'เชียงใหม่', 'เชียงราย'])
const toks = (r) => new Set([r.name, r.nameTh, r.nameEn].flatMap((n) => norm(n).split(' ')).filter((t) => t.length > 2 && !STOP.has(t)))
// names the build wrote from a category and a distance ("Parking · 130 m from …")
const made = (r) => [r.name, r.nameTh, r.nameEn].some((n) => / · /.test(n || ''))
const show = (r) => ({ name: r.name || '', name_th: r.nameTh || '', name_en: r.nameEn || '', address: r.address || '',
  lat: r.lat ?? null, lng: r.lng ?? null, page: r._page })
const shuffle = (xs) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]] } return xs }
const take = (xs, n) => shuffle(xs).slice(0, n)
const byPriority = (k) => (a, b) => b[k] - a[k] || stable(a.source) - stable(b.source)
const tasks = []
const keep = {}, keepGold = {}
const push = (kind, ordinary, golds) => {
  const fresh = ordinary.filter((t) => !settledSrc.has(kind + ' ' + t.source))
  const need = kindNeed(kind, fresh.length)
  for (const t of fresh) t.priority = need + t._p
  const o = fresh.sort(byPriority('priority')).slice(0, PER[kind] || per)
  for (const t of o) delete t._p
  keep[kind] = o.map((t) => t.source)
  // golds as a function: (how many) → the golds, all of them chosen
  const g = typeof golds === 'function' ? golds(Math.max(10, Math.round(o.length / 9))) : take(golds, Math.max(10, Math.round(o.length / 9)))
  if (typeof golds === 'function') keepGold[kind] = g.map((t) => t.source)
  tasks.push(...o, ...g.map((t) => { delete t._p; return t }))
}

// check_links.py --max writes only what it checked or still holds fresh; the rest waits in its cache
const LHC = new URL('cache/linkhealth/', MD)
const status = (u) => {
  if (health[u]) return health[u].status
  try { return JSON.parse(readFileSync(new URL(createHash('sha1').update(u).digest('hex') + '.json', LHC), 'utf8')).status } catch { return undefined }
}
const withSite = recs.filter((r) => r.website)
const okSite = withSite.filter((r) => status(r.website) === 'ok')
const deadGold = (kind, extra) => withSite.filter((r) => status(r.website) === 'dns' && (kind === 'link-belongs' || r.phone))
  .map((r) => ({ kind, source: r.id, gold: 'dead', show: { ...show(r), ...extra(r), link: r.website } }))
const dead = { 'link-belongs': deadGold('link-belongs', () => ({})), 'phone-matches': deadGold('phone-matches', (r) => ({ phone: r.phone })) }

// golds read from the sites themselves: a page fetched in the last 14 days, kept in a cache
const PAGES = homedir() + '/Library/Caches/motdang-micro-gold-pages.json'
const FRESH = 14 * DAY
let pageCache = {}
try { pageCache = JSON.parse(readFileSync(PAGES, 'utf8')) } catch {}
const cands = okSite.filter((r) => r.phone && phonesIn(r.phone).length === 1 && !made(r))
  .map((r) => ({ id: r.id, phone: r.phone, link: r.website, show: show(r), words: [...toks(r)] }))
const UA = 'MotDangLinkCheck/1.0 (+https://motdang.net/reach.html; link health for a local directory)'
async function readPage(link) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000)
  try {
    const r = await fetch(/^https?:/i.test(link) ? link : 'http://' + link, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: ac.signal })
    if (!r.ok) return { at: Date.now(), status: r.status, phones: [] }
    const html = new TextDecoder().decode((await r.arrayBuffer()).slice(0, 1500000))
    return { at: Date.now(), status: r.status, phones: pagePhones(html) }
  } catch (e) { return { at: Date.now(), status: 'error', phones: [] } } finally { clearTimeout(t) }
}
const stale = cands.filter((c) => !(Date.now() - (pageCache[c.link]?.at || 0) < FRESH)).sort((a, b) => stable(a.id) - stable(b.id)).slice(0, opt('--gold-fetch', 300))
for (let i = 0; i < stale.length; i += 8) {
  await Promise.all(stale.slice(i, i + 8).map(async (c) => { pageCache[c.link] = await readPage(c.link) }))
}
if (stale.length) writeFileSync(PAGES, JSON.stringify(pageCache))
const pages = new Map(Object.entries(pageCache).filter(([, v]) => Date.now() - v.at < FRESH && v.status === 200))
const fromSites = (kind) => (n) => goldsFrom(cands, pages, n, dead)[kind]

push('link-belongs',
  okSite.map((r) => ({ kind: 'link-belongs', source: r.id, _p: recPriority(r), show: { ...show(r), link: r.website } })),
  fromSites('link-belongs'))
push('phone-matches',
  okSite.filter((r) => r.phone).map((r) => ({ kind: 'phone-matches', source: r.id, _p: recPriority(r) + 5, show: { ...show(r), phone: r.phone, link: r.website } })),
  fromSites('phone-matches'))
console.log('pages read', stale.length, 'fresh', pages.size, 'phone on its own site', goldsFrom(cands, pages, 0, {}).found)

// same-place: a 40 m neighbourhood on a grid
const alike = (a, b) => { const A = toks(a), B = toks(b); let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.max(1, Math.min(A.size, B.size)) }
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180))
const geo = recs.filter((r) => r.lat != null && r.lng != null && r.geoPrecision === 'exact' && !made(r))
const cell = (r) => `${Math.floor(r.lat / 0.0004)}:${Math.floor(r.lng / 0.0004)}`
const grid = new Map()
for (const r of geo) { const k = cell(r); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r) }
const pairs = []
for (const r of geo) {
  const [y, x] = cell(r).split(':').map(Number)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const s of grid.get(`${y + dy}:${x + dx}`) || []) {
    if (s.id <= r.id || metres(r, s) > 40 || alike(r, s) < 0.5) continue
    pairs.push({ kind: 'same-place', source: `${r.id}|${s.id}`, _p: Math.max(recPriority(r), recPriority(s)), show: { a: show(r), b: show(s), metres: Math.round(metres(r, s)) } })
  }
}
const byName = new Map()
for (const r of geo) { const n = norm(r.name); if (n.length > 3) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(r) } }
const far = []
for (const rs of byName.values()) if (rs.length > 1) {
  const [r, s] = take([...rs], 2)
  if (metres(r, s) >= 3000) far.push({ kind: 'same-place', source: `${r.id}|${s.id}`, gold: 'different', show: { a: show(r), b: show(s), metres: Math.round(metres(r, s)) } })
}
push('same-place', pairs, far)

// name-match
const both = recs.filter((r) => r.nameTh && r.nameEn && norm(r.nameTh) !== norm(r.nameEn) && !made(r))
const ord = both.filter((r) => !r.landmark)
  .map((r) => ({ kind: 'name-match', source: r.id, _p: recPriority(r), show: { th: r.nameTh, en: r.nameEn, address: r.address || '', page: r._page } }))
const yes = both.filter((r) => r.landmark).map((r) => ({ kind: 'name-match', source: r.id, gold: 'yes', show: { th: r.nameTh, en: r.nameEn, address: r.address || '', page: r._page } }))
const pool = shuffle([...both])
const no = pool.slice(0, 2000).map((r, i) => [r, pool[(i + 1) % pool.length]])
  .filter(([r, s]) => r.id !== s.id && alike({ name: s.nameEn }, { name: r.nameEn }) === 0)
  .map(([r, s]) => ({ kind: 'name-match', source: `${r.id}~${s.id}`, gold: 'no', show: { th: r.nameTh, en: s.nameEn, address: r.address || '', page: r._page } }))
push('name-match', ord, [...yes, ...take(no, yes.length || 50)])

// note: a question about a place nobody owns. Nan, 2026-10-16: "Pay microtasks
// only for places nobody owns, completeness everywhere else."
const FACETS = JSON.parse(readFileSync(new URL('data/facets.json', MD), 'utf8')).sets
const byPair = new Map(), bySub = new Map(), byCat = new Map()
for (const fs of FACETS) {
  for (const x of fs.appliesToPair || []) byPair.set(x, fs)
  for (const x of fs.appliesTo || []) bySub.set(x, fs)
  for (const x of fs.appliesToCat || []) byCat.set(x, fs)
}
const list = (v) => Array.isArray(v) ? v : v ? [v] : []
// build.py facet_set_of(): a cat/sub pair, then a sub, then a cat
const setOf = (r) => {
  for (const c of list(r.cat)) for (const x of list(r.sub)) if (byPair.has(`${c}/${x}`)) return byPair.get(`${c}/${x}`)
  for (const x of list(r.sub)) if (bySub.has(x)) return bySub.get(x)
  for (const c of list(r.cat)) if (byCat.has(c)) return byCat.get(c)
  return null
}
const ownPages = (() => { try { return JSON.parse(readFileSync(new URL('data/curated/own_pages.json', MD), 'utf8')).matched || [] } catch { return [] } })()
const claims = (() => { try { return JSON.parse(readFileSync(new URL('data/claims.json', MD), 'utf8')).claims || {} } catch { return {} } })()
const owned = new Set([...ownPages.map((m) => m.place), ...Object.keys(claims), ...recs.filter((r) => r.confirmedAt || r.claim || r.attrs?.ownPage).map((r) => r.id)])
const seenFacet = (r, k) => { const v = (r.facets || r.attrs?.facets || {})[k]; return v === 'field' || v === 'site' }
// the ones she named first: parking, toilets, plumbers who keep their own hours
const NAMED = new Set(['parking', 'trades'])
const notes = []
for (const r of recs) {
  if (owned.has(r.id) || made(r)) continue
  const fs = setOf(r)
  if (!fs) continue
  const call = fs.key === 'trades'
  if (call && !r.phone) continue
  const open = fs.facets.filter((f) => !seenFacet(r, f.key))
  const p = recPriority(r) + Math.round(10 * open.length / fs.facets.length)
  for (const f of open) notes.push({ kind: 'note', source: `${r.id}#${f.key}`, _p: p, _named: NAMED.has(fs.key),
    show: { ...show(r), ...(r.phone ? { phone: r.phone } : {}), how: call ? 'call' : 'go or call', about_th: f.th, about_en: f.en, ask_th: f.ask_th, ask_en: f.ask_en } })
}
// what the toilet costs, at the places /toilets.html sends people to
const TOILET = { ask_th: 'ห้องน้ำที่นี่ให้คนทั่วไปเข้าได้ เข้ากี่บาท ถ้าไม่มีให้เข้า ตอบ none', ask_en: 'What does it cost to use the toilet here? If there is none you can use, answer none.',
  choices: ['free', '3', '5', '10', '20', 'none'], how: 'go' }
let loo = []
try {
  const t = await (await fetch('https://motdang.net/data/toilets.json')).json()
  const col = Object.fromEntries(t.columns.map((c, i) => [c, i]))
  loo = t.places.filter((row) => !row[col.report] && !owned.has(row[col.id])).map((row) => {
    const [prov, slug] = String(row[col.href]).split('/')
    return { kind: 'note', source: `toilet:${row[col.id]}#cost`, _p: 40,
      show: { name: row[col.th], name_en: row[col.en] || '', lat: row[col.lat], lng: row[col.lng], page: `https://motdang.net/${prov}/p/${slug}.html`, ...TOILET } }
  })
} catch (e) { console.log('toilets.json', e.message) }
// golds: her own answers
const golds = []
try {
  const en = JSON.parse(readFileSync(new URL('data/curated/enrich.json', MD), 'utf8'))
  for (const [id, v] of Object.entries(en)) {
    const fx = v?.fields?.attrs?.facets || {}
    const r = recs.find((x) => x.id === id) || { id, name: v?.fields?.name || id }
    const fs = setOf({ ...r, ...v?.fields })
    for (const f of fs?.facets || []) if (fx[f.key] === 'field')
      golds.push({ kind: 'note', source: `${id}#${f.key}`, gold: 'yes', show: { ...show(r), how: 'go or call', about_th: f.th, about_en: f.en, ask_th: f.ask_th, ask_en: f.ask_en } })
  }
} catch {}
// Kamthieng amulet market, NaN 2026-10-16: the toilets cost 3 baht
golds.push({ kind: 'note', source: 'toilet:cm-osm-node-6351675891#cost', gold: '3',
  show: { name: 'Antique Market', name_th: 'ตลาดพระ คำเที่ยง', lat: 18.8093641, lng: 98.9958035, page: 'https://motdang.net/cm/p/antique-market-6351675891.html', ...TOILET } })
// a third each: toilets, the parking and trades lists, every other list; a
// share one group cannot fill goes to the others
const top = (xs, n) => [...xs].sort(byPriority('_p')).slice(0, n)
const named = notes.filter((t) => t._named), rest = notes.filter((t) => !t._named)
const third = Math.round(per / 3)
const picked = [...top(loo, third), ...top(named, third)]
picked.push(...top(rest, per - picked.length))
if (picked.length < per) picked.push(...top([...loo, ...named].filter((t) => !picked.includes(t)), per - picked.length))
for (const t of notes) delete t._named
push('note', picked, golds)

writeFileSync(out, JSON.stringify(tasks))
const count = {}
for (const t of tasks) { const k = `${t.kind}${t.gold ? ' gold' : ''}`; count[k] = (count[k] || 0) + 1 }
console.log(out, tasks.length, count)

if (load) {
  for (let i = 0; i < tasks.length; i += 200) {
    const r = await adm({ do: 'tasks', tasks: tasks.slice(i, i + 200) })
    if (r.bad?.length) console.log('bad', i, r.bad.length)
  }
  for (const [kind, sources] of Object.entries(keep)) console.log(kind, await adm({ do: 'retire', kind, keep: sources, ...(keepGold[kind] ? { golds: keepGold[kind] } : {}) }))
  console.log('settled so far', done.answers.length)
  const open = {}
  for (const c of (await adm({ do: 'settled', since: new Date().toISOString() })).counts) if (c.status === 'open') open[c.kind + (c.gold ? ' gold' : '')] = c.n
  console.log('open now', JSON.stringify(open))
}
