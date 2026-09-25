"""
Nineteenth-century English mill town for the Contaminación header, drawn as an Atlas plate.

A spinning mill with its rows of lit windows, a saw-tooth weaving shed, a row of terraced houses
and three brick chimneys whose smoke drifts east and swallows the stars and the moon: the first
pollution of the night sky. Same "white-line" engraving as tools/observatorio.py: the page is dark,
so lit surfaces carry the lines, light comes from the left.

The smoke is a chain of puffs per chimney; only the outer boundary of their union is drawn (a point
of a puff is kept if no other puff covers it), which is how an engraver draws a billowing plume.

The SVG is monochrome black on transparent and is used as a CSS mask (atlas/tools.css), so the page
paints it with var(--gold) and night mode turns it red by itself.

    python tools/factorias.py   ->   atlas/img/factorias.svg
"""
import math
import random
from pathlib import Path

W, H = 480, 420
GROUND = 392
OUT = Path(__file__).resolve().parent.parent / "atlas" / "img" / "factorias.svg"

rng = random.Random(1851)
paths = {"o": [], "h": [], "f": []}   # outline, hatch, fine
puffs = []                            # (cx, cy, r) of every puff of smoke


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def line(key, x1, y1, x2, y2):
    paths[key].append(f"M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}")


def poly(key, pts, close=False):
    if len(pts) < 2:
        return
    paths[key].append("M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + ("Z" if close else ""))


def rect(key, x0, y0, x1, y1):
    poly(key, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)


def in_smoke(x, y, skip=-1, margin=0.4):
    return any(i != skip and (x - cx) ** 2 + (y - cy) ** 2 < (r - margin) ** 2 for i, (cx, cy, r) in enumerate(puffs))


def draw_visible(key, pts, skip=-1):
    """Polyline cut wherever the smoke covers it."""
    run = []
    for x, y in pts:
        if in_smoke(x, y, skip):
            poly(key, run)
            run = []
        else:
            run.append((x, y))
    poly(key, run)


# ---------------------------------------------------------------- sky
TAIL = set()                          # puffs that are thinning out


def plume(x0, y0, dx, dy, n, r0, r1):
    for i in range(n):
        t = i / (n - 1)
        if t > 0.66:
            TAIL.add(len(puffs))
        cx = x0 + dx * t + math.sin(t * 7 + x0) * 6 * t
        cy = y0 - dy * (1 - (1 - t) ** 1.6) + rng.uniform(-2, 2)
        puffs.append((cx, cy, r0 + (r1 - r0) * t ** 0.8 + rng.uniform(-1.5, 1.5)))


def smoke():
    for i, (cx, cy, r) in enumerate(puffs):
        tail = i in TAIL
        span = range(160, 381, 4) if tail else range(0, 361, 4)
        pts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in span]
        draw_visible("h" if tail else "o", pts, skip=i)
        # engraved billows on the lit (upper-left) side of each puff
        for k, rr in ((0.66, 0.66 * r), (0.4, 0.4 * r)):
            arc = [(cx + rr * math.cos(math.radians(a)), cy + rr * math.sin(math.radians(a)))
                   for a in range(185, 262, 5)]
            draw_visible("h" if k > 0.5 else "f", [(x, y) for x, y in arc if not in_front(i, x, y)], skip=i)


def in_front(i, x, y):
    """Covered by a puff drawn later in the same chain (the plume thickens as it goes)."""
    return any(j > i and (x - cx) ** 2 + (y - cy) ** 2 < r * r for j, (cx, cy, r) in enumerate(puffs))


def sky():
    # the moon, veiled: only what the smoke leaves
    mx, my, mr = 428, 40, 17
    draw_visible("o", [(mx + mr * math.cos(math.radians(a)), my + mr * math.sin(math.radians(a))) for a in range(0, 361, 4)])
    draw_visible("f", [(mx - 6 + 11 * math.cos(math.radians(a)), my + 11 * math.sin(math.radians(a))) for a in range(110, 251, 6)])
    # stars on the clean (west) side; the smoke hides the others
    for x, y, k in ((30, 40, 3.2), (72, 22, 2.2), (54, 96, 2.4), (18, 150, 2), (104, 64, 2.6), (150, 28, 2.2),
                    (250, 30, 2.4), (330, 110, 2.2), (455, 150, 2)):
        if not in_smoke(x, y, margin=-3):
            line("f", x - k, y, x + k, y)
            line("f", x, y - k, x, y + k)


# ---------------------------------------------------------------- town
def chimney(xc, base, top, wb, wt):
    left = [(xc - wb / 2, base), (xc - wt / 2, top)]
    right = [(xc + wb / 2, base), (xc + wt / 2, top)]
    poly("o", left)
    poly("o", right)
    rect("o", xc - wt / 2 - 3, top - 5, xc + wt / 2 + 3, top)          # cap
    line("o", xc - wt / 2 - 1.5, top - 5, xc - wt / 2 - 1.5, top - 9)
    line("o", xc + wt / 2 + 1.5, top - 5, xc + wt / 2 + 1.5, top - 9)
    line("o", xc - wt / 2 - 1.5, top - 9, xc + wt / 2 + 1.5, top - 9)
    y = base - 6
    while y > top + 4:                                                  # brick courses
        t = (base - y) / (base - top)
        w = wb + (wt - wb) * t
        line("f", xc - w / 2, y, xc + w / 2, y)
        line("h", xc - w / 2 + 1.6, y - 0.8, xc - w / 2 + 1.6, y - 5.2)  # lit left flank
        y -= 7.5


