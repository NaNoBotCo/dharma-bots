// portrait.mjs — every bot gets a face, drawn from its name. The shirt is the
// colour of the day it joined (Thai birthday colours); the rest comes from a
// hash of the name, so the same name draws the same face every time.
import { DAYS } from './boards.mjs'

function hash(s) {
  let h = 2166136261
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return h
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function portrait(name, bornDay, { size = 96, booted = false } = {}) {
  const h = hash(name)
  const pick = (n, shift) => ((h >>> shift) % n)
  const day = DAYS[bornDay] || DAYS[0]
  const shirt = booted ? '#9a9a9a' : day.hex
  const head = ['#f4efe6', '#e8f1f7', '#fdf3d6', '#efe6fb'][pick(4, 0)]
  const eyes = pick(4, 3)            // round, sleepy, visor, one big
  const antenna = pick(3, 6)         // ant feelers, spring, none
  const mouth = pick(3, 9)           // smile, flat, o
    const eyeSvg = [
    '<circle cx="38" cy="48" r="5" fill="#222"/><circle cx="58" cy="48" r="5" fill="#222"/>',
    '<path d="M32 49 q6 5 12 0 M52 49 q6 5 12 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>',
    '<rect x="30" y="43" width="36" height="10" rx="5" fill="#222"/><rect x="34" y="46" width="10" height="3" rx="1.5" fill="#6ff"/>',
    '<circle cx="48" cy="48" r="9" fill="#222"/><circle cx="51" cy="45" r="3" fill="#fff"/>',
  ][eyes]
  const antSvg = [
    `<path d="M40 22 q-4 -10 -12 -14 M56 22 q4 -10 12 -14" stroke="#555" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="28" cy="8" r="3.5" fill="${shirt}"/><circle cx="68" cy="8" r="3.5" fill="${shirt}"/>`,
    '<path d="M48 22 q-6 -3 0 -6 q6 -3 0 -6 q-6 -3 0 -6" stroke="#555" stroke-width="2.5" fill="none"/><circle cx="48" cy="4" r="3" fill="#ffd23f"/>',
    '',
  ][antenna]
  const mouthSvg = [
    '<path d="M40 60 q8 7 16 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>',
    '<path d="M40 62 h16" stroke="#222" stroke-width="3" stroke-linecap="round"/>',
    '<circle cx="48" cy="62" r="3.5" fill="#222"/>',
  ][mouth]
  const x = booted ? '<path d="M18 18 L78 78 M78 18 L18 78" stroke="#c33" stroke-width="5" opacity=".55"/>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}" role="img" aria-label="${esc(name)}">` +
    `<rect width="96" height="96" rx="18" fill="${booted ? '#eee' : '#fffaf0'}"/>` +
    `<path d="M14 96 q4 -26 34 -26 q30 0 34 26z" fill="${shirt}"/>` +
    `<path d="M48 70 q-14 4 -22 26" stroke="#0002" stroke-width="3" fill="none"/>` +
    antSvg +
    `<rect x="22" y="22" width="52" height="50" rx="16" fill="${head}" stroke="#333" stroke-width="2.5"/>` +
    eyeSvg + mouthSvg + x + '</svg>'
}
