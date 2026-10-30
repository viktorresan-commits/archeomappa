#!/usr/bin/env python3
"""Genera le icone PNG dell'app (richiede Pillow). Uso: python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BOSCO = (31, 58, 46, 255)
LINEA = (143, 214, 185, 255)
AMBRA = (224, 165, 58, 255)
MENTA = (47, 191, 148, 120)
CHIARO = (191, 245, 223, 255)

OUTER = [(-0.80, -0.20), (-0.35, -0.75), (0.45, -0.70), (0.85, 0.05), (0.40, 0.75), (-0.45, 0.70)]
CENTRO = (0.02, 0.02)


def disegna(dim: int, contenuto: float, pieno: bool = True) -> Image.Image:
    """contenuto = quota del lato occupata dal disegno (0.6 per le icone mascherabili)."""
    s = dim * 4  # sovracampionamento per bordi morbidi
    img = Image.new("RGBA", (s, s), BOSCO if pieno else (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    cx = cy = s / 2
    k = s * contenuto / 2

    def p(pt):
        return (cx + pt[0] * k, cy + pt[1] * k)

    pts = [p(q) for q in OUTER]
    c = p(CENTRO)
    tri = [(c, pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]

    # triangolo evidenziato (potenziale alto)
    ev = tri[2]
    d.polygon(ev, fill=MENTA)
    w = max(2, int(s * 0.012))
    for t in tri:
        d.line([t[0], t[1], t[2], t[0]], fill=LINEA, width=w, joint="curve")
    r = s * 0.032
    for q in pts + [c]:
        d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=AMBRA)
    g = ((ev[0][0] + ev[1][0] + ev[2][0]) / 3, (ev[0][1] + ev[1][1] + ev[2][1]) / 3)
    r2 = s * 0.04
    d.ellipse([g[0] - r2, g[1] - r2, g[0] + r2, g[1] + r2], fill=CHIARO)
    return img.resize((dim, dim), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    disegna(192, 0.84).convert("RGB").save(OUT / "icon-192.png", optimize=True)
    disegna(512, 0.84).convert("RGB").save(OUT / "icon-512.png", optimize=True)
    disegna(512, 0.58).convert("RGB").save(OUT / "maskable-512.png", optimize=True)
    disegna(180, 0.80).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    print("icone create in", OUT)


if __name__ == "__main__":
    main()
