"""
Cabinet of instruments: the engraved plates of proposal 1 for the cabraspace.com home page.

    python instrumentos.py            ->  armilar.svg, refractor.svg, octante.svg, astrolabio.svg
    python instrumentos.py armilar    ->  only that one

Brass instruments of the 17th-18th centuries drawn as solids with the engine in grabado.py:
"white-line" engraving for a dark page (lit surfaces carry the lines, light from the left),
monochrome black on transparent, used as CSS masks painted in gold.

Nothing here is traced: the armillary is tilted to the latitude LAT, the astrolabe's plate is the
real stereographic projection for that latitude and its star pointers are real stars (J2000).
"""
import math
import os
import random
import sys
from pathlib import Path

from grabado import Plate, add, circle2, comb, cross, dot, mul, perp, sub, unit

HERE = Path(os.environ.get("ATLAS_IMG_OUT") or Path(__file__).resolve().parents[3] / "atlas" / "img")   # salida: atlas/img/ (o $ATLAS_IMG_OUT para probar sin pisar nada)
LAT = math.radians(38.15)         # AstroCamp (Nerpio), quoted from memory: NOT VERIFIED, change it here if wrong
EPS = math.radians(23.44)         # obliquity of the ecliptic


def star(pl, x, y, k, key="f"):
    """Four-pointed star, as in the Astro Forecast plate."""
    for dx, dy, m in ((1, 0, 1.0), (0, 1, 1.0), (0.7, 0.7, 0.38), (0.7, -0.7, 0.38)):
        pl.flat(key, [(x - dx * k * m, y - dy * k * m), (x + dx * k * m, y + dy * k * m)])


def ground(pl, y, x0, x1, rng, n=26, depth=-1e6):
    for _ in range(n):
        yy = y + 3 + rng.random() * 16
        x = rng.uniform(x0, x1)
        ln = rng.uniform(6, 24) * (1 - (yy - y) / 26)
        pl.stroke_v("f", [(x, yy, depth), (x + ln, yy, depth)])


