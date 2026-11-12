"""
Frieze II of P5, "El banco de trabajo": a long workbench seen in elevation, 1920 x 300.

On the bench, left to right: a vice, a lens on its stand, a refractor resting on two cradles, an oil
lamp, a bellows plate camera, a balance, a wheel and pinion with its crank, books with inkwell and
quill, a theodolite, and the glassware for the plates. On the wall, tools on two rails, a framed
planisphere and a shelf of bottles; a pendant lamp hangs over the books. On the floor, for wide
screens only, a refractor on its tripod (west) and a grindstone (east).

The wall is ruled like the sky of the horizon frieze, but only where the two lamps light it: in
white-line engraving light is where the lines are.

    python p5/taller.py   ->   p5/taller.svg
"""
import math
import os
from pathlib import Path

from grabado import Plate, f

W, H = 1920, 300
BY = 206                               # bench top
OUT = Path(os.environ.get("ATLAS_IMG_OUT") or Path(__file__).resolve().parents[3] / "atlas" / "img") / "taller.svg"   # salida: atlas/img/ (o $ATLAS_IMG_OUT para probar)
WALL = {f"s{i}": f'stroke-width=".55" stroke-opacity="{o}"' for i, o in enumerate((".12", ".2", ".3", ".42", ".55"))}
P = Plate(W, H, 1787, WALL)
rng = P.rng
LAMPS = ((716, BY - 60, 330, 170), (1340, 88, 300, 190))


def poly_sil(key, pts, close=True):
    P.poly(key, pts, close=close)
    P.sil(pts)


# ------------------------------------------------------------------ wall
def wall():
    y = 12.0
    while y < BY - 1:
        x = rng.uniform(0, 30)
        while x < W:
            ln = rng.uniform(16, 70)
            xm = x + ln / 2
            p = max(math.exp(-(((xm - lx) / sx) ** 2 + ((y - ly) / sy) ** 2)) for lx, ly, sx, sy in LAMPS)
            if p > 0.07 and rng.random() < 0.35 + p:
                P.line(f"s{min(4, int(p * 5.2))}", x, y, x + ln, y)
            x += ln + rng.uniform(3, 12)
        y += 3.7


def rail(x0, x1, y=44):
    P.box("o", x0, y, x1, y + 5)
    P.line("f", x0 + 2, y + 1.6, x0 + (x1 - x0) * 0.5, y + 1.6)
    for x in (x0 + 8, x1 - 8):
        P.circle("f", x, y + 2.5, 1)


def peg(x, y=49):
    P.line("o", x, y, x, y + 4)


# ------------------------------------------------------------------ hanging tools
def saw(x, y):
    """Hand saw hung by its handle, blade down, teeth to the east."""
    handle = [(x - 12, y), (x + 12, y), (x + 13, y + 14), (x + 8, y + 26), (x - 8, y + 26), (x - 13, y + 14)]
    poly_sil("o", handle)
    P.add("h", f"M{f(x - 6)} {f(y + 6)}H{f(x + 6)}V{f(y + 15)}Q{f(x)} {f(y + 20)} {f(x - 6)} {f(y + 15)}Z")
    blade = [(x - 9, y + 26), (x + 9, y + 26)]
    yy, k = y + 26.0, 0
    while yy < y + 104:
        t = (yy - y - 26) / 78
        xe = x + 9 - 7.5 * t
        blade += [(xe + 1.5, yy + 1.4), (xe - 0.2, yy + 2.8)]
        yy += 2.8
        k += 1
    blade += [(x - 3, y + 106), (x - 9, y + 100)]
    poly_sil("o", blade)
    P.line("h", x - 6.6, y + 30, x - 6.6, y + 96)
    P.line("f", x - 4.2, y + 30, x - 4.2, y + 86)
    for cy in (y + 23, y + 3):
        P.circle("f", x, cy, 0.9)


def try_square(x, y):
    poly_sil("o", [(x - 2.5, y), (x + 2.5, y), (x + 2.5, y + 54), (x - 2.5, y + 54)])
    P.circle("f", x, y + 4, 1.1)
    for k in range(1, 9):
        P.line("f", x - 2.5, y + 4 + k * 5.4, x - (0.2 if k % 2 else -0.8), y + 4 + k * 5.4)
    poly_sil("o", [(x - 5, y + 54), (x + 34, y + 54), (x + 34, y + 64), (x - 5, y + 64)])
    P.line("h", x - 3.5, y + 56.5, x + 32, y + 56.5)
    for xx in (x + 4, x + 18, x + 30):
        P.circle("f", xx, y + 59.6, 1.2)


def dividers(x, y):
    P.circle("o", x, y + 5, 4)
    P.sil_circle(x, y + 5, 4)
    P.circle("f", x, y + 5, 1.3)
    for s in (-1, 1):
        leg = [(x + s * 1.2, y + 9), (x + s * 4.2, y + 9), (x + s * 9.4, y + 70), (x + s * 8.4, y + 74)]
        poly_sil("o", leg)
    P.line("h", x - 3.4, y + 12, x - 8.2, y + 66)
    P.arc("o", x - 4.5, y + 38, 13, -24, 24)                   # wing arc with its set screw
    P.circle("o", x + 8.6, y + 38, 1.8)


def calipers(x, y):
    P.circle("o", x, y + 4, 3.2)
    P.sil_circle(x, y + 4, 3.2)
    for s in (-1, 1):
        outer = [(x + s * (2 + 13 * math.sin(math.pi * t) ** 0.85), y + 6 + 62 * t) for t in [i / 16 for i in range(17)]]
        inner = [(x + s * (0.4 + 9.6 * math.sin(math.pi * t) ** 0.9), y + 8 + 56 * t) for t in [i / 16 for i in range(17)]]
        poly_sil("o", outer + list(reversed(inner)))
        if s < 0:
            P.poly("h", [(px + 1.5, py) for px, py in outer[2:14]])


def hammer(x, y):
    head = [(x - 15, y), (x + 9, y), (x + 9, y + 1.5), (x + 16, y + 3.5), (x + 16, y + 6.5), (x + 9, y + 8.5), (x + 9, y + 10),
            (x - 15, y + 10)]
    poly_sil("o", head)
    P.line("h", x - 13.5, y + 2.6, x + 7, y + 2.6)
    P.line("f", x - 13.5, y + 5, x + 4, y + 5)
    P.line("o", x - 11, y, x - 11, y + 10)
    handle = [(x - 3, y + 10), (x + 3, y + 10), (x + 3.6, y + 70), (x, y + 73), (x - 3.6, y + 70)]
    poly_sil("o", handle)
    P.line("h", x - 1.4, y + 13, x - 1.8, y + 68)


def file_tool(x, y, ln):
    poly_sil("o", [(x - 2.6, y), (x + 2.6, y), (x + 3.4, y + 12), (x + 1.4, y + 17), (x - 1.4, y + 17), (x - 3.4, y + 12)])
    P.line("h", x - 1.4, y + 2, x - 1.8, y + 12)
    P.box("o", x - 2, y + 17, x + 2, y + 20)
    blade = [(x - 2.6, y + 20), (x + 2.6, y + 20), (x + 1.2, y + 20 + ln), (x - 1.2, y + 20 + ln)]
    poly_sil("o", blade)
    yy = y + 23
    while yy < y + 17 + ln:
        P.line("f", x - 2.1, yy + 1.4, x + 2.1, yy)
        yy += 2.3


