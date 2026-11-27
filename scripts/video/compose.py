"""Compose the PakCiv demo video from recorded frames + timeline.

  .venv/bin/python scripts/video/compose.py /tmp/pakciv-video/raw media/pakciv-demo.mp4

Per frame: soft eased zoom/pan highlight (cosine ease between keyframes) → 1280×720 Lanczos resample → cursor with
click ripples → minimal chapter label / title / outro cards. Then a two-pass H.264 encode (yuv420p, +faststart).
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pakciv-video/raw")
OUT_MP4 = Path(sys.argv[2] if len(sys.argv) > 2 else "media/pakciv-demo.mp4")
TMP = RAW.parent / "composed"
OW, OH = 1280, 720
ZOOM_FRAMES = 24          # 0.8 s ease between zoom keyframes
TARGET_KBPS = 950         # ≈ 11–12 MB for ~95 s

FONT_DIR = Path("/usr/share/fonts/truetype/sand-box/google")
CINZEL = FONT_DIR / "Cinzel/Cinzel-VariableFont_wght.ttf"
INTER = FONT_DIR / "Inter/Inter-VariableFont_opsz,wght.ttf"


def font(path: Path, size: int, weight: str):
    f = ImageFont.truetype(str(path), size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


F_TITLE = font(CINZEL, 30, "Bold")
F_SUB = font(INTER, 16, "Medium")
F_HERO = font(CINZEL, 92, "Black")
F_HERO_SUB = font(INTER, 22, "Medium")
F_SMALL = font(INTER, 15, "Regular")
GOLD = (243, 213, 138)
INK = (243, 234, 214)


def cos_ease(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * t)


def zoom_states(zooms, n_frames):
    """Per-frame (cx, cy, s): each keyframe eases from wherever the camera was when it was set."""
    zooms = sorted(zooms, key=lambda z: z["f"])
    states = []
    cur = (zooms[0]["cx"], zooms[0]["cy"], zooms[0]["s"])
    start, target, t0 = cur, cur, 0
    zi = 1
    for f in range(n_frames):
        while zi < len(zooms) and zooms[zi]["f"] <= f:
            start = cur
            target = (zooms[zi]["cx"], zooms[zi]["cy"], zooms[zi]["s"])
            t0 = zooms[zi]["f"]
            zi += 1
        k = cos_ease((f - t0) / ZOOM_FRAMES)
        # interpolate scale in log space so zooming feels even
        s = math.exp(math.log(start[2]) + (math.log(target[2]) - math.log(start[2])) * k)
        cur = (start[0] + (target[0] - start[0]) * k, start[1] + (target[1] - start[1]) * k, s)
        states.append(cur)
    return states


def cursor_sprite(scale=1.0):
    """Classic arrow cursor, white with dark outline + soft shadow, drawn at 4× then downsampled."""
    S = 4
    pts = [(0, 0), (0, 17), (4.2, 13.2), (7, 19.5), (9.6, 18.4), (6.9, 12.3), (12.2, 12.3)]
    w, h = int(22 * S), int(26 * S)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = [(2 * S + x * S * scale, 2 * S + y * S * scale) for x, y in pts]
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + 1.5 * S, y + 2 * S) for x, y in P], fill=(0, 0, 0, 120))
    sh = sh.filter(ImageFilter.GaussianBlur(2 * S))
    img = Image.alpha_composite(sh, img)
    d = ImageDraw.Draw(img)
    d.polygon(P, fill=(255, 255, 255, 255), outline=(20, 20, 24, 255))
    d.line(P + [P[0]], fill=(20, 20, 24, 255), width=int(1.3 * S), joint="curve")
    return img.resize((w // S, h // S), Image.LANCZOS)


CURSOR = cursor_sprite()


def draw_label(base: Image.Image, title: str, sub: str, alpha: float):
    if alpha <= 0:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw = d.textlength(title.upper(), font=F_TITLE)
    sw = d.textlength(sub, font=F_SUB)
    w = int(max(tw, sw) + 56)
    h = 78
    x0 = (OW - w) // 2
    y0 = 84
    a = int(255 * alpha)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=16, fill=(12, 14, 18, int(200 * alpha)),
                        outline=(217, 173, 74, int(170 * alpha)), width=1)
    d.text((OW / 2, y0 + 26), title.upper(), font=F_TITLE, fill=GOLD + (a,), anchor="mm")
    d.text((OW / 2, y0 + 56), sub, font=F_SUB, fill=INK + (int(220 * alpha),), anchor="mm")
    base.alpha_composite(layer)


def draw_card(base: Image.Image, alpha: float, lines):
    if alpha <= 0:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle((0, 0, OW, OH), fill=(4, 6, 10, int(120 * alpha)))
    y = OH * 0.40
    for text, f, color in lines:
        d.text((OW / 2, y), text, font=f, fill=color + (int(255 * alpha),), anchor="mm")
        y += f.size * 1.15 + 10
    base.alpha_composite(layer)


def compose():
    tl = json.loads((RAW / "timeline.json").read_text())
    W, H, n = tl["width"], tl["height"], len(tl["frames"])
    states = zoom_states(tl["zooms"], n)
    clicks = tl["clicks"]
    TMP.mkdir(parents=True, exist_ok=True)
    for f in range(n):
        src = Image.open(RAW / f"f{f:05d}.jpg").convert("RGB")
        cx, cy, s = states[f]
        cw, ch = W / s, H / s
        x0 = min(max(cx - cw / 2, 0), W - cw)
        y0 = min(max(cy - ch / 2, 0), H - ch)
        frame = src.resize((OW, OH), Image.LANCZOS, box=(x0, y0, x0 + cw, y0 + ch)).convert("RGBA")
        sx, sy = OW / cw, OH / ch
        # click ripples
        cxy = tl["frames"][f]["c"]
        px, py = (cxy[0] - x0) * sx, (cxy[1] - y0) * sy
        d = ImageDraw.Draw(frame)
        for cf in clicks:
            age = f - cf
            if 0 <= age < 14:
                r = 8 + age * 2.2
                a = int(200 * (1 - age / 14))
                ov = Image.new("RGBA", frame.size, (0, 0, 0, 0))
                ImageDraw.Draw(ov).ellipse((px - r, py - r, px + r, py + r), outline=(243, 213, 138, a), width=3)
                frame.alpha_composite(ov)
        # cursor (hidden during title / outro cards)
        in_title = "title" in tl and f < tl["title"]["f"] + tl["title"]["n"]
        in_outro = "outro" in tl and f >= tl["outro"]["f"]
        if not in_title and not in_outro:
            frame.alpha_composite(CURSOR, (int(px) - 2, int(py) - 2))
        # chapter labels
        for c in tl["chapters"]:
            age = f - c["f"]
            if 0 <= age < c["n"]:
                fade = 9
                al = min(1, age / fade, (c["n"] - age) / fade)
                draw_label(frame, c["title"], c["sub"], cos_ease(al))
        if in_title:
            t = tl["title"]
            age = f - t["f"]
            al = min(1.0, (t["n"] - age) / 20) if age > 20 else min(1.0, age / 10 + 0.3)
            draw_card(frame, cos_ease(al), [("PAKCIV", F_HERO, GOLD),
                                              ("Pakistan as a 3D strategy map — built from real public data", F_HERO_SUB, INK)])
        if in_outro:
            age = f - tl["outro"]["f"]
            al = min(1.0, age / 24)
            draw_card(frame, cos_ease(al), [("PAKCIV", F_HERO, GOLD),
                                              ("23 public data sources · 3,409 hexes · 160 districts · 100% static Three.js", F_HERO_SUB, INK),
                                              ("github.com/imhashir/pakciv", F_SMALL, GOLD)])
        frame.convert("RGB").save(TMP / f"c{f:05d}.jpg", quality=95)
        if f % 300 == 0:
            print("composed", f, "/", n, flush=True)
    return n


def encode(n):
    OUT_MP4.parent.mkdir(parents=True, exist_ok=True)
    common = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", str(TMP / "c%05d.jpg"),
              "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-color_range", "tv",
              "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p",
              "-b:v", f"{TARGET_KBPS}k", "-maxrate", f"{TARGET_KBPS * 2}k", "-bufsize", f"{TARGET_KBPS * 4}k",
              "-g", "60", "-r", "30"]
    plog = str(TMP / "x264pass")
    subprocess.run(common + ["-pass", "1", "-passlogfile", plog, "-an", "-f", "mp4", "/dev/null"], check=True)
    subprocess.run(common + ["-pass", "2", "-passlogfile", plog, "-an", "-movflags", "+faststart", str(OUT_MP4)], check=True)
    print("wrote", OUT_MP4, OUT_MP4.stat().st_size / 1e6, "MB")


if __name__ == "__main__":
    n = compose()
    encode(n)