# ================================================================ armillary sphere
def armilar():
    R = 150.0
    pl = Plate(560, 596, cx=280, cy=208, az=118, el=13)
    rng = random.Random(1687)
    O = (0.0, 0.0, 0.0)
    X, Y, Z = (1.0, 0, 0), (0, 1.0, 0), (0, 0, 1.0)

    # --- the cage: polar axis raised to the latitude, in the meridian plane (x = 0)
    pole = (0.0, math.cos(LAT), math.sin(LAT))
    ea = X
    eb = cross(pole, ea)
    hour = math.radians(-58)                                  # how the cage is turned on its axis
    gam = comb(O, (math.cos(hour), ea), (math.sin(hour), eb))  # equinox
    q = cross(pole, gam)
    n_ecl = comb(O, (math.cos(EPS), pole), (-math.sin(EPS), q))
    t = 0.02 * R

    ecl = pl.band(O, n_ecl, R, 0, 0.058, t, streaks=(-0.55,), thr=0.3)
    pl.band(O, pole, 0.985 * R, 0, 0.026, t, streaks=(0.0,))
    for la in (EPS, -EPS, math.pi / 2 - EPS, -(math.pi / 2 - EPS)):
        pl.band(O, pole, 0.985 * R, la, 0.015, t)
    pl.band(O, q, 0.97 * R, 0, 0.016, t)
    pl.band(O, gam, 0.97 * R, 0, 0.016, t)

    # zodiac scale on the ecliptic: signs, decans and 2° divisions along one edge
    for d in range(0, 360, 2):
        th = math.radians(d)
        if d % 30 == 0:
            la0, la1 = -0.058, 0.058
        elif d % 10 == 0:
            la0, la1 = 0.0, 0.058
        else:
            la0, la1 = 0.034, 0.058
        p0, p1 = ecl["pt"](la0, th), ecl["pt"](la1, th)
        if ecl["is_near"](p0):
            pl.stroke("f", [p0, p1], {ecl["near"]})
    for la in (0.0, 0.034):
        run = []
        for j in range(361):
            p = ecl["pt"](la, math.radians(j))
            if ecl["is_near"](p):
                run.append(p)
            else:
                pl.stroke("f", run, {ecl["near"]})
                run = []
        pl.stroke("f", run, {ecl["near"]})

    # polar axis and the Earth at the centre
    pl.revolve(O, pole, [(-1.035 * R, 1.6), (1.035 * R, 1.6)], hatch=())
    g = 0.14 * R
    gid = pl.sphere(O, g)
    ga, gb = perp(pole), cross(pole, perp(pole))
    for lat in (-60, -30, 0, 30, 60):
        la = math.radians(lat)
        pl.stroke("f", [comb(O, (g * math.sin(la), pole), (g * math.cos(la) * math.cos(math.radians(j)), ga),
                             (g * math.cos(la) * math.sin(math.radians(j)), gb)) for j in range(0, 361, 6)], {gid}, tol=0.4)
    for lon in range(0, 180, 30):
        lo = math.radians(lon)
        d = comb(O, (math.cos(lo), ga), (math.sin(lo), gb))
        pl.stroke("f", [comb(O, (g * math.sin(math.radians(j)), pole), (g * math.cos(math.radians(j)), d))
                        for j in range(0, 361, 6)], {gid}, tol=0.4)
    for k in range(9):                                        # lit limb of the globe
        la = math.radians(-50 + k * 12.5)
        base = math.atan2(dot(pl.L, gb), dot(pl.L, ga))
        pl.stroke("h", [comb(O, (g * math.sin(la), pole), (g * math.cos(la) * math.cos(base + math.radians(j)), ga),
                             (g * math.cos(la) * math.sin(base + math.radians(j)), gb)) for j in range(-34, 35, 4)], {gid}, tol=0.4)

    # --- meridian ring: flat, graduated, in the plane x = 0
    r_in, r_out = 1.04 * R, 1.135 * R
    mid, mf = pl.plate(O, Y, Z, [circle2(r_out, 240), circle2(r_in, 240, cw=True)], t=0.036 * R)
    for d in range(0, 360, 2):
        th = math.radians(d)
        ln = 0.05 * R if d % 10 == 0 else 0.026 * R
        pl.stroke("f", [mf((r_in * math.cos(th), r_in * math.sin(th))), mf(((r_in + ln) * math.cos(th), (r_in + ln) * math.sin(th)))], {mid})
    pl.stroke("f", [mf(p) for p in circle2(r_in + 0.05 * R, 240)] + [mf((r_in + 0.05 * R, 0))], {mid})
    for sgn in (1, -1):                                       # the pivots of the axis
        cx, cy = sgn * 1.085 * R * math.cos(LAT), sgn * 1.085 * R * math.sin(LAT)
        pl.stroke("o", [mf(p) for p in circle2(0.026 * R, 24, cx, cy)] + [mf((cx + 0.026 * R, cy))], {mid})

    # --- horizon ring: broad, flat, with its scales
    h_in, h_out = 1.05 * R, 1.34 * R
    hid, hf = pl.plate(O, X, Y, [circle2(h_out, 300), circle2(h_in, 300, cw=True)], t=0.045 * R)
    for rr in (h_in + 0.035 * R, h_in + 0.05 * R, 1.2 * R, 1.215 * R, h_out - 0.02 * R):
        pl.stroke("f", [hf(p) for p in circle2(rr, 300)] + [hf((rr, 0))], {hid})
    for d in range(0, 360):
        th = math.radians(d)
        cs, sn = math.cos(th), math.sin(th)
        if d % 2 == 0:
            pl.stroke("f", [hf((h_in * cs, h_in * sn)), hf(((h_in + 0.035 * R) * cs, (h_in + 0.035 * R) * sn))], {hid})
        if d % 10 == 0:
            pl.stroke("f", [hf(((h_in + 0.05 * R) * cs, (h_in + 0.05 * R) * sn)), hf((1.2 * R * cs, 1.2 * R * sn))], {hid})
        if d % 30 == 15:
            pl.stroke("f", [hf((1.215 * R * cs, 1.215 * R * sn)), hf(((h_out - 0.02 * R) * cs, (h_out - 0.02 * R) * sn))], {hid})
    for d in range(0, 360, 5):                                # calendar scale on the outer band
        if d % 30 != 15:
            th = math.radians(d)
            pl.stroke("f", [hf((1.215 * R * math.cos(th), 1.215 * R * math.sin(th))),
                            hf((1.245 * R * math.cos(th), 1.245 * R * math.sin(th)))], {hid})

    for d2 in range(0, 720, 3):                               # lit part of the rim
        th = math.radians(d2 / 2)
        nrm = (math.cos(th), math.sin(th), 0.0)
        if dot(nrm, pl.v) > 0.04 and dot(nrm, pl.L) > 0.28:
            pl.stroke("h", [comb(O, (h_out, nrm), (0.016 * R, Z)), comb(O, (h_out, nrm), (-0.016 * R, Z))], {hid})

    # --- cradle: two half hoops under the horizon, crossing at the nadir
    c_in, c_out = 1.165 * R, 1.24 * R
    d0 = math.asin(0.0225 * R / c_out)
    for beta in (45, 135):
        b = math.radians(beta)
        eu = (math.cos(b), math.sin(b), 0.0)
        hoop = circle2(c_out, 120, a0=math.pi + d0, a1=2 * math.pi - d0) + circle2(c_in, 120, a0=math.pi + d0, a1=2 * math.pi - d0)[::-1]
        cid, cf = pl.plate(O, eu, Z, [hoop], t=0.04 * R)
        mid_r = (c_in + c_out) / 2
        run = []
        for j in range(0, 121):                               # bright line on the lit quarter of each hoop
            th = math.pi + d0 + (math.pi - 2 * d0) * j / 120
            p = cf((mid_r * math.cos(th), mid_r * math.sin(th)))
            if dot(unit(p), pl.L) > 0.05:
                run.append(p)
            else:
                pl.stroke("h", run, {cid})
                run = []
        pl.stroke("h", run, {cid})

    # --- stand: saddle for the meridian, turned column, moulded foot on three buns
    pl.revolve(O, Z, [(-1.19 * R, 0.062 * R), (-1.105 * R, 0.062 * R)], cap_end=True)
    col = [(-2.10, 0.0), (-2.10, 0.60), (-2.065, 0.60), (-2.055, 0.565), (-2.02, 0.565), (-2.005, 0.50), (-1.985, 0.30),
           (-1.955, 0.15), (-1.915, 0.085), (-1.89, 0.07), (-1.875, 0.105), (-1.845, 0.105), (-1.83, 0.062),
           (-1.80, 0.060), (-1.76, 0.075), (-1.71, 0.105), (-1.66, 0.128), (-1.61, 0.134), (-1.56, 0.122), (-1.51, 0.098),
           (-1.46, 0.074), (-1.43, 0.064), (-1.415, 0.10), (-1.39, 0.10), (-1.375, 0.060), (-1.33, 0.060),
           (-1.315, 0.12), (-1.275, 0.12), (-1.24, 0.085), (-1.24, 0.0)]
    col = [(s * R, r * R) for s, r in col]
    rv = pl.revolve(O, Z, col, nth=96,
                    hatch=[(d, 13, 23, "h", 0.06) for d in (-34, -12, 12)] + [(d, 8, 10, "h") for d in (-30, -8, 16)]
                    + [(d, 25, 26, "h") for d in (-30, -8, 16)]
                    + [(d, 3, 4, "h", 0.15) for d in range(-40, 30, 9)] + [(d, 1, 2, "h", 0.15) for d in range(-40, 30, 9)])
    for i, fr, span in ((5, 0.5, 46), (6, 0.25, 40), (6, 0.6, 34), (6, 0.9, 28), (7, 0.45, 22)):   # lit side of the foot
        (s0, r0), (s1, r1) = col[i], col[i + 1]
        pl.stroke("h", [rv["pt"](s0 + (s1 - s0) * fr, r0 + (r1 - r0) * fr, rv["thl"] + math.radians(j))
                        for j in range(-span, span + 1, 3)], {rv["ids"][i]})
    for az in (205, 325, 85):
        a = math.radians(az)
        fo = (0.50 * R * math.cos(a), 0.50 * R * math.sin(a), 0.0)
        pl.revolve(fo, Z, [(-2.165 * R, 0.0), (-2.165 * R, 0.035 * R), (-2.15 * R, 0.062 * R), (-2.125 * R, 0.07 * R),
                           (-2.10 * R, 0.055 * R)], crease_deg=50, hatch=[(-20, 1, 4, "h")])

    ground(pl, 208 + 2.165 * R * math.cos(math.radians(13)) + 4, 120, 440, rng, n=22)
    star(pl, 62, 96, 6.5)
    star(pl, 506, 52, 4.4)
    star(pl, 520, 300, 3.6)
    star(pl, 44, 330, 3.2)
    pl.svg(HERE / "armilar.svg")


