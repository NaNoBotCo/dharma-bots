// price.mjs — ราคา · prices. Nan 2026-10-18, C221 (b): "build the price table with weekly Shoup
// steps for the Anthill payouts", after "everything needs to be relational".
//
// Every amount is a program's base × an item's ratio (price_program, price_item). Only the
// base moves: each Monday, Bangkok time, last week's use is read. More than down_over (80%)
// of it used: a rung down. Under up_under (60%): a rung up, to draw more. Between: no change.
// The rung stays between floor and ceiling. Use is slots (price_use: a picture graded to
// pay, a change used) or money (the share of the daily cap taken, from micro_lease).
// A use that arrives once this week's slots are taken takes a slot in the first week with
// room, at the price that week will have if the weeks before it end as they stand.
import { bkkDate } from './site.mjs'

const iso = (d) => d.toISOString()
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** The Monday (Bangkok) of the week `now` falls in, as YYYY-MM-DD. */
export const monday = (now) => { const day = bkkDate(now); return addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7)) }

// money-measured programs: the daily cap in micro_setting and which leases count
const MONEY = {
  micro: { cap: 'cap_satang_day', tiers: "COALESCE(tier, '') != 'note'" },
  note: { cap: 'note_cap_satang_day', tiers: "tier = 'note'" },
}

export async function load(db, program) {
  const p = await db.get('SELECT * FROM price_program WHERE program = ?', program)
  if (!p) return null
  const items = await db.all('SELECT * FROM price_item WHERE program = ? ORDER BY ratio, item', program)
  return { ...p, ladder: JSON.parse(p.ladder), items, item: Object.fromEntries(items.map((i) => [i.item, i])) }
}

export const amount = (p, it, rung = p.rung) => (it.ratio ? Math.max(it.min || 0, Math.round(p.ladder[rung] * it.ratio)) : 0)
/** { item: amount } at a rung (this week's by default). */
export const amounts = (p, rung = p.rung) => Object.fromEntries(p.items.map((it) => [it.item, amount(p, it, rung)]))
const nextRung = (p, rung, share) => share > p.down_over ? Math.max(p.floor_rung, rung - 1)
  : share < p.up_under ? Math.min(p.ceiling_rung, rung + 1) : rung

async function usedSlots(db, program, week, item = null) {
  return (await db.get(`SELECT COUNT(*) n FROM price_use WHERE program = ? AND week = ?${item ? ' AND item = ?' : ''}`,
    program, week, ...(item ? [item] : []))).n
}

/** Last week's use of a program: [used, of]. */
async function use(db, p, week) {
  if (p.measure === 'slots') return [await usedSlots(db, p.program, week), p.slots_week || 0]
  const m = MONEY[p.program] || MONEY[p.program.split('-')[0]]
  if (!m) return [0, 0]
  const cap = Number((await db.get('SELECT v FROM micro_setting WHERE k = ?', m.cap))?.v || 0)
  const n = (await db.get(`SELECT COALESCE(SUM(satang), 0) n FROM micro_lease WHERE cur = 'thb' AND answered = 1 AND ${m.tiers}
    AND day >= ? AND day < ?`, week, addDays(week, 7))).n
  return [n, 7 * cap]
}

/** Mondays from 00:00 Bangkok: every weekly program steps once on last week's use. */
export async function stepAll(db, now, { force = false, only = null } = {}) {
  const week = monday(now)
  if (!force && bkkDate(now) !== week) return { skipped: true }
  const rows = await db.all(`SELECT program FROM price_program WHERE step = 'weekly'${only ? ' AND program = ?' : ''}`, ...(only ? [only] : []))
  const out = {}
  for (const { program } of rows) {
    const p = await load(db, program)
    if (!force && (p.stepped_week === week || week <= p.opened)) continue
    const [used, of] = await use(db, p, addDays(week, -7))
    const rung = nextRung(p, p.rung, of > 0 ? used / of : 0)
    await db.run('UPDATE price_program SET rung = ?, stepped_week = ? WHERE program = ?', rung, week, program)
    await db.run(`INSERT INTO price_step (program, week, used, of, rung_before, rung_after, base_before, base_after, at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(program, week) DO UPDATE SET used = excluded.used, of = excluded.of, rung_after = excluded.rung_after, base_after = excluded.base_after, at = excluded.at`,
    program, week, used, of, p.rung, rung, p.ladder[p.rung], p.ladder[rung], iso(now))
    out[program] = { used, of, share: of > 0 ? Math.round((used / of) * 100) / 100 : 0, from: p.ladder[p.rung], to: p.ladder[rung] }
  }
  return out
}

