// site.mjs — reads motdang.net's own published files from its R2 bucket
// (binding SITE, read only): the festivals and the feed.
// Kept in isolate memory for ten minutes.

const CACHE = new Map()
const TTL_MS = 10 * 60 * 1000

export async function siteText(env, key) {
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v
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