# ================================================================ helpers for flat parts
def area(c):
    return sum(c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1] for i in range(len(c))) / 2


def ccw(c):
    return list(c) if area(c) > 0 else list(c)[::-1]


def cw(c):
    return list(c) if area(c) < 0 else list(c)[::-1]


def bezier(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def ribbon(center, widths):
    """Closed outline of a strip that follows a centre line with the given half widths."""
    left, right = [], []
    n = len(center)
    for i, (x, y) in enumerate(center):
        x0, y0 = center[max(0, i - 1)]
        x1, y1 = center[min(n - 1, i + 1)]
        ln = math.hypot(x1 - x0, y1 - y0) or 1.0
        nx, ny = -(y1 - y0) / ln, (x1 - x0) / ln
        w = widths[i] if isinstance(widths, (list, tuple)) else widths
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return ccw(left + right[::-1])


def inside(p, contours):
    x, y = p
    hit = False
    for c in contours:
        n = len(c)
        for i in range(n):
            (xa, ya), (xb, yb) = c[i], c[(i + 1) % n]
            if (ya > y) != (yb > y) and x < xa + (y - ya) * (xb - xa) / (yb - ya):
                hit = not hit
    return hit


def union(pl, to_world, pieces, key="o", step=0.6):
    """Flat fretwork cut from one sheet: fill every piece, draw only the outline of their union."""
    oid = pl.new_id()
    boxes = []
    for pc in pieces:
        pl.fill([[pl.P(to_world(p)) for p in c] for c in pc], oid)
        xs = [p[0] for c in pc for p in c]
        ys = [p[1] for c in pc for p in c]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))
    for k, pc in enumerate(pieces):
        for c in pc:
            run = []
            m = len(c)
            for i in range(m):
                a, b = c[i], c[(i + 1) % m]
                n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
                for j in range(n + (1 if i == m - 1 else 0)):
                    p = (a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n)
                    hidden = any(q != k and bx[0] <= p[0] <= bx[2] and bx[1] <= p[1] <= bx[3] and inside(p, pieces[q])
                                 for q, bx in enumerate(boxes))
                    if hidden:
                        pl.stroke(key, [to_world(r) for r in run], {oid})
                        run = []
                    else:
                        run.append(p)
            pl.stroke(key, [to_world(r) for r in run], {oid})
    return oid


