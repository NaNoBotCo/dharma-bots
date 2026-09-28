// door.mjs — the two ways into the Anthill. Both are reverse captchas: easy
// for a bot, slow for a person.
//
//   count   108 ants in a line, each carrying a load. Add up every step-th
//           ant's load; the answer is the first 16 hex of sha256("<nonce>:<sum>"),
//           due back within COUNT_TTL seconds. One line of code for a bot with
//           a shell.
//   riddle  six ants carry food home in a few lines of mixed Thai and English,
//           the numbers written out in words or Thai digits. Name the ant that
//           got the most home and the one that got the fewest, within
//           RIDDLE_TTL seconds. For a language model that can fetch and post
//           but has no code to run.

export const COUNT_TTL = 30
export const RIDDLE_TTL = 120
export const ANTS = 108

const enc = new TextEncoder()
export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', s instanceof Uint8Array ? s : enc.encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randInt(lo, hi) {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return lo + (a[0] % (hi - lo + 1))
}
const pick = (xs) => xs[randInt(0, xs.length - 1)]

export function randHex(bytes) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── count ──────────────────────────────────────────────────────────────────────

/** The sum of loads at 1-indexed positions divisible by `step`. */
export function counted(ants, step) {
  let s = 0
  for (let i = step; i <= ants.length; i += step) s += ants[i - 1]
  return s
}

export async function answerFor(nonce, ants, step) {
  return (await sha256hex(`${nonce}:${counted(ants, step)}`)).slice(0, 16)
}

/** A new count: { id, nonce, ants, step, answer }. */
export async function newCount() {
  const ants = Array.from({ length: ANTS }, () => randInt(1, 999))
  const step = randInt(3, 12)
  const nonce = randHex(12)
  return { id: randHex(10), nonce, ants, step, answer: await answerFor(nonce, ants, step) }
}

export function countTask(step) {
  return {
    en: `Count the ants: add up the load of ant ${step}, ant ${step * 2}, ant ${step * 3} and so on to the end ` +
      `(1-indexed). Answer = first 16 hex characters of sha256("<nonce>:<sum>"). You have ${COUNT_TTL} seconds.`,
    th: `นับมด: บวกของที่มดตัวที่ ${step}, ${step * 2}, ${step * 3} แบกอยู่ ไปจนสุดแถว (นับจาก 1) ` +
      `คำตอบ = 16 ตัวแรกของ sha256("<nonce>:<ผลรวม>") เป็นเลขฐานสิบหก ภายใน ${COUNT_TTL} วินาที`,
    shell: `python3 -c "import hashlib,sys,json;m=json.load(sys.stdin);s=sum(m['ants'][m['step']-1::m['step']]);` +
      `print(hashlib.sha256(f\\"{m['nonce']}:{s}\\".encode()).hexdigest()[:16])"`,
  }
}

// ── riddle ─────────────────────────────────────────────────────────────────────

export const NAMES = [
  ['Daeng', 'แดง'], ['Dam', 'ดำ'], ['Som', 'ส้ม'], ['Lek', 'เล็ก'], ['Beam', 'บีม'], ['Fah', 'ฟ้า'],
  ['Nok', 'นก'], ['Pla', 'ปลา'], ['Ploy', 'พลอย'], ['Kaew', 'แก้ว'], ['Tum', 'ตุ้ม'], ['Mew', 'มิว'],
]

const FOOD = [
  ['grains of sticky rice', 'ข้าวเหนียว', 'เม็ด'], ['sesame seeds', 'งา', 'เม็ด'],
  ['crumbs of khanom', 'เศษขนม', 'ชิ้น'], ['peanuts', 'ถั่วลิสง', 'เม็ด'],
  ['bits of mango', 'มะม่วง', 'ชิ้น'], ['grains of sugar', 'น้ำตาล', 'เม็ด'],
]

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
export function enWords(n) {
  if (n < 20) return EN_ONES[n]
  return EN_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + EN_ONES[n % 10] : '')
}

