"""
Builds atlas/armilar.js = armilar.src.js + the static line art of the armillary sphere.

    python build_armilar.py

The animated sphere (atlas/armilar.js) redraws only the turning cage (ecliptic, equator, tropics,
polar circles, colures) every frame. Everything that stays still (meridian, horizon, cradle, stand,
globe, polar axis, ground, stars) is drawn here ONCE with the very same engine and the very same
geometry as tools/atlas2/p1/instrumentos.py::armilar(), minus the cage, and embedded as path data.

The static strokes come out with their hidden lines already removed among the static solids, and
split in three depth layers so the script can paint the cage between them:

    far   behind every ring of the cage     (depth < 0: outside the sphere, away from the viewer)
    mid   inside the sphere                 (globe and the polar axis between the colures)
    near  in front of every ring            (depth > 0, outside the sphere)

It also writes the silhouettes ("masks") of the mid and near solids: the script erases with them
whatever passes behind, leaving the small halo gap of the engraving.

tools/atlas2/p1 is only read (grabado.py is imported, nothing there is modified).
"""
import json
import math
import os
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parents[2]                                # raiz del repo de la web
sys.path.insert(0, str(HERE.parent / "p1"))           # tools/atlas2/p1/grabado.py (solo se lee)

from grabado import RASTER, STEP, Plate, circle2, comb, cross, dot, f, perp, rdp, unit  # noqa: E402

LAT = math.radians(38.15)         # same as instrumentos.py (NOT VERIFIED there either)
R = 150.0
COLURE = 0.97 * R                 # radius of the innermost rings: the axis pierces them at the poles
LAP = 3.0                         # overlap of the axis strokes between layers, drawing units
HALO = 1.4                        # must match HALO in armilar.src.js

FAR, MID, NEAR = "far", "mid", "near"
LAYERS = (FAR, MID, NEAR)


