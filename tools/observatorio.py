"""
Nineteenth-century observatory for the Astro Forecast header, drawn as an Atlas plate.

Front elevation: stepped plinth, main block with OBSERVATORIVM on the frieze, two wings with
balustrades, a panelled drum and a hemispherical dome whose slit is turned 40° towards the viewer,
with a refractor pointing out of it. Lines are "white-line" engraving (scratchboard): the page is
dark, so lit surfaces carry the hatching and shadows stay empty. Light comes from the left.

The SVG is monochrome black on transparent and is used as a CSS mask (atlas/astroforecast.css),
so the page paints it with var(--gold) and night mode turns it red by itself.

    python tools/observatorio.py   ->   atlas/img/observatorio.svg
"""
import math
import random
from pathlib import Path

W, H = 480, 380
TOP = 40                                # room above y=0 for the tube and its star
GROUND = 352
OUT = Path(__file__).resolve().parent.parent / "atlas" / "img" / "observatorio.svg"

# dome: centre of the sphere, radius, slit (half width, turn towards the viewer), telescope elevation
DX, DY, R = 240.0, 148.0, 64.0
SLIT_W, SLIT_A = 10.0, math.radians(40)
TEL_E = math.radians(38)

rng = random.Random(1869)
paths = {"o": [], "h": [], "f": []}   # outline, hatch, fine


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def line(key, x1, y1, x2, y2):
    paths[key].append(f"M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}")


def poly(key, pts, close=False):
    if len(pts) < 2:
        return
    d = "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts)
    paths[key].append(d + ("Z" if close else ""))


def rect(key, x0, y0, x1, y1):
    poly(key, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)


def arch_window(key, x0, x1, top, bottom):
    r = (x1 - x0) / 2
    ys = top + r
    paths[key].append(f"M{f(x0)} {f(bottom)}V{f(ys)}A{f(r)} {f(r)} 0 0 1 {f(x1)} {f(ys)}V{f(bottom)}Z")


def hline_skipping(key, y, x0, x1, holes):
    """Horizontal line from x0 to x1 at height y, interrupted by the (xa, xb, ya, yb) holes."""
    cuts = sorted((a, b) for a, b, ya, yb in holes if ya <= y <= yb)
    x = x0
    for a, b in cuts:
        if a > x:
            line(key, x, y, min(a, x1), y)
        x = max(x, b)
    if x < x1:
        line(key, x, y, x1, y)


# ---------------------------------------------------------------- dome geometry
def in_slit(x, y, z):
    """Point on the sphere (centred coordinates) inside the open slit."""
    return z > 0 and abs(x * math.cos(SLIT_A) - z * math.sin(SLIT_A)) < SLIT_W


def sphere_curve(key, pts3d):
    """Draw a curve on the visible hemisphere, cut where it crosses the slit."""
    run = []
    for x, y, z in pts3d:
        if in_slit(x, y, z):
            poly(key, run)
            run = []
        else:
            run.append((DX + x, DY - y))
    poly(key, run)


def slit_edge(sign, offset=0.0):
    """Edge of the slit band, from the dome eave up and over the top."""
    pts = []
    w = SLIT_W + offset
    for i in range(0, 121):
        y = R * i / 120
        r = math.sqrt(max(R * R - y * y, 0))
        if r < w:
            break
        t = math.acos(sign * w / r) - SLIT_A   # x = r cos t, z = r sin t
        z = r * math.sin(t)
        if z < 0:
            break
        pts.append((DX + r * math.cos(t), DY - y))
    return pts


def dome():
    # outline and eave
    paths["o"].append(f"M{f(DX - R)} {f(DY)}A{f(R)} {f(R)} 0 0 1 {f(DX + R)} {f(DY)}")
    rect("o", DX - R - 3, DY, DX + R + 3, DY + 5)
    line("f", DX - R - 1, DY + 2.5, DX + R + 1, DY + 2.5)
    # ribs every 15° of longitude, rings at 30° and 60° of latitude
    for lon in range(-75, 90, 15):
        p = math.radians(lon)
        sphere_curve("f", [(R * math.sin(p) * math.cos(math.radians(l)), R * math.sin(math.radians(l)),
                            R * math.cos(p) * math.cos(math.radians(l))) for l in range(0, 91, 3)])
    for lat in (30, 60):
        l = math.radians(lat)
        sphere_curve("f", [(R * math.cos(l) * math.sin(math.radians(p)), R * math.sin(l),
                            R * math.cos(l) * math.cos(math.radians(p))) for p in range(-90, 91, 2)])
    # lit side: short horizontal strokes along the left limb, longer near the eave
    lat = 3.0
    while lat < 86:
        l = math.radians(lat)
        r = R * math.cos(l)
        y = DY - R * math.sin(l)
        length = r * (0.42 - 0.3 * lat / 90) * (0.8 + 0.4 * rng.random())
        line("h", DX - r + 0.8, y, DX - r + 0.8 + length, y)
        lat += 2.6
    # slit: two edges with their shutter rails
    for sign in (1, -1):
        poly("o", slit_edge(sign))
        poly("f", slit_edge(sign, 2.6))
    top_a, top_b = slit_edge(1)[-1], slit_edge(-1)[-1]
    line("o", top_a[0], top_a[1], top_b[0], top_b[1])