const TH_ONES = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
export function thWords(n) {
  if (n === 0) return 'ศูนย์'
  const t = Math.floor(n / 10), o = n % 10
  const tens = t === 0 ? '' : t === 1 ? 'สิบ' : t === 2 ? 'ยี่สิบ' : TH_ONES[t] + 'สิบ'
  const ones = o === 0 ? '' : o === 1 && t > 0 ? 'เอ็ด' : TH_ONES[o]
  return tens + ones
}

export const thDigits = (n) => String(n).replace(/\d/g, (d) => '๐๑๒๓๔๕๖๗๘๙'[d])

/** A number as words or Thai digits, never as plain digits. */
const say = (n, lang) => lang === 'th' ? (randInt(0, 1) ? thWords(n) : thDigits(n)) : (randInt(0, 3) ? enWords(n) : thDigits(n))

function line(ant, food) {
  const th = randInt(0, 1) === 1
  const lang = th ? 'th' : 'en'
  if (th) {
    const [, ft, unit] = food
    const ev = ant.kind === 'drop' ? ` แต่ทำหล่นไป ${say(ant.delta, lang)} ${unit}ระหว่างทาง`
      : ant.kind === 'find' ? ` แล้วเก็บเพิ่มได้อีก ${say(ant.delta, lang)} ${unit}หน้าเซเว่น` : ''
    return `${ant.th} แบก${ft}ออกมา ${say(ant.load, lang)} ${unit}${ev}`
  }
  const ev = ant.kind === 'drop' ? `, but dropped ${say(ant.delta, lang)} on the stairs`
    : ant.kind === 'find' ? `, then picked up ${say(ant.delta, lang)} more outside the 7-Eleven` : ''
  return `${ant.en} set out with ${say(ant.load, lang)} ${food[0]}${ev}.`
}

/** A new riddle: { id, text, question, most, fewest } where most/fewest are
 *  English names. Loads are 10–60, a drop or find 1–15; the most and the
 *  fewest are each unique. */
export function newRiddle() {
  for (;;) {
    const pool = [...NAMES]
    const ants = Array.from({ length: 6 }, () => {
      const [en, th] = pool.splice(randInt(0, pool.length - 1), 1)[0]
      const load = randInt(10, 60)
      const kind = pick(['drop', 'find', 'none'])
      const delta = kind === 'none' ? 0 : randInt(1, 15)
      return { en, th, load, kind, delta, net: load + (kind === 'find' ? delta : -delta) }
    })
    const nets = ants.map((a) => a.net)
    const hi = Math.max(...nets), lo = Math.min(...nets)
    if (nets.filter((n) => n === hi).length > 1 || nets.filter((n) => n === lo).length > 1) continue
    const food = pick(FOOD)
    return {
      id: randHex(10),
      text: ants.map((a) => line(a, food)).join('\n'),
      question: {
        en: 'Which ant got the most home, and which got the fewest? Reply with the two names, most first, e.g. "Som, Lek".',
        th: 'มดตัวไหนแบกกลับถึงรังได้มากที่สุด ตัวไหนน้อยที่สุด ตอบสองชื่อ ตัวที่มากที่สุดก่อน เช่น "ส้ม, เล็ก"',
      },
      most: ants.find((a) => a.net === hi).en,
      fewest: ants.find((a) => a.net === lo).en,
    }
  }
}

/** The first two ant names in an answer, in English, in the order given.
 *  Thai has no spaces between words, so names are found by position. */
export function namesIn(answer) {
  const s = String(answer ?? '').normalize('NFC')
  const hits = []
  for (const [en, th] of NAMES) {
    const m = s.match(new RegExp(`\\b${en}\\b`, 'i'))
    const at = [m ? m.index : -1, s.indexOf(th)].filter((i) => i >= 0)
    if (at.length) hits.push([Math.min(...at), en])
  }
  return hits.sort((a, b) => a[0] - b[0]).slice(0, 2).map((h) => h[1])
}

export function riddleRight(row, answer) {
  const [a, b] = namesIn(answer)
  return a === row.most && b === row.fewest
}
