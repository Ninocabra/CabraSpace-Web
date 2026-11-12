"""
Frieze I of P5, "El horizonte": one continuous engraved panorama, 2560 x 470.

Left to right: a far village, an umbrella pine in the foreground, the observatory on its hill
(dome open, refractor out, a small transit dome and a weather mast on the wings), a railway viaduct
over the river, and far away the mill town with its chimneys, whose smoke drifts east. Behind, two
mountain ranges; above, a ruled sky that gets denser (lighter, in white-line) towards the horizon.

The central 1440 units (560-2000) hold the scene; the rest is landscape for wider screens, and the
ends fade out. Monochrome black on transparent: it is used as a CSS mask painted in gold.

    python p5/horizonte.py   ->   p5/horizonte.svg
"""
import math
import os
from pathlib import Path

from grabado import Plate, value_noise, f

W, H = 2560, 470
YH = 318                 # far horizon
CX, TOPY, FOOT = 1000, 262, 380   # observatory hill
OUT = Path(os.environ.get("ATLAS_IMG_OUT") or Path(__file__).resolve().parents[3] / "atlas" / "img") / "horizonte.svg"   # salida: atlas/img/ (o $ATLAS_IMG_OUT para probar)

SKY = {f"s{i}": f'stroke-width=".55" stroke-opacity="{o}"' for i, o in
       enumerate((".1", ".16", ".23", ".31", ".4", ".5", ".6", ".7"))}
P = Plate(W, H, 1869, SKY)
rng = P.rng
fbm = value_noise(rng)


# ------------------------------------------------------------------ profiles
def far_range(x):
    """Jagged sierra; lower behind the town so that the chimneys stand against the sky."""
    ridged = 1 - abs(2 * fbm(x / 230 + 3.1, 4) - 1)
    env = 1 - 0.5 * math.exp(-((x - 1790) / 300) ** 2) - 0.35 * math.exp(-((x - 1000) / 220) ** 2)
    return YH - 6 - 118 * ridged ** 1.5 * env * (0.75 + 0.5 * fbm(x / 700 + 9))


def near_range(x):
    return YH + 4 - 46 * fbm(x / 170 + 40.5, 3) ** 1.2 * (0.6 + 0.8 * fbm(x / 520 + 2))


def hill(x):
    if x < CX - 150:
        t = (CX - 150 - x) / 280
    elif x > CX + 150:
        t = (x - CX - 150) / 235
    else:
        return TOPY - 5 * (1 - ((x - CX) / 150) ** 2)
    t = min(t, 1.0)
    s = t * t * (3 - 2 * t)
    return TOPY + (FOOT - TOPY) * s + 5 * math.sin(t * 9 + x * 0.01) * s * (1 - s)


def fore(x):
    return 424 - 16 * fbm(x / 240 + 77, 3) + 6 * math.sin(x / 95)


def profile(fn, x0, x1, step=4):
    return [(x, fn(x)) for x in range(int(x0), int(x1) + 1, step)]


def plume(puffs, tail, x0, y0, dx, dy, r0, r1):
    """Smoke: rises almost straight, then leans east and thickens. Puffs are spaced by their own
    radius so that they always overlap, with a second irregular row once the column is wide."""
    t = 0.0
    while t <= 1.0:
        r = (r0 + (r1 - r0) * t ** 0.85) * (1 - 0.62 * max(0.0, (t - 0.8) / 0.2) ** 1.5)   # thins out at the end
        x = x0 + dx * t ** 1.45 + math.sin(t * 9 + x0) * 2.5 * t
        y = y0 - dy * t ** 0.72 + rng.uniform(-0.12, 0.12) * r
        if t > 0.7:
            tail.add(len(puffs))
        puffs.append((x, y, r * rng.uniform(0.88, 1.1)))
        if t > 0.22 and rng.random() < 0.7:
            if t > 0.7:
                tail.add(len(puffs))
            puffs.append((x + rng.uniform(-0.5, 0.5) * r, y - rng.uniform(0.35, 0.75) * r, r * rng.uniform(0.5, 0.78)))
        if t > 0.3 and rng.random() < 0.45:
            if t > 0.7:
                tail.add(len(puffs))
            puffs.append((x + rng.uniform(-0.3, 0.6) * r, y + rng.uniform(0.3, 0.6) * r, r * rng.uniform(0.45, 0.7)))
        step = 0.62 * r / max(1.0, math.hypot(dx * 1.45 * max(t, 0.02) ** 0.45, dy * 0.72 * max(t, 0.02) ** -0.28))
        t += max(step, 0.004)


# ------------------------------------------------------------------ sky
def sky():
    """Ruled sky. Spacing shrinks and weight grows towards the horizon; lines break more often high up."""
    y, k = YH - 1.0, 0
    while y > 14:
        t = (YH - y) / (YH - 14)                 # 0 at the horizon, 1 at the top
        cls = f"s{max(0, min(7, int(round(7 * (1 - t) ** 1.25))))}"
        x = rng.uniform(-60, 0)
        while x < W:
            ln = rng.uniform(260, 900) * (1 - 0.86 * t) + 18
            gap = rng.uniform(5, 22) + 150 * t ** 1.6 * rng.random()
            P.line(cls, x, y, min(x + ln, W), y)
            x += ln + gap
        y -= 2.3 + 8.5 * t ** 1.15
        k += 1
    # stars: a few of the first magnitude with rays, the rest dots and small crosses
    P.layer()
    for _ in range(150):
        x, y = rng.uniform(40, W - 40), 12 + 250 * rng.random() ** 1.7
        m = rng.random()
        if (CX - 190 < x < CX + 200 and y > 60) or math.hypot(x - 706, y - 96) < 46 or (1560 < x < 2100 and y > 110):
            continue                                          # keep clear of the observatory, the moon, the smoke
        if y > far_range(x) - 9:
            continue
        if m > 0.93 and y > 190:
            m = 0.7
        if m > 0.93:
            k = rng.uniform(4.5, 6.5)
            P.line("o", x - k, y, x + k, y)
            P.line("o", x, y - k, x, y + k)
            P.line("f", x - k * 0.42, y - k * 0.42, x + k * 0.42, y + k * 0.42)
            P.line("f", x - k * 0.42, y + k * 0.42, x + k * 0.42, y - k * 0.42)
            P.sil_circle(x, y, k + 3)
        elif m > 0.6:
            k = rng.uniform(1.6, 2.8)
            P.line("h", x - k, y, x + k, y)
            P.line("h", x, y - k, x, y + k)
            P.sil_circle(x, y, k + 2.2)
        else:
            P.circle("h", x, y, 0.5)
            P.sil_circle(x, y, 2.4)


def moon(mx, my, r):
    """Thin crescent with its bright limb to the west, where the light of the plate comes from."""
    P.layer()
    P.sil_circle(mx, my, r + 6)
    d = 0.5 * r
    a0 = math.degrees(math.acos(d / 2 / r))
    P.arc("o", mx, my, r, a0, 360 - a0, step=5)
    P.arc("o", mx + d, my, r, 180 - a0, 180 + a0, step=5)
    for a in range(int(a0) + 16, int(360 - a0) - 12, 13):          # limb shading, short level strokes
        x0, y0 = mx + (r - 0.9) * math.cos(math.radians(a)), my - (r - 0.9) * math.sin(math.radians(a))
        xi = mx + d - math.sqrt(max(r * r - (y0 - my) ** 2, 0))
        P.line("f", x0, y0, min(x0 + 2.8, xi - 0.8), y0)


