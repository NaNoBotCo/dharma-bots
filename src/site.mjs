// site.mjs — reads motdang.net's own published files from its R2 bucket
// (binding SITE, read only): the festivals, the feed, the place records and
// the Voight-Kampff gossip.
// Kept in isolate memory for ten minutes.

const CACHE = new Map()
const TTL_MS = 10 * 60 * 1000

export async function siteText(env, key) {
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v
  if (CACHE.size > 5000) CACHE.clear()
  let v = null
  try {
    const obj = await env.SITE?.get(key)
    v = obj ? await obj.text() : null
  } catch { v = null }
  CACHE.set(key, { at: Date.now(), v })
  return v
}

export async function siteJson(env, key) {
  const t = await siteText(env, key)
  try { return t ? JSON.parse(t) : null } catch { return null }
}

export const bkkDate = (d) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)

/** Announced festivals starting within `days` of `day`, with their source. */
export async function festivalsSoon(env, day, days = 10) {
  const [dates, fest] = await Promise.all([siteJson(env, 'data/festival_dates.json'), siteJson(env, 'data/festivals.json')])
  const names = Object.fromEntries((fest?.festivals || []).map((f) => [f.id, f]))
  const end = new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
  const seen = new Set()
  return (dates?.rows || [])
    .filter((r) => r.status === 'announced' && r.date_start >= day && r.date_start <= end)
    .filter((r) => !seen.has(r.festival_id) && seen.add(r.festival_id))
    .map((r) => ({ id: r.festival_id, th: names[r.festival_id]?.name_th || r.festival_id,
      en: names[r.festival_id]?.name_en || r.festival_id, start: r.date_start, end: r.date_end, source: r.source_url }))
}

/** Items of motdang.net/rss.xml: [{ guid, title, link }]. */
export async function rssItems(env) {
  const xml = await siteText(env, 'rss.xml')
  if (!xml) return []
  const un = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const g = (t) => un((m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1])
    return { guid: g('guid') || g('link'), title: g('title'), link: g('link') }
  }).filter((i) => i.guid && i.title)
}

export const PROV_RE = /^[a-z]{2,6}$/
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,200}$/

/** A motdang place by its page address (<prov>/p/<slug>.html), from the
 *  .json the build writes beside every place page; null if there is none. */
export async function place(env, prov, slug) {
  if (!PROV_RE.test(prov) || !SLUG_RE.test(slug)) return null
  const r = await siteJson(env, `${prov}/p/${slug}.json`)
  if (!r) return null
  const th = r.nameTh || r.name || ''
  const en = r.nameEn || ''
  return { prov, slug, th, en, name: [th, en].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || slug,
    url: `https://motdang.net/${prov}/p/${slug}.html`, cat: r.cat || [] }
}

/** The latest Voight-Kampff issue: { issue, from, to, url, beats: [...] }, or null. */
export async function gossip(env) {
  const g = await siteJson(env, 'voight-kampff/gossip.json')
  return g?.beats?.length ? g : null
}