class LayerPlate(Plate):
    """Plate that remembers a tag per stroke and renders the strokes split in depth layers."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.tag = ""
        self.tags = []
        self.out = {la: {"o": [], "h": [], "f": []} for la in LAYERS}
        self.box = {la: [1e9, 1e9, -1e9, -1e9] for la in LAYERS}

    def stroke(self, key, pts, own=(), tol=0.7):
        n = len(self.strokes)
        super().stroke(key, pts, own, tol)
        if len(self.strokes) > n:
            self.tags.append(self.tag)

    def stroke_v(self, key, pts, own=(), tol=0.7):
        n = len(self.strokes)
        super().stroke_v(key, pts, own, tol)
        if len(self.strokes) > n:
            self.tags.append(self.tag)

    def layers(self, tag, q):
        x, y, d = q
        if tag in ("ground", "star", "stand"):
            return (FAR,)
        if tag == "globe":
            return (MID,)
        if tag == "axis":
            s = ((x - self.cx) * self.ax2[0] + (y - self.cy) * self.ax2[1]) / self.ax2n
            res = []
            if s < -COLURE + LAP:
                res.append(FAR)
            if -COLURE <= s <= COLURE:
                res.append(MID)
            if s > COLURE - LAP:
                res.append(NEAR)
            return res
        return (NEAR,) if d > 0 else (FAR,)

    def render(self):
        assert len(self.tags) == len(self.strokes)
        for (key, pts, own, tol), tag in zip(self.strokes, self.tags):
            runs = {la: [] for la in LAYERS}
            prev = None
            for p in pts:
                if prev is None:
                    samples = [p]
                else:
                    n = max(1, int(math.hypot(p[0] - prev[0], p[1] - prev[1]) / STEP))
                    samples = [(prev[0] + (p[0] - prev[0]) * j / n, prev[1] + (p[1] - prev[1]) * j / n,
                                prev[2] + (p[2] - prev[2]) * j / n) for j in range(1, n + 1)]
                for q in samples:
                    if self.visible(q[0], q[1], q[2], own, tol):
                        inl = self.layers(tag, q)
                        for la in LAYERS:
                            if la in inl:
                                runs[la].append((q[0], q[1]))
                            elif runs[la]:
                                runs[la].append((q[0], q[1]))      # shared point: no gap between layers
                                self._emit_l(la, key, runs[la])
                                runs[la] = []
                    else:
                        for la in LAYERS:
                            self._emit_l(la, key, runs[la])
                            runs[la] = []
                prev = p
            for la in LAYERS:
                self._emit_l(la, key, runs[la])
        self.strokes = []
        self.tags = []

    def _emit_l(self, la, key, run):
        if len(run) < 2:
            return
        run = rdp(run, 0.06)
        if len(run) == 2 and math.hypot(run[1][0] - run[0][0], run[1][1] - run[0][1]) < 0.35:
            return
        self.out[la][key].append("M" + "L".join(f"{f(x)} {f(y)}" for x, y in run))
        b = self.box[la]
        for x, y in run:
            b[0], b[1], b[2], b[3] = min(b[0], x), min(b[1], y), max(b[2], x), max(b[3], y)


def star(pl, x, y, k, key="f"):
    for dx, dy, m in ((1, 0, 1.0), (0, 1, 1.0), (0.7, 0.7, 0.38), (0.7, -0.7, 0.38)):
        pl.flat(key, [(x - dx * k * m, y - dy * k * m), (x + dx * k * m, y + dy * k * m)])


def ground(pl, y, x0, x1, rng, n=26, depth=-1e6):
    for _ in range(n):
        yy = y + 3 + rng.random() * 16
        x = rng.uniform(x0, x1)
        ln = rng.uniform(6, 24) * (1 - (yy - y) / 26)
        pl.stroke_v("f", [(x, yy, depth), (x + ln, yy, depth)])


def flat2(pts):
    out = []
    for x, y in pts:
        out += [round(x, 1), round(y, 1)]
    return out


def build():
    """Static part of instrumentos.armilar(): same calls, same order, same numbers; the cage is left out."""
    pl = LayerPlate(560, 596, cx=280, cy=208, az=118, el=13)
    rng = random.Random(1687)
    O = (0.0, 0.0, 0.0)
    X, Y, Z = (1.0, 0, 0), (0, 1.0, 0), (0, 0, 1.0)
    pole = (0.0, math.cos(LAT), math.sin(LAT))
    pl.ax2 = (dot(pole, pl.r), -dot(pole, pl.u))
    pl.ax2n = pl.ax2[0] ** 2 + pl.ax2[1] ** 2
    masks = {MID: {"sweeps": [], "polys": [], "circles": []}, NEAR: {"sweeps": [], "polys": [], "circles": []}}

    def xy(p):
        q = pl.P(p)
        return (q[0], q[1])

    # polar axis and the Earth at the centre
    pl.tag = "axis"
    pl.revolve(O, pole, [(-1.035 * R, 1.6), (1.035 * R, 1.6)], hatch=())
    pl.tag = "globe"
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
    for k in range(9):
        la = math.radians(-50 + k * 12.5)
        base = math.atan2(dot(pl.L, gb), dot(pl.L, ga))
        pl.stroke("h", [comb(O, (g * math.sin(la), pole), (g * math.cos(la) * math.cos(base + math.radians(j)), ga),
                             (g * math.cos(la) * math.sin(base + math.radians(j)), gb)) for j in range(-34, 35, 4)], {gid}, tol=0.4)

    # masks of the globe and of the axis (a thin bar on the sheet)
    masks[MID]["circles"].append([280, 208, round(g, 2)])
    ux, uy = pl.ax2
    un = math.sqrt(pl.ax2n)                       # screen length of one unit along the axis
    nx, ny = -uy / un, ux / un

    def bar(s0, s1, hw=1.6):
        return flat2([(280 + s0 * ux + hw * nx, 208 + s0 * uy + hw * ny), (280 + s1 * ux + hw * nx, 208 + s1 * uy + hw * ny),
                      (280 + s1 * ux - hw * nx, 208 + s1 * uy - hw * ny), (280 + s0 * ux - hw * nx, 208 + s0 * uy - hw * ny)])

    masks[MID]["polys"].append(bar(-COLURE + HALO, COLURE))
    masks[NEAR]["polys"].append(bar(COLURE - LAP + HALO, 1.035 * R + 1.0))

    def sector(to_front, thick, r0, r1, a0, a1, step=3.0):
        """Mask of a piece of flat ring: its front face on the sheet and how far the back face is shifted."""
        n = max(2, int(math.ceil(abs(a1 - a0) / math.radians(step))))
        ang = [a0 + (a1 - a0) * i / n for i in range(n + 1)]
        face = [to_front((r1 * math.cos(a), r1 * math.sin(a))) for a in ang] + \
               [to_front((r0 * math.cos(a), r0 * math.sin(a))) for a in ang[::-1]]
        d = pl.P(thick)
        o = pl.P(O)
        masks[NEAR]["sweeps"].append({"p": flat2([xy(p) for p in face]), "d": [round(d[0] - o[0], 2), round(d[1] - o[1], 2)]})

    def near_range(to_front, r, a0, a1, n=720):
        """Angles (within a0..a1) where the ring of radius r is on the viewer's side of the centre."""
        best, cur = None, None
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            if dot(to_front((r * math.cos(a), r * math.sin(a))), pl.v) > 0:
                cur = [a, a] if cur is None else [cur[0], a]
                if best is None or cur[1] - cur[0] > best[1] - best[0]:
                    best = cur
            else:
                cur = None
        return best

    # --- meridian ring
    pl.tag = "meridian"
    r_in, r_out = 1.04 * R, 1.135 * R
    mid, mf = pl.plate(O, Y, Z, [circle2(r_out, 240), circle2(r_in, 240, cw=True)], t=0.036 * R)
    for d in range(0, 360, 2):
        th = math.radians(d)
        ln = 0.05 * R if d % 10 == 0 else 0.026 * R
        pl.stroke("f", [mf((r_in * math.cos(th), r_in * math.sin(th))), mf(((r_in + ln) * math.cos(th), (r_in + ln) * math.sin(th)))], {mid})
    pl.stroke("f", [mf(p) for p in circle2(r_in + 0.05 * R, 240)] + [mf((r_in + 0.05 * R, 0))], {mid})
    for sgn in (1, -1):
        cx, cy = sgn * 1.085 * R * math.cos(LAT), sgn * 1.085 * R * math.sin(LAT)
        pl.stroke("o", [mf(p) for p in circle2(0.026 * R, 24, cx, cy)] + [mf((cx + 0.026 * R, cy))], {mid})
    # the meridian plane is x = 0; its near half spans 180 degrees: look for it over two turns
    a = near_range(mf, (r_in + r_out) / 2, -math.pi, math.pi)
    b = near_range(mf, (r_in + r_out) / 2, 0, 2 * math.pi)
    a = a if a[1] - a[0] >= b[1] - b[0] else b
    nrm = cross(Y, Z)
    sg = 1.0 if dot(nrm, pl.v) >= 0 else -1.0
    sector(mf, tuple(-sg * 0.036 * R * c for c in nrm), r_in, r_out, a[0], a[1])

    # --- horizon ring
    pl.tag = "horizon"
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
    for d in range(0, 360, 5):
        if d % 30 != 15:
            th = math.radians(d)
            pl.stroke("f", [hf((1.215 * R * math.cos(th), 1.215 * R * math.sin(th))),
                            hf((1.245 * R * math.cos(th), 1.245 * R * math.sin(th)))], {hid})
    for d2 in range(0, 720, 3):
        th = math.radians(d2 / 2)
        nrm = (math.cos(th), math.sin(th), 0.0)
        if dot(nrm, pl.v) > 0.04 and dot(nrm, pl.L) > 0.28:
            pl.stroke("h", [comb(O, (h_out, nrm), (0.016 * R, Z)), comb(O, (h_out, nrm), (-0.016 * R, Z))], {hid})
    a = near_range(hf, (h_in + h_out) / 2, -math.pi, math.pi)
    b = near_range(hf, (h_in + h_out) / 2, 0, 2 * math.pi)
    a = a if a[1] - a[0] >= b[1] - b[0] else b
    sg = 1.0 if dot(Z, pl.v) >= 0 else -1.0
    sector(hf, tuple(-sg * 0.045 * R * c for c in Z), h_in, h_out, a[0], a[1])

    # --- cradle
    pl.tag = "cradle"
    c_in, c_out = 1.165 * R, 1.24 * R
    d0 = math.asin(0.0225 * R / c_out)
    for beta in (45, 135):
        bb = math.radians(beta)
        eu = (math.cos(bb), math.sin(bb), 0.0)
        hoop = circle2(c_out, 120, a0=math.pi + d0, a1=2 * math.pi - d0) + circle2(c_in, 120, a0=math.pi + d0, a1=2 * math.pi - d0)[::-1]
        cid, cf = pl.plate(O, eu, Z, [hoop], t=0.04 * R)
        mid_r = (c_in + c_out) / 2
        run = []
        for j in range(0, 121):
            th = math.pi + d0 + (math.pi - 2 * d0) * j / 120
            p = cf((mid_r * math.cos(th), mid_r * math.sin(th)))
            if dot(unit(p), pl.L) > 0.05:
                run.append(p)
            else:
                pl.stroke("h", run, {cid})
                run = []
        pl.stroke("h", run, {cid})
        a = near_range(cf, mid_r, math.pi + d0, 2 * math.pi - d0)
        if a is not None and a[1] - a[0] > 0.02:
            nrm = cross(eu, Z)
            sg = 1.0 if dot(nrm, pl.v) >= 0 else -1.0
            sector(cf, tuple(-sg * 0.04 * R * c for c in nrm), c_in, c_out, a[0], a[1])

    # --- stand
    pl.tag = "stand"
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
    for i, fr, span in ((5, 0.5, 46), (6, 0.25, 40), (6, 0.6, 34), (6, 0.9, 28), (7, 0.45, 22)):
        (s0, r0), (s1, r1) = col[i], col[i + 1]
        pl.stroke("h", [rv["pt"](s0 + (s1 - s0) * fr, r0 + (r1 - r0) * fr, rv["thl"] + math.radians(j))
                        for j in range(-span, span + 1, 3)], {rv["ids"][i]})
    for az in (205, 325, 85):
        a = math.radians(az)
        fo = (0.50 * R * math.cos(a), 0.50 * R * math.sin(a), 0.0)
        pl.revolve(fo, Z, [(-2.165 * R, 0.0), (-2.165 * R, 0.035 * R), (-2.15 * R, 0.062 * R), (-2.125 * R, 0.07 * R),
                           (-2.10 * R, 0.055 * R)], crease_deg=50, hatch=[(-20, 1, 4, "h")])

    pl.tag = "ground"
    ground(pl, 208 + 2.165 * R * math.cos(math.radians(13)) + 4, 120, 440, rng, n=22)
    pl.tag = "star"
    star(pl, 62, 96, 6.5)
    star(pl, 506, 52, 4.4)
    star(pl, 520, 300, 3.6)
    star(pl, 44, 330, 3.2)

    pl.render()
    return pl, masks


