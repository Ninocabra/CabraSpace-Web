"""
Capricornus chart for the home page, animated from the first hominins (≈7 Myr ago) to today.

Each star moves in a straight line in 3D from its catalogue position, parallax, proper motion and
radial velocity (SIMBAD, CDS, queried 2026-09-24). Its magnitude changes with distance. The static
SVG is today's sky; atlas-cap.js (inline, below) animates it. Beyond ~1 Myr a straight line ignores
the Galaxy's pull, so older positions are only indicative (said on the page).

Projection: gnomonic around RA 315.5°, Dec −19.5°, east to the left, fitted to the Atlas drawing
(2 px rms).
"""
import json
import math

# name, RA°, Dec°, parallax mas, pmRA* mas/yr, pmDec mas/yr, RV km/s, V mag — SIMBAD 2026-09-24
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
GREEK = {"alf02": ("α", 8, -4), "bet01": ("β", 9, 6), "del": ("δ", -14, -6), "gam": ("γ", 2, -10),
         "zet": ("ζ", -6, 18), "ome": ("ω", 8, 12)}
PROJ = {"ra0": 315.5, "de0": -19.5, "k": 673.14, "x0": 161.25, "y0": 112.11}
VIEW = (-20, -10, 370, 250)
K_PM = 4.740470446                 # km/s per (arcsec/yr · pc)
KMS_PCYR = 1.0227121650537077e-6   # pc/yr per km/s
MAX_AGE = 7.0e6                    # years: first hominins


def _unit(ra, de):
    a, d = math.radians(ra), math.radians(de)
    return [math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)]


def _stars():
    out = []
    for n, ra, de, plx, pmra, pmde, rv, v in CATALOGUE:
        a, d = math.radians(ra), math.radians(de)
        dist = 1000.0 / plx
        u = _unit(ra, de)
        ea = [-math.sin(a), math.cos(a), 0.0]
        ed = [-math.sin(d) * math.cos(a), -math.sin(d) * math.sin(a), math.cos(d)]
        vel = [(rv * u[i] + K_PM * pmra / 1000 * dist * ea[i] + K_PM * pmde / 1000 * dist * ed[i]) * KMS_PCYR for i in range(3)]
        out.append({"n": n, "r": [round(u[i] * dist, 6) for i in range(3)], "v": [round(x, 12) for x in vel], "m": v, "d": round(dist, 5)})
    return out


def _basis():
    ra0, de0 = math.radians(PROJ["ra0"]), math.radians(PROJ["de0"])
    c = [math.cos(de0) * math.cos(ra0), math.cos(de0) * math.sin(ra0), math.sin(de0)]
    e = [-math.sin(ra0), math.cos(ra0), 0.0]
    n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]]
    return c, e, n


def _xy(p):
    c, e, n = _basis()
    dot = lambda a, b: sum(a[i] * b[i] for i in range(3))
    pc = dot(p, c)
    return PROJ["x0"] - PROJ["k"] * dot(p, e) / pc, PROJ["y0"] - PROJ["k"] * dot(p, n) / pc


def _radius(m):
    return max(0.7, 3.3 - 0.85 * (m - 2.83))


def _polyline(points):
    return " ".join(("M" if i == 0 else "L") + f"{x:.1f} {y:.1f}" for i, (x, y) in enumerate(points))


