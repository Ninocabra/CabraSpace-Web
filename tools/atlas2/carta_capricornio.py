"""
Carta del heroe de «Atlas II» (v2): fondo estatico + Capricornio animada, en UN solo marco.

    python tools/atlas2/carta_capricornio.py            escribe todo
    python tools/atlas2/carta_capricornio.py --check    solo comprueba el registro, no escribe

Escribe:

    atlas/img/carta-oro.svg         reticula, figuras, rotulos y nebulosas  (mascara, se pinta en oro)
    atlas/img/carta-estrellas.svg   las estrellas de fondo                    (mascara, se pinta en marfil)
    atlas/img/carta-ecliptica.svg   la ecliptica graduada                     (mascara, se pinta en bermellon)
    atlas/capricornus2.js     solo el bloque de datos entre  /* DATA-BEGIN */ y /* DATA-END */
    atlas/atlas2-muestra.html           solo el SVG entre <!-- CAP-SVG-BEGIN --> y <!-- CAP-SVG-END -->

De donde sale cada cosa (no hay numeros nuevos):
  - La carta es la de project/p2/atlas_celeste.py (propuesta 2): proyeccion estereografica, este a la
    izquierda, 15.5 px por grado, Bright Star Catalogue 5.a ed. (V < 5.6) y los Messier del sitio.
    Cambia el encuadre: el centro de proyeccion pasa a Capricornio (AR 315.5, Dec -19.5) y cae en el
    centro del marco, 2400 x 760. Se QUITAN del fondo las diez estrellas de la figura de Capricornio,
    sus lineas y sus letras griegas: las dibuja y las mueve js/capricornus.js.
  - El movimiento es el de Pagina Web/tools/capricornus.py: cada estrella va en linea recta en 3D desde
    su posicion, paralaje, movimiento propio y velocidad radial (SIMBAD, CDS, consultado 2026-09-24).
  - La figura animada usa la MISMA proyeccion y el mismo marco que el fondo (PROJ, mas abajo), asi que
    en «hoy» cada estrella cae donde el catalogo de la carta la tenia. `--check` lo mide.

Las tres capas y el SVG animado comparten viewBox (0 0 2400 760): apiladas en el mismo marco, registran.
"""
import csv
import json
import math
import os
import re
import sys
from pathlib import Path

import matplotlib
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
SITE = HERE.parents[1]                  # raiz del repo de la web
OUT_IMG = Path(os.environ.get("ATLAS_IMG_OUT") or SITE / "atlas" / "img")   # $ATLAS_IMG_OUT: para probar sin pisar nada
OUT_JS = Path(os.environ.get("ATLAS_JS_OUT") or SITE / "atlas" / "capricornus2.js")
OUT_HTML = Path(os.environ.get("ATLAS_HTML_OUT") or SITE / "atlas" / "atlas2-muestra.html")
DATA = HERE / "datos"
rad, sin, cos, tan, pi = math.radians, math.sin, math.cos, math.tan, math.pi
EPS = 23.4392911                       # obliquity of the ecliptic, J2000


def f(v):
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def pts_d(pts, close=False):
    return "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + ("Z" if close else "")


def circle_d(cx, cy, r):
    return f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0Z"