def clouds():
    """Long stratus bars near the horizon: gaps in the ruling with a scalloped top."""
    P.layer()
    for cx, cy, n, r in ((380, 236, 9, 9), (1290, 222, 11, 8), (1500, 258, 7, 6), (2230, 214, 10, 9), (820, 288, 6, 5)):
        circles = []
        for i in range(n):
            t = i / (n - 1)
            env = math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.7
            circles.append((cx + (t - 0.5) * n * r * 2.3 + rng.uniform(-3, 3), cy - r * 0.25 * env + rng.uniform(-1, 1),
                            r * (0.45 + 0.75 * env) * rng.uniform(0.85, 1.1)))
        # flat base: only the upper half of each scallop is drawn, flattened to a low swelling
        k = 0.5
        for i, (x, y, rr) in enumerate(circles):
            run = []
            for a in range(180, 361, 8):
                px, py = x + rr * math.cos(math.radians(a)), y + rr * k * math.sin(math.radians(a))
                if any(j != i and (px - a2) ** 2 + ((py - b2) / k) ** 2 < (c2 - 0.3) ** 2 for j, (a2, b2, c2) in enumerate(circles)):
                    P.poly("df", run)
                    run = []
                else:
                    run.append((px, py))
            P.poly("df", run)
            P.sil(f"M{f(x - rr)} {f(y)}A{f(rr)} {f(rr * k)} 0 0 1 {f(x + rr)} {f(y)}Z")
        x0, x1 = circles[0][0] - circles[0][2] - 14, circles[-1][0] + circles[-1][2] + 14
        P.sil([(x0, cy), (x1, cy), (x1 - 20, cy + 3.2), (x0 + 26, cy + 3.2)])


# ------------------------------------------------------------------ mountains
def mountains():
    P.layer()
    pts = profile(far_range, 0, W, 3)
    P.poly("d", pts)
    P.sil(pts + [(W, H), (0, H)])
    for x in range(4, W, 3):
        slope = far_range(x + 3) - far_range(x - 3)
        y = far_range(x)
        if slope < -1.0 and rng.random() < 0.8:        # rising to the right: the face looks west, lit
            ln = rng.uniform(0.25, 1.0) * min(52, (YH - y) * 0.75)
            P.line("df", x, y + 1.4, x - ln * 0.5, y + 1.4 + ln)
        elif slope > 1.6 and rng.random() < 0.12:
            ln = rng.uniform(4, 12)
            P.line("df", x, y + 1.4, x + ln * 0.35, y + 1.4 + ln)
    # spurs coming down from the main summits
    for x in range(30, W - 30, 3):
        y = far_range(x)
        if y < far_range(x - 9) - 2 and y < far_range(x + 9) - 2 and y < YH - 40:
            hgt = (YH - y) * rng.uniform(0.45, 0.7)
            P.poly("df", [(x + t * hgt * 0.42 + 3 * math.sin(t * 7 + x), y + t * hgt) for t in
                          [i / 8 for i in range(9)]])
    # nearer, rounder hills with their woods
    P.layer()
    pts = profile(near_range, 0, W, 4)
    P.poly("d", pts)
    P.sil(pts + [(W, H), (0, H)])
    for x in range(4, W, 4):
        y = near_range(x)
        slope = near_range(x + 4) - near_range(x - 4)
        if slope < -0.5 and rng.random() < 0.75:
            ln = rng.uniform(4, 15)
            P.line("df", x, y + 1.5, x - ln, y + 1.5 + ln * 0.5)
        if rng.random() < 0.16 and y < YH - 8:          # tree line along the crest
            r = rng.uniform(1.4, 2.6)
            P.arc("df", x, y - r * 0.4, r, 20, 200, step=36)


def plain():
    """The flat land between the hills and the foreground: broken furrows, denser far away."""
    P.layer()
    y = YH + 5
    while y < 420:
        t = (y - YH) / 100
        P.dashes("df" if t < 0.35 else "f", 0, W, y, 14 + 40 * t, 60 + 130 * t, 8 + 30 * t, 40 + 160 * t)
        y += 3.2 + 9 * t
    # hedgerows: lines of small round trees
    for x0, x1, y in ((120, 330, 334), (1420, 1590, 362), (1960, 2140, 344), (2250, 2470, 337), (430, 560, 349)):
        x = x0
        while x < x1:
            r = rng.uniform(2.2, 3.6)
            P.arc("f", x, y - r * 0.5, r, -10, 215, step=32)
            P.line("df", x + r, y + 0.6, x + r + 5, y + 0.6)
            x += r * rng.uniform(1.5, 2.6)


def village(x0, base):
    """Far village with its church, west of the hill."""
    P.layer()
    for dx, w, hh in ((0, 14, 9), (15, 11, 12), (27, 16, 8), (58, 13, 10), (72, 18, 9), (91, 12, 11), (-16, 13, 7)):
        x = x0 + dx
        P.box("d", x, base - hh, x + w, base)
        P.poly("d", [(x - 1, base - hh), (x + w / 2, base - hh - 5), (x + w + 1, base - hh)])
        P.sil([(x - 1, base - hh), (x + w / 2, base - hh - 5), (x + w + 1, base - hh)])
        P.line("df", x + 1.5, base - hh - 0.5, x + w / 2, base - hh - 4)
        if w > 12:
            P.rect("df", x + w * 0.55, base - hh + 3, x + w * 0.55 + 2.5, base - hh + 6.5)
    # church: nave, tower, spire
    tx = x0 + 44
    P.box("d", tx, base - 30, tx + 9, base)
    P.poly("d", [(tx - 1, base - 30), (tx + 4.5, base - 46), (tx + 10, base - 30)])
    P.sil([(tx - 1, base - 30), (tx + 4.5, base - 46), (tx + 10, base - 30)])
    P.line("d", tx + 4.5, base - 46, tx + 4.5, base - 51)
    P.line("d", tx + 3, base - 49, tx + 6, base - 49)
    P.arch("df", tx + 3, tx + 6, base - 26, base - 20)
    P.line("df", tx + 1.6, base - 28, tx + 1.6, base - 1)
    P.line("df", tx + 3.2, base - 18, tx + 3.2, base - 1)


def windmill(x, base):
    P.layer()
    P.poly("d", [(x - 7, base), (x - 4.5, base - 26), (x + 4.5, base - 26), (x + 7, base)])
    P.sil([(x - 7, base), (x - 4.5, base - 26), (x + 4.5, base - 26), (x + 7, base)])
    P.poly("d", [(x - 5.5, base - 26), (x, base - 34), (x + 5.5, base - 26)])
    P.sil([(x - 5.5, base - 26), (x, base - 34), (x + 5.5, base - 26)])
    for k in (4, 9, 14, 19):
        P.line("df", x - 6.5 + k * 0.09, base - k, x - 2, base - k)
    hx, hy = x - 1, base - 29
    for a in (24, 114, 204, 294):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        P.line("d", hx, hy, hx + 25 * ca, hy - 25 * sa)
        px, py = -sa * 4.2, -ca * 4.2
        P.poly("df", [(hx + 7 * ca, hy - 7 * sa), (hx + 7 * ca + px, hy - 7 * sa + py),
                      (hx + 25 * ca + px, hy - 25 * sa + py), (hx + 25 * ca, hy - 25 * sa)])
        for s in (11, 15, 19, 23):
            P.line("df", hx + s * ca, hy - s * sa, hx + s * ca + px, hy - s * sa + py)


