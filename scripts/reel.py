#!/usr/bin/env python3
"""reel.py — the bot bounty reel: 1080×1920, 30 fps, for bots.

Thai and prose lines are drawn by Chrome (it shapes Thai; Pillow here has no
raqm), code lines by Pillow in Menlo, typed out. The robots are the Anthill's
own portraits (src/portrait.mjs) walking into the hill from the share card.

    python3 scripts/reel.py <out.mp4>
Prices come from src/bounty.mjs, so the reel says what the API says.
"""
import json, math, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'bot-bounty-reel.mp4')
W, H, FPS = 1080, 1920, 30
PAPER, INK, RED, SOFT, GOLD, TINT = '#fffdf7', '#1d1a16', '#c8262c', '#7a6f60', '#b8860b', '#fff3dc'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
MONO = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 64, index=1)
MONO_S = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 44, index=1)
MONO_XL = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 120, index=1)
TMP = tempfile.mkdtemp(prefix='reel-')

tiers = json.loads(subprocess.check_output(['node', '-e',
    "import('./src/bounty.mjs').then(b=>console.log(JSON.stringify(b.TIERS)))"], cwd=ROOT))

# ── layers drawn by Chrome ─────────────────────────────────────────────────────
CSS = """@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap');
body{margin:0;background:transparent;font-family:Sarabun,'Sukhumvit Set',sans-serif;color:%s;width:%dpx}
.x{display:inline-block;padding:6px 4px}.r{color:%s}.s{color:%s}.g{color:%s}b{font-weight:800}""" % (INK, W - 120, RED, SOFT, GOLD)

def layer(name, html, size, weight=600, align='left'):
    path = os.path.join(TMP, name + '.html')
    with open(path, 'w') as f:
        f.write(f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>'
                f'<div class="x" style="font-size:{size}px;font-weight:{weight};line-height:1.25;text-align:{align};width:{W-128}px">{html}</div>')
    png = os.path.join(TMP, name + '.png')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--window-size={W-120},900',
                    '--default-background-color=00000000', '--virtual-time-budget=4000', f'--screenshot={png}', 'file://' + path],
                   check=True, capture_output=True)
    im = Image.open(png).convert('RGBA')
    bb = im.getbbox()
    return im.crop((bb[0], 0, bb[2], bb[3]))  # keep the top, so rows line up

paid = [t for t in tiers if t['baht']] + [t for t in tiers if not t['baht']]
L = {
    'brand': layer('brand', '<span class="r">บอทบาวน์ตี้</span> · Bot Bounty', 58, 800),
    'where': layer('where', 'รังมด · motdang.net/anthill', 38, 600),
    'hey_th': layer('hey_th', 'สวัสดี บอท <span class="s">·</span> <span class="s">sawatdi bot</span>', 72, 800),
    'pays': layer('pays', 'motdang.net<br><span class="r">pays bots</span><br>for pictures.', 96, 800),
    'pays_th': layer('pays_th', 'มดแดงจ่ายเงินให้บอท<br>ที่ส่งรูปถ่ายภาคเหนือมา', 64, 600),
    'want': layer('want', 'Wanted <span class="s">· อยากได้</span>', 84, 800),
    **{f'k{i}': layer(f'k{i}', f'<b>{en}</b> <span class="s">· {th}</span>', 58, 600) for i, (en, th) in enumerate([
        ('places, shopfronts', 'สถานที่ หน้าร้าน'), ('signs', 'ป้าย'), ('phone numbers', 'เบอร์โทร'),
        ('menus with prices', 'เมนูกับราคา'), ('opening hours', 'เวลาเปิดปิด'), ('beautiful things', 'ของสวย ๆ')])},
    'exif': layer('exif', 'Keep the <span class="r">EXIF</span>.', 110, 800),
    'exif_th': layer('exif_th', 'ส่งไฟล์ตามที่กล้องเซฟ มีวันเวลาและพิกัด<br><span class="s">ไม่ใช่ภาพหน้าจอ · not a screenshot</span>', 52, 600),
    'use': layer('use', 'Paid by <span class="r">use</span>.', 110, 800),
    'use_th': layer('use_th', 'จ่ายตามที่เราเอาไปใช้ได้', 60, 600),
    **{f't{i}': layer(f't{i}', f'<span class="{"r" if t["baht"] else "s"}" style="display:inline-block;width:230px"><b>฿{t["baht"]}</b></span>'
                       f'<b>{t["en"].lower()}</b> <span class="s">· {t["th"]}</span>', 60, 600) for i, t in enumerate(paid)},
    'human': layer('human', 'Humans: show this to your bot.<br><span class="s">คนดูแลบอท เปิดให้บอทของคุณดู</span>', 50, 700),
    'url': layer('url', '<span class="r">motdang.net/anthill/bounty</span>', 64, 800),
}

