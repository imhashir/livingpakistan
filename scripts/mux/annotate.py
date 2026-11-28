"""Annotate audit screenshots: boxes/labels in CSS px (scaled by DPR) and
optional tap-target overlays from a matrix JSON state.
Usage: python3 scripts/mux/annotate.py spec.json
spec: [{"src": ..., "out": ..., "dpr": 2, "boxes": [{"x","y","w","h","label","color"}],
        "targets": {"json": "/tmp/mux-matrix/i14.json", "state": "tour", "max": 44},
        "banner": "caption text", "crop": [x0,y0,x1,y1] (css px)}]
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, sz)
        except OSError: pass
    return ImageFont.load_default()

COL = {'red': (255, 45, 85), 'amber': (255, 159, 10), 'violet': (88, 86, 214), 'green': (52, 199, 89)}

def box(d, x, y, w, h, color, label, s, F):
    c = COL.get(color, color) if isinstance(color, str) else tuple(color)
    x, y, w, h = [v * s for v in (x, y, w, h)]
    for k in range(3):
        d.rectangle([x - k, y - k, x + w + k, y + h + k], outline=c if k < 2 else (0, 0, 0))
    if label:
        tw = d.textlength(label, font=F) + 10
        th = F.size + 8
        ly = y - th - 2 if y - th - 2 > 0 else y + h + 3
        lx = max(0, min(d.im.size[0] - tw, x))
        d.rectangle([lx, ly, lx + tw, ly + th], fill=c)
        d.text((lx + 5, ly + 3), label, fill=(255, 255, 255), font=F)

for spec in json.load(open(sys.argv[1])):
    im = Image.open(spec['src']).convert('RGB')
    s = spec.get('dpr', 2)
    d = ImageDraw.Draw(im)
    F = font(int(11 * s))
    for b in spec.get('boxes', []):
        box(d, b['x'], b['y'], b['w'], b['h'], b.get('color', 'red'), b.get('label'), s, F)
    t = spec.get('targets')
    if t:
        st = json.load(open(t['json']))['states'][t['state']]
        F2 = font(int(9 * s))
        for g in st['targets']:
            if g['covered'] or (g['w'] >= 44 and g['h'] >= 44): continue
            if g['x'] + g['w'] < 0 or g['x'] > st['vw']: continue
            color = 'red' if min(g['w'], g['h']) < 32 else 'amber'
            box(d, g['x'], g['y'], g['w'], g['h'], color, f"{g['w']}×{g['h']}", s, F2)
    if spec.get('banner'):
        FB = font(int(12 * s)); pad = 6 * s
        lines = []
        for para in spec['banner'].split('\n'):
            cur = ''
            for w in para.split(' '):
                t = (cur + ' ' + w).strip()
                if d.textlength(t, font=FB) > im.size[0] - 2 * pad and cur: lines.append(cur); cur = w
                else: cur = t
            lines.append(cur)
        hh = len(lines) * (FB.size + 4) + pad * 2
        d.rectangle([0, im.size[1] - hh, im.size[0], im.size[1]], fill=(0, 0, 0))
        for i, line in enumerate(lines):
            d.text((pad, im.size[1] - hh + pad + i * (FB.size + 4)), line, fill=(255, 214, 10), font=FB)
    if spec.get('crop'):
        x0, y0, x1, y1 = [v * s for v in spec['crop']]
        im = im.crop((x0, y0, x1, y1))
    im.save(spec['out'], optimize=True)
    print('wrote', spec['out'], im.size)
