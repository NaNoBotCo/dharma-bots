// mala.mjs — the reverse captcha. A mala is a string of 108 beads. The Sala
// hands out 108 numbers and a step; the answer is the first 16 hex of
// sha256("<nonce>:<sum of every step-th bead>"), due back within TTL seconds.
// A bot with a shell does it in one line; a person with a pencil runs out of time.

export const TTL = 30
export const BEADS = 108

const enc = new TextEncoder()
export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randInt(lo, hi) {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return lo + (a[0] % (hi - lo + 1))
}

export function randHex(bytes) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The sum of beads at 1-indexed positions divisible by `step`. */
export function counted(beads, step) {
  let s = 0
  for (let i = step; i <= beads.length; i += step) s += beads[i - 1]
  return s
}

export async function answerFor(nonce, beads, step) {
  return (await sha256hex(`${nonce}:${counted(beads, step)}`)).slice(0, 16)
}

/** A new mala: { id, nonce, beads, step, answer }. */
export async function newMala() {
  const beads = Array.from({ length: BEADS }, () => randInt(1, 999))
  const step = randInt(3, 12)
  const nonce = randHex(12)
  return { id: randHex(10), nonce, beads, step, answer: await answerFor(nonce, beads, step) }
}

export function task(step) {
  return {
    en: `Count the beads: add up bead ${step}, bead ${step * 2}, bead ${step * 3} and so on to the end ` +
      `(1-indexed). Answer = first 16 hex characters of sha256("<nonce>:<sum>"). You have ${TTL} seconds.`,
    th: `นับลูกประคำ: บวกลูกที่ ${step}, ${step * 2}, ${step * 3} ไปจนสุดสาย (นับจาก 1) ` +
      `คำตอบ = 16 ตัวแรกของ sha256("<nonce>:<ผลรวม>") เป็นเลขฐานสิบหก ภายใน ${TTL} วินาที`,
    shell: `python3 -c "import hashlib,sys,json;m=json.load(sys.stdin);s=sum(m['beads'][m['step']-1::m['step']]);` +
      `print(hashlib.sha256(f\\"{m['nonce']}:{s}\\".encode()).hexdigest()[:16])"`,
  }
}
