"""
Frieze III of P5, "El archivo": two tiers of an archive bookcase seen in elevation, 1920 x 232.

Six bays. Runs of books and of numbered log volumes (the numerals are cut in strokes, no font), a
card index, a pile of rolled charts seen end-on, boxes of plates with their labels, a celestial
globe, an armillary sphere, an hourglass and a tied bundle of papers. The back of the case is
ruled faintly where nothing stands in front of it.

    python p5/archivo.py   ->   p5/archivo.svg
"""
import math
import os
from pathlib import Path

from grabado import Plate, f

W, H = 1920, 232
T0, S1, S2 = 14, 96, 184               # underside of the top board, upper shelf, lower shelf
OUT = Path(os.environ.get("ATLAS_IMG_OUT") or Path(__file__).resolve().parents[3] / "atlas" / "img") / "archivo.svg"   # salida: atlas/img/ (o $ATLAS_IMG_OUT para probar)
P = Plate(W, H, 1802, {"w": 'stroke-width=".5" stroke-opacity=".2"'})
rng = P.rng
BAYS = [60 + 300 * k for k in range(7)]


def poly_sil(key, pts):
    P.poly(key, pts, close=True)
    P.sil(pts)


def numeral(n, cx, cy, hgt=6.5):
    """Roman numeral cut in plain strokes, centred on (cx, cy)."""
    s = ""
    for v, g in ((10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= v:
            s += g
            n -= v
    wd = {"I": 1.0, "V": 3.6, "X": 3.6}
    total = sum(wd[c] for c in s) + 1.5 * (len(s) - 1)
    x = cx - total / 2
    for c in s:
        if c == "I":
            P.line("h", x + 0.5, cy - hgt / 2, x + 0.5, cy + hgt / 2)
        elif c == "V":
            P.poly("h", [(x, cy - hgt / 2), (x + 1.8, cy + hgt / 2), (x + 3.6, cy - hgt / 2)])
        else:
            P.line("h", x, cy - hgt / 2, x + 3.6, cy + hgt / 2)
            P.line("h", x + 3.6, cy - hgt / 2, x, cy + hgt / 2)
        x += wd[c] + 1.5


# ------------------------------------------------------------------ the case
def case():
    # faint ruling of the back panel
    for top, bot in ((T0, S1), (S1 + 6, S2)):
        y = top + 4.0
        while y < bot - 2:
            P.dashes("w", BAYS[0] + 8, BAYS[-1], y, 30, 150, 6, 40)
            y += 4.2
    P.layer()
    P.box("o", BAYS[0] - 14, T0 - 7, BAYS[-1] + 22, T0)                 # top board
    P.line("h", BAYS[0] - 12, T0 - 4.6, BAYS[-1] + 20, T0 - 4.6)
    P.line("f", BAYS[0] - 12, T0 - 2.2, BAYS[-1] + 20, T0 - 2.2)
    for y in (S1, S2):
        P.box("o", BAYS[0], y, BAYS[-1] + 8, y + 6)
        P.dashes("h", BAYS[0] + 4, BAYS[-1] + 4, y + 2, 40, 180, 6, 30)
        P.dashes("f", BAYS[0] + 4, BAYS[-1] + 4, y + 4.1, 20, 90, 12, 60)
    for x in BAYS:                                                      # uprights
        P.box("o", x, T0, x + 8, S2 + 6)
        P.line("h", x + 1.8, T0 + 2, x + 1.8, S2 + 4)
        P.line("f", x + 3.6, T0 + 2, x + 3.6, S2 + 4)
    # plinth with sunk panels
    P.box("o", BAYS[0] - 8, S2 + 6, BAYS[-1] + 16, H)
    P.line("o", BAYS[0] - 8, S2 + 10, BAYS[-1] + 16, S2 + 10)
    for a, b in zip(BAYS, BAYS[1:]):
        P.rect("h", a + 20, S2 + 15, b - 12, H + 4)
        P.rect("f", a + 23, S2 + 18, b - 15, H + 4)


# ------------------------------------------------------------------ contents
def book(x, base, w, hh):
    P.box("o", x, base - hh, x + w, base)
    P.line("h", x + 1.5, base - hh + 1.5, x + 1.5, base - 1.5)
    if w > 9:
        P.line("f", x + 3.1, base - hh + 1.5, x + 3.1, base - 1.5)
    style = rng.random()
    if style < 0.4:                                                     # raised bands
        nb = rng.choice((3, 4, 5))
        for k in range(1, nb + 1):
            yy = base - hh * k / (nb + 1)
            P.line("o", x, yy, x + w, yy)
            P.line("f", x, yy + 1.5, x + w, yy + 1.5)
    elif style < 0.75:                                                  # label and two fillets
        ly = base - hh * rng.uniform(0.62, 0.74)
        P.rect("h", x + 1.8, ly - 5, x + w - 1.8, ly + 5)
        if w > 8:
            P.line("f", x + 3.4, ly - 1.6, x + w - 3.4, ly - 1.6)
            P.line("f", x + 3.4, ly + 1.4, x + w - 4.4, ly + 1.4)
        for yy in (base - hh + 4, base - 5):
            P.line("h", x, yy, x + w, yy)
    else:                                                               # plain cloth, a fillet top and bottom
        for yy in (base - hh + 3.4, base - hh + 5.4, base - 4.4):
            P.line("f", x, yy, x + w, yy)
        if w > 10:
            P.circle("f", x + w / 2, base - hh * 0.5, 1.6)


def leaning(x, base, w, hh, deg):
    """A book fallen against the run to its west: it stands on its west corner, x is where it touches."""
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    x = x + hh * sa

    def at(u, v):
        return x + u * ca - v * sa, base - u * sa - v * ca

    poly_sil("o", [at(0, 0), at(w, 0), at(w, hh), at(0, hh)])

    P.line("h", *at(1.5, 1.5), *at(1.5, hh - 1.5))
    for v in (hh * 0.25, hh * 0.5, hh * 0.75):
        P.line("o", *at(0, v), *at(w, v))


def lying(x, base, widths):
    """Books lying flat, fore-edges to the east."""
    y = base
    for w, t in widths:
        xo = x + rng.uniform(0, 5)
        P.add("o", f"M{f(xo + w)} {f(y - t)}H{f(xo + 2.5)}Q{f(xo - 1.2)} {f(y - t / 2)} {f(xo + 2.5)} {f(y)}H{f(xo + w)}")
        P.sil_rect(xo, y - t, xo + w, y)
        P.line("o", xo + w - 1.4, y - t + 1.2, xo + w - 1.4, y - 1.2)
        yy = y - t + 2.4
        while yy < y - 1.4:
            P.line("f", xo + w * 0.5, yy, xo + w - 1.6, yy)
            yy += 1.7
        P.line("h", xo + 3.5, y - t + 1.5, xo + w * 0.45, y - t + 1.5)
        for k in (0.14, 0.34):
            P.line("o", xo + 2 + w * k, y - t, xo + 2 + w * k, y)
        y -= t
    return y


def run(x0, x1, base, hmax, lean_end=True):
    x = x0
    while x < x1 - 8:
        w = rng.uniform(7, 16)
        if x + w > x1:
            break
        book(x, base, w, hmax * rng.uniform(0.66, 0.97))
        x += w
    if lean_end:
        leaning(x + 0.8, base, rng.uniform(9, 12), hmax * 0.8, 13)
    return x


def volumes(x0, base, n, first, w=18.5, hh=72):
    """A run of identical log volumes, numbered on the spine."""
    for i in range(n):
        x = x0 + i * w
        P.box("o", x, base - hh, x + w, base)
        P.line("h", x + 1.5, base - hh + 1.5, x + 1.5, base - 1.5)
        P.line("f", x + 3.1, base - hh + 1.5, x + 3.1, base - 1.5)
        for yy in (base - hh + 5, base - hh + 7, base - 6, base - 8, base - hh * 0.44, base - hh * 0.44 + 2):
            P.line("f" if yy != base - hh + 5 and yy != base - 6 else "h", x, yy, x + w, yy)
        P.rect("h", x + 2.2, base - hh + 13, x + w - 2.2, base - hh + 27)
        numeral(first + i, x + w / 2, base - hh + 20)
        P.circle("f", x + w / 2, base - 18, 2.4)
        P.circle("f", x + w / 2, base - 18, 0.7)
    return x0 + n * w


def card_index(x0, base, cols, rows, dw=56, dh=22):
    P.box("o", x0 - 4, base - rows * dh - 8, x0 + cols * dw + 4, base)
    P.line("h", x0 - 2.4, base - rows * dh - 6, x0 - 2.4, base - 1.5)
    for r in range(rows):
        for c in range(cols):
            x, y = x0 + c * dw, base - 4 - (r + 1) * dh
            P.rect("o", x + 2, y + 2, x + dw - 2, y + dh - 2)
            P.line("h", x + 3.6, y + 3.6, x + 3.6, y + dh - 3.6)
            P.rect("h", x + dw / 2 - 12, y + 4.4, x + dw / 2 + 12, y + 11.4)       # label holder
            P.line("f", x + dw / 2 - 8, y + 7.9, x + dw / 2 + 6, y + 7.9)
            P.arc("o", x + dw / 2, y + 14, 4.4, 180, 360, ry=3.2)                    # pull
            P.line("f", x + dw / 2 - 4.4, y + 14, x + dw / 2 + 4.4, y + 14)


def rolls(x0, base, n, r=9.2, rows=4):
    """Rolled charts piled end-on."""
    row, y = 0, base - r
    while row < rows:
        for i in range(n - row):
            cx = x0 + r + row * r + i * 2 * r
            P.circle("o", cx, y, r)
            P.sil_circle(cx, y, r)
            # the turns of the paper
            pts = []
            for k in range(0, 46):
                a = k * 0.32 + cx * 0.3
                rr = r * (0.82 - 0.56 * k / 45)
                pts.append((cx + rr * math.cos(a), y + rr * math.sin(a)))
            P.poly("f", pts)
            P.arc("h", cx, y, r - 1.8, 110, 215)
        row += 1
        y -= r * math.sqrt(3)
    return x0 + n * 2 * r


def plate_boxes(x0, base, n, w=74, hh=11.5):
    y = base
    for k in range(n):
        xo = x0 + (2.5 if k % 2 else 0) + rng.uniform(-1, 1)
        P.box("o", xo, y - hh, xo + w, y)
        P.line("f", xo, y - hh + 3.4, xo + w, y - hh + 3.4)
        P.rect("h", xo + w / 2 - 15, y - hh + 4.6, xo + w / 2 + 15, y - 1.6)
        P.line("f", xo + w / 2 - 11, y - hh / 2 + 1.5, xo + w / 2 + 9, y - hh / 2 + 1.5)
        P.line("h", xo + 1.5, y - hh + 1.5, xo + 1.5, y - 1.3)
        y -= hh


def globe(cx, base, r=25):
    cy = base - 24 - r + 4
    # stand
    poly_sil("o", [(cx - 19, base), (cx - 16, base - 4), (cx - 5, base - 7), (cx + 5, base - 7), (cx + 16, base - 4), (cx + 19, base)])
    poly_sil("o", [(cx - 2.6, base - 7), (cx + 2.6, base - 7), (cx + 2, base - 15), (cx + 5, base - 18), (cx + 5, base - 20), (cx - 5, base - 20),
                   (cx - 5, base - 18), (cx - 2, base - 15)])
    P.line("h", cx - 14, base - 3.4, cx - 2, base - 6)
    P.layer()
    # meridian ring and sphere
    P.circle("o", cx, cy, r + 3.4)
    P.sil_circle(cx, cy, r + 3.4)
    P.circle("o", cx, cy, r)
    tilt = math.radians(23.5)
    ct, st = math.cos(tilt), math.sin(tilt)

    def proj(lon, lat):
        x = r * math.cos(lat) * math.sin(lon)
        y = r * math.sin(lat)
        return cx + x * ct + y * st, cy - (y * ct - x * st)

    for lon in range(-75, 90, 25):
        P.poly("f", [proj(math.radians(lon), math.radians(la)) for la in range(-90, 91, 6)])
    for la in (-60, -30, 30, 60):
        P.poly("f", [proj(math.radians(lo), math.radians(la)) for lo in range(-90, 91, 6)])
    P.poly("h", [proj(math.radians(lo), 0) for lo in range(-90, 91, 6)])
    # a few constellation figures: dots joined by strokes
    for stars in (((-50, 35), (-38, 44), (-24, 38), (-30, 24)), ((10, -20), (24, -12), (36, -26), (22, -38)), ((30, 40), (44, 30), (52, 46))):
        pts = [proj(math.radians(lo), math.radians(la)) for lo, la in stars]
        P.poly("h", pts)
        for px, py in pts:
            P.circle("o", px, py, 0.8)
    P.arc("h", cx, cy, r - 2, 115, 225)
    P.arc("f", cx, cy, r - 4.4, 125, 210)
    for a in range(0, 360, 10):                                         # graduations of the ring
        aa = math.radians(a)
        P.line("f", cx + (r + 1.2) * math.cos(aa), cy + (r + 1.2) * math.sin(aa), cx + (r + 3.4) * math.cos(aa), cy + (r + 3.4) * math.sin(aa))
    for s in (1, -1):                                                   # poles
        px, py = cx + s * (r + 3.4) * st, cy - s * (r + 3.4) * ct
        P.circle("o", px, py, 1.7)
    P.layer()
    P.box("o", cx - r - 9, cy - 2, cx + r + 9, cy + 2)                   # horizon ring, edge-on
    P.line("f", cx - r - 7, cy, cx + r + 7, cy)
    for s in (-1, 1):
        P.add("o", f"M{f(cx + s * (r + 7))} {f(cy + 2)}Q{f(cx + s * (r + 6))} {f(base - 24)} {f(cx + s * 5)} {f(base - 19)}")


def armillary(cx, base, r=27):
    cy = base - 22 - r
    poly_sil("o", [(cx - 17, base), (cx - 14, base - 4), (cx - 4, base - 6.5), (cx + 4, base - 6.5), (cx + 14, base - 4), (cx + 17, base)])
    poly_sil("o", [(cx - 2.4, base - 6.5), (cx + 2.4, base - 6.5), (cx + 1.6, base - 16), (cx + 4.4, base - 19), (cx - 4.4, base - 19),
                   (cx - 1.6, base - 16)])
    P.add("o", f"M{f(cx - 4.4)} {f(base - 19)}Q{f(cx - r * 0.7)} {f(base - 19)} {f(cx - r * 0.72)} {f(cy + r * 0.7)}")
    P.add("o", f"M{f(cx + 4.4)} {f(base - 19)}Q{f(cx + r * 0.7)} {f(base - 19)} {f(cx + r * 0.72)} {f(cy + r * 0.7)}")
    P.circle("o", cx, cy, r)                                            # meridian
    P.circle("o", cx, cy, r - 2.6)
    tilt = math.radians(32)
    ct, st = math.cos(tilt), math.sin(tilt)

    def ring(lat, squash, key, double=0.0):
        rr = (r - 2.6) * math.cos(math.radians(lat))
        yy = (r - 2.6) * math.sin(math.radians(lat))
        for off in ((0.0,) if not double else (-double, double)):
            pts = []
            for a in range(0, 361, 8):
                x = rr * math.cos(math.radians(a))
                y = yy + off + rr * squash * math.sin(math.radians(a))
                pts.append((cx + x * ct + y * st, cy - (y * ct - x * st)))
            P.poly(key, pts)

    ring(0, 0.24, "o", 1.3)                                             # equator
    ring(23.5, 0.24, "h")
    ring(-23.5, 0.24, "h")
    ring(62, 0.24, "f")
    ring(-62, 0.24, "f")
    # ecliptic band, tilted against the equator
    for off in (-1.4, 1.4):
        pts = []
        for a in range(0, 361, 8):
            x = (r - 2.6) * math.cos(math.radians(a))
            y = off + (r - 2.6) * 0.24 * math.sin(math.radians(a)) + x * math.tan(math.radians(-23.5)) * 0.9
            k = (r - 2.6) / max(math.hypot(x, y), r - 2.6)
            pts.append((cx + (x * ct + y * st) * k, cy - (y * ct - x * st) * k))
        P.poly("h", pts)
    P.line("o", cx - (r + 5) * st, cy + (r + 5) * ct, cx + (r + 5) * st, cy - (r + 5) * ct)     # axis
    for s in (-1, 1):
        P.circle("o", cx + s * (r + 6.4) * st, cy - s * (r + 6.4) * ct, 1.6)
    P.circle("o", cx, cy, 3.4)
    P.arc("f", cx, cy, 2, 110, 230)
    for a in range(0, 360, 15):
        aa = math.radians(a)
        P.line("f", cx + (r - 2.6) * math.cos(aa), cy + (r - 2.6) * math.sin(aa), cx + r * math.cos(aa), cy + r * math.sin(aa))


def hourglass(cx, base, w=17, hh=38):
    for y in (base - 3, base - hh):
        P.box("o", cx - w / 2 - 2, y, cx + w / 2 + 2, y + 3)
    for x in (cx - w / 2, cx + w / 2):
        P.line("o", x, base - hh + 3, x, base - 3)
    m = base - hh / 2
    d = (f"M{f(cx - w / 2 + 2.4)} {f(base - hh + 3)}Q{f(cx - w / 2 + 2)} {f(m - 6)} {f(cx - 1)} {f(m)}"
         f"Q{f(cx - w / 2 + 2)} {f(m + 6)} {f(cx - w / 2 + 2.4)} {f(base - 3)}H{f(cx + w / 2 - 2.4)}"
         f"Q{f(cx + w / 2 - 2)} {f(m + 6)} {f(cx + 1)} {f(m)}Q{f(cx + w / 2 - 2)} {f(m - 6)} {f(cx + w / 2 - 2.4)} {f(base - hh + 3)}Z")
    P.add("o", d)
    P.cur["sil"].append((d, False))
    P.add("h", f"M{f(cx - 4.4)} {f(base - 3)}Q{f(cx)} {f(base - 11)} {f(cx + 4.4)} {f(base - 3)}")      # sand below
    P.line("f", cx, m + 1, cx, base - 9)
    P.line("f", cx - 3.2, m - 7, cx + 3.2, m - 7)                                                    # and above
    P.line("f", cx - 4.2, base - hh + 5.6, cx - 4.6, m - 8)


def bundle(x0, base, w=62, hh=24):
    P.box("o", x0, base - hh, x0 + w, base)
    y = base - hh + 2.2
    while y < base - 1:
        P.dashes("f", x0 + 1, x0 + w - 1, y, 14, 40, 1, 5)
        y += 2.2
    P.line("o", x0 + w * 0.36, base - hh, x0 + w * 0.36, base)
    P.line("o", x0, base - hh * 0.5, x0 + w, base - hh * 0.5)
    P.add("o", f"M{f(x0 + w * 0.36)} {f(base - hh)}q-7 -7 -10 -1q3 3 10 1q7 -7 10 -1q-3 3 -10 1")


def main():
    case()
    b = BAYS
    # ---- upper tier
    P.layer()
    x = run(b[0] + 12, b[0] + 190, S1, 70)
    lying(b[0] + 216, S1, ((70, 9), (64, 8), (58, 10)))
    P.layer()
    rolls(b[1] + 18, S1, 9)
    run(b[1] + 196, b[1] + 286, S1, 62, lean_end=False)
    P.layer()
    run(b[2] + 12, b[2] + 150, S1, 72)
    hourglass(b[2] + 206, S1)
    run(b[2] + 236, b[2] + 296, S1, 56, lean_end=False)
    P.layer()
    armillary(b[3] + 62, S1, r=26)
    P.layer()
    run(b[3] + 118, b[3] + 270, S1, 68)
    P.layer()
    card_index(b[4] + 18, S1, 4, 3, dw=58, dh=22)
    P.layer()
    run(b[4] + 262, b[4] + 296, S1, 60, lean_end=False)
    run(b[5] + 12, b[5] + 120, S1, 70)
    top = lying(b[5] + 168, S1, ((76, 10), (70, 9)))
    bundle(b[5] + 176, top, 58, 20)
    # ---- lower tier
    P.layer()
    card_index(b[0] + 18, S2, 4, 3, dw=58, dh=22)
    P.layer()
    run(b[0] + 262, b[0] + 296, S2, 62, lean_end=False)
    run(b[1] + 12, b[1] + 130, S2, 72)
    P.layer()
    globe(b[1] + 208, S2, r=24)
    P.layer()
    run(b[1] + 254, b[1] + 296, S2, 58, lean_end=False)
    plate_boxes(b[2] + 16, S2, 6)
    run(b[2] + 110, b[2] + 250, S2, 70)
    P.layer()
    volumes(b[3] + 12, S2, 12, 1)
    lying(b[3] + 240, S2, ((52, 9), (48, 8)))
    P.layer()
    rolls(b[4] + 14, S2, 7)
    run(b[4] + 152, b[4] + 262, S2, 70)
    P.layer()
    run(b[5] + 12, b[5] + 96, S2, 66, lean_end=False)
    plate_boxes(b[5] + 108, S2, 5, w=70)
    hourglass(b[5] + 206, S2, w=15, hh=32)
    run(b[5] + 232, b[5] + 296, S2, 60, lean_end=False)
    P.write(OUT, fade_x=58, fade_top=0, fade_bottom=24)


if __name__ == "__main__":
    main()