/** Take a slot for a use. Returns { amount, week } or { error }. A 0-ratio item takes no slot. */
export async function take(db, program, item, ref, who, now) {
  const p = await load(db, program)
  if (!p || p.measure !== 'slots') return { error: `No slots program ${program}.` }
  const it = p.item[item]
  if (!it) return { error: `item: ${p.items.map((i) => i.item).join(' | ')}` }
  await db.run('DELETE FROM price_use WHERE program = ? AND ref = ?', program, String(ref))
  if (!it.ratio) return { amount: 0, week: null }
  let w = monday(now), rung = p.rung
  for (let i = 0; i < 104; i++) {
    const n = await usedSlots(db, program, w)
    if (n < p.slots_week && (!it.slots_week || await usedSlots(db, program, w, item) < it.slots_week)) break
    rung = nextRung(p, rung, n / p.slots_week)
    w = addDays(w, 7)
  }
  const amt = amount(p, it, rung)
  await db.run('INSERT INTO price_use (program, item, ref, who, week, amount, at) VALUES (?,?,?,?,?,?,?)', program, item, String(ref), String(who || ''), w, amt, iso(now))
  return { amount: amt, week: w }
}

export const release = (db, program, ref) => db.run('DELETE FROM price_use WHERE program = ? AND ref = ?', program, String(ref))

/** A program as bots and pages read it. */
export async function view(db, program, now) {
  const p = await load(db, program)
  if (!p) return null
  const week = monday(now)
  const out = {
    program, unit: p.unit, base_item: p.base_item, amounts: amounts(p), ratios: Object.fromEntries(p.items.map((i) => [i.item, i.ratio])),
    floor: amounts(p, p.floor_rung), ceiling: amounts(p, p.ceiling_rung), base_ladder: p.ladder.slice(p.floor_rung, p.ceiling_rung + 1),
    measure: p.measure, step: p.step, week,
    // the first Monday after the opening week, then every Monday
    next_change: p.step === 'weekly' ? addDays(week > p.opened ? week : p.opened, 7) : null,
  }
  if (p.measure === 'slots') {
    const used = await usedSlots(db, program, week)
    out.slots_week = p.slots_week
    out.used_this_week = used
    out.left_this_week = Math.max(0, p.slots_week - used)
    const own = p.items.filter((i) => i.slots_week)
    if (own.length) out.item_slots_week = Object.fromEntries(own.map((i) => [i.item, i.slots_week]))
  }
  const share = (x) => Math.round(x * 100) + '%'
  out.rule = `Each Monday (Bangkok): more than ${share(p.down_over)} of last week's ${p.measure === 'slots' ? `${p.slots_week} slots` : 'money'} used, the base steps down a rung; under ${share(p.up_under)}, up a rung. Every amount is the base × its ratio.`
  return out
}

export async function viewAll(db, now) {
  const rows = await db.all("SELECT program FROM price_program WHERE step != 'template' ORDER BY program")
  return Promise.all(rows.map((r) => view(db, r.program, now)))
}

/** A job our ant posts: its own program, copied from the `job` template, opening this week. */
export async function openJob(db, jobId, now) {
  const program = `job-${jobId}`
  await db.run(`INSERT OR IGNORE INTO price_program (program, base_item, unit, ladder, rung, floor_rung, ceiling_rung, measure, slots_week, down_over, up_under, step, opened, set_by, set_on, about)
    SELECT ?, base_item, unit, ladder, rung, floor_rung, ceiling_rung, measure, slots_week, down_over, up_under, 'weekly', ?, 'the job rule (C221)', ?, ?
    FROM price_program WHERE program = 'job'`, program, monday(now), bkkDate(now), `Job ${jobId}`)
  await db.run(`INSERT OR IGNORE INTO price_item (program, item, ratio, min, slots_week, set_by, set_on)
    SELECT ?, item, ratio, min, slots_week, set_by, ? FROM price_item WHERE program = 'job'`, program, bkkDate(now))
  return load(db, program)
}

/** The pay line a job of ours shows. */
export const jobPay = (p) => `฿${amount(p, p.item.use)} a change this week, moves Mondays`
