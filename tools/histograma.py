"""
Histogram plate for the AutoGHS header, drawn as a nineteenth-century statistical chart.

The histogram of an unstretched astro frame: a sharp peak just above black (the sky background)
and a long faint tail (the object and the stars). The vertical line is GHS's symmetry point (SP),
set on the peak, where the stretch concentrates its contrast. Double-ruled frame, graduated axes
with fractions, bars engraved with vertical strokes; same "white-line" engraving as
tools/observatorio.py and tools/pizarra.py.

The SVG is monochrome black on transparent and is used as a CSS mask (atlas/tools.css), so the page
paints it with var(--gold) and night mode turns it red by itself.

    python tools/histograma.py   ->   atlas/img/histograma.svg
"""
import math
from pathlib import Path

W, H = 480, 420
OUT = Path(__file__).resolve().parent.parent / "atlas" / "img" / "histograma.svg"
SERIF = "'Times New Roman', Times, 'Nimbus Roman', serif"

# frame and plot area
FX0, FY0, FX1, FY1 = 22, 36, 458, 404
PX0, PX1, PY0, PYB = 74, 436, 78, 356
BINS = 44
PEAK = 0.13                    # sky background, as a fraction of the range

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


def text(x, y, s, size=13, italic=True, anchor="middle"):
    style = ' font-style="italic"' if italic else ""
    texts.append(f'<text x="{f(x)}" y="{f(y)}" font-size="{size}"{style} text-anchor="{anchor}">{s}</text>')


def density(t):
    """Unstretched frame: log-normal sky peak plus a long tail."""
    sky = math.exp(-(math.log(t + 0.015) - math.log(PEAK)) ** 2 / (2 * 0.33 ** 2))
    tail = 0.07 * math.exp(-t / 0.3)
    return sky + tail


def frame():
    rect("o", FX0, FY0, FX1, FY1)
    rect("o", FX0 + 6, FY0 + 6, FX1 - 6, FY1 - 6)
    for x, y in ((FX0 + 3, FY0 + 3), (FX1 - 3, FY0 + 3), (FX0 + 3, FY1 - 3), (FX1 - 3, FY1 - 3)):
        poly("o", [(x, y - 3), (x + 3, y), (x, y + 3), (x - 3, y)], close=True)
    # lit top and left rules of the frame
    line("h", FX0 + 2.5, FY0 + 9, FX0 + 2.5, FY1 - 9)
    line("h", FX0 + 9, FY0 + 2.5, FX1 - 9, FY0 + 2.5)


def axes():
    line("o", PX0, PYB, PX1 + 8, PYB)
    line("o", PX0, PYB, PX0, PY0 - 8)
    poly("o", [(PX1 + 3, PYB - 3), (PX1 + 8, PYB), (PX1 + 3, PYB + 3)])
    poly("o", [(PX0 - 3, PY0 - 3), (PX0, PY0 - 8), (PX0 + 3, PY0 - 3)])
    for k, lab in enumerate(("0", "¼", "½", "¾", "1")):
        x = PX0 + (PX1 - PX0) * k / 4
        line("o", x, PYB, x, PYB + 6)
        text(x, PYB + 21, lab, 14)
    for k in range(1, 20):
        x = PX0 + (PX1 - PX0) * k / 20
        if k % 5:
            line("f", x, PYB, x, PYB + 3)
    for k in range(1, 6):
        y = PYB - (PYB - PY0) * k / 5
        line("o", PX0 - 5, y, PX0, y)
    # dotted graticule, very light
    for k in range(1, 5):
        y = PYB - (PYB - PY0) * k / 5
        x = PX0 + 4
        while x < PX1:
            line("f", x, y, x + 1.2, y)
            x += 7


def histogram():
    bw = (PX1 - PX0) / BINS
    vals = [density((i + 0.5) / BINS) for i in range(BINS)]
    top = max(vals)
    hs = [(PYB - PY0 - 12) * v / top for v in vals]
    # stepped outline
    pts = [(PX0, PYB)]
    for i, h in enumerate(hs):
        pts += [(PX0 + i * bw, PYB - h), (PX0 + (i + 1) * bw, PYB - h)]
    pts.append((PX1, PYB))
    poly("o", pts)
    # bar separators and engraved strokes: lit left half of each bar
    for i, h in enumerate(hs):
        x0 = PX0 + i * bw
        if h > 1.5:
            line("f", x0, PYB, x0, PYB - min(h, hs[i - 1] if i else h))
        x = x0 + 1.3
        while x < x0 + bw * 0.62:
            line("h", x, PYB - 0.8, x, PYB - h + 1.2)
            x += 1.7
    # the smooth law the bars follow, dotted
    t = 0.004
    while t < 1:
        x = PX0 + (PX1 - PX0) * t
        y = PYB - (PYB - PY0 - 12) * density(t) / top - 5
        paths["f"].append(f"M{f(x)} {f(y)}m-.6 0h1.2")
        t += 0.011
    return hs


def symmetry_point(hs):
    # on the peak of the histogram
    i = max(range(len(hs)), key=hs.__getitem__)
    x = PX0 + (i + 0.5) * (PX1 - PX0) / BINS
    line("o", x, PYB + 10, x, PY0 - 16)
    line("f", x + 2.2, PYB, x + 2.2, PY0 - 12)
    poly("o", [(x, PY0 - 26), (x + 4.5, PY0 - 20), (x, PY0 - 14), (x - 4.5, PY0 - 20)], close=True)
    line("h", x - 2.4, PY0 - 20, x, PY0 - 23)
    text(x + 11, PY0 - 16, "SP", 14, anchor="start")


def main():
    frame()
    axes()
    hs = histogram()
    symmetry_point(hs)
    style = {"o": 'stroke-width="1.15"', "h": 'stroke-width=".6" stroke-opacity=".8"',
             "f": 'stroke-width=".5" stroke-opacity=".6"'}
    body = "".join(f'<path {style[k]} d="{"".join(paths[k])}"/>' for k in ("f", "h", "o"))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
           f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">{body}</g>'
           f'<g fill="#000" font-family="{SERIF}">{"".join(texts)}</g></svg>\n')
    OUT.write_text(svg, encoding="utf-8")
    print(f"{OUT.name}: {len(svg) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