def roman(n):
    out = ""
    for v, s in ((10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= v:
            out += s
            n -= v
    return out


# ---------------------------------------------------------------- lettering as outlines
class Face:
    def __init__(self, filename):
        self.font = TTFont(Path(matplotlib.get_data_path()) / "fonts" / "ttf" / filename)
        self.gs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.upm = self.font["head"].unitsPerEm
        self.hmtx = self.font["hmtx"]

    def adv(self, c):
        if c == " ":
            return None, 0.17 * self.upm
        g = self.cmap[ord(c)]
        return g, self.hmtx[g][0]

    def width(self, s, size, spacing=0.0):
        return sum(self.adv(c)[1] for c in s) * size / self.upm + spacing * (len(s) - 1)

    def path(self, s, x, y, size, anchor="start", spacing=0.0, angle=0.0):
        sc = size / self.upm
        ca, sa = cos(rad(angle)), sin(rad(angle))
        w = self.width(s, size, spacing)
        pen = {"start": 0.0, "middle": -w / 2, "end": -w}[anchor]
        out = []
        for c in s:
            g, a = self.adv(c)
            if g:
                sp = SVGPathPen(self.gs, ntos=f)
                self.gs[g].draw(TransformPen(sp, (sc * ca, sc * sa, sc * sa, -sc * ca, x + pen * ca, y + pen * sa)))
                out.append(sp.getCommands())
            pen += a * sc + spacing
        return "".join(out)


ROMAN = Face("STIXGeneral.ttf")
ITALIC = Face("STIXGeneralItalic.ttf")


def svg_text(w, h, inner):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">{inner}</g></svg>\n')


# ================================================================ the frame (shared by chart and animation)
CH_W, CH_H = 2400, 760
CH_S = 15.5                            # pixels per degree at the centre (as in proposal 2)
CH_K = CH_S * 180 / pi
CH_CX, CH_CY = 1200.0, 380.0           # Capricornus sits at the centre of the frame
CH_RA0, CH_DE0 = 315.5, -19.5          # centre of projection: the one of the site's Capricornus chart
V_LIMIT = 5.6
PROJ = {"ra0": CH_RA0, "de0": CH_DE0, "k": round(CH_K, 4), "cx": CH_CX, "cy": CH_CY}
VIEW = (965, 226, 470, 312)            # window of the animated figure, frame px: stars fade at its edge

FIGURES = {   # Capricornus is NOT here: it is the animated layer
    "Aqr": ["eps mu bet alp gam zet eta", "zet pi", "alp the lam tau2 del", "lam phi psi1", "bet iot"],
    "Aql": ["gam alp bet the eta del zet eps", "alp del lam"],
    "Sgr": ["gam2 del eps gam2", "del lam phi del", "eps zet phi sig tau zet", "lam mu", "sig omi pi"],
    "Sct": ["alp bet del gam alp"],
    "PsA": ["alp eps lam the iot mu bet gam del alp"],
    "Psc": ["gam the iot lam kap gam", "iot ome"],
    "Ser": ["the eta omi xi"],
    "Oph": ["alp bet eta", "bet gam"],
}
NAMES = [
    # AQVARIVS sits just east of Capricornus (and south of the ecliptic, which would cross it) so the
    # hero's veil, which covers the text, does not cut it;
    # PISCIS AVSTRINVS is left out: wherever it fits, the veil or the caption of the chart crops it
    ("AQVARIVS", 333.4, -16.7), ("AQVILA", 291.0, 1.0), ("SAGITTARIVS", 285.5, -18.6),
    ("SCVTVM", 279.8, -5.4), ("PISCES", 349.6, 0.6),
    ("SERPENS", 277.0, 1.4), ("OPHIVCHVS", 265.5, -3.5),
]
STAR_NAMES = [   # constellation, designation, name, dx, dy
    ("PsA", "alp", "Fomalhaut", 11, 4), ("Sgr", "sig", "Nunki", 9, -6), ("Aqr", "bet", "Sadalsuud", 9, -6),
    ("Aqr", "alp", "Sadalmelik", 9, -6), ("Aqr", "del", "Skat", 9, 4),
]
MESSIER_LABELS = {"M 30", "M 2", "M 72", "M 75", "M 55", "M 22", "M 11", "M 17"}
# hour labels that must move off a figure line: RA of the meridian -> (deg west of it where the text ends, Dec)
# «XXI h» at the default place came 3.2 px from the Aquarius line mu-beta; here it clears it by 12.3 px,
# still above the -10 deg parallel and next to its meridian (measured with the segment distance, 2026-11-12)
HOUR_NUDGE = {315: (-0.5, -9.55)}

# ---- the animated figure: SIMBAD 2026-09-24, copied from Pagina Web/tools/capricornus.py
# name, RA deg, Dec deg, parallax mas, pmRA* mas/yr, pmDec mas/yr, RV km/s, V mag
CATALOGUE = [
    ("alf02", 304.5135649821425, -12.544852120195275, 29.914, 61.212, 2.412, 0.7, 3.58),
    ("bet01", 305.25277749238, -14.78140760208, 8.3966, 44.133, 0.36, -19.0, 3.08),
    ("del", 326.76018433125, -16.12728708527778, 84.27, 261.7, -296.7, -3.4, 2.83),
    ("eps", 324.27012965392, -19.466011222169442, 3.6777, 11.978, 0.497, -23.7, 4.55),
    ("gam", 325.0226892543413, -16.66237119824361, 19.1037, 200.193, -9.578, -31.2, 3.67),
    ("iot", 320.5616499287887, -16.834543892793892, 16.2048, 29.403, 4.909, 12.271, 4.27),
    ("ome", 312.95537723912, -26.91913484546, 5.8975, -9.016, -2.048, 9.1, 4.12),
    ("psi", 311.5238874801846, -25.27089819194861, 68.337, -52.557, -156.935, 27.53, 4.122),
    ("tet", 316.4867853131225, -17.232862837423333, 21.9049, 82.294, -61.654, -10.9, 4.07),
    ("zet", 321.66679439709753, -22.41132034516556, 7.3711, -3.867, 23.703, 2.1, 3.74),
]
LINES = [["alf02", "bet01"], ["bet01", "tet", "iot", "gam", "del"], ["bet01", "psi", "ome", "zet", "eps", "del"]]
BSC = {"alf02": "alp2", "bet01": "bet", "del": "del", "eps": "eps", "gam": "gam", "iot": "iot",
       "ome": "ome", "psi": "psi", "tet": "the", "zet": "zet"}          # SIMBAD name -> Bayer in the BSC
GREEK = {   # letter and its offset from the star, frame px (as proposal 2 placed them)
    "alf02": ("α", 10, -7), "bet01": ("β", 10, 9), "gam": ("γ", 2, -10), "del": ("δ", -17, -8),
    "eps": ("ε", -3, 17), "zet": ("ζ", -6, 19), "tet": ("θ", -3, -10), "iot": ("ι", -2, -9),
    "psi": ("ψ", 9, -4), "ome": ("ω", 9, 12),
}
K_PM = 4.740470446                 # km/s per (arcsec/yr · pc)
KMS_PCYR = 1.0227121650537077e-6   # pc/yr per km/s
MAX_AGE = 7.0e6                    # years: first hominins
GAP = 3.4                          # clear space between a star symbol and the line that reaches it


def load_stars():
    stars = []
    with open(DATA / "bsc5_v58.csv", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            n = r["name"].ljust(10)       # fixed columns: Flamsteed · Bayer · index · constellation
            stars.append({"hr": int(r["hr"]), "fl": n[0:3].strip(), "bay": n[3:6].strip().lower(),
                          "idx": n[6].strip(), "con": n[7:10].strip(),
                          "ra": float(r["ra"]), "de": float(r["dec"]), "v": float(r["vmag"])})
    return stars


def find_star(stars, con, spec):
    if spec.isdigit():
        c = [s for s in stars if s["con"] == con and s["fl"] == spec]
    else:
        b = spec.rstrip("0123456789")
        i = spec[len(b):]
        c = [s for s in stars if s["con"] == con and s["bay"] == b and (not i or s["idx"] == i)]
    if not c:
        raise SystemExit(f"unresolved star: {spec} {con}")
    return min(c, key=lambda s: s["v"])


def ch_xy(ra, de):
    a, d, d0 = rad(ra - CH_RA0), rad(de), rad(CH_DE0)
    cc = sin(d0) * sin(d) + cos(d0) * cos(d) * cos(a)
    if cc < -0.2:
        return None
    k = 2 / (1 + cc)
    return (CH_CX - CH_K * k * cos(d) * sin(a),
            CH_CY - CH_K * k * (cos(d0) * sin(d) - sin(d0) * cos(d) * cos(a)))


def ch_in(p, m=40):
    return p is not None and -m < p[0] < CH_W + m and -m < p[1] < CH_H + m


def ch_runs(coords):
    run, out = [], []
    for ra, de in coords:
        p = ch_xy(ra, de)
        if ch_in(p):
            run.append(p)
        else:
            if len(run) > 1:
                out.append(run)
            run = []
    if len(run) > 1:
        out.append(run)
    return "".join(pts_d(r) for r in out)


def ecl_to_eq(lam, beta=0.0):
    l, b, e = rad(lam), rad(beta), rad(EPS)
    de = math.asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l))
    ra = math.atan2(sin(l) * cos(e) - tan(b) * sin(e), cos(l))
    return math.degrees(ra) % 360, math.degrees(de)


def star_symbol(v):
    """(points, outer radius, inner radius) by magnitude class; points = 0 is a plain dot."""
    if v < 1.5:
        return 8, 8.4, 3.0
    if v < 2.5:
        return 8, 6.4, 2.5
    if v < 3.5:
        return 6, 4.9, 2.1
    if v < 4.5:
        return 4, 3.8, 1.35
    if v < 5.2:
        return 0, 1.3, 0
    return 0, 0.85, 0


def star_d(x, y, n, ro, ri):
    if n == 0:
        return circle_d(x, y, ro)
    pts = []
    for i in range(2 * n):
        a = rad(-90 + i * 180 / n)
        r = ro if i % 2 == 0 else ri
        pts.append((x + r * cos(a), y + r * sin(a)))
    return pts_d(pts, True)


def tangent(ra, de):
    a, b = ch_xy(ra + 1, de), ch_xy(ra - 1, de)
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


# ================================================================ the animated stars (kinematics)
def _unit(ra, de):
    a, d = rad(ra), rad(de)
    return [cos(d) * cos(a), cos(d) * sin(a), sin(d)]


def moving_stars(stars):
    """Position (pc) and velocity (pc/yr) of the ten stars, plus the symbol the chart gives each today."""
    out = []
    for n, ra, de, plx, pmra, pmde, rv, v in CATALOGUE:
        a, d = rad(ra), rad(de)
        dist = 1000.0 / plx
        u = _unit(ra, de)
        ea = [-sin(a), cos(a), 0.0]
        ed = [-sin(d) * cos(a), -sin(d) * sin(a), cos(d)]
        vel = [(rv * u[i] + K_PM * pmra / 1000 * dist * ea[i] + K_PM * pmde / 1000 * dist * ed[i]) * KMS_PCYR
               for i in range(3)]
        b = find_star(stars, "Cap", BSC[n])
        pts, ro, ri = star_symbol(b["v"])
        out.append({"n": n, "r": [round(u[i] * dist, 6) for i in range(3)], "v": [round(x, 12) for x in vel],
                    "m": v, "d": round(dist, 5), "p": pts, "ro": ro, "ri": ri,
                    "_bsc": b, "_xy": ch_xy(ra, de)})
    return out


def project_vec(p):
    """Same projection as ch_xy, from a 3D vector: what js/capricornus.js does at every frame."""
    r0, d0 = rad(CH_RA0), rad(CH_DE0)
    c = [cos(d0) * cos(r0), cos(d0) * sin(r0), sin(d0)]
    e = [-sin(r0), cos(r0), 0.0]
    n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]]
    dot = lambda a, b: sum(a[i] * b[i] for i in range(3))
    d = math.sqrt(dot(p, p))
    cc = dot(p, c) / d
    k = 2 / (1 + cc)
    return CH_CX - CH_K * k * dot(p, e) / d, CH_CY - CH_K * k * dot(p, n) / d