# ================================================================ refracting telescope
def refractor():
    pl = Plate(450, 460, cx=196, cy=432, az=0, el=10, k=0.9)
    rng = random.Random(1758)
    O = (0.0, 0.0, 0.0)
    Z = (0, 0, 1.0)

    # --- folding tripod: three cabriole legs
    for az in (196, 318, 72):
        a = math.radians(az)
        eu = (math.cos(a), math.sin(a), 0.0)
        cl = bezier((4, 104), (52, 132), (92, 62), (117, 9), 40)
        leg = ribbon(cl, [9.5 - 5.2 * (i / 40) ** 0.8 for i in range(41)])
        lid, lf = pl.plate(O, eu, Z, [leg], t=7.5, corner_deg=40)
        hl = [(x + 0.38 * (9.5 - 5.2 * (i / 40) ** 0.8), y + 0.9) for i, (x, y) in enumerate(cl)][3:-3]
        pl.stroke("h", [lf(p) for p in hl], {lid})
        foot = comb(O, (118, eu))
        pl.revolve(foot, Z, [(0, 0), (0, 5), (2, 8.5), (5.5, 9.5), (9, 7.5), (11, 4)], crease_deg=60, cap_end=True,
                   hatch=[(-15, 1, 4, "h")])

    # --- pillar
    pil = [(92, 0), (92, 12.5), (96, 14), (117, 14), (120, 10), (125, 10), (128, 13), (134, 13), (137, 8),
           (146, 7.2), (190, 6.6), (236, 6.0), (238, 9.5), (244, 9.5), (246, 6.2), (254, 6.2), (257, 9), (262, 11.5),
           (268, 11.5), (273, 8.5), (273, 0)]
    pl.revolve(O, Z, pil, nth=72,
               hatch=[(d, 8, 11, "h", 0.04) for d in (-30, -6)] + [(d, 2, 3, "h", 0.12) for d in (-36, -18, 0, 18)]
               + [(d, 6, 7, "h", 0.1) for d in (-30, -6, 18)] + [(d, 12, 13, "h", 0.1) for d in (-30, -6, 18)])

    # --- tube: 33° above the horizon, turned a little towards the viewer
    e, at = math.radians(33), math.radians(-24)
    d = (math.cos(e) * math.cos(at), math.cos(e) * math.sin(at), math.sin(e))
    w = unit(sub(Z, mul(d, dot(Z, d))))
    hz = cross(d, w)
    if dot(hz, pl.v) < 0:
        hz = mul(hz, -1)
    hinge = (0.0, 0.0, 283.0)
    pl.revolve(hinge, hz, [(-13, 7.5), (13, 7.5)], cap_start=True, cap_end=True, hatch=[(0, 0, 1, "h", 0.15)])
    pl.revolve(hinge, hz, [(13, 3), (16, 3)], cap_end=True)
    to = comb(hinge, (38, w), (-14, d))
    saddle = ccw([(-12, 4), (12, 4), (30, 23.5), (-46, 23.5)])
    sid, sf = pl.plate(hinge, d, w, [saddle], t=9, corner_deg=20)
    pl.stroke("h", [sf((-8, 9)), sf((-30, 20))], {sid})
    tube = [(-238, 5.2), (-232, 7.8), (-219, 7.8), (-217, 5.6), (-209, 5.6), (-209, 8.6), (-164, 8.6), (-164, 11.8),
            (-156, 11.8), (-156, 16.4), (-147, 16.4), (-147, 14.6), (-62, 14.9), (-62, 16.0), (-56, 16.0), (-56, 14.9),
            (58, 15.3), (58, 16.4), (64, 16.4), (64, 15.3), (152, 15.6), (152, 18.4), (167, 18.4), (167, 17.0), (200, 17.0)]
    TH = (-56, -44, -33, -22, -10, 4, 20)                     # lit side of the brass, closer towards the limb
    tv = pl.revolve(to, d, tube, nth=96, cap_start=True, cap_end=True,
                    hatch=[(dg, 11, 12, "h", 0.03) for dg in TH] + [(dg, 15, 16, "h", 0.03) for dg in TH]
                    + [(dg, 19, 20, "h", 0.03) for dg in TH] + [(dg, 5, 6, "h", 0.06) for dg in (-34, -12, 10)]
                    + [(dg, 23, 24, "h", 0.08) for dg in TH] + [(dg, 21, 22, "h", 0.1) for dg in (-38, -14, 10)]
                    + [(dg, 1, 2, "h", 0.1) for dg in (-30, 0)])
    cap = tv["ids"][-1]
    for rr, a0, a1 in ((14.6, 0, 360), (11.5, 150, 235), (8.5, 160, 222)):      # the objective and its glint
        pl.stroke("o" if rr > 14 else "h", [tv["pt"](200, rr, tv["thl"] + math.radians(j - 190)) for j in range(a0, a1 + 1, 5)], {cap})
    # focusing pinion under the draw tube
    kn = comb(to, (-152, d), (-12.5, w))
    pl.revolve(kn, hz, [(0, 1.8), (17, 1.8)], hatch=())
    pl.revolve(kn, hz, [(17, 5.2), (23, 5.2)], cap_start=True, cap_end=True, hatch=[(0, 0, 1, "h", 0.1)])

    gx, gy, _ = pl.P(O)
    ground(pl, gy + 9, 60, 360, rng, n=24)
    sx, sy, _ = pl.P(comb(to, (262, d)))
    star(pl, sx, sy, 8.5, "o")
    star(pl, 40, 70, 4.2)
    star(pl, 118, 150, 3.2)
    star(pl, 300, 30, 3.6)
    star(pl, 410, 250, 3.4)
    pl.svg(HERE / "refractor.svg", sw=1.5)