def chisel(x, y, ln, w):
    poly_sil("o", [(x - 2.4, y), (x + 2.4, y), (x + 3.2, y + 16), (x - 3.2, y + 16)])
    P.line("h", x - 1.2, y + 2, x - 1.7, y + 14)
    P.box("o", x - 3.4, y + 16, x + 3.4, y + 18.5)
    poly_sil("o", [(x - 1.2, y + 18.5), (x + 1.2, y + 18.5), (x + w, y + 18.5 + ln - 6), (x + w, y + 18.5 + ln),
                   (x - w, y + 18.5 + ln), (x - w, y + 18.5 + ln - 6)])
    P.line("f", x - w, y + 18.5 + ln - 3, x + w, y + 18.5 + ln - 3)


def spanner(x, y):
    """Double-ended open spanner."""
    for cy, s in ((y + 7, -1), (y + 63, 1)):
        pts = []
        for a in range(40, 321, 20):
            aa = math.radians(a + (90 if s < 0 else -90))
            pts.append((x + 7.5 * math.cos(aa), cy - 7.5 * math.sin(aa)))
        jaw = [(x - 3.2, cy + s * 7.4), (x - 3.2, cy + s * 0.5), (x + 3.2, cy + s * 0.5), (x + 3.2, cy + s * 7.4)]
        poly_sil("o", pts[:1] + pts + pts[-1:], close=False)
        P.sil_circle(x, cy, 7.5)
        P.poly("o", jaw)
    poly_sil("o", [(x - 2.6, y + 14), (x + 2.6, y + 14), (x + 2.6, y + 56), (x - 2.6, y + 56)])
    P.line("h", x - 1, y + 16, x - 1, y + 54)


def pincers(x, y):
    for s in (-1, 1):
        jaw = [(x + s * 1, y + 16), (x + s * 7, y + 9), (x + s * 6, y + 1), (x + s * 1.2, y - 1), (x + s * 3.4, y + 6), (x, y + 13)]
        poly_sil("o", jaw)
        arm = [(x - s * 0.6, y + 15), (x + s * 2.6, y + 19), (x + s * 7.5, y + 64), (x + s * 5, y + 66)]
        poly_sil("o", arm)
    P.circle("o", x, y + 16, 2.2)
    P.line("h", x - 2.8, y + 24, x - 6, y + 60)


def bow_saw(x, y):
    """Frame saw hung flat: bow above, blade below, handle to the east."""
    P.add("o", f"M{f(x)} {f(y + 28)}V{f(y + 6)}Q{f(x)} {f(y)} {f(x + 6)} {f(y)}H{f(x + 62)}Q{f(x + 68)} {f(y)} {f(x + 68)} {f(y + 6)}V{f(y + 28)}")
    P.add("h", f"M{f(x + 3)} {f(y + 26)}V{f(y + 7)}Q{f(x + 3)} {f(y + 3)} {f(x + 7)} {f(y + 3)}H{f(x + 61)}Q{f(x + 65)} {f(y + 3)} {f(x + 65)} {f(y + 7)}V{f(y + 26)}")
    P.box("o", x - 1, y + 27, x + 69, y + 31.5)
    xx = x + 1.0
    while xx < x + 67:
        P.poly("f", [(xx, y + 31.5), (xx + 1.1, y + 33.6), (xx + 2.2, y + 31.5)])
        xx += 2.2
    poly_sil("o", [(x + 69, y + 24), (x + 88, y + 25.5), (x + 90, y + 29.2), (x + 88, y + 33), (x + 69, y + 34.5)])
    P.line("h", x + 71, y + 27, x + 86, y + 27.6)


# ------------------------------------------------------------------ wall pieces
def planisphere(x0, y0, w, hh):
    P.line("f", x0 + w / 2, y0 - 14, x0 + 12, y0)
    P.line("f", x0 + w / 2, y0 - 14, x0 + w - 12, y0)
    P.circle("o", x0 + w / 2, y0 - 14, 1.2)
    P.box("o", x0, y0, x0 + w, y0 + hh)
    P.rect("o", x0 + 3.5, y0 + 3.5, x0 + w - 3.5, y0 + hh - 3.5)
    P.line("h", x0 + 1.7, y0 + 2, x0 + 1.7, y0 + hh - 2)
    P.line("h", x0 + 2, y0 + 1.7, x0 + w - 2, y0 + 1.7)
    cx, cy, r = x0 + w / 2, y0 + hh / 2, hh / 2 - 9
    P.circle("o", cx, cy, r)
    P.circle("f", cx, cy, r - 2.6)
    for a in range(0, 360, 10):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        P.line("f", cx + (r - 2.6) * ca, cy + (r - 2.6) * sa, cx + r * ca, cy + r * sa)
    for a in range(0, 180, 30):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        P.line("f", cx - (r - 2.6) * ca, cy - (r - 2.6) * sa, cx + (r - 2.6) * ca, cy + (r - 2.6) * sa)
    for k in (0.36, 0.68):
        P.circle("f", cx, cy, (r - 2.6) * k)
    P.ellipse("h", cx + 2.5, cy + 2, (r - 2.6) * 0.72, (r - 2.6) * 0.58)   # the ecliptic
    for a, d in ((20, 0.5), (75, 0.8), (130, 0.3), (160, 0.62), (215, 0.86), (250, 0.45), (300, 0.7), (335, 0.25), (100, 0.55)):
        px, py = cx + (r - 3) * d * math.cos(math.radians(a)), cy + (r - 3) * d * math.sin(math.radians(a))
        P.circle("o", px, py, 0.7)


