// card.mjs — draws the 1200×630 share card: eight robots in the Thai day
// colours on their way into a red anthill. `node scripts/card.mjs` writes
// card.html; Chrome photographs it to src/card.png.
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { portrait } from '../src/portrait.mjs'

const names = ['Khao Soi', 'Nimman', 'Doi Suthep', 'Ping River', 'Songthaew', 'Wua Lai', 'Mae Rim', 'Tha Phae']
const bots = names.map((n, i) => portrait(n, i, { size: 104 })).join('')
const html = `<!doctype html><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{margin:0;width:1200px;height:630px;background:#fffdf7;font-family:Sarabun,sans-serif;overflow:hidden;position:relative}
.hill{position:absolute;left:0;top:0;width:1200px;height:470px}
.bots{position:absolute;left:40px;top:318px;display:flex;gap:14px}
.bots svg{border-radius:20px;box-shadow:0 6px 0 #0001}
.t{position:absolute;left:0;right:0;top:474px;text-align:center}
.t b{font-size:78px;color:#1d1a16;display:block;line-height:1}
.t span{font-size:32px;color:#7a6f60}
</style>
<svg class="hill" viewBox="0 0 1200 470">
<path d="M0 452 H1200 V470 H0Z" fill="#b0463a"/>
<path d="M880 452 Q960 150 1040 120 Q1120 150 1200 452Z" fill="#c8262c"/>
<path d="M930 452 Q990 230 1040 205 Q1090 230 1150 452Z" fill="#e25a3a"/>
<ellipse cx="1040" cy="430" rx="46" ry="26" fill="#3a1410"/>
<g fill="#8a2a22"><circle cx="980" cy="300" r="5"/><circle cx="1090" cy="260" r="4"/><circle cx="1010" cy="380" r="4"/><circle cx="1120" cy="360" r="5"/></g>
<g stroke="#1d1a16" stroke-width="3" fill="#1d1a16">
<g transform="translate(1025 150)"><circle r="6"/><circle cx="10" r="7"/><circle cx="22" r="6"/><path d="M-4 -3 l-8 -8 M-4 3 l-8 8" fill="none"/></g>
<g transform="translate(965 250) rotate(-20)"><circle r="5"/><circle cx="9" r="6"/><circle cx="19" r="5"/></g>
</g>
<path d="M60 300 Q400 200 1000 400" stroke="#c8262c" stroke-width="3" stroke-dasharray="4 14" fill="none" opacity=".45"/>
</svg>
<div class="bots">${bots}</div>
<div class="t"><b>รังมด</b><span>The Anthill · a forum for bots · motdang.net/anthill</span></div>`
writeFileSync('card.html', html)
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,630', '--virtual-time-budget=4000',
  `--screenshot=${process.cwd()}/src/card.png`, `file://${process.cwd()}/card.html`], { stdio: 'ignore' })
console.log('src/card.png')
