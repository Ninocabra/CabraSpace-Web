"""
Plate "Observatorio de techo corredizo, en corte" (roll-off roof observatory, in section).

Companion of the dome plate of proposal 3 (project/p3/laminas.py, cupula.svg): same white-line
engraving technique (outline + hatch + fine line, light from the left, cut material hatched at 45
degrees, light of the star dashed, optical axis as a chain line) and the same box, 480 x 458, so it
drops into the same slot of the page.

What it shows: a low masonry hut cut along the direction in which the roof travels. The gabled roof
has rolled on its wheels along the rail beams, off the hut and onto the outer frame of posts, and the
sky is open. Inside, a Schmidt-Cassegrain on a German equatorial mount, on a pier that goes down to
its own footing through a joint in the floor slab. Beyond the cut, drawn lighter, a second pier
with a small refractor (a remote observatory is a shared room) and the door, in the far wall.

Drawn to scale, 66 units to the metre: the room is about 3 m across and its walls 2.25 m high, so that
the 235 mm tube (0.27 m across, 0.56 m long) has room to swing and stays below the rail beam.

It is a GENERIC roll-off hut, not a survey of any real building.

The SVG is monochrome black on transparent and is used as a CSS mask. Call-out LETTERS are not in the
SVG: the script writes llamadas.json (and prints it) with the position of every letter as a
percentage of the box, and the page sets them on top of the mask.

    python tools/atlas2/d3/techo.py   ->   atlas/img/techo-corredizo.svg, tools/atlas2/d3/llamadas.json

Self-contained: the Plate class is a copy of the one in laminas.py (plus the "d" style for the
closed position of the roof and the "p" style for what is buried).
"""
import json
import math
import os
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# In the web repo (F3, 12-11-2026): the SVG goes to atlas/img/ (or $ATLAS_IMG_OUT, to test without overwriting),
# llamadas.json stays next to this script (tools/build_atlas.py reads the letter positions from it).
OUT = Path(os.environ.get("ATLAS_IMG_OUT") or HERE.parents[2] / "atlas" / "img")

