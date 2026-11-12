"""
Engraving helpers for the P5 friezes ("Del cielo al taller").

Same white-line technique as Pagina Web/tools/observatorio.py: the page is dark, lit surfaces carry
the lines, light comes from the left. Three stroke weights (outline, hatch, fine) plus a few fainter
ones for distance and for the ruled sky.

What is new here is occlusion. The SVG is used as a CSS mask, so nothing can be "painted over":
every object is drawn in a layer and declares its silhouette, and each layer is masked by the
silhouettes of all the layers in front of it (SVG <mask>, cumulative through <use>). Lines behind
an object stop cleanly at its edge, which is what an engraver does.

The output is monochrome black on transparent, with no <style>, no animation and no images.
"""
import math
import random
import re

STYLES = {
    "o": 'stroke-width="1.15"',                          # outline
    "h": 'stroke-width=".6" stroke-opacity=".8"',        # hatch
    "f": 'stroke-width=".5" stroke-opacity=".6"',        # fine
    "b": 'stroke-width="1.5"',                           # bold, foreground only
    "d": 'stroke-width=".8" stroke-opacity=".75"',       # distant outline
    "df": 'stroke-width=".45" stroke-opacity=".5"',      # distant fine
}


def f(v):
    s = f"{v:.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    return "0" if s == "-0" else s


_TOKEN = re.compile(r"[MLHVQAZaq]|-?\d*\.?\d+")


def path_bbox(d):
    """Bounding box of the subset of path syntax this module emits (control points included)."""
    xs, ys = [], []
    x = y = 0.0
    tok = _TOKEN.findall(d)
    i, cmd = 0, "M"
    while i < len(tok):
        if tok[i].isalpha():
            cmd = tok[i]
            i += 1
            if cmd == "Z":
                continue
        if cmd in "ML":
            x, y = float(tok[i]), float(tok[i + 1])
            i += 2
            if cmd == "M":
                cmd = "L"
        elif cmd == "H":
            x = float(tok[i])
            i += 1
        elif cmd == "V":
            y = float(tok[i])
            i += 1
        elif cmd == "Q":
            xs.append(float(tok[i]))
            ys.append(float(tok[i + 1]))
            x, y = float(tok[i + 2]), float(tok[i + 3])
            i += 4
        elif cmd == "q":
            xs.append(x + float(tok[i]))
            ys.append(y + float(tok[i + 1]))
            x, y = x + float(tok[i + 2]), y + float(tok[i + 3])
            i += 4
        elif cmd in "Aa":
            rx, ry = float(tok[i]), float(tok[i + 1])
            ex, ey = float(tok[i + 5]), float(tok[i + 6])
            if cmd == "a":
                ex, ey = x + ex, y + ey
            r = max(rx, ry)
            xs += [min(x, ex) - r, max(x, ex) + r]
            ys += [min(y, ey) - r, max(y, ey) + r]
            x, y = ex, ey
            i += 7
        else:
            i += 1
            continue
        xs.append(x)
        ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