# ------------------------------------------------------------------ viaduct and train
def viaduct(x0, n, span, deck, base):
    P.layer()
    r = span / 2 - 3.2
    x1 = x0 + n * span
    # embankments
    P.poly("d", [(x0 - 150, deck + 20), (x0 - 60, deck + 3), (x0, deck)])
    P.poly("d", [(x1, deck), (x1 + 50, deck + 2), (x1 + 130, deck + 16)])
    for xa, xb, s in ((x0 - 150, x0, 1), (x1, x1 + 130, -1)):
        x = xa + 4
        while x < xb - 2:
            t = (x - xa) / (xb - xa)
            top = deck + (20 * (1 - t) ** 1.6 if s == 1 else 16 * t ** 1.6)
            if base - top > 6:
                P.line("df", x, top + 2, x - 2.5, top + 2 + (base - top) * rng.uniform(0.3, 0.75))
            x += 4.5
    sil = f"M{f(x0)} {f(deck - 5)}H{f(x1)}V{f(base)}H{f(x0)}Z"
    for i in range(n):
        cx = x0 + (i + 0.5) * span
        spring = deck + 9 + r
        sil += f"M{f(cx - r)} {f(base)}V{f(spring)}A{f(r)} {f(r)} 0 0 1 {f(cx + r)} {f(spring)}V{f(base)}Z"
        P.add("d", f"M{f(cx - r)} {f(base)}V{f(spring)}A{f(r)} {f(r)} 0 0 1 {f(cx + r)} {f(spring)}V{f(base)}")
        # depth of the vault: the far edge shows on the left of each opening, and catches the light
        P.add("df", f"M{f(cx - r + 2.6)} {f(base)}V{f(spring)}A{f(r)} {f(r)} 0 0 1 {f(cx + 1.2)} {f(spring - r + 0.3)}")
        for k in range(4):
            yy = spring + 2 + k * (base - spring) / 4
            P.line("df", cx - r + 0.4, yy, cx - r + 2.4, yy)
        # voussoirs
        for a in range(15, 180, 22):
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            P.line("df", cx + r * ca, spring - r * sa, cx + (r + 2.6) * ca, spring - (r + 2.6) * sa)
        # pier: lit west face, courses
        px = x0 + i * span
        if i > 0:
            P.line("df", px - 1.4, spring - 2, px - 1.4, base)
            for yy in range(int(spring + 4), int(base), 7):
                P.line("df", px - 3, yy, px + 3, yy)
            P.line("d", px - 3.8, spring, px + 3.8, spring)
    P.cur["sil"].append((sil, True))
    P.line("d", x0 - 60, deck + 3 - 5, x0, deck - 5)
    P.line("d", x0, deck - 5, x1, deck - 5)                 # parapet
    P.line("d", x0, deck, x1, deck)
    P.line("df", x0, deck + 3.5, x1, deck + 3.5)
    x = x0 + 3
    while x < x1:
        P.line("df", x, deck - 4.2, x, deck - 0.6)
        x += 4.3
    return x0, x1


def train(x, deck):
    """Locomotive heading west, four carriages behind, steam trailing east."""
    P.layer()
    y = deck - 5.4
    # locomotive
    P.box("d", x, y - 5.4, x + 13, y - 1.2)                  # boiler
    P.box("d", x + 13, y - 8.6, x + 20, y - 1.2)             # cab
    P.rect("df", x + 14.6, y - 7.4, x + 18.2, y - 4.8)
    P.box("d", x + 1.6, y - 10.2, x + 3.8, y - 5.4)          # funnel
    P.line("d", x + 0.9, y - 10.2, x + 4.5, y - 10.2)
    P.arc("d", x + 8, y - 5.4, 1.5, 0, 180)                  # dome
    P.poly("d", [(x, y - 1.2), (x - 3, y - 0.2), (x, y - 0.2)])
    for cx in (x + 3.5, x + 8.5, x + 16.5):
        P.circle("d", cx, y - 0.6, 1.5)
    for i in range(4):                                       # carriages
        cx = x + 22.5 + i * 15.5
        P.box("d", cx, y - 7.2, cx + 14, y - 1.2)
        P.line("df", cx, y - 4.3, cx + 14, y - 4.3)
        for wx in (cx + 2.4, cx + 6, cx + 9.6):
            P.rect("df", wx, y - 6.3, wx + 2, y - 4.8)
        P.circle("d", cx + 2.8, y - 0.6, 1.3)
        P.circle("d", cx + 11.2, y - 0.6, 1.3)
    P.layer()
    puffs, tail = [], set()
    plume(puffs, tail, x + 2.7, y - 12, 92, 24, 1.3, 7.5)
    P.blob(puffs, key="d", inner=("df", "df"), tail=tail, key_tail="df")


# ------------------------------------------------------------------ the mill town
def chimney(xc, base, top, wb, wt, key="d", fine="df"):
    P.poly(key, [(xc - wb / 2, base), (xc - wt / 2, top)])
    P.poly(key, [(xc + wb / 2, base), (xc + wt / 2, top)])
    P.sil([(xc - wb / 2, base), (xc - wt / 2, top), (xc + wt / 2, top), (xc + wb / 2, base)])
    P.box(key, xc - wt / 2 - 1.6, top - 3.2, xc + wt / 2 + 1.6, top)
    P.box(key, xc - wt / 2 - 0.6, top - 5.4, xc + wt / 2 + 0.6, top - 3.2)
    y = base - 4
    while y > top + 3:
        t = (base - y) / (base - top)
        w = wb + (wt - wb) * t
        P.line(fine, xc - w / 2 + 0.4, y, xc + w / 2 - 0.4, y)
        y -= 5.5
    for k in (1.5, 3.0):                                     # lit west flank
        P.line(fine, xc - wb / 2 + k, base - 2, xc - wt / 2 + k * 0.7, top + 2)