STYLE = {
    "f": 'stroke-width=".45" stroke-opacity=".62"',                                  # fine
    "d": 'stroke-width=".5" stroke-opacity=".7" stroke-dasharray="1.2 3.2"',         # other position
    "h": 'stroke-width=".55" stroke-opacity=".82"',                                  # hatch
    "c": 'stroke-width=".5" stroke-opacity=".8" stroke-dasharray="11 2.6 1.6 2.6"',  # chain (axis)
    "p": 'stroke-width=".8" stroke-dasharray="3.4 2.2"',                             # buried (pads)
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
        print(f"{path.name}: {len(svg) / 1024:.1f} KB", file=sys.stderr)
        return {"ratio": f"{f(w)}/{f(h)}", "labels": lab}


def circle(cx, cy, r, n=40):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


# ====================================================================== the plate
def techo():
    W, H = 480, 476
    P = Plate("techo-corredizo", W, H, 1781)

    # 66 units to the metre
    GROUND, FLOOR, SLAB = 400.0, 394.0, 404.0      # ground outside, top and bottom of the floor slab
    WL0, WL1, WR0, WR1 = 14.0, 26.0, 222.0, 234.0  # the two walls cut by the section: 2.97 m between them
    WTOP = 246.0                                   # top of the walls = underside of the rail beam (2.25 m)
    BEAM, RAIL = 238.0, 235.5                      # top of the rail beam, running surface of the rail
    BEND = 472.0                                   # outer end of the rail beam
    POSTS = (312.0, 385.0, 458.0)                  # outer frame: far row of posts, seen in elevation
    WR = 6.0                                       # wheel radius
    CH0, CH1 = 217.0, 223.5                        # bottom chord of the roof frame (top, bottom)
    SPAN, RISE, EAVE, TH = 228.0, 35.0, 4.0, 6.0   # roof: span, rise (about 17 degrees), eave, thickness
    SHIFT = 230.0                                  # how far the roof has rolled
    RX = WL0 - 4 + SHIFT                           # left end of the chord with the roof open
    PX0, PX1 = 104.0, 124.0                        # pier, 0.3 m
    JOINT = 4.5                                    # gap between the pier and the floor slab
    QX0, QX1 = 46.0, 66.0                          # second pier, beyond the cut
    DX0, DX1, DTOP = 170.0, 218.0, 261.0           # door in the far wall, 0.73 x 2.0 m
    PAD_W, PAD_D = 15.0, 22.0                      # pads of the outer posts: half width, depth
    SCOPE2 = True                                  # the second pier carries a small refractor (False: bare plate)

    # ---------------- geometry of the instrument (drawn last, but it hides what is behind)
    M = (114.0, 300.0)                                   # polar axis seen end-on, 1.4 m above the floor
    a24 = math.radians(24)
    d = (math.cos(a24), -math.sin(a24))                  # declination axis, up to the right
    t = (-math.sin(a24), -math.cos(a24))                 # tube, up to the left, over the wall

    def at(u, v, o=M):
        return o[0] + d[0] * u + t[0] * v, o[1] + d[1] * u + t[1] * v

    def quad(u0, u1, v0, v1, o=M):
        return [at(u0, v0, o), at(u1, v0, o), at(u1, v1, o), at(u0, v1, o)]

    T = at(26.4, 0)
    V1 = 21.5                                            # front of the tube, along it from T
    tube = quad(-8.9, 8.9, -15.5, V1, T)                 # 0.27 x 0.56 m
    cell_f = quad(-9.7, 9.7, V1 - 3.3, V1, T)
    cell_b = [at(-9.7, -15.5, T), at(9.7, -15.5, T), at(9.7, -17.8, T), at(6.2, -20, T),
              at(-6.2, -20, T), at(-9.7, -17.8, T)]      # rear casting of the Schmidt-Cassegrain
    train = [quad(-3.2, 3.2, -23, -20, T),               # reducer
             quad(-8, 4, -25.8, -23, T),                 # filter wheel, off the axis
             quad(-4.4, 4.4, -33.8, -25.8, T)]           # camera
    dec = quad(-4.5, 15, -4.6, 4.6)
    saddle = quad(15, 17.5, -11.5, 11.5)
    shaft = quad(-30, -4.5, -1.1, 1.1)
    weights = quad(-27.4, -16.2, -7.2, 7.2)              # two counterweights, drawn as one block
    stop = quad(-31.4, -30, -2.8, 2.8)
    head = circle(M[0], M[1], 6.6)
    PT = M[1] + 15                                       # top of the piers, 1.2 m above the floor
    base = [(M[0] - 6.6, PT - 3), (M[0] + 6.6, PT - 3), (M[0] + 4.9, M[1] + 5.4), (M[0] - 4.9, M[1] + 5.4)]
    capp = [(PX0 - 3, PT - 3), (PX1 + 3, PT - 3), (PX1 + 3, PT), (PX0 - 3, PT)]
    pier = [(PX0, PT), (PX1, PT), (PX1, 432), (PX0, 432)]
    foot = [(PX0 - 20, 432), (PX1 + 20, 432), (PX1 + 20, 448), (PX0 - 20, 448)]
    front = at(0, V1, T)
    LIGHT = 232.0                                        # from the front of the tube up to the star
    star = at(0, V1 + LIGHT, T)
    beam_of_light = quad(-9.6, 9.6, V1, V1 + LIGHT, T)   # the closed roof is not drawn across the rays

    # the second pier and the door are beyond the cut: they hide the wall, and the instrument hides them
    pier2 = [(QX0, PT), (QX1, PT), (QX1, FLOOR), (QX0, FLOOR)]
    capp2 = [(QX0 - 3, PT - 3), (QX1 + 3, PT - 3), (QX1 + 3, PT), (QX0 - 3, PT)]
    plate2 = [(QX0 + 4.5, PT - 5.4), (QX1 - 4.5, PT - 5.4), (QX1 - 4.5, PT - 3), (QX0 + 4.5, PT - 3)]
    door = [(DX0, DTOP), (DX1, DTOP), (DX1, FLOOR), (DX0, FLOOR)]
    M2 = ((QX0 + QX1) / 2, PT - 17.0)                    # its small refractor looks the other way
    b32 = math.radians(32)
    d2 = (-math.cos(b32), -math.sin(b32))
    t2 = (math.sin(b32), -math.cos(b32))

    def at2(u, v):
        return M2[0] + d2[0] * u + t2[0] * v, M2[1] + d2[1] * u + t2[1] * v

    def quad2(u0, u1, v0, v1):
        return [at2(u0, v0), at2(u1, v0), at2(u1, v1), at2(u0, v1)]

    scope2 = [quad2(4.6, 10.4, -9, 16), quad2(3.9, 11.1, 16, 24), quad2(5.9, 9.1, -12.5, -9),   # back to front
              quad2(5, 10, -17.5, -12.5), quad2(-3, 4.6, -2.3, 2.3), quad2(-11.5, -7.5, -4, 4),
              circle(M2[0], M2[1], 3.6, 20),
              [(M2[0] - 2.8, M2[1] + 3), (M2[0] + 2.8, M2[1] + 3), (M2[0] + 4.4, PT - 3), (M2[0] - 4.4, PT - 3)]]

    # letters that sit over the drawing get a small clear disc
    LAB = {"c": (157, 268), "d": (84, 277), "e": (147, 357), "f": (206, 456)}
    P.occ += [tube, cell_f, cell_b, dec, saddle, shaft, head, base, capp, pier, stop, weights] + train
    P.occ += [circle(x, y, 9.5, 20) for x, y in LAB.values()]
    P.occ += [[(x - 3.5, WTOP), (x + 3.5, WTOP), (x + 3.5, GROUND), (x - 3.5, GROUND)] for x in POSTS]
    P.occ += [[(x - 8, GROUND - 4), (x + 8, GROUND - 4), (x + 8, GROUND), (x - 8, GROUND)] for x in POSTS]

    # ---------------- far away, the line of the sierra
    sierra = [(246, 394), (258, 389), (269, 391), (284, 384), (297, 378), (309, 383), (318, 380), (334, 372),
              (349, 379), (361, 376), (377, 384), (392, 381), (409, 388), (424, 384), (441, 390), (458, 387),
              (472, 392)]
    P.poly("f", sierra, clip=True)
    for (xa, ya), (xb, yb) in zip(sierra, sierra[1:]):
        if yb < ya - 3:                                            # slopes that face the light
            for q in (0.35, 0.65):
                x, y = xa + (xb - xa) * q, ya + (yb - ya) * q
                P.line("f", x + 1.2, y + 2.2, x + 3.4, y + 6.8, clip=True)

    # ---------------- beyond the cut: the door and the second pier, lighter than what the section cuts
    P.poly("m", [door[3], door[0], door[1], door[2]], clip=True)                   # frame
    P.poly("f", [(DX0 + 3, FLOOR), (DX0 + 3, DTOP + 3), (DX1 - 3, DTOP + 3), (DX1 - 3, FLOOR)], clip=True)   # leaf
    mid = FLOOR - 0.47 * (FLOOR - DTOP)
    for y0, y1 in ((DTOP + 10, mid - 5), (mid + 5, FLOOR - 9)):                    # its two panels
        P.rect("f", DX0 + 10, y0, DX1 - 10, y1, clip=True)
    P.poly("m", circle(DX0 + 7, mid, 1.5, 12), close=True, clip=True)              # handle
    P.line("m", DX0 + 7, mid, DX0 + 12.5, mid, clip=True)
    for y in (DTOP + 16, FLOOR - 18):                                              # hinges
        P.line("m", DX1 - 1.5, y - 2.4, DX1 - 1.5, y + 2.4, clip=True)
    P.poly("m", [pier2[3], pier2[0], pier2[1], pier2[2]], clip=True)
    P.poly("m", capp2, close=True, clip=True)
    if SCOPE2:
        keep = P.occ
        for i, q in enumerate(scope2):                                             # each part hidden by the next
            P.occ = keep + scope2[i + 1:]
            P.poly("m", q, close=True, clip=True)
        P.occ = keep + scope2
        P.line("m", *at2(-3, 0), *at2(-13, 0), clip=True)                          # counterweight bar
        P.occ = keep
        P.line("f", *at2(8.7, -7), *at2(8.7, 14), clip=True)
    else:
        P.poly("m", plate2, close=True, clip=True)
        for x in (QX0 + 6.5, QX1 - 6.5):                                           # studs for the mount
            P.line("m", x, PT - 5.4, x, PT - 8, clip=True)
    for x, y0 in ((QX1 - 2.6, PT + 2), (QX1 - 5.4, PT + 2), (QX1 - 8.6, PT + 14)):  # its side in the shade
        P.line("f", x, y0, x, FLOOR - 3, clip=True)
    P.line("f", QX0 - 2.5, FLOOR - 1.8, QX1 + 2.5, FLOOR - 1.8, clip=True)         # base flange
    P.occ += [pier2, capp2, door] + (scope2 if SCOPE2 else [plate2])

    # ---------------- far wall of the hut, seen beyond the cut: courses of block, lit on the right
    y, row = WTOP + 13.5, 0
    while y < FLOOR - 4:
        x = WL1 + 1.5
        while x < WR0 - 2:
            lit = (x - WL1) / (WR0 - WL1)                          # 0 in the shade, 1 next to the lit wall
            ln = P.rng.uniform(16, 40) * (0.55 + 0.9 * lit)
            xe = min(x + ln, WR0 - 1.5)
            if xe - x > 5:
                P.line("f", x, y, xe, y, clip=True)
            x = xe + P.rng.uniform(5, 15) * (1.9 - 1.6 * lit)
        x = WL1 + 20 + (13 if row % 2 else 0)                      # upright joints, only where it is lit
        while x < WR0 - 3:
            if P.rng.random() < ((x - WL1) / (WR0 - WL1)) ** 1.6:
                P.line("f", x, y - 13.5 + 1.2, x, y - 1.2, clip=True)
            x += 26
        y += 13.5
        row += 1

    # ---------------- rail beam on the far wall and out over the posts; the rail on top of it
    P.rect("o", WL0, BEAM, BEND, WTOP, clip=True)
    P.line("f", WL0 + 1, BEAM + 2.1, BEND - 1, BEAM + 2.1, clip=True)
    P.line("f", WL0 + 1, WTOP - 2.1, BEND - 1, WTOP - 2.1, clip=True)
    P.line("m", WL0, RAIL, BEND, RAIL, clip=True)
    for x in (WL0, BEND - 3):                                      # buffers at both ends of the travel
        P.rect("m", x, RAIL - 5.5, x + 3, RAIL, clip=True)
    for x in (WL0 + 44, WR0 - 30, WR1 + 36, 348, 421):             # stiffeners of the beam
        P.line("f", x, BEAM + 2.1, x, WTOP - 2.1, clip=True)

    # ---------------- outer frame: posts, knee braces, base plates and their pads (buried, dashed)
    pads = [[(x - PAD_W, GROUND + 2.5), (x + PAD_W, GROUND + 2.5), (x + PAD_W, GROUND + PAD_D),
             (x - PAD_W, GROUND + PAD_D)] for x in POSTS]
    for i, x in enumerate(POSTS):
        P.rect("o", x - 3.5, WTOP, x + 3.5, GROUND - 4)
        P.line("h", x - 1.5, WTOP + 2, x - 1.5, GROUND - 6)
        P.line("f", x + 0.4, WTOP + 2, x + 0.4, GROUND - 6)
        P.rect("o", x - 8, GROUND - 4, x + 8, GROUND)
        for s in ((-1, 1) if i < len(POSTS) - 1 else (-1,)):
            P.poly("m", [(x + s * 3.5, WTOP + 27), (x + s * 26, WTOP + 1.2), (x + s * 29.6, WTOP + 1.2),
                         (x + s * 3.5, WTOP + 31.2)])
        P.poly("p", pads[i], close=True)
        P.hatch([pads[i]], -45, 4.2, "f")

    # ---------------- the roof, rolled off the hut: frame of the far gable, then the skin in section
    def roof(x0, key_skin="o", ghost=False):
        xm, x1 = x0 + SPAN / 2, x0 + SPAN
        k = RISE / (SPAN / 2)

        def under(x):
            return CH0 - RISE + k * abs(x - xm)

        skins = []
        for s in (-1, 1):
            xe = xm + s * (SPAN / 2 + EAVE)
            skins.append([(xe, under(xe)), (xm, under(xm)), (xm, under(xm) - TH), (xe, under(xe) - TH)])
        if ghost:                                                  # where the roof sits when it is shut
            outline = [skins[0][0], skins[0][3], (xm, under(xm) - TH), skins[1][3], skins[1][0]]
            P.occ.append(beam_of_light)                            # ...broken where the light comes down
            P.poly("d", outline, clip=True)
            P.line("d", x0 + 1, CH1, x1 - 1, CH1, clip=True)
            P.occ.pop()
            return
        # wheels under the chord, on the rail
        for xw in (x0 + 16, x0 + 81, x0 + 147, x0 + 212):
            P.poly("o", circle(xw, RAIL - WR, WR, 26), close=True)
            P.poly("f", circle(xw, RAIL - WR, WR - 2.1, 20), close=True)
            P.dot(xw, RAIL - WR, 1.3)
        # far gable: bottom chord, king post, struts, boards
        chord = [(x0, CH0), (x1, CH0), (x1, CH1), (x0, CH1)]
        post = [(xm - 3, under(xm)), (xm + 3, under(xm)), (xm + 3, CH0), (xm - 3, CH0)]
        struts = []
        for s in (-1, 1):
            xa, xb = xm + s * 3, xm + s * 54
            struts.append([(xa, CH0 - 4.5), (xa, CH0), (xa + s * 5, CH0), (xb, under(xb) + 0.6),
                           (xb - s * 5.2, under(xb - s * 5.2) + 0.6)])
        purl = []
        for s in (-1, 1):
            for fr in (0.2, 0.74):
                xc = xm + s * fr * SPAN / 2
                ang = math.atan(k) * s
                ca, sa = math.cos(ang), math.sin(ang)
                purl.append([(xc + ca * u - sa * v, under(xc) + 0.2 + sa * u + ca * v)
                             for u, v in ((-2.6, 0), (2.6, 0), (2.6, 5.4), (-2.6, 5.4))])
        hide = len(P.occ)
        P.occ += [post] + struts + purl
        x = xm + 12.0
        while x < x1 - 4:                                          # boards of the gable, the lit half
            top = under(x) + 1.2
            if CH0 - top > 3:
                P.line("f", x, top, x, CH0 - 1, clip=True)
            x += 9.0
        x = xm - 15.0
        while x > x0 + 20:                                         # ...and what shows of them in the shade
            top = under(x) + 1.2
            P.line("f", x, top + P.rng.uniform(0.25, 0.6) * (CH0 - top), x, CH0 - 1, clip=True)
            x -= 18.0
        x, gap = x1 - 6.0, 3.2
        while x > xm + 54:                                         # the light itself, towards the eave
            top = under(x) + 1.2
            if CH0 - top > 2.5:
                P.line("h", x, top, x, CH0 - 1, clip=True)
            x -= gap
            gap += 0.55
        del P.occ[hide:]
        P.poly("o", chord, close=True)
        P.line("f", x0 + 1.5, CH0 + 2.1, x1 - 1.5, CH0 + 2.1)
        P.poly("m", post, close=True)
        for q in struts:
            P.poly("m", q, close=True)
        for q in purl:
            P.poly("m", q, close=True)
            P.line("f", *q[3], *q[1])
        for s, q in zip((-1, 1), skins):                           # the skin, cut by the section
            P.poly(key_skin, q, close=True)
            P.hatch([q], 58 * s, 2.9, "h")
        P.poly("m", [(xm - 9, under(xm - 9) - TH - 1.6), (xm, under(xm) - TH - 2.2), (xm + 9, under(xm + 9) - TH - 1.6)])
        for s in (-1, 1):                                          # fascia at each eave
            xe = xm + s * (SPAN / 2 + EAVE)
            P.rect("m", min(xe, xe + s * 1.8), under(xe) - TH - 0.6, max(xe, xe + s * 1.8), under(xe) + 3.4)

    roof(RX)
    P.occ.append([(RX - EAVE - 2, CH1), (RX - EAVE - 2, CH0 - 4), (RX + SPAN / 2, CH0 - RISE - TH - 3),
                  (RX + SPAN + EAVE + 2, CH0 - 4), (RX + SPAN + EAVE + 2, CH1)])
    roof(RX - SHIFT, ghost=True)

    # ---------------- walls of the hut, cut: masonry, cap, footing
    for x0, x1 in ((WL0, WL1), (WR0, WR1)):
        P.solid([(x0, WTOP + 7), (x1, WTOP + 7), (x1, SLAB), (x0, SLAB)], "o", 45, 3.0)
        P.solid([(x0 - 3, WTOP), (x1 + 3, WTOP), (x1 + 3, WTOP + 7), (x0 - 3, WTOP + 7)], "o", -45, 2.4, "f")
        P.solid([(x0 - 8, SLAB), (x1 + 8, SLAB), (x1 + 8, SLAB + 16), (x0 - 8, SLAB + 16)], "o", -45, 3.0)

    # ---------------- floor slab: it stops short of the pier on both sides (the joint)
    for xa, xb in ((WL1, PX0 - JOINT), (PX1 + JOINT, WR0)):
        P.solid([(xa, FLOOR), (xb, FLOOR), (xb, SLAB), (xa, SLAB)], "o", 45, 2.2, "f")
        P.line("f", xa + 8 if xa == WL1 else xa, SLAB + 3, xb if xa == WL1 else xb - 8, SLAB + 3)
    for x in (PX0 - JOINT, PX1 + JOINT):
        P.line("f", x, SLAB, x, SLAB + 3)

    # ---------------- pier and its own footing
    P.solid(pier, "o", -45, 3.4)
    P.solid(foot, "o", 45, 3.0)
    P.solid(capp, "o")

    # ---------------- ground outside and the earth under the building
    gaps = [(0, WL0)] + [(a, b) for a, b in zip([WR1] + [x + 8 for x in POSTS], [x - 8 for x in POSTS] + [W])]
    P.extra = (f'<defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" x2="{W}">'
               f'<stop offset="0" stop-opacity="0"/><stop offset=".07"/><stop offset=".93"/>'
               f'<stop offset="1" stop-opacity="0"/></linearGradient></defs>'
               f'<path fill="none" stroke="url(#fade)" stroke-width="1.2" stroke-linecap="round" '
               f'd="{"".join(f"M{f(a)} {f(GROUND)}H{f(b)}" for a, b in gaps)}"/>')
    solids = [[(WL0 - 8, GROUND), (WL1 + 8, GROUND), (WL1 + 8, SLAB + 16), (WL0 - 8, SLAB + 16)],
              [(WR0 - 8, GROUND), (WR1 + 8, GROUND), (WR1 + 8, SLAB + 16), (WR0 - 8, SLAB + 16)],
              [(PX0 - 3, GROUND), (PX1 + 3, GROUND), (PX1 + 3, 432), (PX0 - 3, 432)], foot]
    solids += [[(WL0, GROUND), (WR1, GROUND), (WR1, SLAB + 5), (WL0, SLAB + 5)]]      # the slab and its lower line
    solids += [[(x - PAD_W - 2, GROUND), (x + PAD_W + 2, GROUND), (x + PAD_W + 2, GROUND + PAD_D + 2),
                (x - PAD_W - 2, GROUND + PAD_D + 2)] for x in POSTS]

    def earth(x, y):
        if any(inside(s, x + dx, y + dy) for s in solids for dx, dy in ((0, 0), (7, -7), (-2, 2))):
            return
        if any(math.hypot(x + 3 - lx, y - 3 - ly) < 13 for lx, ly in LAB.values()):
            return
        for k, ln in enumerate((7.5, 5.6, 3.6)):
            P.line("h", x + 3.2 * k, y, x + 3.2 * k + ln * 0.71, y - ln * 0.71)

    for row, y in enumerate((GROUND + 12, GROUND + 28, GROUND + 44, GROUND + 59)):
        x = 14 + 15 * (row % 2) + 22 * row
        while x < W - 14 - 22 * row:
            earth(x + P.rng.uniform(-3, 3), y + P.rng.uniform(-2, 2))
            x += 31 - 2 * row
    for x, hgt in ((262, 6.5), (338, 5), (358, 7), (424, 5.5), (476, 5), (6, 5.5)):   # a little grass outside
        for dx, lean in ((-2.2, -1.8), (0, 0.3), (2.3, 2.1)):
            P.line("f", x + dx, GROUND - 0.8, x + dx + lean, GROUND - hgt * (1 if dx == 0 else 0.72))

    # ---------------- the instrument
    def stack(parts):
        """Outlines from back to front: each one is hidden by those that come after it."""
        keep = P.occ
        for i, (key, q) in enumerate(parts):
            P.occ = [qq for _, qq in parts[i + 1:]]
            P.poly(key, q, close=True, clip=True)
        P.occ = keep

    P.solid(base, "o")
    stack([("m", shaft), ("o", dec), ("o", head)])
    P.poly("o", weights, close=True)
    P.line("m", *at(-21.8, -7.2), *at(-21.8, 7.2))                 # the two counterweights
    for v in (2.2, 4.6):                                           # their lit edge
        P.line("h", *at(-26.6, v), *at(-22.6, v))
        P.line("h", *at(-21, v), *at(-17, v))
    P.poly("m", stop, close=True)
    P.line("h", *at(7.6, -2.3), *at(13.6, -2.3))
    P.poly("o", saddle, close=True)
    P.poly("m", circle(M[0], M[1], 3.9, 24), close=True)
    P.dot(M[0], M[1], 1.0)
    P.poly("o", tube, close=True)
    P.poly("o", cell_f, close=True)
    P.poly("o", cell_b, close=True)
    for u, v0, v1 in ((-7, -12.5, 15.5), (-5.1, -11, 14), (-2.9, -8, 11)):
        P.line("h" if u < -4 else "f", *at(u, v0, T), *at(u, v1, T))
    P.line("f", *at(-8.9, 7, T), *at(8.9, 7, T))
    P.poly("m", train[0], close=True)
    P.poly("m", train[1], close=True)
    P.poly("o", train[2], close=True)
    for v in (-28.4, -31):                                         # cooling fins of the camera
        P.line("f", *at(-4.4, v, T), *at(4.4, v, T))

    # ---------------- light of the star, over the wall and into the tube
    for u in (-5.8, 5.8):
        a, b = at(u, V1 + LIGHT - 18, T), at(u, V1 + 2.5, T)
        P.poly("r", [a, b])
        P.arrow(a[0] + (b[0] - a[0]) * 0.33, a[1] + (b[1] - a[1]) * 0.33, b[0] - a[0], b[1] - a[1])
    P.line("c", *at(0, V1 + LIGHT - 12, T), *front)
    for dx, dy, k in ((1, 0, 7), (0, 1, 7), (0.7, 0.7, 2.8), (0.7, -0.7, 2.8)):
        P.line("o", star[0] - dx * k, star[1] - dy * k, star[0] + dx * k, star[1] + dy * k)
    for x, y, k in ((176, 44, 2.4), (262, 92, 2.2), (318, 40, 2.8), (392, 104, 2.2), (452, 58, 2.4),
                    (18, 150, 2.2), (116, 22, 2), (214, 132, 2.2), (148, 106, 2)):
        P.line("f", x - k, y, x + k, y)
        P.line("f", x, y - k, x, y + k)

    # ---------------- call-outs
    kr = RISE / (SPAN / 2)
    P.leader("a", RX + SPAN / 2 + 56, CH0 - RISE + kr * 56 - TH / 2, 448, 150)
    P.leader("b", 264, (BEAM + WTOP) / 2, 270, 290)
    P.leader("c", *at(4.5, 6.5, T), *LAB["c"])
    P.leader("d", M[0] - 4.8, M[1] - 3.2, *LAB["d"])
    P.leader("e", PX1, 357, *LAB["e"])
    P.leader("f", PX1 + 20, 442, *LAB["f"])
    P.vb = (0, 12, W, 458)
    return P.save()


if __name__ == "__main__":
    out = {"techo-corredizo": techo()}
    (HERE / "llamadas.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(out))      # ratio of the box and where the page sets each letter, in %
