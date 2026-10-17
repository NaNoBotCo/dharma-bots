// micro-gold.mjs — known answers for the two checks people abroad do, made
// from a record's own site without asking anyone. scripts/micro-tasks.mjs
// fetches the pages; this reads them and picks the golds.
//
//   link-belongs  "yes"        the record's one phone is on its site, and the site lists 3 phones or fewer
//                 "no"         another record shown with that site
//   phone-matches "yes"        the same site, the record's phone
//                 "different"  the same site, another record's phone that is not on the page
// "dead" golds stay too, about a third of each kind's golds.

const TH = '๐๑๒๓๔๕๖๗๘๙'
const RUN = /(?<![\d+])(?:\+?\s?66[\s.\-]*(?:\(0\)[\s.\-]*)?|0)\d(?:[\s.\-()]{0,2}\d){7,8}(?!\d)/g

/** A Thai phone as 0 and 8 or 9 digits, or null. */
export function phoneKey(s) {
  let d = String(s ?? '').replace(/\D/g, '')
  if (d.startsWith('66')) d = '0' + d.slice(2).replace(/^0/, '')
  return /^0\d{8,9}$/.test(d) ? d : null
}

/** Every Thai phone in some text, as keys. */
export function phonesIn(text) {
  const t = String(text ?? '').replace(/[๐-๙]/g, (c) => String(TH.indexOf(c)))
  return [...new Set((t.match(RUN) || []).map(phoneKey).filter(Boolean))]
}

/** The phones a fetched page shows: its text and its tel: links. */
export function pagePhones(html) {
  const h = String(html ?? '')
  const tel = [...h.matchAll(/tel:([+\d\s\-.()%20]{8,24})/gi)].map((m) => m[1].replace(/%20/g, ' ')).join(' , ')
  return phonesIn(h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ') + ' , ' + tel)
}

export const hostOf = (u) => { try { return new URL(/^https?:/i.test(u) ? u : 'http://' + u).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' } }

/** A fixed order that does not change from day to day. */
export const stable = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0 }
const order = (xs, key) => [...xs].sort((a, b) => stable(key(a)) - stable(key(b)))

/**
 * cands: [{ id, phone, link, show, words }] — records with a working own site and
 *   one phone; `show` is what the task shows, `words` the name tokens.
 * pages: Map link → { phones: [keys] } for pages fetched lately.
 * n: golds wanted per kind; dead: the "dead" golds on hand, per kind.
 */
export function goldsFrom(cands, pages, n, dead = {}) {
  const found = order(cands.filter((c) => {
    const p = pages.get(c.link), k = phoneKey(c.phone)
    return p && k && p.phones.length <= 3 && p.phones.includes(k)
  }), (c) => c.id)
  const third = Math.max(1, Math.round(n / 3))
  // two halves, so a site is in one gold of each kind at most:
  // A gives link "yes" and phone "different", B gives link "no" and phone "yes"
  const A = found.filter((_, i) => i % 2 === 0), B = found.filter((_, i) => i % 2 === 1)
  const yesL = A.slice(0, third).map((c) => ({ kind: 'link-belongs', source: `${c.id}#yes`, gold: 'yes', show: { ...c.show, link: c.link } }))
  const yesP = B.slice(0, third).map((c) => ({ kind: 'phone-matches', source: `${c.id}#yes`, gold: 'yes', show: { ...c.show, phone: c.phone, link: c.link } }))
  // another record's phone, not on this page and not close to any on it
  const others = order(cands, (c) => c.id + '~')
  const next = (ok) => { const o = others.find(ok); if (o) others.push(others.splice(others.indexOf(o), 1)[0]); return o }
  const diff = []
  for (const c of A) {
    if (diff.length >= third) break
    const on = pages.get(c.link).phones
    const o = next((x) => x.id !== c.id && phoneKey(x.phone) && !on.some((k) => k.slice(-6) === phoneKey(x.phone).slice(-6)))
    if (o) diff.push({ kind: 'phone-matches', source: `${c.id}#different`, gold: 'different', show: { ...c.show, phone: o.phone, link: c.link } })
  }
  // a record shown with another place's own site
  const no = []
  for (const b of B) {
    if (no.length >= third) break
    const a = next((x) => x.id !== b.id && hostOf(x.link) !== hostOf(b.link) && !x.words.some((w) => b.words.includes(w))
      && !pages.get(b.link).phones.includes(phoneKey(x.phone)))
    if (a) no.push({ kind: 'link-belongs', source: `${a.id}~${b.id}`, gold: 'no', show: { ...a.show, link: b.link } })
  }
  const fill = (kind, have) => order(dead[kind] || [], (t) => t.source).slice(0, Math.max(third, n - have.length))
  return {
    'link-belongs': [...yesL, ...no, ...fill('link-belongs', [...yesL, ...no])],
    'phone-matches': [...yesP, ...diff, ...fill('phone-matches', [...yesP, ...diff])],
    found: found.length,
  }
}