def chart(lang):
    es = lang == "es"
    stars = {s["n"]: s for s in _stars()}
    pos = {n: _xy(s["r"]) for n, s in stars.items()}
    o = [f'<svg class="carta" id="cap-chart" width="430" height="290" viewBox="{" ".join(map(str, VIEW))}" role="img" aria-label="'
         + ("Carta de la constelación de Capricornio" if es else "Chart of the constellation Capricornus") + '">']
    # graticule: meridians RA 20h/21h/22h, parallels −15° / −25°
    grid = []
    for ra, lab in ((300, "XX h"), (315, "XXI h"), (330, "XXII h")):
        pts = [_xy(_unit(ra, de)) for de in range(-34, -1, 2)]
        grid.append(f'<path d="{_polyline(pts)}" stroke="rgba(229,181,63,0.10)" stroke-width="0.6" fill="none"></path>')
        x, y = _xy(_unit(ra, -31.5))
        grid.append(f'<text x="{x + 4:.0f}" y="{min(y, 236):.0f}" font-family="Bodoni Moda, serif" font-style="italic" font-size="9" fill="rgba(229,181,63,0.45)">{lab}</text>')
    for de, lab in ((-15, "−15°"), (-25, "−25°")):
        pts = [_xy(_unit(ra, de)) for ra in range(290, 342, 2)]
        grid.append(f'<path d="{_polyline(pts)}" stroke="rgba(229,181,63,0.10)" stroke-width="0.6" fill="none"></path>')
        x, y = _xy(_unit(333.5, de))
        grid.append(f'<text x="{max(x, -10):.0f}" y="{y - 4:.0f}" font-family="Bodoni Moda, serif" font-style="italic" font-size="9" fill="rgba(229,181,63,0.45)">{lab}</text>')
    # ecliptic (J2000 obliquity)
    eps = math.radians(23.4392911)
    ecl = []
    for lam in range(280, 352, 2):
        L = math.radians(lam)
        ra = math.degrees(math.atan2(math.sin(L) * math.cos(eps), math.cos(L))) % 360
        de = math.degrees(math.asin(math.sin(eps) * math.sin(L)))
        ecl.append(_xy(_unit(ra, de)))
    grid.append(f'<path d="{_polyline(ecl)}" fill="none" stroke="rgba(224,96,63,0.45)" stroke-width="1" stroke-dasharray="5 5"></path>')
    lx, ly = _xy(_unit(302.0, -20.2))
    grid.append(f'<text x="{lx:.0f}" y="{ly + 14:.0f}" font-family="Bodoni Moda, serif" font-style="italic" font-size="11" fill="rgba(224,96,63,0.5)">{"eclíptica" if es else "ecliptic"}</text>')
    o += grid
    for i, line in enumerate(LINES):
        o.append(f'<path id="cap-l{i}" d="{_polyline([pos[n] for n in line])}" fill="none" stroke="rgba(229,181,63,0.5)" stroke-width="1"></path>')
    for n, s in stars.items():
        x, y = pos[n]
        r = _radius(s["m"])
        o.append(f'<g id="cap-{n}"><circle cx="{x:.1f}" cy="{y:.1f}" r="{r + 3:.2f}" fill="#110d09"></circle>'
                 f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r * 0.85:.2f}" fill="rgba(248,241,226,0.85)"></circle></g>')
    for n, (g, dx, dy) in GREEK.items():
        x, y = pos[n]
        o.append(f'<text id="cap-t-{n}" x="{x + dx:.1f}" y="{y + dy:.1f}" font-family="Bodoni Moda, serif" font-style="italic" font-size="12" fill="rgba(199,191,169,0.7)">{g}</text>')
    o.append("</svg>")
    ctrl = (
        '<div class="cap-time" id="cap-time" hidden>'
        f'<button type="button" class="ic cap-play" id="cap-play" aria-label="{"Pausar la animación" if es else "Pause the animation"}" '
        f'data-pause="{"Pausar la animación" if es else "Pause the animation"}" data-play="{"Reanudar la animación" if es else "Resume the animation"}">'
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>'
        '<path class="i-play" d="M8 5v14l11-7z" fill="currentColor"></path></svg></button>'
        '<div class="cap-track"><span class="cap-bar"></span><span class="cap-dot" id="cap-dot"></span>'
        + "".join(f'<span class="cap-tick" data-age="{a}"></span>' for a in (7.0e6, 2.8e6, 3.0e5, 0))
        + f'</div><span class="cap-txt"><span class="cap-age" id="cap-age" aria-live="off"></span><span class="cap-era" id="cap-era"></span></span></div>')
    return "\n".join(o), ctrl