def town(tx, tb):
    # --- smoke first in drawing order (behind the buildings)
    P.layer()
    puffs, tail = [], set()

    plume(puffs, tail, tx + 40, tb - 139, 190, 62, 2.4, 17)
    plume(puffs, tail, tx + 150, tb - 163, 250, 84, 2.4, 22)
    plume(puffs, tail, tx + 292, tb - 123, 170, 56, 2.2, 15)
    plume(puffs, tail, tx + 250, tb - 103, 80, 24, 1.6, 7)
    P.blob(puffs, key="d", inner=("df", "df"), tail=tail, key_tail="df")

    # --- back row: chimneys behind the roofs
    P.layer()
    chimney(tx + 150, tb - 60, tb - 156, 10, 6)
    chimney(tx + 292, tb - 20, tb - 116, 9, 5.5)
    chimney(tx + 250, tb - 20, tb - 97, 6.5, 4, key="df")

    # --- spinning mill
    P.layer()
    x0, x1, top = tx + 70, tx + 214, tb - 70
    P.box("d", x0, top, x1, tb)
    P.box("d", x0 - 2.5, top - 4.5, x1 + 2.5, top)
    cx = (x0 + x1) / 2
    ped = [(cx - 24, top - 4.5), (cx, top - 17), (cx + 24, top - 4.5)]
    P.poly("d", ped)
    P.sil(ped)
    P.circle("d", cx, top - 9, 3.6)
    P.line("df", cx, top - 9, cx, top - 11.6)
    P.line("df", cx, top - 9, cx + 1.8, top - 8.2)
    for k in (1.6, 3.4):
        P.line("df", x0 + k, top + 2, x0 + k, tb - 1.5)
    cols, rows = 12, 5
    for r in range(rows):
        if r:
            P.line("df", x0, top + 3.5 + r * 13.2, x1, top + 3.5 + r * 13.2)
        for c in range(cols):
            wx, wy = x0 + 7.5 + c * 11.2, top + 6.5 + r * 13.2
            if r == rows - 1 and c in (5, 6):
                if c == 5:
                    P.arch("d", wx + 2, wx + 15, wy - 2, tb)
                    P.line("df", wx + 8.5, wy - 2, wx + 8.5, tb)
                continue
            P.rect("df", wx, wy, wx + 5.6, wy + 8)
            if rng.random() < 0.5:                             # the looms work at night
                for yy in (1.6, 3.2, 4.8, 6.4):
                    P.line("df", wx + 0.7, wy + yy, wx + 4.9, wy + yy)
            else:
                P.line("df", wx + 2.8, wy, wx + 2.8, wy + 8)

    # --- weaving shed with its saw-tooth roof
    sx0, sx1, st = tx + 214, tx + 304, tb - 22
    P.box("d", sx0, st, sx1, tb)
    pts, x = [(sx0, st)], sx0
    while x < sx1 - 1:
        pts += [(x, st - 12), (x + 15, st)]
        P.line("df", x + 1.2, st - 1.5, x + 1.2, st - 10)
        P.line("df", x + 2.6, st - 9.6, x + 13.6, st - 1)
        P.line("df", x + 2.6, st - 6.6, x + 9.8, st - 1)
        x += 15
    P.poly("d", pts)
    P.sil(pts)
    for wx in range(int(sx0 + 6), int(sx1 - 6), 15):
        P.rect("df", wx, tb - 16, wx + 6, tb - 6)
        P.line("df", wx + 3, tb - 16, wx + 3, tb - 6)

    # --- gasholder: the bell inside its guide frame
    gx0, gx1 = tx + 318, tx + 366
    gt, ft = tb - 30, tb - 52
    P.layer()
    P.sil_rect(gx0 + 3, gt, gx1 - 3, tb)
    P.add("d", f"M{f(gx0 + 3)} {f(tb)}V{f(gt)}A{f((gx1 - gx0) / 2 - 3)} 4.5 0 0 1 {f(gx1 - 3)} {f(gt)}V{f(tb)}")
    P.sil(f"M{f(gx0 + 3)} {f(gt)}A{f((gx1 - gx0) / 2 - 3)} 4.5 0 0 1 {f(gx1 - 3)} {f(gt)}Z")
    for yy in (gt + 8, gt + 16, gt + 24):
        P.line("df", gx0 + 3, yy, gx1 - 3, yy)
    for k in range(7):
        P.line("df", gx0 + 4.5 + k * 1.9 * (1 + k * 0.12), gt + 1, gx0 + 4.5 + k * 1.9 * (1 + k * 0.12), tb - 1)
    cols_x = [gx0, gx0 + (gx1 - gx0) * 0.27, (gx0 + gx1) / 2, gx1 - (gx1 - gx0) * 0.27, gx1]
    for cxx in cols_x:
        P.line("d", cxx, tb, cxx, ft)
        P.line("d", cxx - 1.4, ft, cxx + 1.4, ft)
    P.line("d", gx0, ft + 2, gx1, ft + 2)
    P.line("df", gx0, ft + 12, gx1, ft + 12)
    for a, b in zip(cols_x, cols_x[1:]):
        P.line("df", a, ft + 2, b, ft + 12)
        P.line("df", b, ft + 2, a, ft + 12)

    # --- warehouses with gables, east of the gasholder
    P.layer()
    for k in range(1):
        wx0 = tx + 374 + k * 22
        P.box("d", wx0, tb - 20, wx0 + 22, tb)
        g = [(wx0, tb - 20), (wx0 + 11, tb - 31), (wx0 + 22, tb - 20)]
        P.poly("d", g)
        P.sil(g)
        P.circle("df", wx0 + 11, tb - 23, 1.8)
        P.arch("df", wx0 + 7, wx0 + 15, tb - 13, tb)
        P.line("df", wx0 + 1.5, tb - 19, wx0 + 10.5, tb - 29)

    # --- front chimney and the workers' terrace
    P.layer()
    chimney(tx + 40, tb, tb - 132, 11, 6.5)
    for k in range(6):
        hx0 = tx - 28 + k * 15.5 + (10 if k > 3 else 0)
        if k == 4:
            hx0 += 4
        P.box("d", hx0, tb - 15, hx0 + 15.5, tb)
        roof = [(hx0 - 1, tb - 15), (hx0 + 7.7, tb - 23), (hx0 + 16.5, tb - 15)]
        P.poly("d", roof)
        P.sil(roof)
        P.line("df", hx0 + 1.2, tb - 15.6, hx0 + 7.4, tb - 21.6)
        P.rect("d", hx0 + 10.5, tb - 25, hx0 + 13, tb - 18.5)
        P.rect("df", hx0 + 3, tb - 7, hx0 + 6, tb)
        P.rect("df", hx0 + 9, tb - 11.5, hx0 + 13, tb - 7)
        if k in (1, 4):
            for yy in (1.3, 2.6):
                P.line("df", hx0 + 9.6, tb - 11.5 + yy, hx0 + 12.4, tb - 11.5 + yy)


def far_works(tx, tb):
    """A second works much farther east: only for wide screens."""
    P.layer()
    puffs, tail = [], set()
    plume(puffs, tail, tx + 30, tb - 65, 110, 34, 1.5, 9)
    plume(puffs, tail, tx + 96, tb - 79, 130, 42, 1.5, 11)
    P.blob(puffs, key="df", inner=("df", "df"), tail=tail, key_tail="df")
    P.layer()
    chimney(tx + 30, tb, tb - 60, 6, 3.6, key="df")
    chimney(tx + 96, tb, tb - 74, 6.5, 4, key="df")
    P.box("df", tx + 40, tb - 26, tx + 88, tb)
    for c in range(6):
        for r in range(2):
            P.rect("df", tx + 44 + c * 7.2, tb - 22 + r * 10, tx + 47.5 + c * 7.2, tb - 16.5 + r * 10)
    pts, x = [(tx + 104, tb - 12)], tx + 104
    while x < tx + 160:
        pts += [(x, tb - 20), (x + 11, tb - 12)]
        x += 11
    P.poly("df", pts + [(x, tb), (tx + 104, tb)], close=True)
    P.sil(pts + [(x, tb), (tx + 104, tb)])


# ------------------------------------------------------------------ trees
def cypress(x, base, height, width, key="o", hk="h"):
    def half(t):
        return width / 2 * min(1.0, 0.55 + 3 * t) * (1 - t ** 2.2) ** 0.5

    n = 40
    left = [(x - half(i / n), base - 3 - (height - 3) * i / n) for i in range(n + 1)]
    right = [(2 * x - px, py) for px, py in reversed(left)]
    P.poly(key, left + right)
    P.sil(left + right)
    P.line(key, x, base - 3, x, base)
    y, row = base - 6, 0
    while y > base - height + 4:
        t = (base - y) / height
        hw = half(t)
        m = max(1, int(2 * hw / 2.6))
        for j in range(m):
            u = (j + 0.5 + (row % 2) * 0.5) / (m + 0.5)
            if rng.random() < 1.1 - u:
                cx = x - hw + 2 * hw * u
                P.add(hk, f"M{f(cx)} {f(y + 2)}Q{f(cx - 0.7)} {f(y)} {f(cx + 0.2)} {f(y - 2.6)}")
        y -= 3.4
        row += 1