def gnomonic_old(p):
    """The projection of the CURRENT home page chart, scaled to this frame: the control that must fail."""
    r0, d0 = rad(315.5), rad(-19.5)
    c = [cos(d0) * cos(r0), cos(d0) * sin(r0), sin(d0)]
    e = [-sin(r0), cos(r0), 0.0]
    n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]]
    dot = lambda a, b: sum(a[i] * b[i] for i in range(3))
    pc = dot(p, c)
    k = 673.14 * (430 / 370)           # px per radian as the home page shows it today
    return CH_CX - k * dot(p, e) / pc, CH_CY - k * dot(p, n) / pc


def check(mov):
    """Registration: where the animation puts each star today vs where the chart's catalogue had it."""
    worst = worst_old = 0.0
    print("  registro hoy (px del marco): animacion (SIMBAD, 3D) vs carta (BSC5)")
    for s in mov:
        ax, ay = project_vec(s["r"])
        bx, by = ch_xy(s["_bsc"]["ra"], s["_bsc"]["de"])
        ox, oy = gnomonic_old(s["r"])
        e, eo = math.hypot(ax - bx, ay - by), math.hypot(ox - bx, oy - by)
        worst, worst_old = max(worst, e), max(worst_old, eo)
        print(f"    {s['n']:6s} anim ({ax:7.1f},{ay:6.1f})  carta ({bx:7.1f},{by:6.1f})  error {e:5.2f}"
              f"   | con la proyeccion vieja: {eo:5.1f}")
    print(f"  error maximo: {worst:.2f} px   (control: con la proyeccion gnomonica de la web actual, {worst_old:.1f} px)")
    if worst > 0.6:
        raise SystemExit("REGISTRO ROTO: la figura animada no cae sobre la carta")
    if worst_old < 3:
        raise SystemExit("CONTROL CIEGO: la prueba de registro no distingue una proyeccion de otra")
    return worst


