"""
Nineteenth-century blackboard for the PixelMath-teca header, drawn as an Atlas plate.

A slate on a tripod easel with the mathematics PixelMath lives on, as it was written then:
Fourier's series (1822), Gauss's error curve (1809) with its plot, and Euler's formula on the
unit circle. Books at the foot. Same "white-line" engraving as tools/observatorio.py: the page is
dark, so chalk and lit surfaces carry the lines, light comes from the left.

The SVG is monochrome black on transparent and is used as a CSS mask (atlas/tools.css), so the page
paints it with var(--gold) and night mode turns it red by itself.

    python tools/pizarra.py   ->   atlas/img/pizarra.svg
"""
import math
import random
from pathlib import Path

W, H = 480, 420
GROUND = 400
OUT = Path(__file__).resolve().parent.parent / "atlas" / "img" / "pizarra.svg"
SERIF = "'Times New Roman', Times, 'Nimbus Roman', serif"

rng = random.Random(1822)
paths = {"o": [], "h": [], "f": []}   # outline, hatch, fine
texts = []


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


def text(x, y, s, size=15, italic=True, anchor="start", extra=""):
    style = ' font-style="italic"' if italic else ""
    texts.append(f'<text x="{f(x)}" y="{f(y)}" font-size="{size}"{style} text-anchor="{anchor}"{extra}>{s}</text>')


# ---------------------------------------------------------------- easel
def leg(x_top, y_top, x_bot, y_bot, w=7):
    dx, dy = x_bot - x_top, y_bot - y_top
    n = math.hypot(dx, dy)
    px, py = -dy / n * w / 2, dx / n * w / 2
    poly("o", [(x_top - px, y_top - py), (x_bot - px, y_bot - py), (x_bot + px, y_bot + py),
               (x_top + px, y_top + py)], close=True)
    # lit (left) edge of the wood
    line("h", x_top - px * 0.45, y_top - py * 0.45 + 6, x_bot - px * 0.45, y_bot - py * 0.45 - 4)


def easel():
    ax, ay = 240, 16
    leg(ax, ay + 70, 240, GROUND - 4, 6)                     # rear leg, seen under the board
    leg(ax - 6, ay, 92, GROUND)
    leg(ax + 6, ay, 388, GROUND)
    rect("o", ax - 9, ay - 8, ax + 9, ay + 4)                # head block
    line("h", ax - 6, ay - 5, ax - 6, ay + 1)
    # cross-bar between the front legs
    y = 352
    xl = 240 - 6 + (92 - 234) * (y - ay) / (GROUND - ay)
    xr = 240 + 6 + (388 - 246) * (y - ay) / (GROUND - ay)
    rect("o", xl + 2, y, xr - 2, y + 6)
    line("h", xl + 5, y + 2, xr - 40, y + 2)
    # pegs holding the board
    for x in (108, 372):
        rect("o", x - 5, 308, x + 5, 316)


# ---------------------------------------------------------------- board
BX0, BY0, BX1, BY1, FR = 50, 64, 430, 300, 10


def board():
    rect("o", BX0, BY0, BX1, BY1)
    rect("o", BX0 + FR, BY0 + FR, BX1 - FR, BY1 - FR)
    for x0, y0, x1, y1 in ((BX0, BY0, BX0 + FR, BY0 + FR), (BX1, BY0, BX1 - FR, BY0 + FR),
                           (BX0, BY1, BX0 + FR, BY1 - FR), (BX1, BY1, BX1 - FR, BY1 - FR)):
        line("f", x0, y0, x1, y1)                             # mitred corners
    # wood grain on the lit frame members (top and left), none on the shaded ones
    for k in range(3):
        y = BY0 + 2.6 + k * 2.4
        x = BX0 + 6
        while x < BX1 - 12:
            ln = rng.uniform(30, 90)
            line("h", x, y, min(x + ln, BX1 - 12), y + rng.uniform(-0.3, 0.3))
            x += ln + rng.uniform(6, 20)
        xg = BX0 + 2.6 + k * 2.4
        yg = BY0 + 12
        while yg < BY1 - 12:
            ln = rng.uniform(30, 70)
            line("h", xg, yg, xg, min(yg + ln, BY1 - 12))
            yg += ln + rng.uniform(6, 20)
    # chalk tray with its sticks and the felt eraser
    rect("o", BX0 + 6, BY1, BX1 - 6, BY1 + 8)
    line("f", BX0 + 6, BY1 + 3, BX1 - 6, BY1 + 3)
    for x, ln in ((96, 16), (118, 9), (300, 12)):
        rect("o", x, BY1 - 3.2, x + ln, BY1)
    rect("o", 342, BY1 - 9, 378, BY1)
    for y in (BY1 - 7.5, BY1 - 5.8, BY1 - 4.1):
        line("h", 344, y, 360, y)
    # old chalk, badly erased: faint smudges
    for cx, cy, w in ((370, 110, 40), (352, 128, 26), (120, 280, 30)):
        for _ in range(7):
            y = cy + rng.uniform(-6, 6)
            x = cx + rng.uniform(-w / 2, w / 4)
            line("f", x, y, x + rng.uniform(8, w), y + rng.uniform(-2, 2))