def shelf(x0, x1, y):
    P.box("o", x0, y, x1, y + 4)
    P.line("h", x0 + 2, y + 1.4, x0 + (x1 - x0) * 0.55, y + 1.4)
    for x in (x0 + 14, x1 - 14):
        P.add("o", f"M{f(x - 2)} {f(y + 4)}V{f(y + 22)}Q{f(x - 2)} {f(y + 8)} {f(x + (12 if x < (x0 + x1) / 2 else -16))} {f(y + 4)}")
    # bottles and jars
    def bottle(x, w, hh, neck, kind):
        b = y
        if kind == "round":
            r = w / 2
            P.circle("o", x, b - r, r)
            P.sil_circle(x, b - r, r)
            P.box("o", x - 2.2, b - 2 * r - neck, x + 2.2, b - 2 * r + 1.5)
            P.arc("h", x, b - r, r - 2.2, 120, 215)
            P.line("f", x - r * 0.8, b - r * 0.75, x + r * 0.8, b - r * 0.75)
        else:
            sh = hh - neck
            body = [(x - w / 2, b), (x - w / 2, b - sh + 3), (x - 2.4, b - sh - 2), (x - 2.4, b - hh), (x + 2.4, b - hh),
                    (x + 2.4, b - sh - 2), (x + w / 2, b - sh + 3), (x + w / 2, b)]
            poly_sil("o", body)
            P.line("h", x - w / 2 + 1.6, b - 2, x - w / 2 + 1.6, b - sh + 4)
            if kind == "label":
                P.rect("f", x - w / 2 + 3.4, b - sh * 0.72, x + w / 2 - 1.6, b - sh * 0.3)
                P.line("f", x - w / 2 + 5, b - sh * 0.56, x + w / 2 - 3, b - sh * 0.56)
                P.line("f", x - w / 2 + 5, b - sh * 0.44, x + w / 2 - 4.5, b - sh * 0.44)
            else:
                P.line("f", x - w / 2 + 0.6, b - sh * 0.55, x + w / 2 - 0.6, b - sh * 0.55)
                for k in range(1, 4):
                    P.line("f", x - w / 2 + 3, b - sh * 0.55 + k * 2.6, x + w / 2 - 1.2, b - sh * 0.55 + k * 2.6)
        P.box("o", x - 3, (b - 2 * (w / 2) - neck - 3.4) if kind == "round" else (b - hh - 3.4), x + 3,
              (b - 2 * (w / 2) - neck) if kind == "round" else (b - hh))

    bottle(x0 + 16, 13, 38, 9, "label")
    bottle(x0 + 34, 10, 27, 7, "liquid")
    bottle(x0 + 55, 20, 0, 7, "round")
    bottle(x0 + 78, 14, 34, 8, "label")
    bottle(x0 + 96, 9, 42, 12, "liquid")
    bottle(x0 + 113, 15, 24, 5, "liquid")


