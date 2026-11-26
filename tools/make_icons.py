#!/usr/bin/env python3
"""App icon generator: pastel rounded square + speech bubble with a cute face."""
from PIL import Image, ImageDraw

S = 1024  # master size

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def draw_icon(pad_ratio=0.0):
    """pad_ratio: extra transparent padding (for maskable icons)."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(S * pad_ratio)
    box = [pad, pad, S - pad, S - pad]
    # vertical pastel gradient background
    top = (255, 209, 220)     # pastel pink
    bottom = (178, 231, 218)  # pastel mint
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        gd.line([(0, y), (S, y)], fill=lerp(top, bottom, y / S) + (255,))
    grad.putalpha(rounded_mask(S, int(S * 0.22)))
    img = Image.alpha_composite(img, grad)
    d = ImageDraw.Draw(img)
    # speech bubble (white, rounded) centered slightly above middle
    bx0, by0, bx1, by1 = int(S * 0.20), int(S * 0.24), int(S * 0.80), int(S * 0.66)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(S * 0.10), fill=(255, 255, 255, 255))
    # bubble tail
    d.polygon([(int(S * 0.38), by1 - 4), (int(S * 0.52), by1 - 4), (int(S * 0.40), int(S * 0.78))],
              fill=(255, 255, 255, 255))
    # face: eyes + smile + cheeks
    eye_y = int(S * 0.42)
    for ex in (int(S * 0.40), int(S * 0.60)):
        d.ellipse([ex - int(S * 0.028), eye_y - int(S * 0.038), ex + int(S * 0.028), eye_y + int(S * 0.038)],
                  fill=(90, 74, 84, 255))
    d.arc([int(S * 0.43), int(S * 0.44), int(S * 0.57), int(S * 0.56)], start=15, end=165,
          fill=(90, 74, 84, 255), width=int(S * 0.016))
    for cx in (int(S * 0.315), int(S * 0.685)):
        d.ellipse([cx - int(S * 0.045), int(S * 0.475) - int(S * 0.026),
                   cx + int(S * 0.045), int(S * 0.475) + int(S * 0.026)], fill=(255, 168, 184, 160))
    # small star accent
    cx, cy, r = int(S * 0.80), int(S * 0.16), int(S * 0.045)
    pts = []
    import math
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    d.polygon(pts, fill=(255, 214, 90, 255))
    return img

base = draw_icon(0.0)
maskable = draw_icon(0.10)
import os
out = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(out, exist_ok=True)
base.resize((512, 512), Image.LANCZOS).save(f"{out}/icon-512.png")
base.resize((192, 192), Image.LANCZOS).save(f"{out}/icon-192.png")
base.resize((180, 180), Image.LANCZOS).save(f"{out}/apple-touch-icon.png")
base.resize((152, 152), Image.LANCZOS).save(f"{out}/icon-152.png")
maskable.resize((512, 512), Image.LANCZOS).save(f"{out}/icon-maskable-512.png")
base.resize((32, 32), Image.LANCZOS).save(f"{out}/favicon-32.png")
print("icons written to", out)