def round_tree(x, base, r, key="o", hk="h", fk="f"):
    """Olive or holm oak: a low scalloped crown on a short trunk, with its cast shadow to the east."""
    P.line(key, x - 0.6, base, x - 0.3, base - r * 0.9)
    P.line(key, x + 0.8, base, x + 0.5, base - r * 0.9)
    cy = base - r * 1.5
    circles = [(x + r * 0.55 * math.cos(a) * 1.25, cy + r * 0.45 * math.sin(a), r * rng.uniform(0.5, 0.7))
               for a in [k * math.tau / 6 + rng.uniform(-0.2, 0.2) for k in range(6)]] + [(x, cy, r * 0.75)]
    P.blob(circles, key=key, inner=(hk, fk))
    for k in range(3):
        P.line(fk, x + 2 + k * 1.5, base + 0.8 + k * 1.1, x + r * 1.7 - k, base + 0.8 + k * 1.1)


def umbrella_pine(x, base, height, spread, lean=0.0):
    """Stone pine: bare leaning trunk, forked high, and a wide flat crown."""
    top = base - height
    cy = top + spread * 0.16
    # crown first (its own layer in front of the trunk would hide the fork; so trunk, then crown)
    trunk_l, trunk_r = [], []
    for i in range(13):
        t = i / 12
        cxx = x + lean * t ** 1.6 + 2.5 * math.sin(t * 5)
        w = 5.2 - 2.6 * t
        trunk_l.append((cxx - w, base - (height * 0.8) * t))
        trunk_r.append((cxx + w, base - (height * 0.8) * t))
    P.poly("o", trunk_l)
    P.poly("o", trunk_r)
    P.sil(trunk_l + list(reversed(trunk_r)))
    for i in range(1, 12):                                    # bark on the lit side
        (xa, ya), (xb, yb) = trunk_l[i], trunk_l[i + 1]
        P.line("h", xa + 1.3, ya, xb + 1.3, yb)
        if i % 2:
            P.line("f", xa + 2.8, ya - 1, xb + 2.8, yb + 2)
    fx, fy = (trunk_l[-1][0] + trunk_r[-1][0]) / 2, trunk_l[-1][1]
    for dx, dy in ((-spread * 0.3, -height * 0.11), (spread * 0.06, -height * 0.15), (spread * 0.32, -height * 0.1)):
        P.add("o", f"M{f(fx - 1.5)} {f(fy + 6)}Q{f(fx + dx * 0.3)} {f(fy + dy * 0.2)} {f(fx + dx)} {f(fy + dy)}")
        P.add("h", f"M{f(fx + 1.5)} {f(fy + 6)}Q{f(fx + dx * 0.3 + 2.5)} {f(fy + dy * 0.2 + 1)} {f(fx + dx + 1.5)} {f(fy + dy + 1)}")
    P.layer()
    circles = []
    n = 13
    for i in range(n):
        t = i / (n - 1)
        env = math.sin(math.pi * (0.1 + 0.8 * t)) ** 0.6
        circles.append((x + lean + (t - 0.5) * spread * 0.9 + rng.uniform(-3, 3), cy - spread * 0.05 * env + rng.uniform(-3, 2),
                        spread * (0.075 + 0.085 * env) * rng.uniform(0.9, 1.12)))
    for i in range(7):                                        # lower lobes
        t = (i + 0.5) / 7
        circles.append((x + lean + (t - 0.5) * spread * 0.72 + rng.uniform(-3, 3), cy + spread * 0.085 + rng.uniform(-2, 2),
                        spread * 0.075 * rng.uniform(0.85, 1.1)))
    P.blob(circles, key="o", inner=("h", "f"))
    # needles: short fans on the lit west and upper side
    for cxx, cyy, r in circles:
        for _ in range(int(r * 0.9)):
            a = math.radians(rng.uniform(150, 290))
            d = r * rng.uniform(0.15, 0.85)
            px, py = cxx + d * math.cos(a), cyy + d * math.sin(a)
            if rng.random() < 0.75 - 0.4 * (px - (x + lean)) / spread:
                P.line("f", px, py, px - 2.2, py - 1.6)


def tuft(x, y, s=1.0, key="h"):
    for a in (-38, -17, 2, 21, 40):
        ln = s * rng.uniform(4, 8.5)
        aa = math.radians(a + rng.uniform(-6, 6))
        P.add(key, f"M{f(x)} {f(y)}Q{f(x + ln * 0.25 * math.sin(aa))} {f(y - ln * 0.6)} {f(x + ln * math.sin(aa))} {f(y - ln * math.cos(aa))}")


# ------------------------------------------------------------------ the observatory hill
def hill_form():
    P.layer()
    x0, x1 = CX - 430, CX + 385
    pts = profile(hill, x0, x1, 4)
    P.sil(pts + [(x1, FOOT + 8), (x0, FOOT + 8)])
    # outline: firm over the top, dying out at the feet
    P.poly("h", [p for p in pts if p[0] <= CX - 330])
    P.poly("o", [p for p in pts if CX - 330 <= p[0] <= CX + 300])
    P.poly("h", [p for p in pts if p[0] >= CX + 300])
    # hachures, as on a nineteenth-century survey sheet: ranks of short strokes down the slope,
    # close together on the lit west flank, a few on the east
    levels = [0.0, 0.07, 0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.84, 1.0]
    for ua, ub in zip(levels, levels[1:]):
        x = x0 + 10
        while x < x1 - 10:
            west = x < CX + 40 - 160 * ua
            xa, ya = u_point(x, ua + 0.012)
            slope = (hill(x + 4) - hill(x - 4)) / 8
            lean = -slope * 2.2 - (0.25 if west else -0.25)
            frac = rng.uniform(0.5, 0.86) if west else rng.uniform(0.25, 0.5)
            yb = hill(x + lean * 6) + (ua + (ub - ua) * frac) * (FOOT + 6 - hill(x + lean * 6))
            if yb - ya > 2.2 and rng.random() < (0.9 if west else 0.55):
                P.line("f" if west else "df", xa, ya, x + lean * (yb - ya) * 0.5, yb)
            x += rng.uniform(3.4, 5.2) if west else rng.uniform(9, 17)
    # two or three form lines to hold the ranks together
    for u in (0.34, 0.7):
        P.dashes("f", x0 + 60, CX + 20, 0, 40, 120, 14, 40, fn=lambda x, u=u: u_point(x, u)[1])


def u_point(x, u):
    return x, hill(x) + u * (FOOT + 6 - hill(x))