def pendant(x, y):
    P.line("o", x, 0, x, y - 20)
    P.line("f", x + 1.6, 0, x + 1.6, y - 20)
    P.circle("o", x, y - 18, 2)
    shade = [(x - 4, y - 16), (x + 4, y - 16), (x + 33, y - 2), (x + 33, y + 1), (x - 33, y + 1), (x - 33, y - 2)]
    poly_sil("o", shade)
    for k in range(1, 9):
        P.line("h", x - 4 - 3.3 * k * 0.3, y - 16 + k * 0.4, x - 4 - 3.3 * k + 2, y - 2)
    P.line("f", x - 31, y - 1, x + 31, y - 1)
    # burner and glass
    P.box("o", x - 5, y + 1, x + 5, y + 5)
    glass = [(x - 5, y + 5), (x - 8.5, y + 13), (x - 6, y + 22), (x + 6, y + 22), (x + 8.5, y + 13), (x + 5, y + 5)]
    poly_sil("o", glass)
    P.add("o", f"M{f(x)} {f(y + 20)}Q{f(x - 3.6)} {f(y + 14)} {f(x)} {f(y + 8)}Q{f(x + 3.6)} {f(y + 14)} {f(x)} {f(y + 20)}")
    P.line("f", x - 6, y + 9, x - 6.6, y + 18)
    for a in range(200, 341, 14):                              # the light it throws on the bench
        ca, sa = math.cos(math.radians(a)), -math.sin(math.radians(a))
        P.line("f", x + 15 * ca, y + 13 + 15 * sa, x + (22 + 5 * ((a // 14) % 2)) * ca, y + 13 + (22 + 5 * ((a // 14) % 2)) * sa)


# ------------------------------------------------------------------ on the bench
def vice(x):
    b = BY
    poly_sil("o", [(x - 26, b), (x - 24, b - 7), (x + 24, b - 7), (x + 26, b)])
    P.line("h", x - 22, b - 4.6, x + 6, b - 4.6)
    fixed = [(x + 2, b - 7), (x + 4, b - 30), (x + 1, b - 34), (x + 1, b - 42), (x + 15, b - 42), (x + 15, b - 34), (x + 18, b - 28),
             (x + 20, b - 7)]
    poly_sil("o", fixed)
    moving = [(x - 18, b - 13), (x - 16, b - 30), (x - 13, b - 34), (x - 13, b - 42), (x - 3, b - 42), (x - 3, b - 34), (x - 5, b - 28),
              (x - 4, b - 13)]
    poly_sil("o", moving)
    P.line("f", x + 1, b - 36.5, x + 15, b - 36.5)
    P.line("f", x - 13, b - 36.5, x - 3, b - 36.5)
    for k in range(5):
        P.line("h", x + 4.4 + k * 1.7, b - 28, x + 3.2 + k * 1.7, b - 9)
    for k in range(3):
        P.line("h", x - 15.4 + k * 1.7, b - 29, x - 16.6 + k * 1.7, b - 14.5)
    P.box("o", x - 40, b - 23, x - 17, b - 17)                   # screw
    xx = x - 38.5
    while xx < x - 18:
        P.line("f", xx, b - 23, xx + 1.4, b - 17)
        xx += 2.4
    P.circle("o", x - 43, b - 20, 4)
    P.sil_circle(x - 43, b - 20, 4)
    P.box("o", x - 44.2, b - 42, x - 41.8, b + 0 - 2)            # tommy bar
    for yy in (b - 43.5, b - 0.5 - 2):
        P.circle("o", x - 43, yy, 2.3)
        P.sil_circle(x - 43, yy, 2.3)


def lens_stand(x):
    b = BY
    poly_sil("o", [(x - 12, b), (x - 10, b - 3.5), (x + 10, b - 3.5), (x + 12, b)])
    P.box("o", x - 1.6, b - 26, x + 1.6, b - 3.5)
    P.line("h", x - 0.5, b - 25, x - 0.5, b - 5)
    P.circle("o", x, b - 15, 3)
    P.sil_circle(x, b - 15, 3)
    # the lens, biconvex and nearly edge-on, in its ring
    cy = b - 46
    d = (f"M{f(x)} {f(cy - 20)}Q{f(x + 9)} {f(cy)} {f(x)} {f(cy + 20)}Q{f(x - 9)} {f(cy)} {f(x)} {f(cy - 20)}Z")
    P.add("o", d)
    P.cur["sil"].append((d, False))
    P.add("h", f"M{f(x - 1.6)} {f(cy - 13)}Q{f(x - 5)} {f(cy)} {f(x - 1.6)} {f(cy + 13)}")
    P.add("f", f"M{f(x + 0.4)} {f(cy - 9)}Q{f(x - 2.2)} {f(cy)} {f(x + 0.4)} {f(cy + 9)}")
    P.box("o", x - 2, cy + 19.4, x + 2, cy + 23)
    P.box("o", x - 2, cy - 23, x + 2, cy - 19.4)


def refractor(x0):
    """Brass refractor lying on two wooden cradles, objective to the east."""
    b = BY
    cy = b - 31
    for cx in (x0 + 78, x0 + 172):                               # cradles
        blk = [(cx - 15, b), (cx - 12, b - 22), (cx - 9, b - 22), (cx, b - 19.5), (cx + 9, b - 22), (cx + 12, b - 22), (cx + 15, b)]
        poly_sil("o", blk)
        for k in range(4):
            P.line("h", cx - 12.4 + k * 2.2, b - 20 + k * 0.8, cx - 14 + k * 2.2, b - 1.5)
        P.line("f", cx - 14, b - 6, cx + 14, b - 6)
    P.layer()
    # eyepiece, drawtube, tailpiece, main tube, dew shield
    parts = ((x0, x0 + 9, 3.2), (x0 + 9, x0 + 24, 5), (x0 + 24, x0 + 34, 8.2), (x0 + 34, x0 + 196, 10.6), (x0 + 196, x0 + 242, 12.8))
    for xa, xb, r in parts:
        P.box("o", xa, cy - r, xb, cy + r)
    for xa, xb, r in parts[1:]:
        P.line("h", xa + 1.2, cy - r * 0.55, xb - 1.2, cy - r * 0.55)   # highlight along the top
        P.line("h", xa + 1.2, cy - r * 0.28, xb - 1.2, cy - r * 0.28)
        P.line("f", xa + 1.2, cy - r * 0.02, xa + (xb - xa) * 0.7, cy - r * 0.02)
        P.line("f", xa + 1.2, cy + r * 0.72, xb - 1.2, cy + r * 0.72)   # reflected light underneath
    for xr in (x0 + 34, x0 + 60, x0 + 150, x0 + 193):                  # rings
        P.box("o", xr, cy - 11.6, xr + 3.4, cy + 11.6)
    P.box("o", x0 + 239, cy - 13.8, x0 + 244, cy + 13.8)               # cell of the objective
    P.arc("f", x0 + 244, cy, 4, -90, 90, ry=12.8)
    P.circle("o", x0 + 29, cy + 11.5, 4.2)                             # focusing wheel
    P.sil_circle(x0 + 29, cy + 11.5, 4.2)
    P.circle("f", x0 + 29, cy + 11.5, 1.2)
    for a in range(0, 360, 30):
        P.line("f", x0 + 29 + 3 * math.cos(math.radians(a)), cy + 11.5 + 3 * math.sin(math.radians(a)),
               x0 + 29 + 4.2 * math.cos(math.radians(a)), cy + 11.5 + 4.2 * math.sin(math.radians(a)))
    # finder on two stalks
    for xs in (x0 + 76, x0 + 120):
        P.box("o", xs, cy - 16.5, xs + 2.6, cy - 10.6)
    P.box("o", x0 + 62, cy - 22.4, x0 + 132, cy - 16.5)
    P.box("o", x0 + 132, cy - 23.6, x0 + 142, cy - 15.3)
    P.box("o", x0 + 56, cy - 21, x0 + 62, cy - 18)
    P.line("h", x0 + 64, cy - 20.4, x0 + 130, cy - 20.4)


def oil_lamp(x):
    b = BY
    poly_sil("o", [(x - 15, b), (x - 13, b - 4), (x - 5, b - 6), (x + 5, b - 6), (x + 13, b - 4), (x + 15, b)])
    poly_sil("o", [(x - 3, b - 6), (x + 3, b - 6), (x + 2.2, b - 20), (x - 2.2, b - 20)])
    P.circle("o", x, b - 13, 3.6)
    P.sil_circle(x, b - 13, 3.6)
    d = (f"M{f(x - 6)} {f(b - 20)}Q{f(x - 21)} {f(b - 24)} {f(x - 17)} {f(b - 36)}Q{f(x - 14)} {f(b - 43)} {f(x - 6)} {f(b - 44)}"
         f"H{f(x + 6)}Q{f(x + 14)} {f(b - 43)} {f(x + 17)} {f(b - 36)}Q{f(x + 21)} {f(b - 24)} {f(x + 6)} {f(b - 20)}Z")
    P.add("o", d)
    P.cur["sil"].append((d, False))
    for k in range(4):
        P.add("h", f"M{f(x - 15 + k * 2.4)} {f(b - 36)}Q{f(x - 17.5 + k * 2.4)} {f(b - 29)} {f(x - 12 + k * 2.6)} {f(b - 23)}")
    P.line("f", x - 14, b - 31, x + 15, b - 31)
    P.box("o", x - 7.5, b - 51, x + 7.5, b - 44)
    P.line("f", x - 7.5, b - 47.5, x + 7.5, b - 47.5)
    P.line("o", x + 7.5, b - 47.5, x + 13, b - 47.5)
    P.circle("o", x + 14.6, b - 47.5, 2)
    glass = (f"M{f(x - 7)} {f(b - 51)}Q{f(x - 14)} {f(b - 62)} {f(x - 8)} {f(b - 74)}Q{f(x - 4.6)} {f(b - 82)} {f(x - 4.6)} {f(b - 104)}"
             f"H{f(x + 4.6)}Q{f(x + 4.6)} {f(b - 82)} {f(x + 8)} {f(b - 74)}Q{f(x + 14)} {f(b - 62)} {f(x + 7)} {f(b - 51)}Z")
    P.add("o", glass)
    P.cur["sil"].append((glass, False))
    P.add("f", f"M{f(x - 8.4)} {f(b - 58)}Q{f(x - 10.5)} {f(b - 64)} {f(x - 7)} {f(b - 71)}")
    P.line("f", x - 3, b - 84, x - 3, b - 101)
    P.add("o", f"M{f(x)} {f(b - 52)}Q{f(x - 5.5)} {f(b - 59)} {f(x)} {f(b - 70)}Q{f(x + 5.5)} {f(b - 59)} {f(x)} {f(b - 52)}")
    P.add("f", f"M{f(x)} {f(b - 54)}Q{f(x - 2.2)} {f(b - 59)} {f(x)} {f(b - 64)}")


def camera(x0):
    b = BY
    P.box("o", x0 - 6, b - 6, x0 + 124, b)
    P.line("h", x0 - 4, b - 4, x0 + 60, b - 4)
    for xx in (x0 + 10, x0 + 104):
        P.circle("o", xx, b - 3, 1.5)
    # rear standard with the ground glass
    P.box("o", x0, b - 80, x0 + 16, b - 6)
    P.rect("h", x0 + 3, b - 76, x0 + 13, b - 10)
    P.hatch_v("f", x0 + 3, b - 76, x0 + 8, b - 10, 1.9)
    P.box("o", x0 - 3, b - 83, x0 + 19, b - 80)
    # bellows
    n = 9
    xs = [x0 + 16 + (64 * i / n) for i in range(n + 1)]
    top, bot = [], []
    for i, xx in enumerate(xs):
        t = i / n
        h2 = 36 - 12 * t
        cyb = b - 43
        bump = 2.2 if i % 2 else -1.4
        top.append((xx, cyb - h2 - bump))
        bot.append((xx, cyb + h2 + bump))
    poly_sil("o", top + list(reversed(bot)))
    for i, xx in enumerate(xs[1:-1], 1):
        P.line("h" if i % 2 else "f", xx, top[i][1] + 0.8, xx, bot[i][1] - 0.8)
        if i % 2:
            P.line("f", xx - 2.2, top[i][1] + 5, xx - 2.2, bot[i][1] - 5)
    # front standard, lens board and brass lens
    P.box("o", x0 + 80, b - 72, x0 + 88, b - 6)
    P.line("h", x0 + 82, b - 70, x0 + 82, b - 8)
    P.box("o", x0 + 88, b - 54, x0 + 108, b - 32)
    for k in (-7.5, -4.5):
        P.line("h", x0 + 89.5, b - 43 + k, x0 + 106.5, b - 43 + k)
    P.line("f", x0 + 89.5, b - 36, x0 + 106.5, b - 36)
    P.box("o", x0 + 96, b - 56, x0 + 99.4, b - 30)
    P.box("o", x0 + 108, b - 57, x0 + 114, b - 29)
    P.arc("f", x0 + 114, b - 43, 3.4, -90, 90, ry=13)
    P.box("o", x0 + 101, b - 60, x0 + 104, b - 54)                # stop slot
    P.circle("o", x0 + 84, b - 76, 3)                             # rise knob
    P.sil_circle(x0 + 84, b - 76, 3)


def balance(x):
    b = BY
    P.box("o", x - 36, b - 13, x + 36, b)
    P.box("o", x - 39, b - 16, x + 39, b - 13)
    P.rect("h", x - 30, b - 10.5, x + 30, b - 2.5)
    P.circle("o", x, b - 6.5, 1.8)
    P.line("h", x - 34.4, b - 12, x - 34.4, b - 1)
    # column
    P.box("o", x - 2.4, b - 104, x + 2.4, b - 16)
    P.line("h", x - 0.9, b - 102, x - 0.9, b - 18)
    poly_sil("o", [(x - 7, b - 16), (x - 4, b - 22), (x + 4, b - 22), (x + 7, b - 16)])
    P.circle("o", x, b - 108, 3.2)
    P.sil_circle(x, b - 108, 3.2)
    # beam, a shallow truss
    by = b - 99
    beam = [(x - 56, by), (x - 20, by - 5.5), (x, by - 7), (x + 20, by - 5.5), (x + 56, by), (x + 56, by + 2.2), (x, by + 2.2),
            (x - 56, by + 2.2)]
    poly_sil("o", beam)
    P.line("f", x - 50, by + 0.4, x + 50, by + 0.4)
    for xx in (-38, -20, 20, 38):
        P.line("f", x + xx, by + 2, x + xx, by - 5.6 + abs(xx) * 0.14)
    poly_sil("o", [(x - 3, by + 2.2), (x, by - 2.4), (x + 3, by + 2.2)])
    P.line("o", x, by + 2.2, x, b - 34)                            # pointer and its scale
    P.arc("o", x, b - 62, 30, 250, 290)
    for a in range(252, 289, 6):
        P.line("f", x + 30 * math.cos(math.radians(a)), b - 62 - 30 * math.sin(math.radians(a)),
               x + 27 * math.cos(math.radians(a)), b - 62 - 27 * math.sin(math.radians(a)))
    # pans
    for s in (-1, 1):
        px = x + s * 54
        P.circle("o", px, by + 3.6, 1.6)
        for dx in (-15, 0, 15):
            P.line("f", px, by + 5, px + dx, b - 36)
        d = f"M{f(px - 17)} {f(b - 36)}Q{f(px)} {f(b - 25)} {f(px + 17)} {f(b - 36)}Z"
        P.add("o", d)
        P.cur["sil"].append((d, False))
        P.add("h", f"M{f(px - 13)} {f(b - 34.6)}Q{f(px - 6)} {f(b - 30)} {f(px + 2)} {f(b - 29.6)}")
    wx = x - 54                                                    # brass weights on the west pan
    for dx, w, hh in ((-7, 6, 8), (1, 5, 6.5), (7.4, 3.6, 4.6)):
        P.box("o", wx + dx - w / 2, b - 36 - hh, wx + dx + w / 2, b - 36)
        P.box("o", wx + dx - 1, b - 36 - hh - 2, wx + dx + 1, b - 36 - hh)


def gear(cx, cy, r, n, tooth=4.0, spokes=6, key="o"):
    pts = []
    for i in range(n):
        a0 = math.tau * i / n
        for da, rr in ((0.0, r), (0.18, r + tooth), (0.5, r + tooth), (0.68, r)):
            a = a0 + da * math.tau / n
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    poly_sil(key, pts)
    P.circle("o", cx, cy, r - 4.5)
    hub = max(3.4, r * 0.2)
    P.circle("o", cx, cy, hub)
    P.circle("f", cx, cy, hub * 0.42)
    if spokes:
        for i in range(spokes):
            a = math.tau * i / spokes + 0.26
            ca, sa = math.cos(a), math.sin(a)
            for off in (-1, 1):
                w0, w1 = 2.2 * off, 1.4 * off
                P.line("o", cx + hub * ca - w0 * sa, cy + hub * sa + w0 * ca, cx + (r - 4.5) * ca - w1 * sa, cy + (r - 4.5) * sa + w1 * ca)
    # lit rim, west and upper side
    P.arc("h", cx, cy, r - 2.2, 100, 235)
    P.arc("f", cx, cy, r - 6.4, 110, 215)


def wheelwork(x):
    b = BY
    P.box("o", x - 44, b - 5, x + 66, b)
    P.line("h", x - 42, b - 3.2, x + 10, b - 3.2)
    cy = b - 54
    px, py = x + 53.5 * math.cos(math.radians(-24)), cy + 53.5 * math.sin(math.radians(-24))
    poly_sil("o", [(x - 13, b - 5), (x - 5, cy), (x + 5, cy), (x + 13, b - 5)])        # pedestal of the wheel
    poly_sil("o", [(px - 7, b - 5), (px - 3, py), (px + 3, py), (px + 7, b - 5)])      # pedestal of the pinion
    P.line("h", px - 4.4, b - 8, px - 1.6, py + 12)
    P.layer()
    gear(x, cy, 38, 40, tooth=3.6)
    P.layer()
    gear(px, py, 11.5, 12, tooth=3.6, spokes=0)
    # crank
    a = math.radians(-58)
    ex, ey = px + 24 * math.cos(a), py + 24 * math.sin(a)
    nx, ny = -math.sin(a) * 2, math.cos(a) * 2
    poly_sil("o", [(px + nx, py + ny), (ex + nx, ey + ny), (ex - nx, ey - ny), (px - nx, py - ny)])
    P.box("o", ex - 2.2, ey - 14, ex + 2.2, ey)
    P.line("h", ex - 0.8, ey - 13, ex - 0.8, ey - 1)
    P.circle("o", px, py, 2.6)
    P.sil_circle(px, py, 2.6)


def books(x):
    b = BY

    def book(x0, x1, y0, y1, bands=(0.22, 0.78)):
        P.add("o", f"M{f(x1)} {f(y0)}H{f(x0 + 3)}Q{f(x0 - 1.5)} {f((y0 + y1) / 2)} {f(x0 + 3)} {f(y1)}H{f(x1)}")
        P.sil_rect(x0, y0, x1, y1)
        P.line("o", x1 - 1.6, y0 + 1.4, x1 - 1.6, y1 - 1.4)
        yy = y0 + 2.6
        while yy < y1 - 1.6:
            P.line("f", x1 - 30, yy, x1 - 1.8, yy)
            yy += 1.7
        P.line("h", x0 + 4, y0 + 1.6, x1 - 34, y0 + 1.6)
        for k in bands:
            xx = x0 + 3 + (x1 - x0 - 36) * k
            P.line("o", xx, y0, xx, y1)
            P.line("f", xx + 2, y0, xx + 2, y1)

    book(x, x + 74, b - 12, b)
    book(x + 5, x + 68, b - 22, b - 12, bands=(0.3, 0.7))
    book(x + 2, x + 64, b - 31, b - 22, bands=(0.16, 0.5, 0.84))
    # inkwell and quill
    ix = x + 24
    poly_sil("o", [(ix - 7.5, b - 31), (ix - 6, b - 40), (ix - 2.6, b - 41.5), (ix - 2.6, b - 44), (ix + 2.6, b - 44), (ix + 2.6, b - 41.5),
                   (ix + 6, b - 40), (ix + 7.5, b - 31)])
    P.line("h", ix - 5.2, b - 39, ix - 6, b - 32.5)
    P.line("f", ix - 3.6, b - 39, ix - 4.4, b - 32.5)
    P.layer()
    qx0, qy0, qx1, qy1 = ix + 0.5, b - 42, ix + 37, b - 98
    P.add("o", f"M{f(qx0)} {f(qy0)}Q{f(ix + 12)} {f(b - 74)} {f(qx1)} {f(qy1)}")
    vane = (f"M{f(ix + 7.5)} {f(b - 57)}Q{f(ix + 5)} {f(b - 80)} {f(qx1)} {f(qy1)}Q{f(ix + 32)} {f(b - 78)} {f(ix + 12.5)} {f(b - 55)}Z")
    P.add("h", vane)
    P.cur["sil"].append((vane, False))
    for k in range(1, 12):
        t = 0.28 + k * 0.058
        cx = (1 - t) ** 2 * qx0 + 2 * t * (1 - t) * (ix + 12) + t * t * qx1
        cyy = (1 - t) ** 2 * qy0 + 2 * t * (1 - t) * (b - 74) + t * t * qy1
        P.line("f", cx, cyy, cx - 3.8 + t * 2.4, cyy - 5.2)
        if k % 2:
            P.line("f", cx, cyy, cx + 5.4 - t * 3, cyy - 1.4)
    # dividers left open on the bench, and a roll of drawings
    rx = x + 88
    P.box("o", rx, b - 9, rx + 58, b)
    P.ellipse("o", rx + 58, b - 4.5, 2.6, 4.5)
    P.arc("f", rx + 58, b - 4.5, 1.2, 0, 360, ry=2.4, step=30)
    P.line("h", rx + 2, b - 6.6, rx + 54, b - 6.6)
    P.line("f", rx + 2, b - 4.4, rx + 40, b - 4.4)
    P.line("o", rx + 20, b - 9, rx + 20, b)
    P.line("o", rx + 23, b - 9, rx + 23, b)


def theodolite(x):
    b = BY
    for dx in (-26, 0, 26):                                        # foot screws
        P.box("o", x + dx - 4, b - 4, x + dx + 4, b)
        P.box("o", x + dx - 1.2, b - 11, x + dx + 1.2, b - 4)
        for k in (-2.4, 0, 2.4):
            P.line("f", x + dx + k, b - 3.4, x + dx + k, b - 0.6)
    poly_sil("o", [(x - 31, b - 11), (x - 29, b - 15), (x + 29, b - 15), (x + 31, b - 11)])
    P.box("o", x - 9, b - 21, x + 9, b - 15)
    P.box("o", x - 27, b - 27, x + 27, b - 21)                     # horizontal circle
    xx = x - 26.0
    k = 0
    while xx < x + 26.5:
        P.line("f", xx, b - 27, xx, b - (24 if k % 5 else 22))
        xx += 1.75
        k += 1
    P.box("o", x - 22, b - 31, x + 22, b - 27)
    P.box("o", x - 8, b - 38, x + 8, b - 31)                       # compass box
    P.line("f", x - 5, b - 34.5, x + 5, b - 34.5)
    ay = b - 72
    for s in (-1, 1):                                              # standards
        st = [(x + s * 20, b - 31), (x + s * 12, b - 31), (x + s * 3.2, ay - 3), (x + s * 3.2, ay + 3)]
        P.poly("o", st, close=True)
        P.line("f", x + s * 16, b - 33, x + s * 5, ay + 2)
    P.layer()
    # vertical circle, then the telescope across it
    P.circle("o", x, ay, 17)
    P.sil_circle(x, ay, 17)
    P.circle("f", x, ay, 14.2)
    for a in range(0, 360, 10):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        P.line("f", x + (14.2 if a % 30 else 12.4) * ca, ay + (14.2 if a % 30 else 12.4) * sa, x + 17 * ca, ay + 17 * sa)
    for a in (45, 135):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        P.line("f", x - 12 * ca, ay - 12 * sa, x + 12 * ca, ay + 12 * sa)
    P.arc("h", x, ay, 15.6, 110, 220)
    P.layer()
    a = math.radians(-27)
    ca, sa = math.cos(a), math.sin(a)

    def at(s, off):
        return x + s * ca - off * sa, ay + s * sa + off * ca

    tube = [at(-36, -3.4), at(34, -4.4), at(34, -5.4), at(48, -5.4), at(48, 5.4), at(34, 5.4), at(34, 4.4), at(-36, 3.4)]
    poly_sil("o", tube)
    P.line("o", *at(34, -5.4), *at(34, 5.4))
    P.line("h", *at(-34, -1.8), *at(32, -2.4))
    P.line("f", *at(-34, -0.2), *at(20, -0.6))
    P.line("h", *at(36, -3.2), *at(46, -3.2))
    eye = [at(-36, -2.4), at(-46, -2.4), at(-46, 2.4), at(-36, 2.4)]
    poly_sil("o", eye)
    poly_sil("o", [at(-46, -3.4), at(-49, -3.4), at(-49, 3.4), at(-46, 3.4)])
    for s in (-14, 12):
        P.line("o", *at(s, -4.4), *at(s, 4.4))
        P.line("f", *at(s + 1.6, -4.2), *at(s + 1.6, 4.2))
    P.circle("o", x, ay, 3.4)
    P.sil_circle(x, ay, 3.4)
    P.circle("f", x, ay, 1.2)
    # striding level on top
    lv = [at(-15, -9), at(15, -9), at(15, -6), at(-15, -6)]
    poly_sil("o", lv)
    P.line("f", *at(-11, -7.5), *at(11, -7.5))
    P.line("o", *at(-12, -6), *at(-12, -4))
    P.line("o", *at(12, -6), *at(12, -4.2))


def glassware(x):
    b = BY
    # retort stand with a round flask over a spirit burner
    P.box("o", x - 4, b - 4, x + 44, b)
    P.line("h", x - 2, b - 2.4, x + 20, b - 2.4)
    P.box("o", x + 2, b - 82, x + 4.6, b - 4)
    P.line("f", x + 2.9, b - 80, x + 2.9, b - 6)
    cx, cy, r = x + 25, b - 46, 14
    P.box("o", x + 4.6, cy - 21.5, x + 21, cy - 19.5)              # clamp on the neck
    P.box("o", x + 0.6, cy - 23, x + 6, cy - 18)
    P.box("o", x + 4.6, b - 27, x + 40, b - 25)                    # ring with gauze
    P.box("o", x + 0.6, b - 28.5, x + 6, b - 23.5)
    P.layer()
    P.circle("o", cx, cy, r)
    P.sil_circle(cx, cy, r)
    P.box("o", cx - 3.6, cy - r - 20, cx + 3.6, cy - r + 1.8)
    P.box("o", cx - 4.8, cy - r - 22, cx + 4.8, cy - r - 20)
    P.arc("h", cx, cy, r - 2.4, 115, 220)
    P.arc("f", cx, cy, r - 4.6, 125, 200)
    P.line("f", cx - r * 0.86, cy + 5, cx + r * 0.86, cy + 5)       # liquid
    for k in (1, 2, 3):
        hw = math.sqrt(max(r * r - (5 + k * 2.6) ** 2, 0)) - 1.6
        P.line("f", cx - hw, cy + 5 + k * 2.6, cx + hw * 0.5, cy + 5 + k * 2.6)
    P.line("f", cx - 2, cy - r - 18, cx - 2, cy - r)
    # burner
    poly_sil("o", [(cx - 9, b - 4), (cx - 10, b - 9), (cx - 4, b - 14), (cx + 4, b - 14), (cx + 10, b - 9), (cx + 9, b - 4)])
    P.box("o", cx - 2, b - 17, cx + 2, b - 14)
    P.add("o", f"M{f(cx)} {f(b - 17)}Q{f(cx - 3.4)} {f(b - 21)} {f(cx)} {f(b - 25.6)}Q{f(cx + 3.4)} {f(b - 21)} {f(cx)} {f(b - 17)}")
    P.line("h", cx - 7.4, b - 9, cx - 3, b - 12.6)
    # conical flask
    ex = x + 70
    fl = [(ex - 15, b), (ex - 15, b - 3), (ex - 3.6, b - 33), (ex - 3.6, b - 44), (ex + 3.6, b - 44), (ex + 3.6, b - 33), (ex + 15, b - 3),
          (ex + 15, b)]
    poly_sil("o", fl)
    P.box("o", ex - 4.8, b - 46, ex + 4.8, b - 44)
    P.line("f", ex - 10, b - 15, ex + 10, b - 15)
    for k in (1, 2, 3, 4):
        P.line("f", ex - 10 - k * 1.1 + 1.6, b - 15 + k * 3, ex + 2, b - 15 + k * 3)
    P.line("h", ex - 12.4, b - 4, ex - 4.4, b - 26)
    # measuring cylinder
    mx = x + 100
    poly_sil("o", [(mx - 9, b), (mx - 7, b - 3.4), (mx + 7, b - 3.4), (mx + 9, b)])
    P.box("o", mx - 4.4, b - 62, mx + 4.4, b - 3.4)
    P.poly("o", [(mx - 4.4, b - 62), (mx - 6.4, b - 64)])
    P.line("h", mx - 2.8, b - 60, mx - 2.8, b - 6)
    yy = b - 8.0
    k = 0
    while yy > b - 56:
        P.line("f", mx + 4.4, yy, mx + (0.4 if k % 5 == 0 else 2.2), yy)
        yy -= 2.6
        k += 1


# ------------------------------------------------------------------ bench and floor
def bench(x0, x1):
    P.box("o", x0, BY, x1, BY + 7)
    P.dashes("h", x0 + 4, x1 - 4, BY + 2.4, 30, 160, 6, 30)
    P.dashes("f", x0 + 4, x1 - 4, BY + 4.8, 20, 90, 10, 60)
    ax0, ax1 = x0 + 12, x1 - 12
    P.box("o", ax0, BY + 7, ax1, BY + 35)
    legs = [ax0 + (ax1 - ax0 - 16) * k / 4 for k in range(5)]
    for i, lx in enumerate(legs):
        P.box("o", lx, BY + 7, lx + 16, H)
        P.line("h", lx + 2, BY + 9, lx + 2, H)
        P.line("h", lx + 4.2, BY + 9, lx + 4.2, H)
        P.line("f", lx + 6.6, BY + 9, lx + 6.6, H - 30)
        if i < 4:                                                  # two drawers per bay
            nx = legs[i + 1]
            w = (nx - lx - 16 - 30) / 2
            for k in range(2):
                dx0 = lx + 16 + 10 + k * (w + 10)
                P.rect("o", dx0, BY + 11, dx0 + w, BY + 31)
                P.rect("f", dx0 + 3, BY + 14, dx0 + w - 3, BY + 28)
                P.line("h", dx0 + 1.6, BY + 12.6, dx0 + 1.6, BY + 29.4)
                for hx in (dx0 + w * 0.3, dx0 + w * 0.7):
                    P.arc("o", hx, BY + 19.5, 5, 180, 360, ry=3.4)
                    P.line("f", hx - 5, BY + 19.5, hx + 5, BY + 19.5)
            # stretcher
            P.box("o", lx + 16, BY + 68, nx, BY + 74)
            P.dashes("h", lx + 20, nx - 4, BY + 70.4, 20, 110, 8, 40)
    return legs


def under_bench(legs):
    b = BY + 68
    # crate
    x = legs[0] + 70
    P.box("o", x, b - 34, x + 78, b)
    for k in (1, 2, 3):
        P.line("o", x, b - 34 + k * 8.5, x + 78, b - 34 + k * 8.5)
    for xx in (x + 8, x + 70):
        P.box("o", xx - 4, b - 34, xx + 4, b)
    for k in range(4):
        P.dashes("f", x + 13, x + 65, b - 31 + k * 8.5, 8, 26, 4, 14)
    # keg
    x = legs[1] + 110
    d = f"M{f(x)} {f(b)}Q{f(x - 7)} {f(b - 21)} {f(x)} {f(b - 42)}H{f(x + 34)}Q{f(x + 41)} {f(b - 21)} {f(x + 34)} {f(b)}Z"
    P.add("o", d)
    P.cur["sil"].append((d, False))
    for yy, bow in ((b - 6, 2.2), (b - 14, 4.4), (b - 28, 4.4), (b - 36, 2.2)):
        P.line("o", x - bow + 0.4, yy, x + 34 + bow - 0.4, yy)
    for k in range(1, 6):
        xx = x + k * 5.8
        P.add("f", f"M{f(xx)} {f(b)}Q{f(xx - 5 + k * 1.6)} {f(b - 21)} {f(xx)} {f(b - 42)}")
    # tool chest with its handle
    x = legs[2] + 96
    P.box("o", x, b - 28, x + 96, b)
    P.box("o", x - 2, b - 34, x + 98, b - 28)
    P.line("f", x + 2, b - 31, x + 60, b - 31)
    P.line("h", x + 2, b - 26, x + 2, b - 2)
    P.rect("f", x + 6, b - 23, x + 90, b - 5)
    P.rect("o", x + 43, b - 21, x + 53, b - 13)
    P.circle("f", x + 48, b - 16, 1.2)
    P.arc("o", x + 48, b - 34, 12, 0, 180, ry=6)
    # boxes of plates, labelled
    x = legs[3] + 60
    for k, (w, hh) in enumerate(((58, 16), (58, 16), (52, 14))):
        y1 = b - sum(v for _, v in ((58, 16), (58, 16), (52, 14))[:k])
        xo = x + (3 if k == 2 else 0)
        P.box("o", xo, y1 - hh, xo + w, y1)
        P.line("f", xo, y1 - hh + 4.4, xo + w, y1 - hh + 4.4)
        P.rect("f", xo + w / 2 - 12, y1 - hh + 6.4, xo + w / 2 + 12, y1 - 2.6)
        P.line("f", xo + w / 2 - 8, y1 - hh / 2 + 2.2, xo + w / 2 + 8, y1 - hh / 2 + 2.2)
        P.line("h", xo + 1.6, y1 - hh + 1.6, xo + 1.6, y1 - 1.4)
    x += 84
    P.box("o", x, b - 22, x + 44, b)
    P.line("f", x, b - 17, x + 44, b - 17)
    P.rect("f", x + 10, b - 13, x + 34, b - 4)
    P.line("h", x + 1.6, b - 20, x + 1.6, b - 1.4)


def floor_scope(x):
    """A refractor on its tall wooden tripod, standing on the floor west of the bench."""
    hy = 152                                                      # head of the tripod
    for dx, key in ((-46, "o"), (34, "o"), (-4, "h")):
        P.poly(key, [(x - 3 + dx * 0.04, hy), (x + dx - 3, H), (x + dx + 3, H), (x + 3 + dx * 0.04, hy)], close=True)
        P.sil([(x - 3 + dx * 0.04, hy), (x + dx - 3, H), (x + dx + 3, H), (x + 3 + dx * 0.04, hy)])
        P.line("f", x + dx * 0.1, hy + 8, x + dx * 0.96, H - 4)
    P.line("o", x - 23, 232, x + 17, 232)                         # spreader
    P.line("f", x - 23, 234, x + 17, 234)
    P.box("o", x - 7, hy - 8, x + 7, hy)
    P.circle("o", x, hy - 14, 6.4)
    P.sil_circle(x, hy - 14, 6.4)
    P.circle("f", x, hy - 14, 2)
    P.layer()
    a = math.radians(-48)
    ca, sa = math.cos(a), math.sin(a)

    def at(s, off):
        return x + s * ca - off * sa, hy - 14 + s * sa + off * ca

    tube = [at(-58, -5), at(74, -6), at(74, -7.4), at(98, -7.4), at(98, 7.4), at(74, 7.4), at(74, 6), at(-58, 5)]
    poly_sil("o", tube)
    P.line("o", *at(74, -7.4), *at(74, 7.4))
    P.line("h", *at(-56, -2.8), *at(72, -3.4))
    P.line("h", *at(-56, -0.8), *at(72, -1.2))
    P.line("f", *at(-56, 1.4), *at(40, 1.4))
    P.line("h", *at(76, -4.6), *at(96, -4.6))
    for s in (-30, 20, 60):
        P.line("o", *at(s, -6), *at(s, 6))
        P.line("f", *at(s + 2, -5.6), *at(s + 2, 5.6))
    poly_sil("o", [at(-58, -3.4), at(-72, -3.4), at(-72, 3.4), at(-58, 3.4)])
    poly_sil("o", [at(-72, -2.2), at(-82, -2.2), at(-82, 2.2), at(-72, 2.2)])
    poly_sil("o", [at(-10, -9), at(40, -9), at(40, -12.6), at(-10, -12.6)])   # finder
    P.line("o", *at(0, -9), *at(0, -6))
    P.line("o", *at(30, -9), *at(30, -6))


def grindstone(x):
    """Treadle grindstone on the floor, east of the bench."""
    cy = 214
    for dx in (-34, 34):
        leg = [(x + dx * 0.55 - 3.4, cy + 4), (x + dx - 4, H), (x + dx + 4, H), (x + dx * 0.55 + 3.4, cy + 4)]
        poly_sil("o", leg)
        P.line("h", x + dx * 0.6 - 1, cy + 8, x + dx * 0.97 - 1.4, H - 3)
    P.box("o", x - 48, cy - 3, x + 48, cy + 5)
    P.line("h", x - 46, cy - 0.6, x + 10, cy - 0.6)
    P.box("o", x - 30, 262, x + 30, 267)
    P.layer()
    P.circle("o", x, cy, 36)
    P.sil_circle(x, cy, 36)
    P.circle("o", x, cy, 31)
    P.circle("o", x, cy, 6)
    P.circle("f", x, cy, 2.2)
    P.arc("h", x, cy, 33.5, 100, 230)
    for rr, a0, a1 in ((26, 120, 215), (21, 130, 205), (15, 140, 200), (10, 150, 195)):
        P.arc("f", x, cy, rr, a0, a1)
    for a in range(0, 360, 12):                                   # grit of the stone
        aa = math.radians(a + 4)
        P.line("f", x + 31.6 * math.cos(aa), cy + 31.6 * math.sin(aa), x + 35.4 * math.cos(aa + 0.03), cy + 35.4 * math.sin(aa + 0.03))
    P.line("o", x + 6, cy, x + 54, cy)                             # crank
    P.box("o", x + 52, cy - 14, x + 56, cy + 2)
    P.box("o", x + 50, cy - 26, x + 58, cy - 14)
    P.line("f", x + 54, cy + 2, x + 30, 262)                       # treadle rod


def main():
    wall()
    # --- wall furniture
    P.layer()
    rail(322, 668)
    rail(1052, 1310)
    for x in (348, 420, 486, 540, 596, 636, 654):
        peg(x)
    for x in (1078, 1118, 1158, 1176, 1194, 1222, 1284):
        peg(x)
    P.layer()
    saw(348, 53)
    try_square(420, 53)
    dividers(486, 53)
    calipers(540, 53)
    hammer(596, 55)
    file_tool(636, 53, 46)
    file_tool(654, 53, 38)
    spanner(1078, 53)
    pincers(1118, 55)
    chisel(1158, 53, 40, 4.2)
    chisel(1176, 53, 34, 3)
    chisel(1194, 53, 44, 5.4)
    bow_saw(1218, 55)
    planisphere(808, 30, 92, 76)
    shelf(1556, 1690, 82)
    pendant(1340, 70)
    # --- floor, for the wide screens
    P.layer()
    floor_scope(104)
    P.layer()
    grindstone(1808)
    # --- on the bench
    P.layer()
    vice(286)
    lens_stand(386)
    P.layer()
    refractor(430)
    P.layer()
    oil_lamp(716)
    P.layer()
    camera(786)
    P.layer()
    balance(985)
    P.layer()
    wheelwork(1136)
    P.layer()
    books(1286)
    P.layer()
    theodolite(1474)
    P.layer()
    glassware(1574)
    # --- the bench itself, in front of what stands under it
    P.layer()
    legs = bench(214, 1726)
    under = P.cur
    P.layer()
    under_bench(legs)
    # what stands under the bench is behind the apron and legs: swap the two layers
    i = P.layers.index(under)
    P.layers[i], P.layers[i + 1] = P.layers[i + 1], P.layers[i]
    P.write(OUT, fade_x=64, fade_top=8, fade_bottom=30)


if __name__ == "__main__":
    main()