# ---------------------------------------------------------------- chalk: the mathematics
def fourier():
    x, y = 74, 112
    text(x, y, "f(x) =", 17)
    # a0 / 2
    text(x + 58, y - 7, "a<tspan font-size='9' dy='3'>0</tspan>", 13)
    line("o", x + 55, y - 3.5, x + 72, y - 3.5)
    text(x + 63.5, y + 8, "2", 12, italic=False, anchor="middle")
    text(x + 78, y, "+", 16, italic=False)
    text(x + 103, y + 3, "Σ", 24, italic=False, anchor="middle")
    text(x + 103, y - 17, "∞", 9, italic=False, anchor="middle")
    text(x + 103, y + 14, "n=1", 8, anchor="middle")
    text(x + 116, y, "(a<tspan font-size='10' dy='3'>n</tspan><tspan dy='-3'> cos nx + b</tspan>"
                     "<tspan font-size='10' dy='3'>n</tspan><tspan dy='-3'> sin nx)</tspan>", 16)
    # a quick chalk underline, as a teacher would
    paths["h"].append(f"M{x - 2} {y + 20}Q{x + 150} {y + 16} {x + 292} {y + 21}")


def gauss():
    ox, oy, w = 80, 262, 150
    mu, s, hgt = ox + 76, 21, 78
    line("o", ox, oy, ox + w, oy)                             # axes
    poly("o", [(ox + w - 5, oy - 3), (ox + w, oy), (ox + w - 5, oy + 3)])
    line("o", ox + 4, oy + 4, ox + 4, oy - 100)
    poly("o", [(ox + 1, oy - 95), (ox + 4, oy - 100), (ox + 7, oy - 95)])
    pts = [(ox + 8 + i * (w - 16) / 80, oy - hgt * math.exp(-(((ox + 8 + i * (w - 16) / 80) - mu) / s) ** 2 / 2))
           for i in range(81)]
    poly("o", pts)
    # dashed centre and the two sigmas
    y = oy
    while y > oy - hgt:
        line("f", mu, y, mu, max(y - 4, oy - hgt))
        y -= 7
    for sx in (mu - s, mu + s):
        yy = oy - hgt * math.exp(-0.5)
        line("f", sx, oy, sx, yy)
    line("f", mu - s, oy - hgt * 0.35, mu + s, oy - hgt * 0.35)
    text(mu, oy + 13, "μ", 12, anchor="middle")
    text(mu + s + 2, oy - hgt * 0.35 - 3, "σ", 11)
    # hatching under the curve between ±σ (the lit band of the plate)
    x = mu - s + 2.5
    while x < mu + s - 1:
        top = oy - hgt * math.exp(-((x - mu) / s) ** 2 / 2)
        line("h", x, oy - 1, x, top + 3)
        x += 3.2


def normal_law():
    x, y = 246, 176
    text(x, y, "φ(x) =", 17)
    line("o", x + 56, y - 5, x + 94, y - 5)
    text(x + 75, y - 10, "1", 13, italic=False, anchor="middle")
    text(x + 75, y + 10, "σ√2π", 13, anchor="middle")
    text(x + 98, y, "e", 18)
    text(x + 107, y - 11, "−(x−μ)²/2σ²", 10)
    text(x + 14, y + 26, "Gauss, 1809", 10, extra=' fill-opacity=".7"')