def hill_details():
    # the road: three reaches and two hairpins, narrowing as it climbs
    P.layer()
    knots = [(CX - 250, 1.02), (CX - 60, 0.86), (CX + 150, 0.66), (CX + 232, 0.5), (CX + 150, 0.4),
             (CX - 40, 0.34), (CX - 210, 0.26), (CX - 262, 0.15), (CX - 190, 0.085), (CX - 60, 0.05), (CX - 20, 0.012)]
    centre = []
    for (xa, ua), (xb, ub) in zip(knots, knots[1:]):
        for i in range(12):
            t = i / 12
            s = t * t * (3 - 2 * t)
            centre.append((xa + (xb - xa) * t, ua + (ub - ua) * s))
    centre.append(knots[-1])
    up, down = [], []
    for x, u in centre:
        px, py = u_point(x, u)
        w = 1.6 + 5.6 * u
        up.append((px, py - w / 2))
        down.append((px, py + w / 2))
    P.poly("h", up)
    P.poly("h", down)
    P.sil([(x, y - 1.2) for x, y in up] + [(x, y + 1.2) for x, y in reversed(down)])

    # dry-stone terraces with olive trees, and a vineyard at the west foot
    P.layer()
    for xa, xb, u in ((CX - 330, CX - 215, 0.5), (CX - 150, CX + 40, 0.52), (CX - 120, CX + 20, 0.2),
                      (CX + 90, CX + 200, 0.27), (CX + 20, CX + 150, 0.86), (CX - 330, CX - 240, 0.74)):
        top = [u_point(x, u) for x in range(xa, xb + 1, 6)]
        P.sil([(x, y - 9) for x, y in top] + [(x, y + 5.5) for x, y in reversed(top)])
        P.poly("h", top)
        P.poly("f", [(x, y + 3.4) for x, y in top])
        for i, (x, y) in enumerate(top[:-1]):
            P.line("f", x + (2 if i % 2 else 4.5), y + 0.4, x + (2 if i % 2 else 4.5), y + 3.2)
        x = xa + 12
        while x < xb - 6:
            px, py = u_point(x, u)
            round_tree(px, py - 0.5, rng.uniform(4.2, 5.6), key="h", hk="f", fk="f")
            x += rng.uniform(22, 38)
    P.sil([u_point(x, 0.57) for x in range(CX - 215, CX - 85, 10)]
          + [u_point(x, 0.96) for x in range(CX - 110, CX - 275, -10)])
    for row in range(7):                                      # vineyard: ranks of stocks
        u = 0.6 + row * 0.055
        for x in range(CX - 205 - row * 9, CX - 95 - row * 4, 7):
            px, py = u_point(x, u)
            P.line("f", px, py, px, py - 3)
            P.line("f", px - 1.6, py - 2.6, px + 1.8, py - 3.4)

    # masia at the east foot, with its cypress
    bx, by = CX + 262, FOOT - 6
    P.layer()
    cypress(bx - 14, by + 1, 34, 6.5, key="h", hk="f")
    P.layer()
    P.box("o", bx, by - 17, bx + 34, by)
    roof = [(bx - 2.5, by - 17), (bx + 17, by - 28), (bx + 36.5, by - 17)]
    P.poly("o", roof)
    P.sil(roof)
    for k in range(1, 5):
        P.line("f", bx - 2.5 + k * 3.7, by - 17.6, bx + 17 - 0.6, by - 28 + k * 2.2 + 0.4)
    P.arch("h", bx + 14, bx + 20, by - 9, by)
    for wx in (bx + 5, bx + 25):
        P.rect("h", wx, by - 12, wx + 4, by - 7)
    P.box("o", bx + 34, by - 10, bx + 50, by)
    P.poly("h", [(bx + 34, by - 14), (bx + 52, by - 10)])
    P.rect("h", bx + 24, by - 32, bx + 27.5, by - 23)
    P.line("f", bx + 1.6, by - 16, bx + 1.6, by - 1)


