# Side-by-side before/after images for docs/mobile-ux-fixes.md.
#   .venv/bin/python scripts/mux/pairs.py <beforeDir> <afterDir> <outDir>
# Reads <dir>/<shot>.png from fixshots.mjs and writes previews/muxfix-NN-<mid>.png.
import sys
from PIL import Image, ImageDraw, ImageFont

before, after, out = sys.argv[1:4]
PAIRS = [  # (number, shot, issue, caption)
    ('01', 'm01', 'm01', 'Pinch that starts on the dock'),
    ('02', 'm02', 'm02', 'Tap the map during a tour'),
    ('03', 'm03', 'm03', 'Badshahi Mosque selected'),
    ('05', 'm05', 'm05', 'Play all: badge vs cinema exit'),
    ('06', 'm06', 'm06', 'Duel: typing "Kar" with the keyboard up'),
    ('09', 'm09', 'm09', 'First visit on a phone'),
    ('09', 'm09-welcome', 'm09-welcome', 'Welcome wording'),
    ('11', 'm11', 'm11', 'iPad portrait 820x1180'),
    ('12', 'm12', 'm12', 'K2 tour, stop 2: labels at the edge'),
]
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
except OSError:
    font = ImageFont.load_default()

for nn, shot, name, caption in PAIRS:
    a, b = Image.open(f'{before}/{shot}.png').convert('RGB'), Image.open(f'{after}/{shot}.png').convert('RGB')
    if a.width > 1000:  # the tablet: halve it
        a, b = (im.resize((im.width // 2, im.height // 2), Image.LANCZOS) for im in (a, b))
    gap, head = 24, 64
    canvas = Image.new('RGB', (a.width + b.width + gap, max(a.height, b.height) + head), (7, 9, 13))
    canvas.paste(a, (0, head)); canvas.paste(b, (a.width + gap, head))
    d = ImageDraw.Draw(canvas)
    d.text((16, 16), f'BEFORE (main) · {caption}', fill=(255, 106, 77), font=font)
    d.text((a.width + gap + 16, 16), 'AFTER (fix/mobile-ux-all)', fill=(48, 209, 88), font=font)
    mid = name.replace('m', 'm-', 1) if '-' not in name else 'm-09-welcome'
    path = f'{out}/muxfix-{nn}-{mid}.png'
    canvas.save(path, optimize=True)
    print(path, canvas.size)
