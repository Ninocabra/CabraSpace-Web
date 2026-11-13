"""
Plates for proposal 3, "Lamina de Enciclopedia" (after the plates of the Encyclopedie, 18th century).

Three technical figures drawn as white-line engraving, same technique as Pagina Web/tools/observatorio.py
(outline + hatch + fine line), but as SECTIONS and an EXPLODED VIEW, the way a plate of the
Encyclopedie shows a machine: cut material carries a 45 degree hatch, glass a sparser one, rays of
light are dashed, the optical axis is a chain line, and each part has a call-out point with a leader.

    telescopio.svg   Fig. 1  Schmidt-Cassegrain telescope in section with the path of light
    despiece.svg     Fig. 3  reducer, filter wheel and camera, exploded along the optical axis
    cupula.svg       Fig. 4  observatory dome in section: shell, slit, telescope, isolated pier

The SVGs are monochrome black on transparent and are used as CSS masks, so the page paints them gold.
Call-out LETTERS are not in the SVG (an SVG used as an image cannot load the page fonts): the script
prints, for each figure, the position of every letter as a percentage of the box, and the page sets
them in Bodoni italic on top of the mask (stdout is that table, as JSON).

    python p3/laminas.py   ->   p3/telescopio.svg, p3/despiece.svg, p3/cupula.svg
"""
import json
import math
import os
import random
import sys
from pathlib import Path

OUT = Path(os.environ.get("ATLAS_IMG_OUT") or Path(__file__).resolve().parents[3] / "atlas" / "img")   # salida: atlas/img/ (o $ATLAS_IMG_OUT para probar)

STYLE = {
    "f": 'stroke-width=".45" stroke-opacity=".62"',                                  # fine
    "h": 'stroke-width=".55" stroke-opacity=".82"',                                  # hatch
    "c": 'stroke-width=".5" stroke-opacity=".8" stroke-dasharray="11 2.6 1.6 2.6"',  # chain (axis)
    "r": 'stroke-width=".8" stroke-dasharray="4.6 2.6"',                             # ray of light
    "l": 'stroke-width=".5"',                                                        # leader
    "m": 'stroke-width=".8"',                                                        # medium
    "o": 'stroke-width="1.2"',                                                       # outline
}


def f(v):
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def inside(poly, x, y):
    n, c = len(poly), False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