# ================================================================ the chart
def chart(stars, mov):
    moving = [s["_bsc"] for s in mov]
    mxy = [ch_xy(s["ra"], s["de"]) for s in moving]
    seen, dropped = [], 0
    for s in sorted(stars, key=lambda s: s["v"]):
        if s["v"] >= V_LIMIT:
            continue
        p = ch_xy(s["ra"], s["de"])
        if not ch_in(p, 12):
            continue
        # the ten animated stars, and whatever the chart merged with them (alpha1 with alpha2), leave the background
        if any(abs(p[0] - q[0]) < 3 and abs(p[1] - q[1]) < 3 for q in mxy):
            dropped += 1
            continue
        if any(abs(p[0] - q["x"]) < 3 and abs(p[1] - q["y"]) < 3 for q in seen):
            continue                      # close pairs: the brighter one stands for both
        s["x"], s["y"] = p
        s["sym"] = star_symbol(s["v"])
        seen.append(s)
    print(f"  estrellas de fondo: {len(seen)} (V < {V_LIMIT}); retiradas por ser de la figura animada: {dropped}")

    grid, eq, fig, neb, text_hi, text_lo = [], [], [], [], [], []
    for ra in range(0, 360, 15):
        grid.append(ch_runs([(ra, de / 2) for de in range(-150, 61)]))
    for de in range(-60, 31, 10):
        if de:
            grid.append(ch_runs([(CH_RA0 + a / 2, de) for a in range(-220, 221)]))
    eq.append(ch_runs([(CH_RA0 + a / 2, 0) for a in range(-220, 221)]))
    for ra in range(int(CH_RA0) - 100, int(CH_RA0) + 101):
        ln = 0.95 if ra % 15 == 0 else 0.62 if ra % 5 == 0 else 0.34
        a, b = ch_xy(ra, 0), ch_xy(ra, ln)
        if ch_in(a):
            eq.append(pts_d([a, b]))

    for con, lines in FIGURES.items():
        for spec in lines:
            chain = [find_star(stars, con, n) for n in spec.split()]
            for a, b in zip(chain, chain[1:]):
                pa, pb = ch_xy(a["ra"], a["de"]), ch_xy(b["ra"], b["de"])
                if pa is None or pb is None or not (ch_in(pa, 200) or ch_in(pb, 200)):
                    continue
                d = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
                ga = star_symbol(a["v"])[1] + GAP
                gb = star_symbol(b["v"])[1] + GAP
                if d <= ga + gb + 2:
                    continue
                ux, uy = (pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d
                fig.append(pts_d([(pa[0] + ux * ga, pa[1] + uy * ga), (pb[0] - ux * gb, pb[1] - uy * gb)]))

    for name, ra, de in NAMES:
        p = ch_xy(ra, de)
        if ch_in(p):
            text_hi.append(ROMAN.path(name, p[0], p[1], 12.5, "middle", 5.2, tangent(ra, de)))
    for con, spec, name, dx, dy in STAR_NAMES:
        s = find_star(stars, con, spec)
        if "x" in s:
            r = s["sym"][1]
            text_lo.append(ITALIC.path(name, s["x"] + r * 0.6 + dx, s["y"] + dy, 11.5, "start", 0.3))

    with open(DATA / "messier.csv", encoding="utf-8") as fh:
        n_neb = 0
        for r in csv.DictReader(fh):
            p = ch_xy(float(r["ra"]), float(r["dec"]))
            if not ch_in(p, 0):
                continue
            n_neb += 1
            neb.append(circle_d(p[0], p[1], 3.5))
            if r["name"] == "M 75":
                # at the default place (right of the circle) it sat under the word «Ecliptica»: hang it below-left
                text_lo.append(ITALIC.path("M 75", p[0] - 6, p[1] + 15, 9.5, "end"))
            elif r["name"] in MESSIER_LABELS:
                text_lo.append(ITALIC.path(r["name"].replace(" ", " "), p[0] + 7, p[1] + 3.2, 9.5))
    print(f"  objetos Messier en el marco: {n_neb}")

    # hours written just above the -10 deg parallel, one per meridian; degrees where parallels cross two meridians
    for ra in range(int(CH_RA0) - 90, int(CH_RA0) + 91):
        if ra % 15 == 0:
            off, de = HOUR_NUDGE.get(ra, (0.45, -9.25))
            p = ch_xy(ra - off, de)
            if ch_in(p, 0):
                text_lo.append(ITALIC.path(roman((ra % 360) // 15 or 24) + " h", p[0], p[1], 11, "end", 0.4,
                                           tangent(ra, -9.25)))
    for mer, decs in ((300, (-30,)), (345, (-20, -30)), (285, (-10, -20, -30))):
        for de in decs:
            p = ch_xy(mer, de)
            if ch_in(p, 0):
                text_lo.append(ITALIC.path("−" + str(abs(de)) + "°", p[0] + 5, p[1] - 5, 10.5))
    for ra in (350.0, 281.0):
        p = ch_xy(ra, -1.75)
        if ch_in(p, 0):
            text_lo.append(ITALIC.path("Aequator", p[0], p[1], 11.5, "middle", 1.2, tangent(ra, -1.75)))

    gold = (f'<path stroke-width=".6" stroke-opacity=".34" d="{"".join(grid)}"/>'
            f'<path stroke-width=".7" stroke-opacity=".62" d="{"".join(eq)}"/>'
            f'<path stroke-width=".9" stroke-opacity=".7" d="{"".join(fig)}"/>'
            f'<path stroke-width=".8" stroke-opacity=".85" stroke-dasharray="1.7 1.5" d="{"".join(neb)}"/>'
            f'<path fill="#000" stroke="none" fill-opacity=".95" d="{"".join(text_hi)}"/>'
            f'<path fill="#000" stroke="none" fill-opacity=".8" d="{"".join(text_lo)}"/>')

    by_class = {}
    for s in seen:
        n, ro, ri = s["sym"]
        by_class.setdefault((n, ro), []).append(star_d(s["x"], s["y"], n, ro, ri))
    op = {8.4: "1", 6.4: "1", 4.9: ".96", 3.8: ".92", 1.3: ".85", 0.85: ".7"}
    star_layer = "".join(f'<path fill="#000" stroke="none" fill-opacity="{op[ro]}" d="{"".join(d)}"/>'
                         for (n, ro), d in sorted(by_class.items(), key=lambda kv: -kv[0][1]))

    line = ch_runs([ecl_to_eq(l / 2) for l in range(440, 801)])
    ticks = []
    for lam in range(220, 401):
        ln = 1.25 if lam % 30 == 0 else 0.62 if lam % 5 == 0 else 0.34
        a, b = ch_xy(*ecl_to_eq(lam)), ch_xy(*ecl_to_eq(lam, ln))
        if ch_in(a):
            ticks.append(pts_d([a, b]))
    lab = []
    for lam in (340.0, 296.0, 268.0):
        a, b = ch_xy(*ecl_to_eq(lam + 1, -1.5)), ch_xy(*ecl_to_eq(lam - 1, -1.5))
        p = ch_xy(*ecl_to_eq(lam, -1.5))
        ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        lab.append(ITALIC.path("Ecliptica", p[0], p[1], 12.5, "middle", 1.6, ang))
    ecl = (f'<path stroke-width="1.15" d="{line}"/><path stroke-width=".7" stroke-opacity=".85" d="{"".join(ticks)}"/>'
           f'<path fill="#000" stroke="none" d="{"".join(lab)}"/>')
    return {"carta-oro.svg": svg_text(CH_W, CH_H, gold), "carta-estrellas.svg": svg_text(CH_W, CH_H, star_layer),
            "carta-ecliptica.svg": svg_text(CH_W, CH_H, ecl)}


# ================================================================ the animated figure, as it is today
def segments():
    return [[a, b] for line in LINES for a, b in zip(line, line[1:])]


def figure_svg(mov):
    """Inline SVG for the page: today's sky. js/capricornus.js moves these same elements."""
    pos = {s["n"]: project_vec(s["r"]) for s in mov}
    sym = {s["n"]: s for s in mov}
    o = [f'<svg class="cap-fig" id="cap-chart" viewBox="0 0 {CH_W} {CH_H}" width="{CH_W}" height="{CH_H}" '
         'role="img" aria-label="Carta de la constelación de Capricornio">']
    for i, (a, b) in enumerate(segments()):
        (x1, y1), (x2, y2) = pos[a], pos[b]
        d = math.hypot(x2 - x1, y2 - y1)
        ga, gb = sym[a]["ro"] + GAP, sym[b]["ro"] + GAP
        ux, uy = (x2 - x1) / d, (y2 - y1) / d
        o.append(f'<path class="cap-linea" id="cap-s{i}" d="M{x1 + ux * ga:.1f} {y1 + uy * ga:.1f}'
                 f'L{x2 - ux * gb:.1f} {y2 - uy * gb:.1f}"></path>')
    for s in mov:
        x, y = pos[s["n"]]
        o.append(f'<path class="cap-estrella" id="cap-{s["n"]}" transform="translate({x:.1f} {y:.1f})" '
                 f'd="{star_d(0, 0, s["p"], s["ro"], s["ri"])}"></path>')
    for n, (g, dx, dy) in GREEK.items():
        x, y = pos[n]
        o.append(f'<text class="cap-letra" id="cap-t-{n}" x="{x + dx:.1f}" y="{y + dy:.1f}">{g}</text>')
    o.append("</svg>")
    return "\n".join(o)


def data_json(mov):
    stars = [{k: v for k, v in s.items() if not k.startswith("_")} for s in mov]
    data = {"stars": stars, "segs": segments(), "greek": {n: [dx, dy] for n, (_, dx, dy) in GREEK.items()},
            "proj": PROJ, "view": list(VIEW), "gap": GAP, "maxAge": MAX_AGE}
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def patch(path, begin, end, body):
    """Replace what lies between two markers; say so if the file or the markers are missing."""
    if not path.exists():
        print(f"  {path.name}: no existe todavia, no se toca")
        return
    txt = path.read_text(encoding="utf-8")
    pat = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.S)
    if not pat.search(txt):
        print(f"  {path.name}: SIN MARCADORES {begin} ... {end}; no se toca")
        return
    new = pat.sub(lambda _: begin + "\n" + body + "\n" + end, txt, count=1)
    if new != txt:
        path.write_text(new, encoding="utf-8", newline="\n")
        print(f"  {path.name}: bloque actualizado")
    else:
        print(f"  {path.name}: ya estaba al dia")


if __name__ == "__main__":
    all_stars = load_stars()
    mov = moving_stars(all_stars)
    check(mov)
    if "--check" in sys.argv:
        raise SystemExit(0)
    for name, svg in chart(all_stars, mov).items():
        (OUT_IMG / name).write_text(svg, encoding="utf-8", newline="\n")
        print(f"  {name}: {len(svg) / 1024:.1f} KB")
    patch(OUT_JS, "/* DATA-BEGIN */", "/* DATA-END */", "  var D = " + data_json(mov) + ";")
    patch(OUT_HTML, "<!-- CAP-SVG-BEGIN -->", "<!-- CAP-SVG-END -->", figure_svg(mov))