def observatory(cx, by):
    """Front elevation on the summit. y grows upwards in the local frame."""
    def X(x):
        return cx + x

    def Y(y):
        return by - y

    R, DY = 31.0, 92.0                    # dome radius and springing height
    slit_w, slit_a, tel_e = 5.2, math.radians(40), math.radians(40)

    def slit_edge(sign, off=0.0):
        pts, w = [], slit_w + off
        for i in range(0, 121):
            y = R * i / 120
            r = math.sqrt(max(R * R - y * y, 0))
            if r < w:
                break
            t = math.acos(sign * w / r) - slit_a
            if r * math.sin(t) < 0:
                break
            pts.append((X(r * math.cos(t)), Y(DY + y)))
        return pts

    # --- cypresses behind the wings
    P.layer()
    for dx, hh, ww in ((-143, 60, 9.5), (-131, 44, 7.5), (139, 54, 9), (150, 38, 7)):
        cypress(X(dx), Y(-2), hh, ww)

    # --- the dark of the slit, then the refractor seen through it
    P.layer()
    slit = slit_edge(1) + list(reversed(slit_edge(-1)))
    P.sil(slit)
    P.layer()
    ux, uy = math.sin(slit_a) * math.cos(tel_e), math.sin(tel_e)
    nn = math.hypot(ux, uy)
    ax, ay = ux / nn, -uy / nn
    px, py = -ay, ax
    x0, y0 = X(R * ux * 0.5), Y(DY + R * uy * 0.5)
    body, dew = 60.0, 13.0

    def at(s, off):
        return x0 + ax * s + px * off, y0 + ay * s + py * off

    def half(s):
        return 3.3 - 0.8 * s / body if s <= body else 3.6

    P.sil([at(0, -3.3), at(body, -2.5), at(body, -3.6), at(body + dew, -3.6), at(body + dew, 3.6), at(body, 3.6),
           at(body, 2.5), at(0, 3.3)])
    for side in (1, -1):
        P.poly("o", [at(0, side * half(0)), at(body, side * half(body))])
        P.poly("o", [at(body, side * 3.6), at(body + dew, side * 3.6)])
    P.line("o", *at(body, -3.6), *at(body, 3.6))
    P.line("o", *at(body + dew, -3.6), *at(body + dew, 3.6))
    for s in (14, 30, 47):
        P.line("o", *at(s, -half(s) - 0.5), *at(s, half(s) + 0.5))
        P.line("f", *at(s + 1.5, -half(s)), *at(s + 1.5, half(s)))
    for off, a, b in ((-1.9, 3, body - 2), (-0.8, 7, body - 6), (-2.4, body + 1.5, body + dew - 1.5)):
        P.line("h", *at(a, off), *at(b, off))
    P.poly("o", [at(26, -5), at(44, -5)])                    # finder
    P.poly("o", [at(26, -6.6), at(44, -6.6)])
    P.line("o", *at(44, -6.6), *at(44, -5))
    P.line("f", *at(30, -3.2), *at(30, -5))
    P.line("f", *at(41, -3), *at(41, -5))
    sx, sy = at(body + dew + 34, 0)                          # the star it follows
    for dx, dy, k in ((1, 0, 7.5), (0, 1, 7.5), (0.7, 0.7, 2.8), (0.7, -0.7, 2.8)):
        P.line("o", sx - dx * k, sy - dy * k, sx + dx * k, sy + dy * k)
    P.sil_circle(sx, sy, 11)

    # --- dome
    P.layer()
    dome_d = f"M{f(X(-R))} {f(Y(DY))}A{f(R)} {f(R)} 0 0 1 {f(X(R))} {f(Y(DY))}Z"
    slit_d = "M" + "L".join(f"{f(x)} {f(y)}" for x, y in slit) + "Z"
    P.cur["sil"].append((dome_d + slit_d, True))
    P.add("o", f"M{f(X(-R))} {f(Y(DY))}A{f(R)} {f(R)} 0 0 1 {f(X(R))} {f(Y(DY))}")

    def in_slit(x, y, z):
        return z > 0 and abs(x * math.cos(slit_a) - z * math.sin(slit_a)) < slit_w

    def sphere_curve(key, pts3d):
        run = []
        for x, y, z in pts3d:
            if in_slit(x, y, z):
                P.poly(key, run)
                run = []
            else:
                run.append((X(x), Y(DY + y)))
        P.poly(key, run)

    for lon in range(-75, 90, 15):
        p = math.radians(lon)
        sphere_curve("f", [(R * math.sin(p) * math.cos(math.radians(l)), R * math.sin(math.radians(l)),
                            R * math.cos(p) * math.cos(math.radians(l))) for l in range(0, 91, 5)])
    for lat in (28, 58):
        l = math.radians(lat)
        sphere_curve("f", [(R * math.cos(l) * math.sin(math.radians(p)), R * math.sin(l),
                            R * math.cos(l) * math.cos(math.radians(p))) for p in range(-90, 91, 4)])
    lat = 4.0
    while lat < 84:
        l = math.radians(lat)
        r = R * math.cos(l)
        ln = r * (0.44 - 0.3 * lat / 90) * (0.8 + 0.4 * rng.random())
        P.line("h", X(-r + 0.7), Y(DY + R * math.sin(l)), X(-r + 0.7 + ln), Y(DY + R * math.sin(l)))
        lat += 4.6
    for sign in (1, -1):
        P.poly("o", slit_edge(sign))
        P.poly("f", slit_edge(sign, 1.5))
    a, b = slit_edge(1)[-1], slit_edge(-1)[-1]
    P.line("o", a[0], a[1], b[0], b[1])

    # --- walls
    P.layer()
    P.box("o", X(-35), Y(DY), X(35), Y(DY - 3.4))            # eave of the dome
    P.box("o", X(-32), Y(DY - 3.4), X(32), Y(70))            # drum
    P.box("o", X(-37), Y(70), X(37), Y(66.5))                # its base ring
    for deg in range(-75, 90, 25):
        x = 32 * math.sin(math.radians(deg))
        P.line("o", X(x), Y(DY - 3.4), X(x), Y(70))
    for deg in range(-86, -22, 5):
        x = 32 * math.sin(math.radians(deg))
        P.line("h", X(x), Y(DY - 4.6), X(x), Y(71))
    for deg in (-50, 0, 50):
        x = 32 * math.sin(math.radians(deg + 12.5))
        wv = 3.6 * math.cos(math.radians(deg + 12.5)) + 0.6
        P.rect("h", X(x - wv / 2), Y(84), X(x + wv / 2), Y(75))
    # main block
    P.box("o", X(-62), Y(62), X(62), Y(8))
    P.box("o", X(-66), Y(66.5), X(66), Y(62))               # cornice
    P.line("f", X(-65), Y(64.2), X(65), Y(64.2))
    x = -60.0
    while x < 59:
        P.rect("f", X(x), Y(62), X(x + 1.8), Y(60.2))        # dentils
        x += 4.1
    P.line("o", X(-62), Y(56.5), X(62), Y(56.5))
    for k, y in enumerate(range(14, 56, 5)):                 # stone courses, joints staggered
        P.line("f", X(-61), Y(y), X(61), Y(y))
        for xx in range(-58 + (k % 2) * 6, 60, 12):
            P.line("f", X(xx), Y(y), X(xx), Y(y + 5))
    # wings
    for sgn in (-1, 1):
        xa, xb = (X(-120), X(-62)) if sgn < 0 else (X(62), X(120))
        P.box("o", xa, Y(44), xb, Y(8))
        P.box("o", xa - 2, Y(47.5), xb + 2, Y(44))
        for y in range(14, 44, 5):
            P.line("f", xa + 1, Y(y), xb - 1, Y(y))
        P.line("h", xa + 1.6, Y(43), xa + 1.6, Y(9))
    P.line("h", X(-60.4), Y(55.5), X(-60.4), Y(46))
    # terrace
    P.box("o", X(-156), Y(8), X(156), Y(0))
    P.line("f", X(-156), Y(6.2), X(156), Y(6.2))
    for xx in range(-150, 156, 9):
        if abs(xx) > 16:
            P.line("f", X(xx), Y(6.2), X(xx), Y(0.5))
    P.line("h", X(-154), Y(3.2), X(-40), Y(3.2))
    P.box("o", X(-16), Y(8), X(16), Y(-2))                   # steps
    for y in (5.5, 3, 0.5):
        P.line("h", X(-16), Y(y), X(16), Y(y))

    # --- openings and orders, in front of the courses
    P.layer()
    for xx in (-62, -37.5, -13, 8, 32.5, 57):                # pilasters
        P.box("o", X(xx), Y(56.5), X(xx + 5), Y(8))
        P.box("o", X(xx - 1), Y(56.5), X(xx + 6), Y(54))
        P.line("h", X(xx + 1.4), Y(53), X(xx + 1.4), Y(9))
    P.layer()

    def window(xc, y0, y1, w, lit=False):
        xa, xb = xc - w / 2, xc + w / 2
        P.arch("o", X(xa - 1.6), X(xb + 1.6), Y(y1 + 1.6), Y(y0), sil=True)
        P.arch("o", X(xa), X(xb), Y(y1), Y(y0))
        P.line("o", X(xa - 2.6), Y(y0), X(xb + 2.6), Y(y0))
        r = w / 2
        if lit:
            y = y0 + 1.2
            while y < y1 - 0.6:
                hw = r if y <= y1 - r else math.sqrt(max(r * r - (y - (y1 - r)) ** 2, 0))
                if hw > 1.2:
                    P.line("h", X(xc - hw + 0.7), Y(y), X(xc - 0.7), Y(y))
                    P.line("h", X(xc + 0.7), Y(y), X(xc + hw - 0.7), Y(y))
                y += 1.5
        else:
            P.line("f", X(xc), Y(y0), X(xc), Y(y1 - 0.5))
            P.line("f", X(xa), Y(y1 - r), X(xb), Y(y1 - r))
            P.line("f", X(xa), Y((y0 + y1 - r) / 2), X(xb), Y((y0 + y1 - r) / 2))
        P.line("h", X(xa - 0.9), Y(y1 - r), X(xa - 0.9), Y(y0 + 0.6))

    for xc in (-47.2, -22.7, 22.7, 47.2):
        window(xc, 20, 48, 10, lit=(xc == 22.7))
    for xc in (-104, -82, 82, 104):
        window(xc, 18, 37, 8, lit=(xc == -104))
    # door with its fanlight
    P.arch("o", X(-8.5), X(8.5), Y(45), Y(8), sil=True)
    P.arch("o", X(-6.5), X(6.5), Y(43), Y(8))
    P.line("f", X(0), Y(36), X(0), Y(8))
    P.line("f", X(-6.5), Y(36.5), X(6.5), Y(36.5))
    for a in (45, 90, 135):
        P.line("f", X(0), Y(36.5), X(6.3 * math.cos(math.radians(a))), Y(36.5 + 6.3 * math.sin(math.radians(a))))
    for y in (27, 18):
        P.line("f", X(-6), Y(y), X(6), Y(y))
    P.line("h", X(-7.6), Y(36), X(-7.6), Y(8.6))

    # --- west wing: the transit room under its small dome
    P.layer()
    P.box("o", X(-103), Y(54), X(-79), Y(47.5))
    r2 = 11.0
    P.add("o", f"M{f(X(-91 - r2))} {f(Y(54))}A{f(r2)} {f(r2)} 0 0 1 {f(X(-91 + r2))} {f(Y(54))}")
    P.sil(f"M{f(X(-91 - r2))} {f(Y(54))}A{f(r2)} {f(r2)} 0 0 1 {f(X(-91 + r2))} {f(Y(54))}Z")
    for xo in (-1.6, 1.6):
        P.line("o", X(-91 + xo), Y(54), X(-91 + xo), Y(54 + math.sqrt(r2 * r2 - xo * xo)))
    for k in range(5):
        l = math.radians(12 + k * 15)
        r = r2 * math.cos(l)
        P.line("h", X(-91 - r + 0.6), Y(54 + r2 * math.sin(l)), X(-91 - r + 0.6 + r * 0.42), Y(54 + r2 * math.sin(l)))
    for lon in (-55, -30, 30, 55):
        P.poly("f", [(X(-91 + r2 * math.sin(math.radians(lon)) * math.cos(math.radians(l))), Y(54 + r2 * math.sin(math.radians(l))))
                     for l in range(0, 91, 10)])
    for xx in (-117, -109, -73, -66):                        # parapet posts
        P.rect("h", X(xx), Y(51.5), X(xx + 2.2), Y(47.5))
    P.line("h", X(-120), Y(51.5), X(-103), Y(51.5))
    P.line("h", X(-79), Y(51.5), X(-62), Y(51.5))

    # --- east wing: balustrade, weather mast and screen
    P.line("o", X(62), Y(54), X(120), Y(54))
    P.line("h", X(62), Y(52.6), X(120), Y(52.6))
    xx = 64.0
    while xx < 119:
        P.line("f", X(xx), Y(52.6), X(xx), Y(47.5))
        xx += 2.6
    P.rect("o", X(118), Y(55.5), X(121.5), Y(47.5))
    mx = 100.0                                                # mast
    P.line("o", X(mx), Y(54), X(mx), Y(96))
    P.line("f", X(mx), Y(72), X(mx - 9), Y(54))
    P.line("f", X(mx), Y(72), X(mx + 9), Y(54))
    P.line("o", X(mx - 7), Y(96), X(mx + 7), Y(96))          # anemometer
    for dx in (-7, 0, 7):
        yy = 96 if dx else 98.5
        P.arc("o", X(mx + dx), Y(yy), 2.1, 90, 270) if dx <= 0 else P.arc("o", X(mx + dx), Y(yy), 2.1, -90, 90)
    P.line("o", X(mx), Y(96), X(mx), Y(98.5))
    P.line("o", X(mx - 8), Y(86), X(mx + 8), Y(86))          # vane
    P.poly("o", [(X(mx - 8), Y(86)), (X(mx - 12), Y(88.4)), (X(mx - 12), Y(83.6))], close=True)
    P.poly("o", [(X(mx + 8), Y(86)), (X(mx + 5.5), Y(87.6)), (X(mx + 5.5), Y(84.4))], close=True)
    P.rect("o", X(72), Y(64), X(82), Y(57))                  # thermometer screen
    for y in (58.6, 60.4, 62.2):
        P.line("f", X(72.6), Y(y), X(81.4), Y(y))
    P.poly("o", [(X(71), Y(64)), (X(77), Y(66.6)), (X(83), Y(64))])
    P.line("h", X(73), Y(57), X(73), Y(54))
    P.line("h", X(81), Y(57), X(81), Y(54))