# ---------------------------------------------------------------- telescope
def telescope():
    ux = math.sin(SLIT_A) * math.cos(TEL_E)
    uy = math.sin(TEL_E)
    n = math.hypot(ux, uy)
    ax, ay = ux / n, -uy / n           # axis in the drawing
    px, py = -ay, ax                   # perpendicular (towards the lower right)
    x0, y0 = DX + R * ux * 0.62, DY - R * uy * 0.62   # starts inside, seen through the slit
    body, dew = 118.0, 26.0

    def at(s, off):
        return x0 + ax * s + px * off, y0 + ay * s + py * off

    def half(s):                       # tapered tube, wider dew shield
        return 6.2 - 1.4 * s / body if s <= body else 6.6

    for side in (1, -1):
        poly("o", [at(s, side * half(s)) for s in (0, body)])
        poly("o", [at(s, side * half(s)) for s in (body, body + dew)])
    line("o", *at(body, -6.6), *at(body, 6.6))
    for s in (26, 58, 92):              # brass rings
        line("o", *at(s, -half(s) - 0.8), *at(s, half(s) + 0.8))
        line("f", *at(s + 2.2, -half(s)), *at(s + 2.2, half(s)))
    # objective seen almost edge-on
    cx, cy = at(body + dew, 0)
    rot = math.degrees(math.atan2(ay, ax))
    paths["o"].append(f"M{f(cx + px * 6.6)} {f(cy + py * 6.6)}"
                      f"A2.4 6.6 {f(rot)} 1 0 {f(cx - px * 6.6)} {f(cy - py * 6.6)}")
    # lit (upper-left) side of the tube
    for off, a, b in ((-3.6, 6, body - 4), (-1.8, 12, body - 10), (-4.4, body + 3, body + dew - 3)):
        line("h", *at(a, off), *at(b, off))
    # finder scope on the lit side
    poly("o", [at(52, -9.5), at(86, -9.5)])
    poly("o", [at(52, -12.3), at(86, -12.3)])
    line("o", *at(86, -12.3), *at(86, -9.5))
    line("f", *at(60, -6.2), *at(60, -9.5))
    line("f", *at(80, -5.9), *at(80, -9.5))
    # the star it is aimed at
    sx, sy = at(body + dew + 44, 0)
    for dx, dy, k in ((1, 0, 7), (0, 1, 7), (0.7, 0.7, 2.6), (0.7, -0.7, 2.6)):
        line("o", sx - dx * k, sy - dy * k, sx + dx * k, sy + dy * k)
    return x0, y0, ax, ay, body + dew


def telescope_clip():
    """Visible where it is outside the dome or inside the slit."""
    dome_path = f"M{f(DX - R)} {f(DY)}A{f(R)} {f(R)} 0 0 1 {f(DX + R)} {f(DY)}Z"
    slit = slit_edge(1) + list(reversed(slit_edge(-1)))
    slit_d = "M" + "L".join(f"{f(x)} {f(y)}" for x, y in slit) + "Z"
    return (f'<clipPath id="tc"><path clip-rule="evenodd" d="M0 {-TOP}H{W}V{DY}H0Z{dome_path}"/>'
            f'<path d="{slit_d}"/></clipPath>')


# ---------------------------------------------------------------- building
def balustrade(x0, x1, top, bottom, step=6.5):
    rect("o", x0, top, x1, top + 3.5)
    rect("o", x0, bottom - 3.5, x1, bottom)
    x = x0 + step / 2 + 1
    while x < x1 - 2:
        a, b = bottom - 3.5, top + 3.5
        m = (a + b) / 2
        paths["f"].append(f"M{f(x - 1.1)} {f(a)}C{f(x - 3)} {f(m + 2)} {f(x - 0.6)} {f(m - 1)} {f(x - 0.9)} {f(b)}"
                          f"M{f(x + 1.1)} {f(a)}C{f(x + 3)} {f(m + 2)} {f(x + 0.6)} {f(m - 1)} {f(x + 0.9)} {f(b)}")
        x += step


def urn(x, base):
    rect("o", x - 3.5, base - 5, x + 3.5, base)
    paths["o"].append(f"M{f(x - 2)} {f(base - 5)}C{f(x - 6)} {f(base - 9)} {f(x - 3)} {f(base - 14)} {f(x)} {f(base - 14)}"
                      f"C{f(x + 3)} {f(base - 14)} {f(x + 6)} {f(base - 9)} {f(x + 2)} {f(base - 5)}")
    line("o", x, base - 14, x, base - 17)