class Plate:
    def __init__(self, w, h, seed, styles=None):
        self.w, self.h = w, h
        self.rng = random.Random(seed)
        self.styles = dict(STYLES)
        if styles:
            self.styles.update(styles)
        self.layers = []
        self.layer()

    # ------------------------------------------------------------ layers
    def layer(self):
        self.cur = {"paths": {}, "sil": []}
        self.layers.append(self.cur)
        return self.cur

    def add(self, key, d):
        self.cur["paths"].setdefault(key, []).append(d)

    def sil(self, pts, evenodd=False):
        """Closed silhouette of what has just been drawn: hides everything in the layers behind."""
        d = pts if isinstance(pts, str) else "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + "Z"
        self.cur["sil"].append((d, evenodd))

    def sil_rect(self, x0, y0, x1, y1):
        self.sil([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    def sil_circle(self, cx, cy, r):
        self.sil(f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0Z")

    # ------------------------------------------------------------ primitives
    def line(self, key, x1, y1, x2, y2):
        a, b, c, d = f(x1), f(y1), f(x2), f(y2)
        self.add(key, f"M{a} {b}H{c}" if b == d else f"M{a} {b}V{d}" if a == c else f"M{a} {b}L{c} {d}")

    def poly(self, key, pts, close=False):
        if len(pts) < 2:
            return
        self.add(key, "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + ("Z" if close else ""))

    def rect(self, key, x0, y0, x1, y1):
        self.poly(key, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)

    def box(self, key, x0, y0, x1, y1):
        """Rectangle that also hides what is behind it."""
        self.rect(key, x0, y0, x1, y1)
        self.sil_rect(x0, y0, x1, y1)

    def circle(self, key, cx, cy, r):
        self.add(key, f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0")

    def ellipse(self, key, cx, cy, rx, ry):
        self.add(key, f"M{f(cx - rx)} {f(cy)}a{f(rx)} {f(ry)} 0 1 0 {f(2 * rx)} 0a{f(rx)} {f(ry)} 0 1 0 {f(-2 * rx)} 0")

    def arc(self, key, cx, cy, r, a0, a1, ry=None, step=6):
        """Arc from angle a0 to a1 (degrees, 0 = east, counter-clockwise on screen = y up)."""
        ry = r if ry is None else ry
        n = max(2, int(abs(a1 - a0) / step) + 1)
        self.poly(key, [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / (n - 1))),
                         cy - ry * math.sin(math.radians(a0 + (a1 - a0) * i / (n - 1)))) for i in range(n)])

    def arch(self, key, x0, x1, top, bottom, sil=False):
        """Round-headed opening."""
        r = (x1 - x0) / 2
        d = f"M{f(x0)} {f(bottom)}V{f(top + r)}A{f(r)} {f(r)} 0 0 1 {f(x1)} {f(top + r)}V{f(bottom)}Z"
        self.add(key, d)
        if sil:
            self.cur["sil"].append((d, False))

    def hatch_h(self, key, x0, y0, x1, y1, step, inset=0.9):
        y = y0 + step * 0.6
        while y < y1 - step * 0.3:
            self.line(key, x0 + inset, y, x1 - inset, y)
            y += step

    def hatch_v(self, key, x0, y0, x1, y1, step, inset=0.9):
        x = x0 + step * 0.6
        while x < x1 - step * 0.3:
            self.line(key, x, y0 + inset, x, y1 - inset)
            x += step

    def dashes(self, key, x0, x1, y, lo, hi, gap_lo, gap_hi, fn=None):
        """Broken horizontal (or fn-following) line: an engraver lifting the burin."""
        rng = self.rng
        x = x0 + rng.uniform(0, gap_hi)
        while x < x1:
            ln = rng.uniform(lo, hi)
            xe = min(x + ln, x1)
            if fn is None:
                self.line(key, x, y, xe, y)
            else:
                n = max(2, int((xe - x) / 6) + 1)
                self.poly(key, [(x + (xe - x) * i / (n - 1), fn(x + (xe - x) * i / (n - 1))) for i in range(n)])
            x = xe + rng.uniform(gap_lo, gap_hi)

    # ------------------------------------------------------------ billowing masses
    def blob(self, circles, key="o", inner=("h", "f"), tail=(), key_tail="h", sil=True, inner_span=(185, 262)):
        """Union of circles drawn the engraver's way: only the outer boundary, plus short billows on
        the lit (upper-left) side of each one. Used for smoke, clouds and foliage."""
        def covered(i, x, y, margin=0.4):
            return any(j != i and (x - cx) ** 2 + (y - cy) ** 2 < (r - margin) ** 2
                       for j, (cx, cy, r) in enumerate(circles))

        def later(i, x, y):
            return any(j > i and (x - cx) ** 2 + (y - cy) ** 2 < r * r for j, (cx, cy, r) in enumerate(circles))

        for i, (cx, cy, r) in enumerate(circles):
            step = 5 if r > 8 else 9
            is_tail = i in tail
            span = range(160, 381, step) if is_tail else range(0, 361, step)
            run = []
            for a in span:
                x, y = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
                if covered(i, x, y):
                    self.poly(key_tail if is_tail else key, run)
                    run = []
                else:
                    run.append((x, y))
            self.poly(key_tail if is_tail else key, run)
            if inner:
                for k, kk in ((0.66, inner[0]), (0.4, inner[1])):
                    if r * k < 2.2:
                        continue
                    run = []
                    for a in range(inner_span[0], inner_span[1], 7):
                        x, y = cx + r * k * math.cos(math.radians(a)), cy + r * k * math.sin(math.radians(a))
                        if later(i, x, y):
                            self.poly(kk, run)
                            run = []
                        else:
                            run.append((x, y))
                    self.poly(kk, run)
            if sil:
                self.sil_circle(cx, cy, r - 0.3)

    # ------------------------------------------------------------ output
    def svg(self, fade_x=0.0, fade_top=0.0, fade_bottom=0.0):
        w, h = self.w, self.h
        n = len(self.layers)
        defs = []
        # cumulative silhouettes: c{i} = silhouettes of layer i and of every layer in front of it
        nxt = None
        has = [False] * (n + 1)
        for i in range(n - 1, -1, -1):
            sil = self.layers[i]["sil"]
            if not sil and nxt is None:
                continue
            body = "".join(f'<path{" fill-rule=\"evenodd\"" if eo else ""} d="{d}"/>' for d, eo in sil)
            if nxt is not None:
                body += f'<use href="#c{nxt}"/>'
            if sil:
                defs.append(f'<g id="c{i}">{body}</g>')
                nxt = i
            has[i] = True
        # for each layer, the nearest c{j} with j > i
        front = [None] * n
        last = None
        for i in range(n - 1, -1, -1):
            front[i] = last
            if self.layers[i]["sil"]:
                last = i
        # one mask per layer, no larger than what the layer draws: the renderer needs an offscreen
        # buffer of that size for each, so a full-plate mask for a chimney would be wasteful
        for i in range(n):
            j = front[i]
            lay = self.layers[i]
            if j is None or not lay["paths"]:
                continue
            boxes = [b for v in lay["paths"].values() for b in (path_bbox(d) for d in v) if b]
            x0 = max(0, math.floor(min(b[0] for b in boxes) - 3))
            y0 = max(0, math.floor(min(b[1] for b in boxes) - 3))
            x1 = min(w, math.ceil(max(b[2] for b in boxes) + 3))
            y1 = min(h, math.ceil(max(b[3] for b in boxes) + 3))
            defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}">'
                        f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="#fff"/>'
                        f'<g fill="#000"><use href="#c{j}"/></g></mask>')
        fade = fade_x or fade_top or fade_bottom
        if fade:
            a, b = fade_x / w, 1 - fade_x / w
            t, u = fade_top / h, 1 - fade_bottom / h
            defs.append(f'<linearGradient id="fx" x1="0" x2="1" y1="0" y2="0">'
                        f'<stop offset="0" stop-color="#000"/><stop offset="{a:.3f}" stop-color="#fff"/>'
                        f'<stop offset="{b:.3f}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>'
                        f'<linearGradient id="fy" x1="0" x2="0" y1="0" y2="1">'
                        f'<stop offset="0" stop-color="#000"/><stop offset="{t:.3f}" stop-color="#fff"/>'
                        f'<stop offset="{u:.3f}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>'
                        f'<mask id="mx" maskUnits="userSpaceOnUse" x="0" y="0" width="{w}" height="{h}">'
                        f'<rect width="{w}" height="{h}" fill="url(#fx)"/></mask>'
                        f'<mask id="my" maskUnits="userSpaceOnUse" x="0" y="0" width="{w}" height="{h}">'
                        f'<rect width="{w}" height="{h}" fill="url(#fy)"/></mask>')
        out = []
        for i, lay in enumerate(self.layers):
            if not lay["paths"]:
                continue
            body = "".join(f'<path {self.styles[k]} d="{"".join(v)}"/>' for k, v in lay["paths"].items())
            j = front[i]
            out.append(f'<g mask="url(#m{i})">{body}</g>' if j is not None else body)
        inner = f'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">{"".join(out)}</g>'
        if fade:
            inner = f'<g mask="url(#mx)"><g mask="url(#my)">{inner}</g></g>'
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
                f'<defs>{"".join(defs)}</defs>{inner}</svg>\n')

    def write(self, path, **kw):
        s = self.svg(**kw)
        path.write_text(s, encoding="utf-8")
        print(f"{path.name}: {len(s) / 1024:.1f} KB, {len(self.layers)} layers")


def value_noise(rng, n=1024):
    vals = [rng.random() for _ in range(n)]

    def noise(x):
        i = math.floor(x)
        t = x - i
        t = t * t * (3 - 2 * t)
        return vals[i % n] * (1 - t) + vals[(i + 1) % n] * t

    def fbm(x, octaves=4):
        s, a, tot = 0.0, 1.0, 0.0
        for k in range(octaves):
            s += a * noise(x * 2 ** k + 17.3 * k)
            tot += a
            a *= 0.5
        return s / tot

    return fbm