# ================================================================ Hadley's octant
def octante():
    pl = Plate(340, 400, cx=118, cy=46, az=-26, el=7)
    psi = math.radians(11)                                    # how it is turned on the sheet
    eu = (math.cos(psi), 0.0, math.sin(psi))
    ev = (-math.sin(psi), 0.0, math.cos(psi))
    nrm = cross(eu, ev)                                       # towards the viewer
    O = (0.0, 0.0, 0.0)
    AL = math.radians(27.5)                                   # half angle of the frame
    RO, RI, LW, T = 300.0, 264.0, 20.0, 11.0

    def pol(r, th):                                           # th from straight down, positive to the right
        return (r * math.sin(th), -r * math.cos(th))

    def inner(s, side):                                       # inner edge of a limb, s along it
        return (side * (s * math.sin(AL) - LW * math.cos(AL)), -s * math.cos(AL) - LW * math.sin(AL))

    def s_at(v):
        return (-v - LW * math.sin(AL)) / math.cos(AL)

    head = circle2(25, 40, a0=math.radians(-62.5), a1=math.radians(242.5))
    arc = [pol(RO, math.radians(-27.5 + 55 * i / 80)) for i in range(81)]
    frame = ccw(arc + head)
    s_arc = math.sqrt(RI * RI - LW * LW)
    th_arc = math.atan2(inner(s_arc, 1)[0], -inner(s_arc, 1)[1])
    b0, b1 = -146.0, -164.0                                   # the cross brace
    hole1 = cw([inner(LW / math.tan(AL), 1), inner(s_at(b0), 1), inner(s_at(b0), -1)])
    hole2 = cw([inner(s_at(b1), -1), inner(s_at(b1), 1)] + [pol(RI, th_arc - 2 * th_arc * i / 60) for i in range(61)])
    fid, ff = pl.plate(O, eu, ev, [frame, hole1, hole2], t=T, corner_deg=25)

    # the ivory scale: 0 to 90 in half degrees of arc
    for rr in (270.0, 277.0, 294.0):
        pl.stroke("f", [ff(pol(rr, math.radians(-24.5 + 49 * i / 80))) for i in range(81)], {fid})
    for i in range(0, 91):
        th = math.radians(-22.5 + i * 0.5)
        r1 = 294.0 if i % 10 == 0 else (289.0 if i % 5 == 0 else 284.0)
        pl.stroke("f", [ff(pol(277.0, th)), ff(pol(r1, th))], {fid})
    for i in range(0, 10):                                    # diagonal figures band
        th = math.radians(-22.5 + i * 5)
        pl.stroke("f", [ff(pol(270.0, th)), ff(pol(277.0, th))], {fid})
    # grain of the wood, along each limb and round the arc
    for side, offs in ((-1, (5.5, 10.5, 15.0)), (1, (7.0, 13.5))):
        for off in offs:
            a = (side * (34 * math.sin(AL) - off * math.cos(AL)), -34 * math.cos(AL) - off * math.sin(AL))
            b = (side * (258 * math.sin(AL) - off * math.cos(AL)), -258 * math.cos(AL) - off * math.sin(AL))
            pl.stroke("h", [ff(a), ff(b)], {fid})
    pl.stroke("h", [ff((-44, (b0 + b1) / 2 + 3)), ff((40, (b0 + b1) / 2 + 3))], {fid})
    pl.stroke("h", [ff(pol(298.0, math.radians(-25 + 30 * i / 40))) for i in range(41)], {fid})
    pl.stroke("f", [ff(p) for p in ((-15, b0 - 4.5), (15, b0 - 4.5), (15, b1 + 4.5), (-15, b1 + 4.5), (-15, b0 - 4.5))], {fid})

    # --- index arm with its vernier, turning on the apex
    ti = math.radians(7.5)
    dr, pr = pol(1, ti), (math.cos(ti), math.sin(ti))

    def arm(b, a):                                            # b across the arm, a down along it
        return (a * dr[0] + b * pr[0], a * dr[1] + b * pr[1])

    top = [arm(15 * math.cos(math.radians(q)), -15 * math.sin(math.radians(q))) for q in range(-28, 209, 8)]
    body = [arm(-6.8, 9), arm(-8.2, 256), arm(-21, 256), arm(-21, 303), arm(-7, 303), arm(-7, 322), arm(7, 322),
            arm(7, 303), arm(21, 303), arm(21, 256), arm(8.2, 256), arm(6.8, 9)]
    win = cw([arm(-14.5, 270), arm(14.5, 270), arm(14.5, 297), arm(-14.5, 297)])
    ao = comb(O, (T / 2 + 2.6, nrm))
    aid, af = pl.plate(ao, eu, ev, [ccw(body + top), win], t=4.2, corner_deg=25)
    for i in range(11):
        b = -12.5 + 2.5 * i
        pl.stroke("f", [af(arm(b, 297)), af(arm(b, 300.5 if i % 5 else 302))], {aid})
    pl.stroke("h", [af(arm(-3.6, 22)), af(arm(-4.6, 250))], {aid})
    for rr in (7.5, 3.0):
        pl.stroke("o" if rr > 5 else "f", [af(p) for p in circle2(rr, 24)] + [af((rr, 0))], {aid})
    pl.stroke("o", [af(arm(5 * math.cos(math.radians(q)), 312.5 + 5 * math.sin(math.radians(q)))) for q in range(0, 361, 20)], {aid})

    def standing(base, along, length, height, t=2.6, lift=0.0, hole=None, glass=True):
        """Small plate standing on the instrument: mirrors, sight and shades."""
        e1 = unit(comb(O, (along[0], eu), (along[1], ev)))
        o = comb(O, (base[0], eu), (base[1], ev), (lift, nrm))
        c = [ccw([(-length / 2, 0), (length / 2, 0), (length / 2, height), (-length / 2, height)])]
        if glass:
            c.append(cw([(-length / 2 + 3, 3), (length / 2 - 3, 3), (length / 2 - 3, height - 3), (-length / 2 + 3, height - 3)]))
        sid, sf = pl.plate(o, e1, nrm, c, t=t, corner_deg=25)
        if hole:
            pl.stroke("o", [sf(p) for p in circle2(hole, 12, 0, height * 0.62)] + [sf((hole, height * 0.62))], {sid})
        return sid, sf

    front = T / 2
    standing(arm(0, 2), dr, 36, 30, lift=front + 4.7)                              # index mirror
    hg = pol(132, -AL + math.radians(4.3))
    standing(hg, pol(1, math.radians(-12)), 27, 27, lift=front)                    # horizon glass
    for k, ang in enumerate((-62, -84)):                                            # shades
        sh = pol(172 + k * 3, -AL + math.radians(3.6))
        standing((sh[0] + 9 * math.cos(math.radians(ang)), sh[1] + 9 * math.sin(math.radians(ang))),
                 (math.cos(math.radians(ang)), math.sin(math.radians(ang))), 19, 20, t=2, lift=front)
    sv = pol(126, AL - math.radians(4.4))
    standing(sv, pol(1, AL), 15, 30, lift=front, hole=2.2, glass=False)            # sight vane
    star(pl, 300, 56, 6)
    star(pl, 26, 250, 4)
    star(pl, 306, 190, 3.2)
    pl.svg(HERE / "octante.svg", sw=1.45)