def window(xc, top, bottom, w, lit=False):
    x0, x1 = xc - w / 2, xc + w / 2
    arch_window("o", x0 - 2.5, x1 + 2.5, top - 2.5, bottom)        # surround
    arch_window("o", x0, x1, top, bottom)
    rect("o", x0 - 4, bottom, x1 + 4, bottom + 3)                   # sill
    kx, ky = xc, top - 2.5
    poly("o", [(kx - 2.5, ky + 0.5), (kx - 3.2, ky - 4), (kx + 3.2, ky - 4), (kx + 2.5, ky + 0.5)])
    r = w / 2
    bars = [top + r + (bottom - top - r) * k for k in (0.33, 0.66)]
    if lit:
        y = top + 1.4
        while y < bottom - 0.8:
            half = r if y >= top + r else math.sqrt(max(r * r - (top + r - y) ** 2, 0))
            if half > 1.5 and all(abs(y - b) > 1.2 for b in bars):
                line("h", xc - half + 0.9, y, xc - 1.1, y)
                line("h", xc + 1.1, y, xc + half - 0.9, y)
            y += 1.55
    else:
        line("f", xc, top + 1, xc, bottom)
        for b in bars:
            line("f", x0, b, x1, b)
        paths["f"].append(f"M{f(x0)} {f(top + r)}H{f(x1)}")
    # lit left reveal of the opening
    line("h", x0 - 1.2, top + r, x0 - 1.2, bottom - 1)


def building():
    # plinth: three steps, each with its lit tread
    for i, (x0, x1) in enumerate(((30, 450), (40, 440), (50, 430))):
        y1 = GROUND - i * 8
        rect("o", x0, y1 - 8, x1, y1)
        line("h", x0 + 2, y1 - 6.2, x0 + (x1 - x0) * 0.45, y1 - 6.2)

    # wings
    for x0, x1, xc in ((50, 130, 90), (350, 430, 390)):
        rect("o", x0, 262, x1, 328)
        rect("o", x0 - 3, 256, x1 + 3, 262)
        balustrade(x0, x1, 238, 256)
        urn(x0 + 4, 238)
        urn(x1 - 4, 238)
        window(xc, 280, 316, 18)
        for y in range(270, 328, 8):
            hline_skipping("f", y, x0 + 1, x1 - 1, [(xc - 12, xc + 12, 276, 320)])
    # the right wing is in the main block's shadow near the corner: no texture there
    # main block
    rect("o", 130, 196, 350, 328)
    rect("o", 124, 188, 356, 196)                                   # cornice
    line("f", 126, 192, 354, 192)
    for x in range(133, 348, 7):                                    # dentils
        rect("f", x, 196, x + 3.5, 200)
    line("o", 130, 214, 350, 214)                                   # architrave
    paths["o"].append(f'M130 206H350')
    for x0, x1 in ((130, 142), (338, 350), (211, 219), (261, 269)): # pilasters
        rect("o", x0, 214, x1, 328)
        rect("o", x0 - 1.5, 214, x1 + 1.5, 219)
        line("h", x0 + 2, 221, x0 + 2, 325)
    # door
    arch_window("o", 224, 256, 268, 328)
    arch_window("o", 227.5, 252.5, 271.5, 328)
    line("f", 240, 290, 240, 328)
    for y in (300, 314):
        line("f", 229, y, 251, y)
    line("h", 225.8, 285, 225.8, 327)
    for x in (156, 190, 290, 324):
        window(x, 230, 298, 20, lit=(x == 290))
    # stone courses and staggered joints on the wall, left of each bay slightly denser
    holes = [(129, 143, 214, 328), (337, 351, 214, 328), (210, 220, 214, 328), (260, 270, 214, 328),
             (221, 259, 265, 328)] + [(x - 14, x + 14, 225, 302) for x in (156, 190, 290, 324)]
    for k, y in enumerate(range(222, 328, 8)):
        hline_skipping("f", y, 131, 349, holes)
        for x in range(146 + (k % 2) * 12, 336, 24):
            if not any(a <= x <= b and ya <= y + 4 <= yb for a, b, ya, yb in holes):
                line("f", x, y, x, y + 8)
    # roof balustrade either side of the drum
    balustrade(130, 176, 172, 188)
    balustrade(304, 350, 172, 188)
    for x in (132, 348):
        urn(x, 172)

    # drum: a cylinder of panels, lit on the left
    rect("o", 176, 182, 304, 188)
    rect("o", 180, DY + 5, 300, 182)
    for deg in range(-75, 90, 25):
        x = DX + 60 * math.sin(math.radians(deg))
        line("o", x, DY + 5, x, 182)
    for deg in range(-88, -20, 4):
        x = DX + 60 * math.sin(math.radians(deg))
        line("h", x, DY + 7, x, 180)
    for deg in (-50, 0, 50):                                         # small windows of the drum
        x = DX + 60 * math.sin(math.radians(deg))
        wv = 7 * math.cos(math.radians(deg))
        rect("o", x - wv / 2 + 12 * math.cos(math.radians(deg)), 160,
             x + wv / 2 + 12 * math.cos(math.radians(deg)), 174)