# ------------------------------------------------------------------ river
def river():
    """It comes through the viaduct and widens towards us."""
    P.layer()
    left, right = [], []
    for i in range(25):
        t = i / 24
        y = 366 + (436 - 366) * t ** 1.25
        cx = 1452 + 46 * math.sin(t * 4.2 + 0.4) * (0.4 + t) - 70 * t ** 2
        w = 5 + 46 * t ** 1.5
        left.append((cx - w, y))
        right.append((cx + w, y))
    P.sil(left + list(reversed(right)))
    P.poly("o", left)
    P.poly("h", right)
    # still water: ruled level lines from bank to bank, lifted here and there for the glints
    def bank(side, y):
        for (xa, ya), (xb, yb) in zip(side, side[1:]):
            if ya <= y <= yb:
                return xa + (xb - xa) * (y - ya) / max(yb - ya, 1e-6)
        return side[-1][0]

    y = left[0][1] + 1.6
    while y < left[-1][1]:
        xa, xb = bank(left, y) + 1.6, bank(right, y) - 1.2
        x = xa
        while x < xb:
            ln = rng.uniform(5, 22)
            P.line("f", x, y, min(x + ln, xb), y)
            x += ln + rng.uniform(1.5, 7)
        y += 2.1
    # reeds on the west bank
    for i in (9, 11, 13, 16):
        x, y = left[i]
        tuft(x - 2, y, 0.9, "f")


# ------------------------------------------------------------------ foreground
def foreground():
    P.layer()
    pts = profile(fore, 0, W, 5)
    P.sil(pts + [(W, H), (0, H)])
    P.dashes("o", 0, W, 0, 60, 240, 6, 30, fn=fore)
    y_off = 5.0
    while y_off < 52:
        t = y_off / 52
        P.dashes("h" if t < 0.45 else "f", 0, W, 0, 30 * (1 - t) + 8, 150 * (1 - t) + 20, 8 + 40 * t, 30 + 190 * t,
                 fn=lambda x, o=y_off, t=t: fore(x) + o + 3 * math.sin(x / 60 + o))
        y_off += 4.5 + 7 * t
    for _ in range(170):
        x = rng.uniform(10, W - 10)
        tuft(x, fore(x) + rng.uniform(-1, 9), rng.uniform(0.7, 1.25))
    # stones
    for _ in range(46):
        x = rng.uniform(10, W - 10)
        y = fore(x) + rng.uniform(3, 20)
        w, hh = rng.uniform(4, 11), rng.uniform(2.5, 5)
        P.add("h", f"M{f(x - w)} {f(y)}Q{f(x - w * 0.7)} {f(y - hh * 1.6)} {f(x)} {f(y - hh)}Q{f(x + w * 0.8)} {f(y - hh * 0.9)} {f(x + w)} {f(y)}")
        P.line("f", x - w * 0.6, y - hh * 0.5, x - w * 0.1, y - hh * 0.8)
    # dry-stone wall, a stretch east of the river
    P.layer()
    xa, xb = 1610, 1880
    sil_top, x = [], xa
    while x < xb:
        # two courses of rough stones, each with its own rounded back; the wall has gaps and a fallen end
        base = fore(x) + 1
        for course, hh in ((0, rng.uniform(5.5, 7.5)), (1, rng.uniform(4, 6))):
            if course == 1 and (rng.random() < 0.14 or x > xb - 30 or x < xa + 14):
                continue
            w = rng.uniform(8, 15)
            ox = x + (rng.uniform(2, 6) if course else 0)
            y0 = base - (7 if course else 0)
            P.add("h" if course else "o",
                  f"M{f(ox)} {f(y0)}Q{f(ox + 0.4)} {f(y0 - hh)} {f(ox + w * 0.45)} {f(y0 - hh)}"
                  f"Q{f(ox + w - 0.4)} {f(y0 - hh * 0.95)} {f(ox + w)} {f(y0)}")
            P.line("f", ox + 1.6, y0 - hh * 0.55, ox + w * 0.4, y0 - hh * 0.8)
            P.sil([(ox, y0), (ox + 0.6, y0 - hh), (ox + w - 0.6, y0 - hh), (ox + w, y0)])
        x += rng.uniform(9, 14)


def main():
    sky()
    moon(706, 96, 15)
    clouds()
    mountains()
    plain()
    village(352, 332)
    windmill(512, 338)
    far_works(2262, 331)
    river()
    viaduct(1352, 8, 25, 322, 364)
    train(1386, 322)
    town(1580, 348)
    hill_form()
    hill_details()
    observatory(CX, hill(CX) + 1.5)
    foreground()
    P.layer()
    umbrella_pine(664, fore(664) + 4, 176, 190, lean=22)
    P.layer()
    umbrella_pine(2128, fore(2128) + 4, 150, 160, lean=-14)
    P.layer()
    for dx, hh, ww in ((0, 96, 13), (17, 70, 10)):
        cypress(2232 + dx, fore(2232 + dx) + 3, hh, ww)
    P.layer()
    umbrella_pine(226, fore(226) + 4, 132, 150, lean=-10)
    P.write(OUT, fade_x=170, fade_top=18, fade_bottom=26)


if __name__ == "__main__":
    main()