# ================================================================ planispheric astrolabe
STARS = [("Aldebaran", 68.98, 16.51), ("Rigel", 78.63, -8.20), ("Capella", 79.17, 46.00), ("Betelgeuse", 88.79, 7.41),
         ("Sirius", 101.29, -16.72), ("Procyon", 114.83, 5.22), ("Regulus", 152.09, 11.97), ("Alphard", 141.90, -8.66),
         ("Dubhe", 165.93, 61.75), ("Spica", 201.30, -11.16), ("Arcturus", 213.92, 19.18), ("Alphecca", 233.67, 26.71),
         ("Rasalhague", 263.73, 12.56), ("Vega", 279.23, 38.78), ("Altair", 297.70, 8.87), ("Deneb", 310.36, 45.28),
         ("Deneb Algedi", 326.76, -16.13), ("Markab", 346.19, 15.21), ("Alpheratz", 2.10, 29.09), ("Menkar", 45.57, 4.09)]


def astrolabio():
    pl = Plate(400, 470, cx=204, cy=286, az=-17, el=5)
    X, Z = (1.0, 0, 0), (0, 0, 1.0)
    N = (0.0, -1.0, 0.0)                                      # face normal, towards the viewer
    O = (0.0, 0.0, 0.0)
    RM, T = 150.0, 11.0
    RCAP = 121.0
    REQ = RCAP / math.tan(math.radians(45) + EPS / 2)
    RCAN = REQ * math.tan(math.radians(45) - EPS / 2)

    # --- mater with its throne, shackle and ring
    mid, mf = pl.plate(O, X, Z, [circle2(RM, 300)], t=T)
    a0, a1 = math.radians(64), math.radians(116)
    p0, p1 = (RM * math.cos(a0), RM * math.sin(a0)), (RM * math.cos(a1), RM * math.sin(a1))
    side_r = bezier(p0, (40, 150), (30, 160), (27, 171), 14) + bezier((27, 171), (27, 186), (14, 197), (0, 197), 14)
    side_l = [(-x, y) for x, y in side_r][::-1]
    base = [(RM * math.cos(a), RM * math.sin(a)) for a in [a1 + (a0 - a1) * i / 30 for i in range(31)]]
    thr = ccw(side_r + side_l[1:] + base[1:-1])
    tid, tf = pl.plate(O, X, Z, [thr, circle2(5.5, 20, 0, 181, cw=True)], t=T * 0.8)
    for sgn in (1, -1):                                       # scrolls engraved on the throne
        pl.stroke("f", [tf((sgn * x, y)) for x, y in bezier((34, 150), (22, 158), (18, 168), (12, 176), 12)], {tid})
        pl.stroke("h", [tf((sgn * x, y)) for x, y in bezier((20, 153), (13, 160), (11, 166), (9, 170), 10)], {tid})
    sh_o = (0.0, 0.0, 187.0)
    pl.plate(sh_o, N, Z, [circle2(11.5, 48), circle2(8.0, 48, cw=True)], t=3.4)
    rg = math.radians(38)
    pl.plate((0.0, 0.0, 216.0), (math.cos(rg), math.sin(rg), 0.0), Z, [circle2(22.5, 80), circle2(18.5, 80, cw=True)], t=4.0)
    for d2 in range(0, 720, 9):                               # milled edge, where it catches the light
        th = math.radians(d2 / 2)
        nr = (math.cos(th), 0.0, math.sin(th))
        if dot(nr, pl.v) > 0.02 and dot(nr, pl.L) > 0.1:
            pl.stroke("h", [comb(O, (RM, nr), (T / 2, N)), comb(O, (RM, nr), (-T / 2, N))], {mid})

    # --- limb: degrees and the twenty-four hours
    lo = comb(O, (T / 2 + 1.2, N))
    lid, lf = pl.plate(lo, X, Z, [circle2(RM - 0.6, 300), circle2(125.5, 300, cw=True)], t=2.4)
    for rr in (131.0, 137.5, 145.0):
        pl.stroke("f", [lf(p) for p in circle2(rr, 240)] + [lf((rr, 0))], {lid})
    for d in range(0, 360):
        cs, sn = math.cos(math.radians(d)), math.sin(math.radians(d))
        if d % 2 == 0:
            r1 = 145.0 if d % 10 == 0 else 141.5
            pl.stroke("f", [lf((137.5 * cs, 137.5 * sn)), lf((r1 * cs, r1 * sn))], {lid})
        if d % 15 == 0:
            pl.stroke("f", [lf((125.5 * cs, 125.5 * sn)), lf((137.5 * cs, 137.5 * sn))], {lid})
        elif d % 5 == 0:
            pl.stroke("f", [lf((131.0 * cs, 131.0 * sn)), lf((137.5 * cs, 137.5 * sn))], {lid})

    # --- plate for the latitude LAT, south at the top: tropics, equator, almucantars and azimuths
    def clip(pts, keep):
        run = []
        for p in pts:
            if keep(p):
                run.append(mf(p))
            else:
                pl.stroke("f", run, {mid})
                run = []
        pl.stroke("f", run, {mid})

    in_plate = lambda p: math.hypot(p[0], p[1]) <= RCAP
    for rr in (RCAP, REQ, RCAN):
        pl.stroke("f", [mf(p) for p in circle2(rr, 200)] + [mf((rr, 0))], {mid})
    sl, cl_ = math.sin(LAT), math.cos(LAT)
    hc, hr = REQ * cl_ / sl, REQ / sl                         # the horizon
    above = lambda p: in_plate(p) and math.hypot(p[0], p[1] - hc) <= hr + 0.01
    for alt in range(0, 90, 10):
        sa = math.sin(math.radians(alt))
        yc, rr = REQ * cl_ / (sl + sa), REQ * math.cos(math.radians(alt)) / (sl + sa)
        clip(circle2(rr, 240, 0, yc) + [(rr, yc)], in_plate)
    yz = REQ * math.tan((math.pi / 2 - LAT) / 2)
    yn = -REQ * math.tan((math.pi / 2 + LAT) / 2)
    ym, hd = (yz + yn) / 2, (yz - yn) / 2
    for az in range(30, 180, 30):
        c = hd / math.tan(math.radians(az))
        rr = math.hypot(c, hd)
        clip(circle2(rr, 400, c, ym) + [(c + rr, ym)], above)
    clip([(0, -RCAP + i * 2 * RCAP / 200) for i in range(201)], in_plate)
    clip([(-RCAP + i * 2 * RCAP / 200, 0) for i in range(201)], in_plate)

    # --- rete: ecliptic, equinoctial bar and the flames that point at the stars
    rot = math.radians(205)                                   # where the winter solstice sits
    tau = (math.cos(rot), math.sin(rot))
    re_, ce = (RCAP + RCAN) / 2, (RCAP - RCAN) / 2
    ec = (ce * tau[0], ce * tau[1])
    bw = 3.4
    bar_n = (-tau[1], tau[0])
    pieces = [
        [circle2(RCAP, 240), circle2(RCAP - 6.5, 240, cw=True)],
        [circle2(re_, 240, ec[0], ec[1]), circle2(re_ - 10.5, 240, ec[0], ec[1], cw=True)],
        [ccw([(bar_n[0] * s * (RCAP - 3) + tau[0] * q * bw, bar_n[1] * s * (RCAP - 3) + tau[1] * q * bw)
              for s, q in ((-1, -1), (1, -1), (1, 1), (-1, 1))])],
        [circle2(13.5, 60), circle2(6.0, 40, cw=True)],
        [ccw([(tau[0] * s + bar_n[0] * q * bw, tau[1] * s + bar_n[1] * q * bw)
              for s, q in ((10, -1), (ce + re_ - 4, -1), (ce + re_ - 4, 1), (10, 1))])],
    ]
    arc_a = [rot + math.pi / 2 + math.pi * i / 80 for i in range(81)]     # the half of the equator outside the ecliptic
    pieces.append([ccw([((REQ + 2.6) * math.cos(a), (REQ + 2.6) * math.sin(a)) for a in arc_a]
                       + [((REQ - 2.6) * math.cos(a), (REQ - 2.6) * math.sin(a)) for a in arc_a[::-1]])])

    def nearest(p):
        """Closest point of the frame of the rete, to grow a pointer from."""
        x, y = p
        out = []
        r = math.hypot(x, y) or 1.0
        out.append(((RCAP - 3.2) * x / r, (RCAP - 3.2) * y / r))
        dx, dy = x - ec[0], y - ec[1]
        r2 = math.hypot(dx, dy) or 1.0
        out.append((ec[0] + (re_ - 5.2) * dx / r2, ec[1] + (re_ - 5.2) * dy / r2))
        s = max(-(RCAP - 6), min(RCAP - 6, x * bar_n[0] + y * bar_n[1]))
        out.append((bar_n[0] * s, bar_n[1] * s))
        s = max(12.0, min(ce + re_ - 6, x * tau[0] + y * tau[1]))
        out.append((tau[0] * s, tau[1] * s))
        if x * tau[0] + y * tau[1] < 0:
            out.append((REQ * x / r, REQ * y / r))
        return min(out, key=lambda q: math.hypot(q[0] - x, q[1] - y))

    tips = []
    for k, (name, ra, dec) in enumerate(STARS):
        rr = REQ * math.tan((math.pi / 2 - math.radians(dec)) / 2)
        a = rot + math.radians(ra - 270.0)
        tip = (rr * math.cos(a), rr * math.sin(a))
        an = nearest(tip)
        ln = math.hypot(tip[0] - an[0], tip[1] - an[1])
        if ln < 7.5 or rr > RCAP - 9:
            continue
        ux, uy = (tip[0] - an[0]) / ln, (tip[1] - an[1]) / ln
        nx, ny = -uy, ux
        bend = (0.22 if k % 2 else -0.22) * ln
        root = (an[0] - ux * 3.0, an[1] - uy * 3.0)
        ctrl = ((root[0] + tip[0]) / 2 + nx * bend, (root[1] + tip[1]) / 2 + ny * bend)
        hw = min(5.2, 2.6 + ln * 0.09)
        left = bezier((root[0] + nx * hw, root[1] + ny * hw), (ctrl[0] + nx * hw * 0.7, ctrl[1] + ny * hw * 0.7),
                      (ctrl[0] + nx * hw * 0.5, ctrl[1] + ny * hw * 0.5), tip, 14)
        right = bezier((root[0] - nx * hw, root[1] - ny * hw), (ctrl[0] - nx * hw * 0.7, ctrl[1] - ny * hw * 0.7),
                       (ctrl[0] - nx * hw * 0.5, ctrl[1] - ny * hw * 0.5), tip, 14)
        pieces.append([ccw(left + right[::-1][1:])])
        tips.append(name)
    ro = comb(O, (T / 2 + 2.4, N))
    rf = lambda p: comb(ro, (p[0], X), (p[1], Z))
    rid = union(pl, rf, pieces)
    print("astrolabio, star pointers:", ", ".join(tips))
    # the zodiac on the ecliptic: sign boundaries seen from the pole, and the bevel
    pl.stroke("f", [rf(p) for p in circle2(re_ - 3.4, 200, ec[0], ec[1])] + [rf((ec[0] + re_ - 3.4, ec[1]))], {rid})
    for lam in range(0, 360, 5):
        lm = math.radians(lam)
        ra = math.atan2(math.sin(lm) * math.cos(EPS), math.cos(lm))
        a = rot + ra - math.radians(270)
        ux, uy = math.cos(a), math.sin(a)
        b = ux * ec[0] + uy * ec[1]
        outer = b + math.sqrt(max(b * b - (ce * ce - re_ * re_), 0))
        r_in = re_ - (10.5 if lam % 30 == 0 else 3.4)
        inner_ = b + math.sqrt(max(b * b - (ce * ce - r_in * r_in), 0))
        pl.stroke("f", [rf((ux * inner_, uy * inner_)), rf((ux * outer, uy * outer))], {rid})

    # --- rule and pin
    ru = math.radians(152)
    rx, ry = (math.cos(ru), math.sin(ru)), (-math.sin(ru), math.cos(ru))
    half = [(-124.5, 0), (-117, -4.6), (-11, -4.6)] + [(11 * math.cos(math.radians(q)), 11 * math.sin(math.radians(q))) for q in range(-155, -24, 10)] \
        + [(11, -4.6), (117, -4.6), (124.5, 0), (117, 4.6), (11, 4.6)] \
        + [(11 * math.cos(math.radians(q)), 11 * math.sin(math.radians(q))) for q in range(25, 156, 10)] + [(-11, 4.6), (-117, 4.6)]
    rule = ccw([(x * rx[0] + y * ry[0], x * rx[1] + y * ry[1]) for x, y in half])
    uo = comb(O, (T / 2 + 5.4, N))
    uid, uf = pl.plate(uo, X, Z, [rule], t=2.2, corner_deg=25)
    pl.stroke("f", [uf((-118 * rx[0], -118 * rx[1])), uf((-13 * rx[0], -13 * rx[1]))], {uid})
    pl.stroke("f", [uf((118 * rx[0], 118 * rx[1])), uf((13 * rx[0], 13 * rx[1]))], {uid})
    pl.revolve(comb(O, (T / 2 + 6.4, N)), N, [(0, 4.6), (4.5, 4.6), (6.5, 2.4)], cap_end=True, crease_deg=30)
    star(pl, 356, 60, 5.5)
    star(pl, 40, 96, 4)
    star(pl, 368, 396, 3.4)
    pl.svg(HERE / "astrolabio.svg", sw=1.25)


PLATES = {"armilar": armilar, "refractor": refractor, "octante": octante, "astrolabio": astrolabio}

if __name__ == "__main__":
    for name in (sys.argv[1:] or PLATES):
        PLATES[name]()
