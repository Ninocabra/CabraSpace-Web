"""
Small 3D "white-line engraving" engine for the cabinet-of-instruments plates (proposal 1).

The instruments are modelled as solids (turned parts, flat plates with thickness, spherical bands,
spheres), projected orthographically, and every line is cut where something nearer covers it, using
a depth buffer. So rings pass in front of and behind each other the way an engraver draws them.

Same convention as Pagina Web/tools/observatorio.py: the page is dark, lit surfaces carry the
hatching, light comes from the left; three line weights (outline, hatch, fine). The SVG is
monochrome black on transparent, to be used as a CSS mask painted in gold.
"""
import math
from array import array

RASTER = 2          # depth-buffer pixels per drawing unit
STEP = 0.5          # sampling step along a stroke, in drawing units


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".") if abs(v) >= 0.05 else "0"


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(a):
    n = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def comb(o, *terms):
    """o + sum(k * vec) for (k, vec) pairs."""
    x, y, z = o
    for k, v in terms:
        x += k * v[0]
        y += k * v[1]
        z += k * v[2]
    return (x, y, z)


def perp(a):
    """Any unit vector perpendicular to a."""
    b = (1.0, 0.0, 0.0) if abs(a[0]) < 0.9 else (0.0, 1.0, 0.0)
    return unit(cross(a, b))


def circle2(r, n=180, cx=0.0, cy=0.0, a0=0.0, a1=2 * math.pi, cw=False):
    """Points of a circle (or arc) in a plate's own 2D coordinates. Counter-clockwise unless cw."""
    full = abs(a1 - a0) >= 2 * math.pi - 1e-9
    m = n if full else n + 1
    pts = [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(m)]
    return pts[::-1] if cw else pts