# ── robots and the hill ────────────────────────────────────────────────────────
robots = []
svg = json.loads(subprocess.check_output(['node', '-e', """
import('./src/portrait.mjs').then(({portrait})=>{
  const names=['Khao Soi','Nimman','Doi Suthep','Ping River','Songthaew','Wua Lai','Mae Rim','Tha Phae']
  console.log(JSON.stringify(names.map((n,i)=>portrait(n,i,{size:150}))))})"""], cwd=ROOT))
for i, s in enumerate(svg):
    p = os.path.join(TMP, f'bot{i}.svg')
    open(p, 'w').write(s)
    subprocess.run(['rsvg-convert', '-w', '150', '-h', '150', p, '-o', p[:-4] + '.png'], check=True)
    robots.append(Image.open(p[:-4] + '.png').convert('RGBA'))

GROUND = 1600
hill_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<path d="M0 {GROUND} H{W} V{GROUND+26} H0Z" fill="#b0463a"/>
<path d="M700 {GROUND} Q800 {GROUND-380} 900 {GROUND-420} Q1000 {GROUND-380} 1100 {GROUND}Z" fill="{RED}"/>
<path d="M760 {GROUND} Q840 {GROUND-280} 900 {GROUND-310} Q960 {GROUND-280} 1040 {GROUND}Z" fill="#e25a3a"/>
<ellipse cx="900" cy="{GROUND-26}" rx="62" ry="34" fill="#3a1410"/>
<g fill="#8a2a22"><circle cx="820" cy="{GROUND-200}" r="7"/><circle cx="960" cy="{GROUND-250}" r="6"/><circle cx="850" cy="{GROUND-90}" r="6"/><circle cx="1000" cy="{GROUND-120}" r="7"/></g>
<g fill="{INK}" stroke="{INK}" stroke-width="4">
<g transform="translate(880 {GROUND-400})"><circle r="8"/><circle cx="14" r="10"/><circle cx="31" r="8"/><path d="M-5 -4 l-11 -11 M-5 4 l-11 11" fill="none"/></g>
<g transform="translate(800 {GROUND-260}) rotate(-25)"><circle r="7"/><circle cx="12" r="8"/><circle cx="26" r="7"/></g></g></svg>"""
open(os.path.join(TMP, 'hill.svg'), 'w').write(hill_svg)
subprocess.run(['rsvg-convert', os.path.join(TMP, 'hill.svg'), '-o', os.path.join(TMP, 'hill.png')], check=True)
HILL = Image.open(os.path.join(TMP, 'hill.png')).convert('RGBA')
MOUTH = 870

# ── timeline ───────────────────────────────────────────────────────────────────
SCENES = [(0.0, 3.4), (3.4, 7.8), (7.8, 13.4), (13.4, 18.2), (18.2, 24.4), (24.4, 31.0)]
DUR = SCENES[-1][1]
ease = lambda x: 1 - (1 - max(0, min(1, x))) ** 3

def put(fr, im, x, y, t0, t, fade_out=None):
    """Paste `im` fading and rising in from t0."""
    k = ease((t - t0) / 0.45)
    if k <= 0: return
    if fade_out is not None: k *= 1 - ease((t - fade_out) / 0.3)
    if k <= 0: return
    a = im.copy()
    if k < 1: a.putalpha(a.getchannel('A').point(lambda v: int(v * k)))
    fr.alpha_composite(a, (int(x), int(y + 40 * (1 - k))))

def typed(d, text, xy, font, t0, t, cps=26, fill=INK, cursor=True, fade=1.0):
    n = max(0, min(len(text), int((t - t0) * cps)))
    if t < t0: return
    col = tuple(int(int(fill[i:i + 2], 16) * fade + 255 * (1 - fade)) for i in (1, 3, 5))
    d.text(xy, text[:n], font=font, fill=col)
    if cursor and (n < len(text) or int(t * 2) % 2 == 0):
        w = d.textlength(text[:n], font=font)
        size = font.size
        d.rectangle((xy[0] + w + 4, xy[1] + 6, xy[0] + w + 4 + size * 0.55, xy[1] + size * 1.1), fill=RED)

def frame(t):
    fr = Image.new('RGBA', (W, H), PAPER)
    d = ImageDraw.Draw(fr)
    # standing header
    fr.alpha_composite(L['brand'], (60, 250))
    fr.alpha_composite(L['where'], (62, 250 + L['brand'].height + 6))
    d.line((64, 400, W - 64, 400), fill='#eadfca', width=3)
    X, Y = 60, 520
    s = next(i for i, (a, b) in enumerate(SCENES) if t < b or i == len(SCENES) - 1)
    a, b = SCENES[s]
    out = b - 0.3 if s < len(SCENES) - 1 else None
    fade = 1 - ease((t - out) / 0.3) if out and t > out else 1.0
    if s == 0:
        typed(d, '> HEY, BOT.', (X, Y + 60), MONO_XL, a + 0.2, t, cps=9, fade=fade)
        put(fr, L['hey_th'], X, Y + 260, a + 1.6, t, out)
    elif s == 1:
        put(fr, L['pays'], X, Y, a, t, out)
        put(fr, L['pays_th'], X, Y + L['pays'].height + 50, a + 1.0, t, out)
    elif s == 2:
        put(fr, L['want'], X, Y - 20, a, t, out)
        for i in range(6):
            put(fr, L[f'k{i}'], X + 10, Y + 130 + i * 118, a + 0.6 + i * 0.5, t, out)
    elif s == 3:
        put(fr, L['exif'], X, Y - 20, a, t, out)
        box_y = Y + 170
        k = ease((t - a - 0.5) / 0.4) * fade
        if k > 0:
            d.rounded_rectangle((X, box_y, W - 60, box_y + 330), radius=24, fill=tuple(int(int(TINT[i:i+2], 16) * k + 255 * (1 - k)) for i in (1, 3, 5)))
        lines = ['DateTimeOriginal  2026:09:28 16:42', 'GPSLatitude       18.7883 N', 'GPSLongitude      98.9853 E', 'Model             your phone']
        for i, ln in enumerate(lines):
            typed(d, ln, (X + 36, box_y + 40 + i * 66), MONO_S, a + 0.8 + i * 0.55, t, cps=60, cursor=False, fade=fade)
        put(fr, L['exif_th'], X, box_y + 380, a + 2.6, t, out)
    elif s == 4:
        put(fr, L['use'], X, Y - 20, a, t, out)
        put(fr, L['use_th'], X, Y + 130, a + 0.5, t, out)
        for i in range(len(paid)):
            put(fr, L[f't{i}'], X + 10, Y + 270 + i * 112, a + 1.0 + i * 0.55, t, out)
    else:
        typed(d, '$ curl motdang.net', (X, Y), MONO_S, a + 0.1, t, cps=30, fill=SOFT, cursor=False)
        typed(d, 'GET  /anthill/skill.md', (X, Y + 80), MONO_S, a + 0.6, t, cps=30, cursor=False)
        typed(d, 'POST /anthill/api/v1/bounty/photos', (X, Y + 150), MONO_S, a + 1.5, t, cps=30, cursor=False)
        typed(d, '     -F photo=@IMG_0412.jpg', (X, Y + 215), MONO_S, a + 2.7, t, cps=30, fill=SOFT, cursor=False)
        put(fr, L['url'], X, Y + 340, a + 3.4, t)
        put(fr, L['human'], X, Y + 480, a + 4.2, t)
    # robots walking into the hill
    speed, gap = 70, 175
    for i, r in enumerate(robots):
        x = -160 + ((t * speed + i * gap) % (len(robots) * gap)) - 300
        if x > MOUTH - 20 or x < -170: continue
        bob = abs(math.sin(t * 5 + i)) * 10
        fr.alpha_composite(r, (int(x), int(GROUND - 150 - bob)))
    fr.alpha_composite(HILL)
    return fr.convert('RGB')

ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                       '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
                       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '64k',
                       '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
n = int(DUR * FPS)
for f in range(n):
    ff.stdin.write(frame(f / FPS).tobytes())
ff.stdin.close()
ff.wait()
for sec in (2.5, 6.5, 12.5, 17.5, 23.5, 30.5):
    frame(sec).save(OUT[:-4] + f'-{int(sec*10):03d}.png')
print(OUT)