class Plate:
    def __init__(self, name, w, h, seed):
        self.name, self.w, self.h = name, w, h
        self.rng = random.Random(seed)
        self.p = {k: [] for k in STYLE}
        self.fills = []
        self.occ = []          # polygons that hide what is drawn with clip=True
        self.labels = {}
        self.extra = ""
        self.vb = (0, 0, w, h)     # crop: what the SVG shows of the drawing

    # ------------------------------------------------------------ primitives
    def hidden(self, x, y):
        return any(inside(o, x, y) for o in self.occ)

    def poly(self, key, pts, close=False, clip=False):
        pts = list(pts)
        if len(pts) < 2:
            return
        if not clip or not self.occ:
            self.p[key].append("M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + ("Z" if close else ""))
            return
        if close:
            pts = pts + [pts[0]]
        dense = []
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            n = max(1, int(math.hypot(x1 - x0, y1 - y0) / 0.8))
            dense += [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, k == 0) for k in range(n)]
        dense.append((pts[-1][0], pts[-1][1], True))
        run = []

        def flush():
            if len(run) >= 2:
                keep = [q for j, q in enumerate(run) if q[2] or j in (0, len(run) - 1)]
                self.poly(key, [(x, y) for x, y, _ in keep])

        for x, y, corner in dense:
            if self.hidden(x, y):
                flush()
                run = []
            else:
                run.append((x, y, corner))
        flush()

    def line(self, key, x1, y1, x2, y2, clip=False):
        self.poly(key, [(x1, y1), (x2, y2)], clip=clip)

    def rect(self, key, x0, y0, x1, y1, clip=False):
        self.poly(key, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, clip=clip)

    def fill(self, pts):
        self.fills.append("M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + "Z")

    def dot(self, x, y, r=1.3):
        self.fills.append(f"M{f(x - r)} {f(y)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0Z")

    def hatch(self, polys, angle, step, key="h", clip=False, phase=0.0):
        """Parallel lines at `angle` degrees filling the even-odd union of `polys`."""
        a = math.radians(angle)
        ca, sa = math.cos(a), math.sin(a)
        rot = [[(x * ca + y * sa, -x * sa + y * ca) for x, y in p] for p in polys]
        ys = [y for p in rot for _, y in p]
        y = math.floor(min(ys) / step) * step + phase + step / 2
        while y < max(ys):
            xs = []
            for p in rot:
                for i in range(len(p)):
                    (x0, y0), (x1, y1) = p[i], p[(i + 1) % len(p)]
                    if (y0 > y) != (y1 > y):
                        xs.append(x0 + (x1 - x0) * (y - y0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                if xs[i + 1] - xs[i] > 0.6:
                    p0 = (xs[i] * ca - y * sa, xs[i] * sa + y * ca)
                    p1 = (xs[i + 1] * ca - y * sa, xs[i + 1] * sa + y * ca)
                    self.line(key, *p0, *p1, clip=clip)
            y += step

    def solid(self, pts, key="o", angle=None, step=2.6, hkey="h", clip=False):
        """Closed outline, optionally hatched (a part cut by the section plane)."""
        self.poly(key, pts, close=True, clip=clip)
        if angle is not None:
            self.hatch([pts], angle, step, hkey, clip=clip)

    def arrow(self, x, y, dx, dy, size=4.4, key="m"):
        n = math.hypot(dx, dy)
        ux, uy = dx / n, dy / n
        for s in (1, -1):
            c, sn = math.cos(math.radians(24)), math.sin(math.radians(24)) * s
            bx, by = -(ux * c - uy * sn), -(ux * sn + uy * c)
            self.line(key, x, y, x + bx * size, y + by * size)

    def leader(self, letter, px, py, lx, ly, gap=8.5):
        """Call-out: a dot on the part, a thin line towards the letter; the letter is set by the page."""
        d = math.hypot(lx - px, ly - py)
        ex, ey = lx - (lx - px) * gap / d, ly - (ly - py) * gap / d
        self.line("l", px, py, ex, ey)
        self.dot(px, py)
        self.labels[letter] = (lx, ly)

    # ------------------------------------------------------------ output
    def save(self):
        x0, y0, w, h = self.vb
        body = "".join(f'<path {STYLE[k]} d="{"".join(self.p[k])}"/>' for k in STYLE if self.p[k])
        fills = f'<path fill="#000" stroke="none" d="{"".join(self.fills)}"/>' if self.fills else ""
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{f(w)}" height="{f(h)}" '
               f'viewBox="{f(x0)} {f(y0)} {f(w)} {f(h)}">{self.extra}'
               f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">{body}</g>{fills}</svg>\n')
        path = OUT / f"{self.name}.svg"
        path.write_text(svg, encoding="utf-8")
        lab = {k: (round(100 * (x - x0) / w, 2), round(100 * (y - y0) / h, 2)) for k, (x, y) in self.labels.items()}
        CALLOUTS[self.name] = {"ratio": f"{f(w)}/{f(h)}", "labels": lab}
        print(f"{path.name}: {len(svg) / 1024:.1f} KB", file=sys.stderr)


CALLOUTS = {}


# ====================================================================== Fig. 1
def telescopio():
    """Schmidt-Cassegrain in section. Light comes from the left: corrector, primary, secondary, and back
    through the hole of the primary to the reducer, the filter and the sensor."""
    P = Plate("telescopio", 680, 360, 1751)
    AY = 195.0

    def up(pts):
        return [(x, AY - r) for x, r in pts]

    def dn(pts):
        return [(x, AY + r) for x, r in pts]

    def both(pts, key="o", angle=None, step=2.6, hkey="h"):
        for half in (up(pts), dn(pts)):
            P.solid(half, key, angle, step, hkey)

    def box(x0, x1, r, key="o", angle=None, step=2.6, hkey="h"):
        P.solid([(x0, AY - r), (x1, AY - r), (x1, AY + r), (x0, AY + r)], key, angle, step, hkey)

    def face(r):                                   # concave front of the primary (curvature exaggerated)
        return 412 - r * r / 760

    def sec(r):                                    # convex face of the secondary
        return 177 - r * r / 180

    GLASS = dict(angle=62, step=4.2, hkey="f")

    # --- tube, front cell with the corrector, rear cell
    both([(160, 68), (160, 72), (446, 72), (446, 68)], "o", 45, 2.2, "h")
    both([(144, 60), (144, 77), (168, 77), (168, 72), (154, 72), (154, 60)], "o", -45, 2.6)
    both([(154.6, 23), (154.6, 71), (159.4, 71), (159.4, 23)], "m", **GLASS)
    both([(438, 72), (438, 77), (452, 77), (456, 73), (456, 14.5), (446, 14.5), (446, 72)], "o", -45, 2.6)
    both([(456, 14.5), (456, 20), (468, 20), (468, 14.5)], "o", 45, 2.2, "f")
    # far inner wall of the tube, seen beyond the cut: lines that thin out towards the axis
    for r, gap in ((66.6, 0), (65.0, 0), (63.2, 0), (61.0, 0.12), (58.2, 0.3), (50.6, 0.5), (45.4, 0.72)):
        for s in (1, -1):
            y = AY - s * r
            xa, xb = 161.0, (437.5 if r > 62.5 else face(r) - 1.5)
            if not gap:
                P.line("f", xa, y, xb, y)
                continue
            x = xa + P.rng.uniform(0, 14)
            while x < xb - 6:
                ln = P.rng.uniform(16, 44) * (1 - gap * 0.6)
                P.line("f", x, y, min(x + ln, xb), y)
                x += ln + P.rng.uniform(5, 16) * (1 + 3 * gap)

    # --- secondary: hub through the corrector, mirror, baffle, collimation screws
    box(148, 170, 23, "o", -45, 2.6)
    for r in (-12, 0, 12):
        P.rect("m", 144.4, AY + r - 2, 148, AY + r + 2)
    mirror2 = [(170, AY - 20)] + [(sec(r), AY + r) for r in range(-20, 21, 2)] + [(170, AY + 20)]
    P.solid(mirror2, "o", **GLASS)
    both([(170, 21.5), (170, 23), (198, 26.5), (198, 25)], "m")

    # --- primary with its carrier and the central baffle
    prim = [(face(r), r) for r in range(16, 63, 2)] + [(430, 62), (430, 16)]
    both(prim, "o", **GLASS)
    both([(430, 15), (430, 58), (435, 58), (435, 15)], "m", -45, 2.2, "f")
    both([(318, 10.5), (318, 12), (446, 14.5), (446, 13)], "m")

    # --- dovetail under the tube, focus knob on the rear cell
    P.solid(dn([(196, 72), (196, 80), (428, 80), (428, 72)]), "o", 45, 2.6)
    P.rect("o", 456, AY + 42, 469, AY + 54)
    for k in range(1, 6):
        P.line("f", 457, AY + 42 + 2 * k, 468, AY + 42 + 2 * k)

    # --- reducer: ring nut, barrel, two lenses
    both([(462, 20), (462, 24.5), (471, 24.5), (471, 20)], "o", -45, 2.2, "f")
    both([(471, 19.5), (471, 23), (499, 23), (499, 19.5)], "o", 45, 2.2, "f")
    rr = [r / 2 for r in range(-39, 40, 3)]
    lens_a = [(475 + r * r / 120, AY + r) for r in rr] + [(483 - r * r / 120, AY + r) for r in reversed(rr)]
    lens_b = [(488 - r * r / 200, AY + r) for r in rr] + [(493.4 - r * r / 90, AY + r) for r in reversed(rr)]
    P.solid(lens_a, "m", **GLASS)
    P.solid(lens_b, "m", **GLASS)

    # --- filter wheel: thin housing, the carousel with one filter in the beam and one opposite
    FY = AY - 34
    x0, x1, top, bot = 503.0, 519.0, FY - 64, FY + 64
    both([(499, 13), (499, 18), (503, 18), (503, 13)], "m", -45, 2.0, "f")
    for x, xi in ((x0, x0 + 2.2), (x1, x1 - 2.2)):
        for ya, yb in ((top, AY - 13), (AY + 13, bot)):
            P.line("o", x, ya, x, yb)
            P.line("f", xi, max(ya, top + 2.2), xi, min(yb, bot - 2.2))
        for s in (1, -1):
            P.line("o", x, AY + 13 * s, xi, AY + 13 * s)
    for y, yi in ((top, top + 2.2), (bot, bot - 2.2)):
        P.line("o", x0, y, x1, y)
        P.line("f", x0 + 2.2, yi, x1 - 2.2, yi)
    cells = (AY, AY - 68)
    for yc in cells:
        P.solid([(508.4, yc - 12), (513.6, yc - 12), (513.6, yc + 12), (508.4, yc + 12)], "m", **GLASS)
    for ya, yb in ((FY - 58, AY - 80), (AY - 56, FY - 4.5), (FY + 4.5, AY - 12), (AY + 12, FY + 58)):
        P.rect("m", 510, ya, 512, yb)
    P.rect("m", x0 + 2.2, FY - 4.5, x1 - 2.2, FY + 4.5)
    P.line("f", x0 + 2.2, FY, x1 - 2.2, FY)
    P.rect("o", x1, FY - 58, x1 + 12, FY - 36)
    for k in range(1, 5):
        P.line("f", x1 + 1.5, FY - 58 + 4.4 * k, x1 + 10.5, FY - 58 + 4.4 * k)

    # --- camera: adapter, shell, window, sensor, cold finger, heat sink, fan
    both([(519, 13), (519, 21), (525, 21), (525, 13)], "o", -45, 2.2, "f")
    both([(525, 16), (525, 40), (583, 40), (583, 37), (529, 37), (529, 16)], "o", 45, 2.6)
    P.rect("m", 529.8, AY - 16, 531.6, AY + 16)
    P.fill([(540, AY - 11), (542.4, AY - 11), (542.4, AY + 11), (540, AY + 11)])
    P.rect("m", 542.4, AY - 14, 545.6, AY + 14)
    P.rect("m", 545.6, AY - 8, 556, AY + 8)
    for k in range(1, 5):
        P.line("f", 545.6 + 2.1 * k, AY - 8, 545.6 + 2.1 * k, AY + 8)
    both([(548, 9.5), (548, 31), (550, 31), (550, 9.5)], "m")
    box(556, 560.5, 33, "o", -45, 2.2, "f")
    r = -33.0
    while r <= 33.01:
        P.line("m", 560.5, AY + r, 580.5, AY + r)
        r += 4.4
    P.p["o"].append(f"M583 {f(AY - 38)}H592Q595 {f(AY - 38)} 595 {f(AY - 35)}V{f(AY + 35)}Q595 {f(AY + 38)} 592 {f(AY + 38)}H583")
    P.rect("m", 585.5, AY - 6, 592.5, AY + 6)
    for s in (1, -1):
        r = 9.0
        while r < 34:
            P.line("f", 585.8, AY + s * r, 592.2, AY + s * (r + 3))
            r += 4.6
    # power and data cable
    c0, c1, c2, c3 = (595, AY + 20), (632, AY + 22), (612, AY + 96), (664, AY + 118)
    side = {1: [], -1: []}
    for i in range(41):
        t = i / 40
        bx = (1 - t) ** 3 * c0[0] + 3 * (1 - t) ** 2 * t * c1[0] + 3 * (1 - t) * t * t * c2[0] + t ** 3 * c3[0]
        by = (1 - t) ** 3 * c0[1] + 3 * (1 - t) ** 2 * t * c1[1] + 3 * (1 - t) * t * t * c2[1] + t ** 3 * c3[1]
        dx = 3 * (1 - t) ** 2 * (c1[0] - c0[0]) + 6 * (1 - t) * t * (c2[0] - c1[0]) + 3 * t * t * (c3[0] - c2[0])
        dy = 3 * (1 - t) ** 2 * (c1[1] - c0[1]) + 6 * (1 - t) * t * (c2[1] - c1[1]) + 3 * t * t * (c3[1] - c2[1])
        n = math.hypot(dx, dy)
        for s in (1, -1):
            side[s].append((bx - s * dy / n * 1.5, by + s * dx / n * 1.5))
    P.poly("m", side[1])
    P.poly("m", side[-1])

    # --- the path of light and the optical axis
    P.line("c", 54, AY, 612, AY)
    for s in (1, -1):
        for h in (54, 36):
            pts = [(60, AY - s * h), (face(h), AY - s * h), (sec(0.3 * h), AY - s * 0.3 * h), (540, AY)]
            P.poly("r", pts)
            P.arrow(108, AY - s * h, 1, 0)
            for (xa, ya), (xb, yb), t in ((pts[1], pts[2], 0.5), (pts[2], pts[3], 0.24)):
                P.arrow(xa + (xb - xa) * t, ya + (yb - ya) * t, xb - xa, yb - ya)

    # --- call-outs
    P.leader("a", 157, AY - 46, 120, 86)
    P.leader("b", 173, AY - 9, 208, 86)
    P.leader("c", 421, AY + 40, 402, 322)
    P.leader("d", 485, AY + 21, 476, 322)
    P.leader("e", 511, AY - 86, 498, 56)
    P.leader("f", 541.2, AY - 9, 572, 108)
    P.vb = (46, 38, 628, 300)
    P.save()


# ====================================================================== Fig. 3
def despiece():
    """Reducer, filter wheel (cover, carousel, body) and cooled camera, exploded along the optical axis.
    Oblique view from the front left: circles across the axis become ellipses K times as wide as tall."""
    P = Plate("despiece", 720, 286, 1763)
    AY, K = 182.0, 0.36
    DY = AY - 46                                   # centre of the wheel: one filter sits on the axis

    def E(a, cy, r, t0=0, t1=360, step=4):
        n = max(2, int(abs(t1 - t0) / step))
        return [(a + K * r * math.cos(math.radians(t0 + (t1 - t0) * i / n)),
                 cy - r * math.sin(math.radians(t0 + (t1 - t0) * i / n))) for i in range(n + 1)]

    def cyl(a0, a1, r, cy=AY, key="o"):
        """Cylinder along the axis: front face, the two edges and the visible half of the back rim."""
        P.poly(key, E(a0, cy, r), clip=True)
        for s in (1, -1):
            P.line(key, a0, cy - s * r, a1, cy - s * r, clip=True)
        P.poly(key, E(a1, cy, r, -90, 90), clip=True)
        return E(a0, cy, r, 90, 270) + E(a1, cy, r, -90, 90)

    def ring(a, r, cy=AY, key="f"):
        P.poly(key, E(a, cy, r, -90, 90), clip=True)

    def along(a0, a1, r, t, cy=AY, key="h", jit=0.0):
        """Stroke on the side of a cylinder, parallel to the axis, at angle t round it."""
        c, s = math.cos(math.radians(t)), math.sin(math.radians(t))
        j0, j1 = P.rng.uniform(0, jit), P.rng.uniform(0, jit)
        P.line(key, a0 + j0 + K * r * c, cy - r * s, a1 - j1 + K * r * c, cy - r * s, clip=True)

    def in_ell(x, y, a, cy, r):
        return ((x - a) / (K * r)) ** 2 + ((y - cy) / r) ** 2 < 1

    def lit(a0, a1, r, cy=AY, ts=((80, "h", 2), (70, "h", 4), (60, "h", 7), (49, "f", 11), (37, "f", 16))):
        for t, key, jit in ts:
            along(a0, a1, r, t, cy, key, jit)

    # --- a. reducer
    nose = cyl(50, 60, 22)
    P.poly("m", E(50, AY, 18))
    P.poly("f", E(50, AY, 12, 112, 178))
    P.poly("f", E(50, AY, 7, 122, 166))
    P.poly("f", [p for p in E(55, AY, 18, 100, 260, 3) if in_ell(*p, 50, AY, 18)])
    for a in (53.5, 56.5):
        ring(a, 22)
    P.occ.append(nose)
    body = cyl(60, 114, 27)
    ring(74, 27, key="m")
    ring(86, 27, key="m")
    for t in range(-84, 85, 6):
        along(74, 86, 27, t, key="f")
    lit(62, 73, 27, ts=((82, "h", 0), (72, "h", 1), (61, "h", 2), (49, "f", 3), (36, "f", 4)))
    lit(88, 107, 27, ts=((83, "h", 0), (75, "h", 1), (66, "h", 2), (56, "h", 4), (45, "f", 6), (33, "f", 9), (20, "f", 12)))
    ring(108, 27)
    P.occ.append(body)

    # --- b. cover of the wheel, with the threaded port on the axis
    port = cyl(187, 196, 19)
    P.poly("m", E(187, AY, 15))
    P.poly("f", [p for p in E(196, AY, 15, 90, 270, 3) if in_ell(*p, 187, AY, 15)])
    for a in (190, 193):
        ring(a, 19)
    P.occ.append(port)
    cover = cyl(196, 201, 66, DY)
    P.hatch([E(196, DY, 63.5, 0, 360, 3)], 34, 3.1, "f", clip=True)
    P.poly("f", E(196, DY, 63.5), clip=True)
    for ang in range(0, 360, 60):
        cx = 196 + K * 58 * math.cos(math.radians(ang))
        cy = DY - 58 * math.sin(math.radians(ang))
        P.poly("m", [(cx + K * 2.8 * math.cos(math.radians(t)), cy - 2.8 * math.sin(math.radians(t)))
                     for t in range(0, 361, 30)], clip=True)
        P.line("f", cx - 0.7, cy + 1.9, cx + 0.7, cy - 1.9, clip=True)
    P.occ.append(cover)

    # --- c. carousel: seven filters, each engraved with its own hatch
    car = cyl(296, 299, 60, DY)
    holes = []
    for i in range(7):
        ang = math.radians(-90 + i * 360 / 7)
        hx, hy = 296 + K * 46 * math.cos(ang), DY - 46 * math.sin(ang)
        hole = [(hx + K * 14 * math.cos(math.radians(t)), hy - 14 * math.sin(math.radians(t))) for t in range(0, 360, 6)]
        holes.append(hole)
        P.poly("o", hole, close=True)
        inner = [(hx + 3 + K * 14 * math.cos(math.radians(t)), hy - 14 * math.sin(math.radians(t))) for t in range(96, 265, 6)]
        P.poly("f", [p for p in inner if ((p[0] - hx) / (K * 14)) ** 2 + ((p[1] - hy) / 14) ** 2 < 1])
        for rr, t0, t1 in ((9.6, 118, 172), (6.2, 126, 160)):      # glint on the glass
            P.poly("f", [(hx + 1.6 + K * rr * math.cos(math.radians(t)), hy - rr * math.sin(math.radians(t)))
                         for t in range(t0, t1 + 1, 6)])
    hub = E(296, DY, 9)
    P.hatch([E(296, DY, 57.5, 0, 360, 3)] + holes + [hub], 34, 2.5, "f")
    P.poly("m", hub)
    P.poly("m", E(296, DY, 3.4))
    P.occ.append(car)

    # --- d. body of the wheel: recess, spindle and the port to the camera
    wbody = cyl(396, 410, 66, DY)
    P.poly("m", E(396, DY, 61))
    P.poly("f", [p for p in E(406, DY, 61, 60, 300, 2) if in_ell(*p, 396, DY, 61)])
    for r, key in ((15, "m"), (19, "f")):
        run = [p for p in E(406, AY, r, 0, 360, 4) if in_ell(*p, 396, DY, 61)]
        P.poly(key, run)
    P.poly("m", E(399, DY, 5.5))
    P.poly("m", E(399, DY, 2))
    for a in (402, 405):
        P.poly("f", E(a, DY, 5.5, -90, 90))
    lit(397.5, 409, 66, DY, ts=((84, "h", 0), (76, "h", 0), (68, "h", 1), (59, "h", 1), (49, "f", 2), (38, "f", 3), (26, "f", 4)))
    rim = E(396, DY, 66, 0, 360, 3)
    P.hatch([rim, E(396, DY, 61, 0, 360, 3)], 34, 1.9, "f")       # lit rim round the dark recess
    P.occ.append(wbody)

    # --- e. camera: flange with the sensor behind its window, body, cooling fins
    flange = cyl(489, 500, 25)
    P.poly("m", E(489, AY, 20.5))
    P.poly("f", E(489, AY, 22.6))
    P.fill([(489 + K * u, AY - v) for u, v in ((-11.5, -7.8), (11.5, -7.8), (11.5, 7.8), (-11.5, 7.8))])
    P.poly("f", [(489 + K * u, AY - v) for u, v in ((-14.5, -10.6), (14.5, -10.6), (14.5, 10.6), (-14.5, 10.6))], close=True)
    for a in (492.5, 496):
        ring(a, 25)
    P.occ.append(flange)
    cam = cyl(500, 560, 42)
    P.poly("f", E(500, AY, 38), clip=True)
    P.hatch([E(500, AY, 38, 0, 360, 3), E(500, AY, 30, 0, 360, 3)], 34, 2.6, "f", clip=True)
    P.poly("f", E(500, AY, 30), clip=True)
    for ang in (45, 135, 225, 315):
        cx, cy = 500 + K * 33 * math.cos(math.radians(ang)), AY - 33 * math.sin(math.radians(ang))
        P.poly("m", [(cx + K * 2.4 * math.cos(math.radians(t)), cy - 2.4 * math.sin(math.radians(t)))
                     for t in range(0, 361, 30)], clip=True)
    lit(503, 554, 42, ts=((85, "h", 1), (79, "h", 2), (72, "h", 3), (65, "h", 5), (57, "h", 8), (48, "h", 12),
                          (38, "f", 17), (27, "f", 23), (15, "f", 30)))
    ring(556.5, 42, key="m")
    P.occ.append(cam)
    fins = cyl(560, 584, 42)
    a, k = 562.0, 0
    while a < 583.5:
        ring(a, 42 if k % 2 else 40.6, key="m" if k % 2 else "f")
        a += 2.2
        k += 1
    P.occ.append(fins)
    cap = cyl(584, 592, 39.5)
    P.occ.append(cap)
    # cable leaving the back of the camera
    c0, c1, c2, c3 = (598, AY + 22), (640, AY + 24), (640, AY + 78), (700, AY + 76)
    side = {1: [], -1: []}
    for i in range(41):
        t = i / 40
        bx = (1 - t) ** 3 * c0[0] + 3 * (1 - t) ** 2 * t * c1[0] + 3 * (1 - t) * t * t * c2[0] + t ** 3 * c3[0]
        by = (1 - t) ** 3 * c0[1] + 3 * (1 - t) ** 2 * t * c1[1] + 3 * (1 - t) * t * t * c2[1] + t ** 3 * c3[1]
        dx = 3 * (1 - t) ** 2 * (c1[0] - c0[0]) + 6 * (1 - t) * t * (c2[0] - c1[0]) + 3 * t * t * (c3[0] - c2[0])
        dy = 3 * (1 - t) ** 2 * (c1[1] - c0[1]) + 6 * (1 - t) * t * (c2[1] - c1[1]) + 3 * t * t * (c3[1] - c2[1])
        n = math.hypot(dx, dy)
        for s in (1, -1):
            side[s].append((bx - s * dy / n * 1.6, by + s * dx / n * 1.6))
    P.poly("m", side[1], clip=True)
    P.poly("m", side[-1], clip=True)

    # --- optical axis: visible in the gaps and through the open ports
    chord = K * math.sqrt(66 ** 2 - 46 ** 2)
    for xa, xb in ((22, 50), (114 + K * 27, 187), (201 + chord, 296 + K * 14),
                   (299 + K * math.sqrt(60 ** 2 - 46 ** 2), 406 + K * 15), (410 + chord, 489)):
        P.line("c", xa, AY, xb, AY)

    P.leader("a", 92, AY + 26, 78, AY + 66)
    P.leader("b", 189, DY - 63, 174, 40)
    P.leader("c", 293, DY - 58, 278, 40)
    P.leader("d", 400, DY - 65.5, 385, 40)
    P.leader("e", 538, AY + 41.5, 524, AY + 74)
    P.vb = (16, 26, 692, 242)
    P.save()


# ====================================================================== Fig. 4
def cupula():
    """Observatory dome cut through the slit: shell, shutter slid back, equatorial mount on a pier that
    goes down to its own footing without touching the floor, and the light of a star coming in."""
    W, H = 480, 476
    P = Plate("cupula", W, H, 1772)
    CX, CY, RO, RI = 240.0, 236.0, 150.0, 143.0
    GROUND, FLOOR = 400.0, 346.0

    def pol(r, deg):
        return CX + r * math.cos(math.radians(deg)), CY - r * math.sin(math.radians(deg))

    def circle(cx, cy, r, n=40):
        return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]

    # ---------------- geometry of the instrument (drawn last, but it hides what is behind)
    M = (240.0, 274.0)                                   # polar axis seen end-on
    a28 = math.radians(28)
    d = (math.cos(a28), -math.sin(a28))                  # declination axis, up to the right
    t = (-math.sin(a28), -math.cos(a28))                 # tube, up to the left, through the slit

    def at(u, v, o=M):
        return o[0] + d[0] * u + t[0] * v, o[1] + d[1] * u + t[1] * v

    def quad(u0, u1, v0, v1, o=M):
        return [at(u0, v0, o), at(u1, v0, o), at(u1, v1, o), at(u0, v1, o)]

    T = at(57, 0)
    tube = quad(-19, 19, -36, 44, T)
    cell_f = quad(-20.5, 20.5, 38, 44, T)
    cell_b = quad(-20.5, 20.5, -36, -29, T)
    train = [quad(-7, 7, -44, -36, T), quad(-16, 9, -48.5, -44, T), quad(-9, 9, -66, -48.5, T)]
    dec = quad(-8, 34, -8, 8)
    saddle = quad(34, 38, -22, 22)
    shaft = quad(-64, -8, -1.6, 1.6)
    weights = [quad(-46, -37, -15, 15), quad(-57, -48, -15, 15)]
    stop = quad(-66, -64, -4, 4)
    head = circle(M[0], M[1], 13)
    base = [(228, 300), (252, 300), (249, 285), (231, 285)]
    capp = [(219, 300), (261, 300), (261, 304), (219, 304)]
    pier = [(224, 304), (256, 304), (256, 430), (224, 430)]
    foot = [(206, 430), (274, 430), (274, 446), (206, 446)]
    front = at(0, 44, T)
    star = at(0, 44 + 205, T)

    # letters that sit over the drawing get a small clear disc
    LAB = {"c": (338, 204), "d": (197, 248), "e": (300, 378), "f": (326, 454)}
    P.occ += [tube, cell_f, cell_b, dec, saddle, shaft, head, base, capp, pier, stop] + train + weights
    P.occ += [circle(x, y, 9.5, 20) for x, y in LAB.values()]

    # ---------------- far half of the building, seen beyond the cut
    for lon in range(-75, 90, 15):                       # ribs of the dome
        p = math.radians(lon)
        P.poly("f", [(CX + RI * math.sin(p) * math.cos(math.radians(l)), CY - RI * math.sin(math.radians(l)))
                     for l in range(0, 91, 3)], clip=True)
    for lat in (30, 60):
        r = RI * math.cos(math.radians(lat))
        y = CY - RI * math.sin(math.radians(lat))
        P.line("f", CX - r, y, CX + r, y, clip=True)
    lat = 2.0                                            # lit inner face of the shell, on the right
    while lat < 66:
        r = RI * math.cos(math.radians(lat))
        y = CY - RI * math.sin(math.radians(lat))
        ln = r * (0.36 - 0.26 * lat / 90) * (0.8 + 0.4 * P.rng.random())
        P.line("h", CX + r - 1.2 - ln, y, CX + r - 1.2, y, clip=True)
        lat += 2.5
    for deg in range(-75, 90, 25):                       # panels of the drum
        x = CX + 134 * math.sin(math.radians(deg))
        P.line("f", x, 246, x, FLOOR - 1, clip=True)
    for deg in range(52, 89, 4):
        x = CX + 134 * math.sin(math.radians(deg))
        P.line("h", x, 248, x, FLOOR - 2, clip=True)
    P.line("f", 107, 262, 373, 262, clip=True)            # string course of the drum

    # ---------------- shell cut by the section, slit from 70 to 150 degrees
    for a0, a1 in ((0, 70), (150, 180)):
        arc_o = [pol(RO, a) for a in range(a0, a1 + 1, 2)]
        arc_i = [pol(RI, a) for a in range(a1, a0 - 1, -2)]
        P.poly("o", arc_o + arc_i, close=True)
        a = a0 + 0.9
        while a < a1:
            P.line("h", *pol(RI + 0.9, a), *pol(RO - 0.9, a + 1.1))
            a += 1.5
    P.poly("f", [pol(RI, a) for a in range(70, 151, 2)])          # far lip of the slit
    P.poly("f", [pol(RO - 0.6, a) for a in range(70, 151, 2)])
    shut_o = [pol(157, a) for a in range(6, 67, 2)]
    shut_i = [pol(152.6, a) for a in range(66, 5, -2)]
    P.poly("o", shut_o + shut_i, close=True)                      # shutter slid back over the roof
    for a in range(12, 66, 9):
        P.line("f", *pol(152.6, a), *pol(157, a))
    for a in (10, 62):                                            # its rollers
        P.poly("m", circle(*pol(151.3, a), 1.3, 10), close=True)

    # ---------------- walls, ring beam, footings
    for x0, x1, s in ((90, 106, 1), (374, 390, -1)):
        if s == 1:
            wall = [(x0, 244), (x1, 244), (x1, GROUND), (x0, GROUND)]
            P.solid(wall, "o", 45, 3.0)
        else:                                                     # the door is on this side
            P.solid([(x0, 244), (x1, 244), (x1, 352), (x0, 352)], "o", 45, 3.0)
            P.line("f", x0, 352, x0, GROUND)
            P.line("f", x1, 352, x1, GROUND)
            P.line("f", x0 + 4, 356, x0 + 4, GROUND)
            P.line("f", x0 + 4, 356, x1, 356)
        P.solid([(x0 - 4, 236), (x1 + 4, 236), (x1 + 4, 244), (x0 - 4, 244)], "o", -45, 2.4, "f")
        P.rect("o", x0 - 2, 229.5, x1 + 2, 234)                   # rotating base ring of the dome
        for xw in (x0 + 3, x1 - 3):
            P.poly("m", circle(xw, 235, 1.3, 10), close=True)
        P.solid([(x0 - 8, GROUND), (x1 + 8, GROUND), (x1 + 8, GROUND + 16), (x0 - 8, GROUND + 16)], "o", -45, 3.0)

    # ---------------- observing floor on joists (it stops short of the pier), stair, ground slab
    for xa, xb in ((106, 150), (186, 218), (262, 374)):
        P.solid([(xa, FLOOR), (xb, FLOOR), (xb, FLOOR + 5), (xa, FLOOR + 5)], "o", 45, 2.2, "f")
    for x in list(range(112, 148, 18)) + [192, 208] + list(range(268, 372, 18)):
        P.rect("m", x, FLOOR + 5, x + 4, FLOOR + 13)
        P.line("f", x, FLOOR + 13, x + 4, FLOOR + 5)
    steps = [(120, GROUND)]
    for k in range(6):
        x, y = 120 + 10 * k, GROUND - 9 * k
        steps += [(x, y - 9), (x + 10, y - 9)]
    P.poly("m", steps)
    P.line("f", 120, GROUND, 180, GROUND - 54)
    P.line("f", 124, GROUND - 21, 184, GROUND - 75)               # handrail
    for k in (0, 3, 6):
        P.line("f", 124 + 10 * k, GROUND - 21 - 9 * k, 124 + 10 * k, GROUND - 4 - 9 * k)
    P.line("m", 114, GROUND, 224, GROUND)
    P.line("m", 256, GROUND, 366, GROUND)
    P.line("f", 114, GROUND + 3, 221, GROUND + 3)
    P.line("f", 259, GROUND + 3, 366, GROUND + 3)
    P.line("f", 221, GROUND, 221, GROUND + 3)                     # joint: the slab does not touch the pier
    P.line("f", 259, GROUND, 259, GROUND + 3)

    # ---------------- pier and its own footing
    P.solid(pier, "o", -45, 3.4)
    P.solid(foot, "o", 45, 3.0)
    P.solid(capp, "o")

    # ---------------- ground outside and the earth under the building
    P.extra = (f'<defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" x2="{W}">'
               f'<stop offset="0" stop-opacity="0"/><stop offset=".12"/><stop offset=".88"/>'
               f'<stop offset="1" stop-opacity="0"/></linearGradient></defs>'
               f'<path fill="none" stroke="url(#fade)" stroke-width="1.2" stroke-linecap="round" '
               f'd="M0 {f(GROUND)}H82M398 {f(GROUND)}H{W}"/>')
    solids = [[(82, GROUND), (114, GROUND), (114, GROUND + 16), (82, GROUND + 16)],
              [(366, GROUND), (398, GROUND), (398, GROUND + 16), (366, GROUND + 16)],
              [(221, GROUND), (259, GROUND), (259, 430), (221, 430)], foot]

    def earth(x, y):
        if any(inside(s, x + dx, y + dy) for s in solids for dx, dy in ((0, 0), (7, -7), (-2, 2))):
            return
        if any(math.hypot(x + 3 - lx, y - 3 - ly) < 13 for lx, ly in LAB.values()):
            return
        for k, ln in enumerate((7.5, 5.6, 3.6)):
            P.line("h", x + 3.2 * k, y, x + 3.2 * k + ln * 0.71, y - ln * 0.71)

    for row, y in enumerate((GROUND + 12, GROUND + 28, GROUND + 44, GROUND + 59)):
        x = 30 + 15 * (row % 2) + 24 * row
        while x < W - 30 - 24 * row:
            earth(x + P.rng.uniform(-3, 3), y + P.rng.uniform(-2, 2))
            x += 31 - 2 * row

    # ---------------- the instrument
    P.solid(base, "o")
    P.line("f", 232.5, 292, 247.5, 292)
    P.poly("o", shaft, close=True)
    for w in weights:
        P.poly("o", w, close=True)
        for u in (-0.32, -0.12):                                   # lit edge of each counterweight
            pts = [w[0], w[1], w[2], w[3]]
            ax = (pts[0][0] + (pts[3][0] - pts[0][0]) * (0.5 + u), pts[0][1] + (pts[3][1] - pts[0][1]) * (0.5 + u))
            bx = (pts[1][0] + (pts[2][0] - pts[1][0]) * (0.5 + u), pts[1][1] + (pts[2][1] - pts[1][1]) * (0.5 + u))
            P.line("h", ax[0], ax[1], bx[0], bx[1])
    P.poly("o", stop, close=True)
    P.poly("o", dec, close=True)
    for v in (-5, -2.2):
        P.line("h", *at(-5, v), *at(31, v))
    P.poly("o", saddle, close=True)
    P.poly("o", head, close=True)
    P.poly("m", circle(M[0], M[1], 8), close=True)
    P.poly("m", circle(M[0], M[1], 2), close=True)
    P.poly("o", tube, close=True)
    P.poly("o", cell_f, close=True)
    P.poly("o", cell_b, close=True)
    for u, v0, v1 in ((-15.5, -27, 36), (-12, -25, 33), (-8, -20, 28), (-3.5, -12, 18)):
        P.line("h" if u < -10 else "f", *at(u, v0, T), *at(u, v1, T))
    P.line("f", *at(-19, 20, T), *at(19, 20, T))
    for q in train:
        P.poly("o", q, close=True)
    for v in (-53, -57, -61):
        P.line("f", *at(-9, v, T), *at(9, v, T))

    # ---------------- light of the star, down the slit and into the tube
    for u in (-12, 12):
        a, b = at(u, 44 + 186, T), at(u, 44 + 3, T)
        P.poly("r", [a, b])
        P.arrow(a[0] + (b[0] - a[0]) * 0.33, a[1] + (b[1] - a[1]) * 0.33, b[0] - a[0], b[1] - a[1])
    P.line("c", *at(0, 44 + 192, T), *front)
    for dx, dy, k in ((1, 0, 7), (0, 1, 7), (0.7, 0.7, 2.8), (0.7, -0.7, 2.8)):
        P.line("o", star[0] - dx * k, star[1] - dy * k, star[0] + dx * k, star[1] + dy * k)
    for x, y, k in ((66, 60, 2.6), (118, 26, 2.2), (402, 44, 2.8), (438, 132, 2.2), (30, 150, 2.2), (330, 22, 2)):
        P.line("f", x - k, y, x + k, y)
        P.line("f", x, y - k, x, y + k)

    # ---------------- call-outs
    P.leader("a", *pol(146.5, 166), 58, 176)
    P.leader("b", *pol(RI, 132), 112, 96)
    P.leader("c", *at(14, 6, T), *LAB["c"])
    P.leader("d", M[0] - 9, M[1] - 6, *LAB["d"])
    P.leader("e", 256, 376, *LAB["e"])
    P.leader("f", 274, 440, *LAB["f"])
    P.vb = (0, 12, W, 458)
    P.save()


if __name__ == "__main__":
    # En la web solo entra la cupula (Fig. 4). telescopio() y despiece() siguen aqui, sin usar:
    # `python laminas.py --todo` los escribe tambien en la misma carpeta de salida.
    if "--todo" in sys.argv:
        telescopio()
        despiece()
    cupula()
    print(json.dumps(CALLOUTS))      # ratio of each box and where the page sets each letter, in %