def frieze():
    return (f'<text x="{DX}" y="{211.2}" text-anchor="middle" font-family="Bodoni Moda, Didot, \'Bodoni 72\', '
            f'\'Times New Roman\', serif" font-size="7.4" letter-spacing="3.2">OBSERVATORIVM</text>')


# ---------------------------------------------------------------- landscape
def cypress(x, height, width):
    """Mediterranean cypress: a narrow column with a pointed top, foliage in short vertical flames."""
    top = GROUND - height

    def half(t):                       # t = 0 at the foot, 1 at the tip
        return width / 2 * min(1.0, 0.55 + 3 * t) * (1 - t ** 2.2) ** 0.5

    left = [(x - half(i / 60), GROUND - 4 - (height - 4) * i / 60) for i in range(61)]
    right = [(2 * x - px, py) for px, py in reversed(left)]
    poly("o", left + right)
    rect("o", x - 1.4, GROUND - 4, x + 1.4, GROUND)
    y = GROUND - 9
    row = 0
    while y > top + 6:
        t = (GROUND - y) / height
        h = half(t)
        n = max(1, int(2 * h / 3.2))
        for j in range(n):
            u = (j + 0.5 + (row % 2) * 0.5) / (n + 0.5)
            if rng.random() < 1.15 - u:       # lit side denser
                cx = x - h + 2 * h * u
                paths["h"].append(f"M{f(cx)} {f(y + 2.6)}Q{f(cx - 0.9)} {f(y)} {f(cx + 0.3)} {f(y - 3.4)}")
        y -= 4.2
        row += 1


def ground():
    paths["g"] = [f"M0 {GROUND}H{W}"]
    for i in range(46):
        y = GROUND + 4 + rng.random() * 22
        x = rng.uniform(0, W)
        ln = rng.uniform(6, 26) * (1 - (y - GROUND) / 34)
        line("f", x, y, x + ln, y)


def stars():
    for x, y, k in ((60, 70, 3.5), (118, 34, 2.4), (420, 150, 2.8), (20, 180, 2.2), (455, 60, 2.4)):
        line("f", x - k, y, x + k, y)
        line("f", x, y - k, x, y + k)


# ---------------------------------------------------------------- output
def main():
    ground()
    cypress(17, 128, 17)
    cypress(463, 104, 14)
    building()
    dome()
    stars()
    tel_paths = {"o": [], "h": [], "f": []}
    saved = {k: list(v) for k, v in paths.items() if k != "g"}
    for k in saved:
        paths[k].clear()
    telescope()
    for k in saved:
        tel_paths[k] = paths[k][:]
        paths[k][:] = saved[k]

    style = {"o": 'stroke-width="1.15"', "h": 'stroke-width=".6" stroke-opacity=".8"',
             "f": 'stroke-width=".5" stroke-opacity=".6"'}
    body = []
    for k in ("f", "h", "o"):
        body.append(f'<path {style[k]} d="{"".join(paths[k])}"/>')
    tel = "".join(f'<path {style[k]} d="{"".join(tel_paths[k])}"/>' for k in ("f", "h", "o") if tel_paths[k])
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H + TOP}" viewBox="0 {-TOP} {W} {H + TOP}">'
           f'<defs>{telescope_clip()}'
           f'<radialGradient id="lamp"><stop offset="0" stop-opacity=".32"/><stop offset="1" stop-opacity="0"/>'
           f'</radialGradient>'
           f'<linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" x2="{W}">'
           f'<stop offset="0" stop-opacity="0"/><stop offset=".12"/><stop offset=".88"/>'
           f'<stop offset="1" stop-opacity="0"/></linearGradient></defs>'
           f'<g fill="none" stroke="#000" stroke-linecap="round">'
           f'<path stroke="url(#fade)" stroke-width="1.15" d="{paths.pop("g")[0]}"/>'
           f'<circle cx="290" cy="262" r="46" fill="url(#lamp)" stroke="none"/>'
           + "".join(body)
           + f'<g clip-path="url(#tc)">{tel}</g>'
           + f'<g fill="#000" stroke="none" fill-opacity=".85">{frieze()}</g>'
           + '</g></svg>\n')
    OUT.write_text(svg, encoding="utf-8")
    print(f"{OUT.name}: {len(svg) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
