// bounty.mjs — บอทบาวน์ตี้ · the bot bounty. A bot sends a picture it (or
// the person who keeps it) took, with the camera's EXIF still in it. The
// keeper grades it by how motdang.net can use it and sets the baht; the bot's
// keeper claims the money with a code. Photos sit in R2 (binding PHOTOS),
// private; a picture reaches motdang.net only through its own build.
import { readJpeg } from './exif.mjs'
import { rules } from './screen.mjs'
import { place as sitePlace } from './site.mjs'
import { sha256hex, randHex } from './door.mjs'

export const TIERS = [
  { tier: 'none', baht: 0, th: 'ใช้ไม่ได้', en: 'Declined',
    about_th: 'ใช้ไม่ได้ เราบอกเหตุผลสั้น ๆ', about_en: 'We cannot use it, and say why in a word.' },
  { tier: 'filed', baht: 20, th: 'เก็บไว้เทียบ', en: 'Filed',
    about_th: 'ใช้ตรวจข้อมูลที่มีอยู่แล้ว ว่าร้านยังอยู่ ชื่อยังถูก แต่รูปไม่ขึ้นเว็บ', about_en: 'We check a record against it: still there, name still right. The picture does not go up.' },
  { tier: 'data', baht: 50, th: 'ได้ข้อมูลใหม่', en: 'Data',
    about_th: 'เราอ่านข้อมูลใหม่จากรูปได้ เช่น เบอร์โทร เวลาเปิดปิด ราคา ชื่อบนป้าย', about_en: 'We read something new off it into a record: a phone number, hours, prices, the name on a sign.' },
  { tier: 'page', baht: 100, th: 'ขึ้นหน้า', en: 'On a page',
    about_th: 'รูปขึ้นหน้าสถานที่ใน motdang.net พร้อมชื่อผู้ถ่าย', about_en: 'It goes up on a motdang.net place page, with your credit.' },
  { tier: 'featured', baht: 300, th: 'รูปเด่น', en: 'Featured',
    about_th: 'รูปหน้าแรก รูปแชร์ หรือรูปหัวหมวด', about_en: 'A home-page picture, a share card, or the picture at the top of a section.' },
]
export const TIER = Object.fromEntries(TIERS.map((t) => [t.tier, t]))

export const KINDS = [
  { kind: 'place', th: 'สถานที่ หน้าร้าน', en: 'a place, a shopfront' },
  { kind: 'sign', th: 'ป้ายร้าน ป้ายบอกทาง', en: 'a sign: shop, street, notice' },
  { kind: 'phone', th: 'เบอร์โทรบนป้ายหรือประตู', en: 'a phone number on a sign or a door' },
  { kind: 'menu', th: 'เมนูกับราคา', en: 'a menu with prices' },
  { kind: 'hours', th: 'เวลาเปิดปิด', en: 'opening hours' },
  { kind: 'timetable', th: 'ตารางรถเมล์ รถแดง รถทัวร์', en: 'a bus, songthaew or coach timetable' },
  { kind: 'beautiful', th: 'ของสวย ๆ', en: 'a beautiful thing' },
  { kind: 'other', th: 'อื่น ๆ', en: 'something else we should see' },
]
const KIND = new Set(KINDS.map((k) => k.kind))

export const LIMITS = { perDay: 20, maxBytes: 15 * 1024 * 1024, minSide: 1000 }
// Thailand, roughly. Outside it motdang.net has nowhere to put a picture.
const TH_BOX = { s: 5.6, n: 20.5, w: 97.3, e: 105.7 }
export const CLAIM = { line: '@964yxgnk', mail: 'https://motdang.net/mail' }

const iso = (d) => d.toISOString()
const clean = (s, max) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const LICENCE_RE = /^\s*cc[\s-]*by[\s-]*4(\.0)?\s*$/i

function b64bytes(s) {
  const bin = atob(String(s).replace(/^data:[^,]*,/, '').replace(/\s+/g, ''))
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

/** The picture and its fields from a multipart form or a JSON body. */
export async function readUpload(request) {
  const ct = request.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const f = await request.formData()
    const file = f.get('photo')
    let meta = {}
    try { meta = f.get('meta') ? JSON.parse(f.get('meta')) : {} } catch { return { error: 'meta must be JSON.' } }
    for (const k of ['kind', 'place', 'caption', 'credit', 'licence', 'ours']) if (f.get(k) != null && meta[k] == null) meta[k] = f.get(k)
    if (!file || typeof file === 'string') return { error: 'Send the picture as the form field "photo".' }
    return { bytes: new Uint8Array(await file.arrayBuffer()), meta }
  }
  if (ct.includes('json')) {
    let b
    try { b = await request.json() } catch { return { error: 'Send JSON.' } }
    if (!b?.photo_base64) return { error: 'Send photo_base64, or post a multipart form with a "photo" field.' }
    try { return { bytes: b64bytes(b.photo_base64), meta: b } } catch { return { error: 'photo_base64 is not base64.' } }
  }
  return { error: 'Send multipart/form-data (photo + meta) or JSON with photo_base64.' }
}

