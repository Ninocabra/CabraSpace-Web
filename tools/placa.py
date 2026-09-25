"""
Carte du Ciel plate for the CabraSpace Web header, drawn as an Atlas plate.

The glass photographic plate of the international Carte du Ciel (Paris, 1887): a printed réseau
grid, the stars of the zone, the brightest ones as the survey's triple exposure (three images in a
small triangle, to tell a star from a flaw in the emulsion), in its wooden holder, with the
measuring loupe on top magnifying one corner. Same "white-line" engraving as the other plates,
with heavier strokes because the CabraSpace Web header is a compact band and the drawing is small.

The SVG is monochrome black on transparent and is used as a CSS mask (atlas/tools.css), so the page
paints it with var(--gold) and night mode turns it red by itself.

    python tools/placa.py   ->   atlas/img/placa.svg
"""
import math
import random
from pathlib import Path

W, H = 480, 420
OUT = Path(__file__).resolve().parent.parent / "atlas" / "img" / "placa.svg"

# wooden holder, glass, réseau, loupe
HX0, HY0, HX1, HY1 = 40, 20, 440, 404
GX0, GY0, GX1, GY1 = 74, 50, 406, 374
CELLS = 8
LX, LY, LR, ZOOM = 318, 282, 66, 2.0

rng = random.Random(1887)
SW = {"o": 2.2, "h": 1.2, "f": 0.95}


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


class Layer:
    def __init__(self):
        self.p = {"o": [], "h": [], "f": []}
        self.dots = []

    def line(self, key, x1, y1, x2, y2):
        self.p[key].append(f"M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}")

    def rect(self, key, x0, y0, x1, y1):
        self.p[key].append(f"M{f(x0)} {f(y0)}H{f(x1)}V{f(y1)}H{f(x0)}Z")

    def circle(self, key, cx, cy, r):
        self.p[key].append(f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0")

    def dot(self, cx, cy, r):
        self.dots.append(f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0")

    def svg(self, scale=1.0):
        out = []
        for k in ("f", "h", "o"):
            if self.p[k]:
                op = {"o": "", "h": ' stroke-opacity=".85"', "f": ' stroke-opacity=".6"'}[k]
                out.append(f'<path stroke-width="{f(SW[k] / scale)}"{op} d="{"".join(self.p[k])}"/>')
        if self.dots:
            out.append(f'<path fill="#000" stroke="none" d="{"".join(self.dots)}"/>')
        return "".join(out)


def holder(L):
    L.rect("o", HX0, HY0, HX1, HY1)
    L.rect("o", GX0 - 6, GY0 - 6, GX1 + 6, GY1 + 6)
    # grain on the lit (top and left) members
    for k in range(3):
        y = HY0 + 6 + k * 7
        x = HX0 + 10
        while x < HX1 - 16:
            ln = rng.uniform(40, 110)
            L.line("h", x, y, min(x + ln, HX1 - 16), y)
            x += ln + rng.uniform(10, 26)
        xg = HX0 + 6 + k * 7
        yg = HY0 + 30
        while yg < HY1 - 16:
            ln = rng.uniform(40, 100)
            L.line("h", xg, yg, xg, min(yg + ln, HY1 - 16))
            yg += ln + rng.uniform(10, 26)
    for x, y in ((HX0 + 14, HY0 + 14), (HX1 - 14, HY0 + 14), (HX0 + 14, HY1 - 14), (HX1 - 14, HY1 - 14)):
        L.circle("o", x, y, 5)
        L.line("f", x - 3.5, y, x + 3.5, y)


def plate(L):
    L.rect("o", GX0, GY0, GX1, GY1)
    cw = (GX1 - GX0) / CELLS
    ch = (GY1 - GY0) / CELLS
    for i in range(1, CELLS):
        L.line("f", GX0 + i * cw, GY0, GX0 + i * cw, GY1)
        L.line("f", GX0, GY0 + i * ch, GX1, GY0 + i * ch)
    # stars: many faint, a few bright ones as triple exposures
    for _ in range(95):
        x, y = rng.uniform(GX0 + 4, GX1 - 4), rng.uniform(GY0 + 4, GY1 - 4)
        m = rng.random() ** 3
        L.dot(x, y, 1.1 + 2.6 * m)
    for _ in range(9):
        x, y = rng.uniform(GX0 + 16, GX1 - 16), rng.uniform(GY0 + 16, GY1 - 16)
        r = rng.uniform(2.6, 4.2)
        for a in (90, 210, 330):
            L.dot(x + 6.5 * math.cos(math.radians(a)), y - 6.5 * math.sin(math.radians(a)), r)
    # a triple star right under the loupe, so the magnification shows the trick
    for a in (90, 210, 330):
        L.dot(LX - 8 + 6.5 * math.cos(math.radians(a)), LY + 6 - 6.5 * math.sin(math.radians(a)), 2.4)


def loupe(L):
    L.circle("o", LX, LY, LR)
    L.circle("o", LX, LY, LR + 7)
    L.p["h"].append(f"M{f(LX - LR - 3.5)} {f(LY)}A{f(LR + 3.5)} {f(LR + 3.5)} 0 0 1 {f(LX)} {f(LY - LR - 3.5)}")
    # handle towards the lower right
    a = math.radians(-42)
    ux, uy = math.cos(a), -math.sin(a)
    px, py = -uy, ux
    s0, s1 = LR + 7, LR + 70
    for off in (-7, 7):
        L.line("o", LX + ux * s0 + px * off * 0.8, LY + uy * s0 + py * off * 0.8,
               LX + ux * s1 + px * off, LY + uy * s1 + py * off)
    L.line("o", LX + ux * s1 + px * -7, LY + uy * s1 + py * -7, LX + ux * s1 + px * 7, LY + uy * s1 + py * 7)
    L.line("h", LX + ux * (s0 + 6) + px * -3.5, LY + uy * (s0 + 6) + py * -3.5,
           LX + ux * (s1 - 4) + px * -3.5, LY + uy * (s1 - 4) + py * -3.5)
    # glint on the glass
    L.p["h"].append(f"M{f(LX - 38)} {f(LY - 22)}A44 44 0 0 1 {f(LX - 16)} {f(LY - 42)}")


def main():
    base = Layer()
    holder(base)
    glass = Layer()
    plate(glass)
    top = Layer()
    loupe(top)
    lens = f"M{f(LX - LR)} {f(LY)}a{LR} {LR} 0 1 0 {2 * LR} 0a{LR} {LR} 0 1 0 {-2 * LR} 0Z"
    zoom = f"translate({f(LX)} {f(LY)}) scale({ZOOM}) translate({f(-LX)} {f(-LY)})"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
           f'<defs><clipPath id="out"><path clip-rule="evenodd" d="M0 0H{W}V{H}H0Z{lens}"/></clipPath>'
           f'<clipPath id="in"><path d="{lens}"/></clipPath>'
           f'<clipPath id="gl"><path d="M{GX0} {GY0}H{GX1}V{GY1}H{GX0}Z"/></clipPath></defs>'
           f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">'
           f'<g clip-path="url(#out)">{base.svg()}{glass.svg()}</g>'
           f'<g clip-path="url(#in)"><g transform="{zoom}"><g clip-path="url(#gl)">{glass.svg(ZOOM)}</g></g></g>'
           f'{top.svg()}</g></svg>\n')
    OUT.write_text(svg, encoding="utf-8")
    print(f"{OUT.name}: {len(svg) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