def script(lang):
    data = {"stars": _stars(), "lines": LINES, "greek": {n: [dx, dy] for n, (_, dx, dy) in GREEK.items()},
            "proj": PROJ, "view": VIEW, "maxAge": MAX_AGE, "lang": lang}
    return """  <script>
  (function () {
    var D = %s;
    var svg = document.getElementById('cap-chart'); if (!svg) return;
    var ui = document.getElementById('cap-time');
    // reduced motion: no autoplay, but the button is there to start it by hand
    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    ui.hidden = false;
    var en = D.lang === 'en', P = D.proj, V = D.view;
    var r0 = P.ra0 * Math.PI / 180, d0 = P.de0 * Math.PI / 180;
    var C = [Math.cos(d0) * Math.cos(r0), Math.cos(d0) * Math.sin(r0), Math.sin(d0)];
    var E = [-Math.sin(r0), Math.cos(r0), 0];
    var N = [C[1] * E[2] - C[2] * E[1], C[2] * E[0] - C[0] * E[2], C[0] * E[1] - C[1] * E[0]];
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    var el = {};
    D.stars.forEach(function (s) {
      var g = document.getElementById('cap-' + s.n);
      el[s.n] = { halo: g.children[0], dot: g.children[1], label: document.getElementById('cap-t-' + s.n) };
    });
    var lines = D.lines.map(function (_, i) { return document.getElementById('cap-l' + i); });
    function inside(x, y, m) { return Math.max(0, Math.min(1, Math.min(x - V[0], V[0] + V[2] - x, y - V[1], V[1] + V[3] - y) / m)); }
    function place(age) {
      var pos = {};
      D.stars.forEach(function (s) {
        var p = [s.r[0] - s.v[0] * age, s.r[1] - s.v[1] * age, s.r[2] - s.v[2] * age];
        var d = Math.sqrt(dot(p, p)), pc = dot(p, C) / d;
        var mag = s.m + 5 * Math.log10(d / s.d);
        var ok = pc > 0.5, x = ok ? P.x0 - P.k * dot(p, E) / d / pc : -999, y = ok ? P.y0 - P.k * dot(p, N) / d / pc : -999;
        var vis = ok ? inside(x, y, 24) * Math.max(0, Math.min(1, (6.5 - mag) / 1.5)) : 0;
        var r = Math.max(0.7, 3.3 - 0.85 * (mag - 2.83));
        pos[s.n] = [x, y, vis];
        var e = el[s.n];
        e.halo.setAttribute('cx', x.toFixed(1)); e.halo.setAttribute('cy', y.toFixed(1)); e.halo.setAttribute('r', (r + 3).toFixed(2));
        e.dot.setAttribute('cx', x.toFixed(1)); e.dot.setAttribute('cy', y.toFixed(1)); e.dot.setAttribute('r', (r * 0.85).toFixed(2));
        e.halo.style.opacity = e.dot.style.opacity = vis.toFixed(3);
        if (e.label) { var o = D.greek[s.n]; e.label.setAttribute('x', (x + o[0]).toFixed(1)); e.label.setAttribute('y', (y + o[1]).toFixed(1)); e.label.style.opacity = vis.toFixed(3); }
      });
      D.lines.forEach(function (line, i) {
        var dd = '', vmin = 1;
        line.forEach(function (n, j) { var q = pos[n]; dd += (j ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); vmin = Math.min(vmin, q[2]); });
        lines[i].setAttribute('d', dd); lines[i].style.opacity = (vmin * vmin).toFixed(3);
      });
    }
    // time runs slower near today, where the figure takes shape
    function ageAt(s) { return D.maxAge * Math.pow(1 - s, 4); }
    function sAt(age) { return 1 - Math.pow(age / D.maxAge, 0.25); }
    var ageEl = document.getElementById('cap-age'), eraEl = document.getElementById('cap-era'), dotEl = document.getElementById('cap-dot');
    document.querySelectorAll('.cap-tick').forEach(function (t) { t.style.left = (sAt(+t.getAttribute('data-age')) * 100).toFixed(2) + '%%'; });
    function fmt(a) {
      if (a < 500) return en ? 'today' : 'hoy';
      if (a >= 1e6) { var m = (a / 1e6).toFixed(1); return en ? m + ' million years ago' : 'hace ' + m.replace('.', ',') + ' millones de años'; }
      var k = a >= 1e5 ? Math.round(a / 1e4) * 10 : a >= 1e4 ? Math.round(a / 1e3) : Math.max(1, Math.round(a / 100) / 10);
      return en ? k.toLocaleString('en') + ' thousand years ago' : 'hace ' + String(k).replace('.', ',') + ' mil años';
    }
    function era(a) {
      if (a < 500) return en ? 'the sky we see' : 'el cielo que vemos';
      if (a > 2.8e6) return en ? 'first hominins' : 'primeros homínidos';
      if (a > 3.0e5) return en ? 'genus Homo' : 'género Homo';
      return 'Homo sapiens';
    }
    var RUN = 24000, HOLD = 7000, FADE = 1200, t0 = null, paused = false, pauseAt = 0, visible = true;
    function frame(ts) {
      if (paused || !visible) { t0 = null; return; }
      if (t0 === null) t0 = ts - pauseAt;
      var t = (ts - t0) %% (RUN + HOLD);
      pauseAt = t;
      var s = Math.min(1, t / RUN), a = ageAt(s);
      place(a);
      ageEl.textContent = fmt(a); eraEl.textContent = era(a); dotEl.style.left = (s * 100).toFixed(2) + '%%';
      var fade = t > RUN + HOLD - FADE ? (RUN + HOLD - t) / FADE : t < FADE ? t / FADE : 1;
      svg.style.opacity = (0.35 + 0.65 * fade).toFixed(3);
      requestAnimationFrame(frame);
    }
    var btn = document.getElementById('cap-play');
    btn.addEventListener('click', function () {
      paused = !paused; btn.classList.toggle('paused', paused);
      btn.setAttribute('aria-label', btn.getAttribute(paused ? 'data-play' : 'data-pause'));
      if (!paused) requestAnimationFrame(frame);
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        var was = visible; visible = es[0].isIntersecting;
        if (visible && !was && !paused) requestAnimationFrame(frame);
      }).observe(svg);
    }
    if (reduced) {
      paused = true; btn.classList.add('paused'); btn.setAttribute('aria-label', btn.getAttribute('data-play'));
      ageEl.textContent = fmt(0); eraEl.textContent = era(0); dotEl.style.left = '100%%';
    } else {
      requestAnimationFrame(frame);
    }
  })();
  </script>""" % json.dumps(data, separators=(",", ":"))
