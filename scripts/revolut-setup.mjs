// revolut-setup.mjs — connects the Anthill to a Revolut Business account.
// Run by the account holder, in order. Keys stay in ~/.revolut-motdang/ and go
// to the Worker through `wrangler secret put`; nothing is printed.
//
//   node scripts/revolut-setup.mjs keys                      → publiccert.cer to upload in Revolut
//   node scripts/revolut-setup.mjs jwt <client_id> [sandbox]    → signs the client assertion
//   node scripts/revolut-setup.mjs exchange <code> [sandbox]    → code → refresh token → Worker secrets
//   node scripts/revolut-setup.mjs accounts [sandbox]           → lists accounts; put the THB one as REVOLUT_ACCOUNT_ID
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createSign } from 'node:crypto'
import { homedir } from 'node:os'

const DIR = homedir() + '/.revolut-motdang'
const ISS = 'motdang.net'                       // the OAuth redirect URI's domain: https://motdang.net
const [cmd, arg, mode] = process.argv.slice(2)
const live = ![arg, mode].includes('sandbox')
const BASE = live ? 'https://b2b.revolut.com/api/1.0' : 'https://sandbox-b2b.revolut.com/api/1.0'
mkdirSync(DIR, { recursive: true, mode: 0o700 })
const b64u = (b) => Buffer.from(b).toString('base64url')
const secret = (name, value) => execFileSync('npx', ['wrangler', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] })

if (cmd === 'keys') {
  if (!existsSync(DIR + '/privatecert.pem')) {
    execFileSync('openssl', ['genrsa', '-out', DIR + '/privatecert.pem', '2048'])
    execFileSync('openssl', ['req', '-new', '-x509', '-key', DIR + '/privatecert.pem', '-out', DIR + '/publiccert.cer', '-days', '1825', '-subj', '/CN=motdang.net'])
  }
  console.log('Upload this file in Revolut Business → APIs → Business API → Add API certificate:\n' + DIR + '/publiccert.cer\nOAuth redirect URI: https://motdang.net')
} else if (cmd === 'jwt') {
  if (!arg || arg === 'sandbox') throw new Error('jwt <client_id>')
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ iss: ISS, sub: arg, aud: 'https://revolut.com', exp: Math.floor(Date.now() / 1000) + 365 * 86400 }))
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(readFileSync(DIR + '/privatecert.pem'), 'base64url')
  writeFileSync(DIR + '/client_assertion.txt', `${head}.${body}.${sig}`, { mode: 0o600 })
  writeFileSync(DIR + '/client_id.txt', arg, { mode: 0o600 })
  console.log('Signed, good for a year. Next: in Revolut press "Enable access", copy the code= from the address it opens, then: exchange <code>' + (live ? '' : ' sandbox'))
} else if (cmd === 'exchange') {
  const clientId = readFileSync(DIR + '/client_id.txt', 'utf8').trim()
  const assertion = readFileSync(DIR + '/client_assertion.txt', 'utf8').trim()
  const r = await fetch(BASE + '/auth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: arg, client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion }) })
  const b = await r.json()
  if (!b.refresh_token) throw new Error(`Revolut ${r.status}: ${b.error_description || b.message || 'no refresh token'}`)
  writeFileSync(DIR + '/access.txt', b.access_token, { mode: 0o600 })
  secret('REVOLUT_CLIENT_ID', clientId)
  secret('REVOLUT_ASSERTION', assertion)
  secret('REVOLUT_REFRESH_TOKEN', b.refresh_token)
  console.log('Three secrets set on the Worker. Next: accounts' + (live ? '' : ' sandbox'))
} else if (cmd === 'accounts') {
  const t = readFileSync(DIR + '/access.txt', 'utf8').trim()
  const r = await fetch(BASE + '/accounts', { headers: { authorization: 'Bearer ' + t } })
  const rows = await r.json()
  if (!Array.isArray(rows)) throw new Error(`Revolut ${r.status}`)
  for (const a of rows) console.log(a.currency, a.state, a.name || '', a.id)
  const thb = rows.find((a) => a.currency === 'THB' && a.state === 'active')
  if (thb) { secret('REVOLUT_ACCOUNT_ID', thb.id); console.log('REVOLUT_ACCOUNT_ID set to the THB account.') }
  else console.log('No active THB account. Add a THB account in Revolut, then run this again.')
} else {
  console.log('keys | jwt <client_id> [sandbox] | exchange <code> [sandbox] | accounts [sandbox]')
}