def euler():
    cx, cy, r = 272, 250, 22
    paths["o"].append(f"M{f(cx + r)} {f(cy)}A{r} {r} 0 1 0 {f(cx - r)} {f(cy)}A{r} {r} 0 1 0 {f(cx + r)} {f(cy)}")
    line("f", cx - r - 6, cy, cx + r + 6, cy)
    line("f", cx, cy + r + 6, cx, cy - r - 6)
    a = math.radians(38)
    px, py = cx + r * math.cos(a), cy - r * math.sin(a)
    line("o", cx, cy, px, py)
    y = cy
    while y > py:                                              # sin θ, dashed
        line("f", px, y, px, max(y - 2.5, py))
        y -= 4.5
    paths["f"].append(f"M{f(cx + 8)} {f(cy)}A8 8 0 0 0 {f(cx + 8 * math.cos(a))} {f(cy - 8 * math.sin(a))}")
    text(cx + 11, cy - 3, "θ", 8)
    text(cx + 34, cy + 5, "e<tspan font-size='9' dy='-7'>iθ</tspan><tspan dy='7'> = cos θ + i sin θ</tspan>", 14)


# ---------------------------------------------------------------- floor
def books():
    y = GROUND
    for x0, x1, hgt in ((402, 474, 11), (408, 468, 9), (398, 462, 12)):
        rect("o", x0, y - hgt, x1, y)
        line("f", x0 + 3, y - hgt, x0 + 3, y)                  # spine band
        line("h", x0 + 5, y - hgt + 2.2, x1 - 18, y - hgt + 2.2)
        y -= hgt
    # a pair of compasses lying on top
    line("o", 404, y - 1, 452, y - 6)
    line("o", 404, y - 1, 450, y + 0.5)
    paths["o"].append(f"M404 {f(y - 1)}m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0")


def ground():
    paths["g"] = [f"M0 {GROUND}H{W}"]
    for _ in range(40):
        y = GROUND + 4 + rng.random() * 16
        x = rng.uniform(0, W)
        ln = rng.uniform(6, 24) * (1 - (y - GROUND) / 26)
        line("f", x, y, x + ln, y)


def stars():
    for x, y, k in ((40, 30, 3), (455, 40, 2.4), (20, 200, 2.2), (462, 210, 2.6)):
        line("f", x - k, y, x + k, y)
        line("f", x, y - k, x, y + k)


def main():
    ground()
    easel()
    behind = {k: paths[k][:] for k in ("o", "h", "f")}       # the easel goes behind the board
    for k in behind:
        paths[k].clear()
    board()
    fourier()
    gauss()
    normal_law()
    euler()
    books()
    stars()
    style = {"o": 'stroke-width="1.15"', "h": 'stroke-width=".6" stroke-opacity=".8"',
             "f": 'stroke-width=".5" stroke-opacity=".6"'}
    body = "".join(f'<path {style[k]} d="{"".join(paths[k])}"/>' for k in ("f", "h", "o"))
    easel_svg = "".join(f'<path {style[k]} d="{"".join(behind[k])}"/>' for k in ("f", "h", "o"))
    clip = (f'<clipPath id="eb"><path clip-rule="evenodd" d="M0 0H{W}V{H}H0Z'
            f'M{BX0} {BY0}H{BX1}V{BY1 + 8}H{BX0}Z"/></clipPath>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
           f'<defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" x2="{W}">'
           f'<stop offset="0" stop-opacity="0"/><stop offset=".12"/><stop offset=".88"/>'
           f'<stop offset="1" stop-opacity="0"/></linearGradient>{clip}</defs>'
           f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">'
           f'<path stroke="url(#fade)" stroke-width="1.15" d="{paths["g"][0]}"/>'
           f'<g clip-path="url(#eb)">{easel_svg}</g>{body}</g>'
           f'<g fill="#000" font-family="{SERIF}">{"".join(texts)}</g></svg>\n')
    OUT.write_text(svg, encoding="utf-8")
    print(f"{OUT.name}: {len(svg) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