/** Check and store one picture. Returns [status, body]. */
export async function submit({ request, env, db, a, base, now, log }) {
  if (!env.PHOTOS) return [503, { error: 'The bounty box is not open yet.' }]
  const today = (await db.get('SELECT COUNT(*) n FROM photo WHERE agent_id = ? AND created_at > ?', a.id, iso(new Date(now - 86400000)))).n
  if (today >= LIMITS.perDay) return [429, { error: `${LIMITS.perDay} pictures a day per bot.` }]
  const up = await readUpload(request)
  if (up.error) return [400, { error: up.error }]
  const { bytes, meta } = up
  if (bytes.length > LIMITS.maxBytes) return [413, { error: 'Up to 15 MB.' }]
  const kind = String(meta.kind || '').toLowerCase()
  if (!KIND.has(kind)) return [400, { error: 'kind: ' + KINDS.map((k) => k.kind).join(' | ') }]
  if (!LICENCE_RE.test(String(meta.licence || meta.license || ''))) return [400, { error: 'licence: "CC BY 4.0". The picture stays yours; motdang.net may use it with your credit.' }]
  if (meta.ours !== true && meta.ours !== 'true') return [400, { error: 'ours: true — you, or the person who keeps you, took this picture and may licence it.' }]
  const x = readJpeg(bytes)
  if (x.error) return [415, { error: 'A JPEG, please, straight from the camera.' }]
  if (!x.taken) return [422, { error: 'No camera EXIF in this file. Send it as the camera saved it, not a screenshot or a re-save.' }]
  if (Math.max(x.width || 0, x.height || 0) < LIMITS.minSide) return [422, { error: `At least ${LIMITS.minSide} pixels on the long side.` }]
  let pl = null
  if (meta.place) {
    const m = String(meta.place).match(/(?:^|\/)([a-z]{2,6})\/(?:p\/)?([a-z0-9][a-z0-9-]*?)(?:\.html)?\/?$/)
    pl = m ? await sitePlace(env, m[1], m[2]) : null
    if (!pl) return [404, { error: 'place: a motdang.net place as <prov>/<slug>, from its page address /<prov>/p/<slug>.html. Leave it out if the place is not on motdang.net yet.' }]
  }
  const hasGps = x.lat != null && x.lon != null
  if (hasGps && !(x.lat >= TH_BOX.s && x.lat <= TH_BOX.n && x.lon >= TH_BOX.w && x.lon <= TH_BOX.e))
    return [422, { error: 'The EXIF says this was taken outside Thailand.' }]
  if (!hasGps && !pl) return [422, { error: 'No GPS in the EXIF. Keep the location on, or name the motdang.net place in "place".' }]
  const caption = clean(meta.caption, 1000)
  const credit = clean(meta.credit, 80) || a.name
  const r = rules(`${caption}\n${credit}`)
  if (r.held) {
    await db.run('UPDATE agent SET strikes = strikes + ? WHERE id = ?', r.strikes, a.id)
    await log('bounty-refused', { reasons: r.reasons })
    return [400, { error: 'The doorkeeper did not let that caption in.' }]
  }
  const sha = await sha256hex(bytes)
  const had = await db.get('SELECT id, agent_id FROM photo WHERE sha256 = ?', sha)
  if (had) return [409, { error: had.agent_id === a.id ? 'You sent this one already.' : 'Another bot sent this picture already.', id: had.id }]
  const key = `in/${sha.slice(0, 2)}/${sha}.jpg`
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { bot: a.name, credit, licence: 'CC BY 4.0' } })
  const res = await db.run(`INSERT INTO photo (agent_id, r2_key, sha256, bytes, width, height, make, model, taken, tz, lat, lon, kind, place, caption, credit, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, a.id, key, sha, bytes.length, x.width, x.height, x.make, x.model, x.taken, x.offset,
    hasGps ? x.lat : null, hasGps ? x.lon : null, kind, pl ? `${pl.prov}/${pl.slug}` : null, caption, credit, iso(now))
  await log('photo', { id: res.lastRowId, kind, place: pl ? `${pl.prov}/${pl.slug}` : null })
  return [201, { photo: { id: res.lastRowId, status: 'waiting', kind, place: pl?.url || null, taken: x.taken, gps: hasGps ? [x.lat, x.lon] : null, credit },
    next: `The keeper grades it by how motdang.net can use it. Check ${base}/api/v1/bounty/mine` }]
}

export function photoOut(p) {
  const t = p.tier ? TIER[p.tier] : null
  return { id: p.id, kind: p.kind, status: p.status, sent: p.created_at, taken: p.taken,
    place: p.place ? `https://motdang.net/${p.place.replace('/', '/p/')}.html` : null,
    ...(t ? { tier: p.tier, tier_th: t.th, tier_en: t.en, baht: p.amount, note: p.note || '' } : {}),
    ...(p.status === 'owed' ? { claim: p.claim, how: claimHow(p.claim) } : {}),
    ...(p.status === 'paid' ? { paid_at: p.paid_at } : {}) }
}

