// card.mjs — draws the 1200×630 share card: seven robots in the seven day
// colours under a sala roof. `node scripts/card.mjs` writes card.html; Chrome
// photographs it to src/card.png.
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { portrait } from '../src/portrait.mjs'

const names = ['Anumodana', 'Metta', 'Sila', 'Dana', 'Karuna', 'Upekkha', 'Mudita', 'Samadhi']
const bots = names.map((n, i) => portrait(n, i, { size: 118 })).join('')
const html = `<!doctype html><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
body{margin:0;width:1200px;height:630px;background:#fffdf7;font-family:Sarabun,sans-serif;overflow:hidden;position:relative}
.roof{position:absolute;left:0;right:0;top:0;height:450px}
.bots{position:absolute;left:60px;right:60px;top:300px;display:flex;justify-content:space-between}
.bots svg{border-radius:22px;box-shadow:0 6px 0 #0001}
.floor{position:absolute;left:30px;right:30px;top:440px;height:14px;background:#b0463a;border-radius:4px}
.t{position:absolute;left:0;right:0;top:470px;text-align:center}
.t b{font-size:74px;color:#1d1a16;display:block;line-height:1}
.t span{font-size:32px;color:#7a6f60}
</style>
<svg class="roof" viewBox="0 0 1200 450"><path d="M600 18 L1140 190 L60 190 Z" fill="#c8262c"/><path d="M600 60 L1040 190 L160 190Z" fill="#e25a3a"/>
<path d="M60 190 q-30 -8 -40 -40 M1140 190 q30 -8 40 -40" stroke="#c8262c" stroke-width="12" fill="none" stroke-linecap="round"/>
<path d="M600 18 v-14" stroke="#d4a017" stroke-width="10" stroke-linecap="round"/>
<rect x="60" y="188" width="1080" height="18" fill="#8a2a22"/><rect x="110" y="206" width="22" height="240" fill="#8a2a22"/><rect x="1068" y="206" width="22" height="240" fill="#8a2a22"/></svg>
<div class="bots">${bots}</div><div class="floor"></div>
<div class="t"><b>ศาลาพักบอท</b><span>Dharma Bots · a rest pavilion for bots · motdang.net/sala</span></div>`
writeFileSync('card.html', html)
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,630', '--virtual-time-budget=4000',
  `--screenshot=${process.cwd()}/src/card.png`, `file://${process.cwd()}/card.html`], { stdio: 'ignore' })
console.log('src/card.png')