def main():
    pl, masks = build()
    data = {}
    for la in LAYERS:
        b = pl.box[la]
        entry = {k: "".join(pl.out[la][k]) for k in ("o", "h", "f")}
        if la in masks:
            entry["mask"] = masks[la]
        m = 4
        entry["box"] = [math.floor(b[0] - m), math.floor(b[1] - m), math.ceil(b[2] + m), math.ceil(b[3] + m)]
        data[la] = entry
        print(f"{la:5s} o={len(entry['o']) / 1024:5.1f} KB  h={len(entry['h']) / 1024:5.1f} KB  f={len(entry['f']) / 1024:5.1f} KB  box={entry['box']}")
    # camera, as a cross-check for the port in armilar.src.js
    data["cam"] = {"v": [round(c, 6) for c in pl.v], "r": [round(c, 6) for c in pl.r], "u": [round(c, 6) for c in pl.u],
                   "L": [round(c, 6) for c in pl.L]}
    blob = json.dumps(data, separators=(",", ":"))
    (HERE / "static-data.json").write_text(blob, encoding="utf-8")
    src = (HERE / "armilar.src.js").read_text(encoding="utf-8")
    assert "/*__DATA__*/null" in src
    out = src.replace("/*__DATA__*/null", blob)
    dst = Path(os.environ.get("ATLAS_ARMILAR_OUT") or SITE / "atlas" / "armilar.js")   # salida: atlas/armilar.js (o $ATLAS_ARMILAR_OUT para probar)
    dst.write_text(out, encoding="utf-8", newline="\n")
    print(f"{dst}: {len(out) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