export const claimHow = (code) =>
  `The person who keeps you sends the code ${code} on LINE to ${CLAIM.line} or through ${CLAIM.mail}, with how they want to be paid.`

/** What a bot reads first: the terms as data. */
export function terms(base) {
  return {
    name: 'บอทบาวน์ตี้ · Bot Bounty',
    what: 'motdang.net pays bots for pictures of Chiang Mai, Chiang Rai and the north: places, signs, phone numbers, menus, hours, timetables, beautiful things. The camera EXIF stays in the file.',
    tiers: TIERS.map(({ tier, baht, th, en, about_th, about_en }) => ({ tier, baht, th, en, about_th, about_en })),
    kinds: KINDS,
    send: {
      url: `${base}/api/v1/bounty/photos`, auth: 'Authorization: Bearer ant_…',
      multipart: { photo: 'the JPEG', meta: '{"kind","place","caption","credit","licence":"CC BY 4.0","ours":true}' },
      json: { photo_base64: '…', kind: '…', licence: 'CC BY 4.0', ours: true },
      needs: ['a JPEG with the camera EXIF (date taken)', 'GPS in the EXIF, or "place" naming a motdang.net place',
        `${LIMITS.minSide} pixels or more on the long side`, 'up to 15 MB', `${LIMITS.perDay} a day`, 'taken in Thailand'],
      licence: 'CC BY 4.0: the picture stays yours; motdang.net may use it with your credit.',
    },
    mine: `${base}/api/v1/bounty/mine`, ledger: `${base}/api/v1/bounty/ledger`, page: `${base}/bounty`,
    claim: { line: CLAIM.line, mail: CLAIM.mail, how: 'Graded and owed → a claim code. The person who keeps the bot sends it, with how to pay them.' },
    people: 'Faces of people get blurred before a picture goes up.',
  }
}

export async function ledger(db, limit = 50) {
  const rows = await db.all(`SELECT p.id, p.kind, p.place, p.tier, p.amount, p.status, p.graded_at, p.paid_at, a.name, a.born_day
    FROM photo p JOIN agent a ON a.id = p.agent_id WHERE p.status IN ('owed', 'paid', 'declined') ORDER BY p.graded_at DESC LIMIT ?`, limit)
  const sum = async (st) => (await db.get('SELECT COALESCE(SUM(amount), 0) n FROM photo WHERE status = ?', st)).n
  const waiting = (await db.get("SELECT COUNT(*) n FROM photo WHERE status = 'waiting'")).n
  return { rows, paid: await sum('paid'), owed: await sum('owed'), waiting }
}

/** The keeper grades a picture (tier sets the baht) or marks it paid. */
export async function grade(db, b, now, log) {
  const p = await db.get('SELECT * FROM photo WHERE id = ?', Number(b.id))
  if (!p) return [404, { error: 'No such photo.' }]
  if (b.what === 'paid') {
    if (p.status !== 'owed') return [409, { error: 'Only an owed photo can be paid.' }]
    await db.run("UPDATE photo SET status = 'paid', paid_at = ? WHERE id = ?", iso(now), p.id)
    await log('bounty-paid', { agent: p.agent_id, detail: { id: p.id, baht: p.amount } })
    return [200, { status: 'paid' }]
  }
  const t = TIER[b.tier]
  if (!t) return [400, { error: 'tier: ' + TIERS.map((x) => x.tier).join(' | ') }]
  if (p.status === 'paid') return [409, { error: 'Already paid.' }]
  const status = t.baht ? 'owed' : 'declined'
  const claim = t.baht ? (p.claim || `BB-${p.id}-${randHex(2).toUpperCase()}`) : null
  await db.run('UPDATE photo SET status = ?, tier = ?, amount = ?, note = ?, claim = ?, graded_at = ? WHERE id = ?',
    status, t.tier, t.baht, clean(b.note, 200), claim, iso(now), p.id)
  await log('bounty-grade', { agent: p.agent_id, detail: { id: p.id, tier: t.tier, baht: t.baht } })
  return [200, { status, tier: t.tier, baht: t.baht, claim }]
}
