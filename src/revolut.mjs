// revolut.mjs — the Revolut Business API, for microtask payouts.
//
// Secrets (npx wrangler secret put <NAME>), set by the account holder:
//   REVOLUT_CLIENT_ID      from Business → APIs → the API certificate
//   REVOLUT_ASSERTION      the signed client-assertion JWT (client_assertion.txt)
//   REVOLUT_REFRESH_TOKEN  from the first token exchange
//   REVOLUT_ACCOUNT_ID     the THB account the money leaves from
// Vars: REVOLUT_BASE (default the sandbox), MICRO_RAIL = list | draft | pay.
//
// /pay needs a Business Company plan; Freelancer plans get /payment-drafts,
// approved in the Revolut app.

export const SANDBOX = 'https://sandbox-b2b.revolut.com/api/1.0'
export const LIVE = 'https://b2b.revolut.com/api/1.0'

export const rail = (env) => (['draft', 'pay'].includes(env.MICRO_RAIL) ? env.MICRO_RAIL : 'list')
export const ready = (env) => Boolean(env.REVOLUT_CLIENT_ID && env.REVOLUT_ASSERTION && env.REVOLUT_REFRESH_TOKEN && env.REVOLUT_ACCOUNT_ID)
const base = (env) => env.REVOLUT_BASE || SANDBOX

/** An access token, cached in micro_setting until a minute before it lapses. */
async function token(env, db, now, fetcher) {
  const hit = await db.get("SELECT v FROM micro_setting WHERE k = 'rv_token'")
  if (hit) {
    const t = JSON.parse(hit.v)
    if (t.exp > now.getTime() + 60000) return t.access
  }
  const r = await fetcher(base(env) + '/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: env.REVOLUT_REFRESH_TOKEN, client_id: env.REVOLUT_CLIENT_ID,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: env.REVOLUT_ASSERTION,
    }),
  })
  if (!r.ok) throw new Error(`token ${r.status}`)
  const b = await r.json()
  const v = JSON.stringify({ access: b.access_token, exp: now.getTime() + (Number(b.expires_in) || 2400) * 1000 })
  await db.run("INSERT INTO micro_setting (k, v) VALUES ('rv_token', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", v)
  return b.access_token
}

async function call(env, db, now, fetcher, method, path, body) {
  const t = await token(env, db, now, fetcher)
  const r = await fetcher(base(env) + path, {
    method, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let out = null
  try { out = await r.json() } catch { out = null }
  return { status: r.status, ok: r.ok, body: out }
}

/** Add the payee as a counterparty. Revolut checks the name against the Revtag. */
export async function counterparty(env, db, payee, now = new Date(), fetcher = fetch) {
  const r = await call(env, db, now, fetcher, 'POST', '/counterparty', { profile_type: 'personal', name: payee.name, revtag: payee.revtag })
  if (r.ok && r.body?.id) return { id: r.body.id }
  return { error: r.status === 404 ? 'Revolut does not match that name to that Revtag.' : r.status === 422 ? 'Revolut already holds this Revtag as a counterparty.' : `Revolut ${r.status}` }
}

const majors = (satang) => Math.round(satang) / 100

/** One payout by /pay. request_id makes a retry of the same payout a no-op. */
export async function pay(env, db, payout, payee, now = new Date(), fetcher = fetch) {
  const r = await call(env, db, now, fetcher, 'POST', '/pay', {
    request_id: `motdang-micro-${payout.id}`, account_id: env.REVOLUT_ACCOUNT_ID,
    receiver: { counterparty_id: payee.counterparty_id }, amount: majors(payout.satang), currency: 'THB',
    reference: `motdang.net microtasks #${payout.id}`,
  })
  if (r.ok && r.body?.id && !['declined', 'failed', 'reverted'].includes(r.body.state)) return { ref: r.body.id, state: r.body.state }
  return { error: r.body?.message || `Revolut ${r.status}${r.body?.state ? ' ' + r.body.state : ''}` }
}

/** All of a day's payouts as one payment draft, for approval in the app. */
export async function draft(env, db, rows, now = new Date(), fetcher = fetch) {
  const r = await call(env, db, now, fetcher, 'POST', '/payment-drafts', {
    title: `motdang.net microtasks ${now.toISOString().slice(0, 10)}`,
    payments: rows.map(({ payout, payee }) => ({
      account_id: env.REVOLUT_ACCOUNT_ID, receiver: { counterparty_id: payee.counterparty_id },
      amount: majors(payout.satang), currency: 'THB', reference: `motdang.net microtasks #${payout.id}`,
    })),
  })
  if (r.ok && r.body?.id) return { ref: r.body.id }
  return { error: r.body?.message || `Revolut ${r.status}` }
}