def terrace():
    for k in range(4):
        x0 = 14 + k * 34
        x1 = x0 + 34
        rect("o", x0, 338, x1, GROUND)
        poly("o", [(x0 - 2, 338), (x0 + 17, 322), (x1 + 2, 338)])
        line("h", x0 + 2, 336.5, x0 + 16, 324.5)                        # lit roof slope
        rect("o", x1 - 9, 318, x1 - 4, 330)                             # chimney pot
        rect("o", x0 + 5, 370, x0 + 13, GROUND)                         # door
        lit = k in (1, 3)
        for wx in (x0 + 19,):
            rect("o", wx, 348, wx + 10, 360)
            if lit:
                for y in (349.8, 351.6, 353.4, 355.2, 357, 358.8):
                    line("h", wx + 1, y, wx + 9, y)
            else:
                line("f", wx + 5, 348, wx + 5, 360)


def mill():
    x0, x1, top = 150, 338, 244
    rect("o", x0, top, x1, GROUND)
    rect("o", x0 - 4, top - 7, x1 + 4, top)                            # cornice
    line("f", x0 - 2, top - 3.5, x1 + 2, top - 3.5)
    line("h", x0 + 2, top + 3, x0 + 2, GROUND - 2)
    line("h", x0 + 4.5, top + 3, x0 + 4.5, GROUND - 2)
    # a pediment with its clock over the middle bays
    cx = (x0 + x1) / 2
    poly("o", [(cx - 36, top - 7), (cx, top - 27), (cx + 36, top - 7)])
    paths["o"].append(f"M{f(cx - 7)} {f(top - 14)}a7 7 0 1 0 14 0a7 7 0 1 0 -14 0")
    line("o", cx, top - 14, cx, top - 18.5)
    line("o", cx, top - 14, cx + 3.2, top - 12.5)
    cols, rows = 9, 5
    for r in range(rows):
        for c in range(cols):
            wx = x0 + 11 + c * 19.6
            wy = top + 12 + r * 26
            if r == rows - 1 and c == cols // 2:
                rect("o", wx - 3, wy, wx + 14, GROUND)                   # gate
                line("f", wx + 5.5, wy, wx + 5.5, GROUND)
                continue
            rect("o", wx, wy, wx + 11, wy + 15)
            if rng.random() < 0.55:                                    # lamplit: the looms work at night
                y = wy + 1.6
                while y < wy + 14:
                    line("h", wx + 1.1, y, wx + 9.9, y)
                    y += 1.7
            else:
                line("f", wx + 5.5, wy, wx + 5.5, wy + 15)
                line("f", wx, wy + 7.5, wx + 11, wy + 7.5)
    for r in range(1, rows):                                           # floor bands
        line("f", x0, top + 5 + r * 26, x1, top + 5 + r * 26)


def shed():
    x0, x1, base_top = 338, 470, 332
    rect("o", x0, base_top, x1, GROUND)
    x = x0
    pts = [(x0, base_top)]
    while x < x1 - 1:
        pts += [(x, base_top - 22), (x + 22, base_top)]
        # north-light glazing on the steep side, roof hatch on the lit slope
        line("f", x + 1.5, base_top - 3, x + 1.5, base_top - 19)
        line("h", x + 3, base_top - 19, x + 20, base_top - 2.5)
        x += 22
    poly("o", pts)
    for wx in range(x0 + 10, x1 - 10, 22):
        rect("o", wx, 350, wx + 10, 368)
        line("f", wx + 5, 350, wx + 5, 368)


def ground():
    paths["g"] = [f"M0 {GROUND}H{W}"]
    for _ in range(30):
        y = GROUND + 4 + rng.random() * 18
        x = rng.uniform(0, W)
        ln = rng.uniform(6, 22) * (1 - (y - GROUND) / 28)
        line("f", x, y, x + ln, y)


def main():
    # smoke first, so everything behind it can ask where it is
    plume(122, 96, 250, 58, 17, 5, 25)
    plume(300, 80, 200, 34, 12, 5, 25)
    plume(404, 144, 110, 58, 9, 4, 20)
    ground()
    sky()
    smoke()
    chimney(84, 322, 200, 12, 8)                                       # distant, behind the terrace
    chimney(122, 338, 112, 18, 11)
    chimney(300, 237, 96, 18, 11)
    chimney(404, 322, 160, 15, 9)
    terrace()
    mill()
    shed()
    style = {"o": 'stroke-width="1.15"', "h": 'stroke-width=".6" stroke-opacity=".8"',
             "f": 'stroke-width=".5" stroke-opacity=".6"'}
    body = "".join(f'<path {style[k]} d="{"".join(paths[k])}"/>' for k in ("f", "h", "o"))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
           f'<defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" x2="{W}">'
           f'<stop offset="0" stop-opacity="0"/><stop offset=".1"/><stop offset=".9"/>'
           f'<stop offset="1" stop-opacity="0"/></linearGradient></defs>'
           f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">'
           f'<path stroke="url(#fade)" stroke-width="1.15" d="{paths["g"][0]}"/>{body}</g></svg>\n')
    OUT.write_text(svg, encoding="utf-8")
    print(f"{OUT.name}: {len(svg) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