def rdp(pts, eps):
    """Ramer-Douglas-Peucker on (x, y) points."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            if ln < 1e-9:           # closed loop: distance to the shared end point
                d = math.hypot(pts[i][0] - ax, pts[i][1] - ay)
            else:
                d = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / ln
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


class Plate:
    """One engraved plate: a canvas, a camera, a depth buffer and the pending strokes."""

    def __init__(self, w, h, cx, cy, az=0.0, el=12.0, k=1.0, light=(-0.62, 0.52, 0.58)):
        self.w, self.h, self.cx, self.cy, self.k = w, h, cx, cy, k
        a, e = math.radians(az), math.radians(el)
        self.v = (math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))   # towards the viewer
        self.r = (math.cos(a), math.sin(a), 0.0)                                         # screen right
        self.u = cross(self.v, self.r)                                                   # screen up
        self.L = unit(comb((0, 0, 0), (light[0], self.r), (light[1], self.u), (light[2], self.v)))
        self.RW, self.RH = w * RASTER, h * RASTER
        self.zb = array("f", [-1e9]) * (self.RW * self.RH)
        self.ib = array("i", [0]) * (self.RW * self.RH)
        self.nid = 0
        self.strokes = []
        self.paths = {"o": [], "h": [], "f": []}
        self.extra = []

    # ------------------------------------------------------------ camera and buffer
    def new_id(self):
        self.nid += 1
        return self.nid

    def P(self, p):
        """World point -> (x, y, depth); depth grows towards the viewer."""
        return (self.cx + self.k * dot(p, self.r), self.cy - self.k * dot(p, self.u), self.k * dot(p, self.v))

    @staticmethod
    def _plane(c):
        n = len(c)
        best, bd = None, 0.0
        for i, j, k in ((0, n // 3, 2 * n // 3), (0, 1, 2), (0, n // 4, n // 2), (0, 1, n - 1)):
            if len({i, j, k}) < 3 or k >= n:
                continue
            (x0, y0, d0), (x1, y1, d1), (x2, y2, d2) = c[i], c[j], c[k]
            det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
            if abs(det) > abs(bd):
                a = ((d1 - d0) * (y2 - y0) - (d2 - d0) * (y1 - y0)) / det
                b = ((x1 - x0) * (d2 - d0) - (x2 - x0) * (d1 - d0)) / det
                best, bd = (a, b, d0 - a * x0 - b * y0), det
        return best if abs(bd) > 1e-7 else None

    def fill(self, contours, oid):
        """Even-odd fill of projected contours (lists of (x, y, depth)) into the depth buffer."""
        plane = self._plane(contours[0])
        if plane is None:
            return
        pa, pb, pc = plane
        S, W, H = RASTER, self.RW, self.RH
        edges = []
        lo, hi = 1e9, -1e9
        for c in contours:
            n = len(c)
            for i in range(n):
                xa, ya = c[i][0] * S, c[i][1] * S
                xb, yb = c[(i + 1) % n][0] * S, c[(i + 1) % n][1] * S
                if ya == yb:
                    continue
                if ya > yb:
                    xa, ya, xb, yb = xb, yb, xa, ya
                edges.append((ya, yb, xa, (xb - xa) / (yb - ya)))
                lo, hi = min(lo, ya), max(hi, yb)
        if not edges:
            return
        zb, ib = self.zb, self.ib
        pa, pb = pa / S, pb / S
        for yi in range(max(0, int(math.floor(lo))), min(H - 1, int(math.ceil(hi))) + 1):
            yc = yi + 0.5
            xs = sorted(xa + (yc - ya) * sl for ya, yb, xa, sl in edges if ya <= yc < yb)
            base = yi * W
            row = pb * yc + pc
            for j in range(0, len(xs) - 1, 2):
                xl = max(0, int(math.ceil(xs[j] - 0.5)))
                xr = min(W - 1, int(math.floor(xs[j + 1] - 0.5)))
                for xi in range(xl, xr + 1):
                    d = pa * (xi + 0.5) + row
                    if d > zb[base + xi]:
                        zb[base + xi] = d
                        ib[base + xi] = oid

    def visible(self, x, y, d, own, tol):
        xi, yi = int(x * RASTER), int(y * RASTER)
        if not (0 <= xi < self.RW and 0 <= yi < self.RH):
            return False
        i = yi * self.RW + xi
        return not (self.zb[i] > d + tol and self.ib[i] not in own)

    # ------------------------------------------------------------ strokes
    def stroke(self, key, pts, own=(), tol=0.7):
        """Polyline in world coordinates, cut later wherever something nearer covers it."""
        if len(pts) > 1:
            self.strokes.append((key, [self.P(p) for p in pts], frozenset(own), tol))

    def stroke_v(self, key, pts, own=(), tol=0.7):
        if len(pts) > 1:
            self.strokes.append((key, list(pts), frozenset(own), tol))

    def flat(self, key, pts, depth=1e6):
        """Polyline given directly on the sheet (x, y), in front of everything unless depth says otherwise."""
        self.stroke_v(key, [(x, y, depth) for x, y in pts])

    def render(self):
        for key, pts, own, tol in self.strokes:
            run = []
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
                        run.append((q[0], q[1]))
                    else:
                        self._emit(key, run)
                        run = []
                prev = p
            self._emit(key, run)
        self.strokes = []

    def _emit(self, key, run):
        if len(run) < 2:
            return
        run = rdp(run, 0.06)
        if len(run) == 2 and math.hypot(run[1][0] - run[0][0], run[1][1] - run[0][1]) < 0.35:
            return
        self.paths[key].append("M" + "L".join(f"{f(x)} {f(y)}" for x, y in run))

    def svg(self, path, sw=1.0):
        """Write the SVG. sw scales the three line weights (use > 1 for plates shown small)."""
        self.render()
        style = {"o": f'stroke-width="{f(1.15 * sw)}"',
                 "h": f'stroke-width="{0.62 * sw:.2f}" stroke-opacity=".8"',
                 "f": f'stroke-width="{0.5 * sw:.2f}" stroke-opacity=".62"'}
        body = "".join(f'<path {style[k]} d="{"".join(self.paths[k])}"/>' for k in ("f", "h", "o") if self.paths[k])
        out = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'
               f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">{body}{"".join(self.extra)}</g></svg>\n')
        path.write_text(out, encoding="utf-8")
        print(f"{path.name}: {len(out) / 1024:.1f} KB")

    # ------------------------------------------------------------ solids
    def revolve(self, o, a, prof, key="o", hatch=(), nth=72, cap_start=False, cap_end=False, crease_deg=20.0):
        """
        Turned part: the profile (s along the axis, radius) revolved around the axis through o.
        The profile runs with s increasing where the outside is on the +radius side.
        hatch: (offset in degrees from the lit meridian, first vertex, last vertex, key).
        """
        a = unit(a)
        av = dot(a, self.v)
        vp = sub(self.v, mul(a, av))
        m = math.sqrt(dot(vp, vp))
        e1 = mul(vp, 1 / m) if m > 1e-6 else perp(a)
        e2 = cross(a, e1)
        prof = list(prof)
        off = 0
        if cap_start:
            prof = [(prof[0][0], 0.0)] + prof
            off = 1
        if cap_end:
            prof = prof + [(prof[-1][0], 0.0)]
        n = len(prof) - 1
        ids = [self.new_id() for _ in range(n)]

        def pt(s, rho, th):
            return comb(o, (s, a), (rho * math.cos(th), e1), (rho * math.sin(th), e2))

        co = []
        for i in range(n):
            ds, dr = prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]
            ln = math.hypot(ds, dr) or 1.0
            co.append((ds / ln * m, -dr / ln * av, math.atan2(dr, ds)))

        def facing(i, th):
            return co[i][0] * math.cos(th) + co[i][1] > 1e-9

        for i in range(n):
            (s0, r0), (s1, r1) = prof[i], prof[i + 1]
            ring0 = [self.P(pt(s0, r0, 2 * math.pi * j / nth)) for j in range(nth)]
            ring1 = [self.P(pt(s1, r1, 2 * math.pi * j / nth)) for j in range(nth)]
            for j in range(nth):
                if not facing(i, 2 * math.pi * (j + 0.5) / nth):
                    continue
                jj = (j + 1) % nth
                if r0 > 1e-9:
                    self.fill([[ring0[j], ring0[jj], ring1[jj]]], ids[i])
                if r1 > 1e-9:
                    self.fill([[ring0[j], ring1[jj], ring1[j]]], ids[i])

        # split into smooth runs at the creases
        crease = [True] + [abs((co[i][2] - co[i - 1][2] + math.pi) % (2 * math.pi) - math.pi) > math.radians(crease_deg)
                           for i in range(1, n)] + [True]
        # silhouette: per vertex inside a smooth run, per segment end at a crease
        for sg in (1, -1):
            line = []
            for i in range(n):
                for end in (0, 1):
                    j = i + end
                    if crease[j] or (end == 0 and i == 0) or (end == 1 and i == n - 1):
                        ca, cb = co[i][0], co[i][1]
                    else:
                        other = i - 1 if end == 0 else i + 1
                        ca, cb = (co[i][0] + co[other][0]) / 2, (co[i][1] + co[other][1]) / 2
                    if abs(ca) > 1e-9 and abs(cb / ca) < 1:
                        th = math.acos(-cb / ca)
                        line.append(pt(prof[j][0], prof[j][1], sg * th))
                    else:
                        line.append(None)
                seg = line[-2:]
                if seg[0] is not None and seg[1] is not None:
                    self.stroke(key, seg, set(ids[max(0, i - 1):i + 2]))
        # crease circles
        for j in range(n + 1):
            if not crease[j] or prof[j][1] < 1e-9:
                continue
            segs = [i for i in (j - 1, j) if 0 <= i < n]
            run = []
            for q in range(0, 181):
                th = math.radians(q * 2)
                if any(facing(i, th) for i in segs):
                    run.append(pt(prof[j][0], prof[j][1], th))
                else:
                    self.stroke(key, run, {ids[i] for i in segs})
                    run = []
            self.stroke(key, run, {ids[i] for i in segs})
        # hatching along the lit meridians
        thl = math.atan2(dot(self.L, e2), dot(self.L, e1))
        for h in hatch:
            deg, i0, i1, hk = h[:4]
            inset = h[4] if len(h) > 4 else 0.0
            th = thl + math.radians(deg)
            for i in range(i0 + off, i1 + off):
                if not facing(i, th):
                    continue
                (s0, r0), (s1, r1) = prof[i], prof[i + 1]
                t0 = inset if i == i0 + off else 0.0
                t1 = 1 - inset if i == i1 + off - 1 else 1.0
                self.stroke(hk, [pt(s0 + (s1 - s0) * t0, r0 + (r1 - r0) * t0, th),
                                 pt(s0 + (s1 - s0) * t1, r0 + (r1 - r0) * t1, th)], {ids[i]})
        return {"ids": ids, "pt": pt, "thl": thl, "facing": facing, "off": off}

    def plate(self, o, eu, ev, contours, t=0.0, key="o", edge_key=None, corner_deg=30.0, own=()):
        """
        Flat part with thickness t: contours in its own (eu, ev) coordinates, outer ones
        counter-clockwise and holes clockwise. Returns (id, to_world) for engraving on its front face.
        """
        eu, ev = unit(eu), unit(ev)
        n = cross(eu, ev)
        nv = dot(n, self.v)
        sg = 1.0 if nv >= 0 else -1.0
        oid = self.new_id()
        mine = {oid} | set(own)
        edge_key = edge_key or key
        fo = add(o, mul(n, sg * t / 2))
        bo = add(o, mul(n, -sg * t / 2))

        def front(p):
            return comb(fo, (p[0], eu), (p[1], ev))

        def back(p):
            return comb(bo, (p[0], eu), (p[1], ev))

        pf = [[self.P(front(p)) for p in c] for c in contours]
        pb = [[self.P(back(p)) for p in c] for c in contours]
        if abs(nv) > 1e-3:
            self.fill(pf, oid)
            for c in pf:
                self.stroke_v(key, c + [c[0]], mine)
        if t > 0:
            for c, cf, cb in zip(contours, pf, pb):
                m = len(c)
                vis, turn = [], []
                for i in range(m):
                    p, q = c[i], c[(i + 1) % m]
                    dx, dy = q[0] - p[0], q[1] - p[1]
                    vis.append(dot(comb((0, 0, 0), (dy, eu), (-dx, ev)), self.v) > 1e-9)
                    turn.append(math.atan2(dy, dx))
                    if vis[-1]:
                        self.fill([[cf[i], cf[(i + 1) % m], cb[(i + 1) % m], cb[i]]], oid)
                if not any(vis):
                    continue
                start = next((i for i in range(m) if vis[i] and not vis[i - 1]), None)
                order = range(m) if start is None else [(start + i) % m for i in range(m)]
                run = []
                for i in order:
                    if vis[i]:
                        if not run:
                            run = [cb[i]]
                            if start is not None:
                                self.stroke_v(edge_key, [cf[i], cb[i]], mine)
                        elif abs((turn[i] - turn[i - 1] + math.pi) % (2 * math.pi) - math.pi) > math.radians(corner_deg):
                            self.stroke_v(edge_key, [cf[i], cb[i]], mine)
                        run.append(cb[(i + 1) % m])
                    elif run:
                        self.stroke_v(edge_key, run, mine)
                        self.stroke_v(edge_key, [cf[i], cb[i]], mine)
                        run = []
                if run:
                    self.stroke_v(edge_key, run, mine)
                    if start is not None:
                        e = (order[-1] + 1) % m
                        self.stroke_v(edge_key, [cf[e], cb[e]], mine)
                    elif abs((turn[0] - turn[-1] + math.pi) % (2 * math.pi) - math.pi) > math.radians(corner_deg):
                        self.stroke_v(edge_key, [cf[0], cb[0]], mine)
        return oid, front

    def band(self, c, axis, r, lat=0.0, hw=0.03, t=0.0, n=240, key="o", far_key="f", streaks=(), thr=0.25):
        """
        Ring of an armillary: the strip of the sphere of radius r between latitudes lat ± hw around
        the axis, with radial thickness t. The near half is drawn in outline, the far half fine.
        streaks: latitude offsets (as a fraction of hw) of the bright lines engraved where it faces the light.
        """
        a = unit(axis)
        e1 = perp(a)
        e2 = cross(a, e1)
        idn, idf = self.new_id(), self.new_id()

        def pt(la, th, rr=None, shrink=0.0):
            rr = r if rr is None else rr
            return comb(c, (rr * math.sin(la), a), (rr * math.cos(la) * math.cos(th) - shrink * math.cos(th), e1),
                        (rr * math.cos(la) * math.sin(th) - shrink * math.sin(th), e2))

        def near(p):
            return dot(sub(p, c), self.v) > 0

        lo, hi = lat - hw, lat + hw
        ths = [2 * math.pi * j / n for j in range(n + 1)]
        e_lo = [pt(lo, th) for th in ths]
        e_hi = [pt(hi, th) for th in ths]
        for j in range(n):
            oid = idn if near(pt(lat, (ths[j] + ths[j + 1]) / 2)) else idf
            q = [self.P(e_lo[j]), self.P(e_lo[j + 1]), self.P(e_hi[j + 1]), self.P(e_hi[j])]
            self.fill([[q[0], q[1], q[2]]], oid)
            self.fill([[q[0], q[2], q[3]]], oid)

        def split(pts, k_near, k_far, flags=None):
            run, state = [], None
            for i, p in enumerate(pts):
                s = near(p) if flags is None else flags[i]
                if s != state and run:
                    run.append(p)
                    self.stroke(k_near if state else k_far, run, {idn} if state else {idf})
                    run = []
                run.append(p)
                state = s
            if run:
                self.stroke(k_near if state else k_far, run, {idn} if state else {idf})

        split(e_lo, key, far_key)
        split(e_hi, key, far_key)
        if t > 0:
            la = hi if dot(a, self.v) > 0 else lo
            wall = [pt(la, th, shrink=t) for th in ths]
            split(wall, "f", far_key, [near(p) for p in (e_hi if la == hi else e_lo)])
        for s in streaks:
            la = lat + s * hw
            run = []
            for th in ths:
                p = pt(la, th)
                nrm = unit(sub(p, c))
                if near(p) and dot(nrm, self.L) > thr:
                    run.append(p)
                else:
                    self.stroke("h", run, {idn})
                    run = []
            self.stroke("h", run, {idn})
        return {"near": idn, "far": idf, "pt": pt, "is_near": near}

    def sphere(self, c, r, key="o"):
        oid = self.new_id()
        X, Y, D = self.P(c)
        S, W, H = RASTER, self.RW, self.RH
        rk = r * self.k
        for yi in range(max(0, int((Y - rk) * S)), min(H - 1, int((Y + rk) * S)) + 1):
            dy = (yi + 0.5) / S - Y
            if abs(dy) >= rk:
                continue
            half = math.sqrt(rk * rk - dy * dy)
            for xi in range(max(0, int(math.ceil((X - half) * S - 0.5))), min(W - 1, int(math.floor((X + half) * S - 0.5))) + 1):
                dx = (xi + 0.5) / S - X
                d = D + math.sqrt(max(rk * rk - dx * dx - dy * dy, 0.0))
                if d > self.zb[yi * W + xi]:
                    self.zb[yi * W + xi] = d
                    self.ib[yi * W + xi] = oid
        self.stroke_v(key, [(X + rk * math.cos(math.radians(q)), Y + rk * math.sin(math.radians(q)), D) for q in range(0, 361, 3)],
                      {oid}, tol=0.7)
        return oid
