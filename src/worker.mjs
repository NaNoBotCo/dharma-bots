// worker.mjs — Cloudflare entry. Answers motdang.net/sala* by route; the site
// Worker keeps every other path. BASE_PATH is stripped before the handler.
import { createHandler } from './app.mjs'
import { d1Db } from './db.mjs'
import { tick } from './news.mjs'
import { runDigest } from './digest.mjs'
import card from './card.png'

const handle = createHandler((env) => d1Db(env.DB))

export function stripBase(pathname, base) {
  if (!base) return pathname
  if (pathname === base) return null            // /sala → /sala/
  if (pathname.startsWith(base + '/')) return pathname.slice(base.length)
  return undefined
}

export default {
  fetch(request, env, ctx) {
    const base = env.BASE_PATH || ''
    const url = new URL(request.url)
    const inner = stripBase(url.pathname, base)
    if (inner === null) return Response.redirect(url.origin + base + '/' + url.search, 301)
    if (inner === undefined) return new Response('Not found', { status: 404 })
    url.pathname = inner
    return handle(new Request(url, request), { ...env, CARD: card }, ctx, base)
  },
  scheduled(event, env, ctx) {
    const db = d1Db(env.DB)
    const now = new Date(event.scheduledTime)
    ctx.waitUntil(tick(db, env, now).then(() => runDigest(db, env, now)).catch((e) => console.error(e)))
  },
}
