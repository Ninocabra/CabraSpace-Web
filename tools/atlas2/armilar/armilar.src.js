/*!
 * armilar.js - animated armillary sphere, drawn as a white-line engraving (cabraspace.com)
 *
 * The same instrument as project/p1/armilar.svg (generator: project/p1/instrumentos.py + grabado.py),
 * but alive: the celestial cage (ecliptic with its zodiac scale, equator, tropics, polar circles,
 * colures) turns slowly on the polar axis while meridian, horizon, cradle and stand stay still.
 *
 * Use:   <div class="armilar" data-armilar aria-hidden="true"></div>   +   <script src="js/armilar.js" defer>
 * The script mounts itself on every [data-armilar], fills its box (aspect ratio 560:596, contained and
 * centred), paints with the element's currentColor and adds the class "is-live" to it.
 * It stops off screen and in hidden tabs, and stands still under prefers-reduced-motion.
 *
 * How it is drawn (no depth buffer at run time, so nothing can flicker):
 *   everything the cage is made of lies on three nested spheres, so the order from back to front never
 *   changes:  far static parts < far half of the rings (outer sphere first) < globe and axis <
 *   near half of the rings (inner sphere first) < near static parts.
 *   Each solid first ERASES what is behind it (its silhouette plus a thin halo), then gets its lines.
 *   The static parts were resolved once, offline, by the original Python engine and are kept as bitmaps.
 *
 * THIS FILE IS GENERATED: edit v2/tools/armilar/armilar.src.js and run build_armilar.py.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.document || window.Armilar) return;

  var DATA = /*__DATA__*/null;

  // ------------------------------------------------------------------ the plate (instrumentos.py::armilar)
  var W = 560, H = 596, CX = 280, CY = 208, R = 150;
  var PI = Math.PI, TAU = 2 * PI, RAD = PI / 180;
  var cos = Math.cos, sin = Math.sin, sqrt = Math.sqrt, atan2 = Math.atan2, acos = Math.acos;
  var LAT = 38.15 * RAD;            // latitude the instrument is set to (as in instrumentos.py)
  var EPS = 23.44 * RAD;            // obliquity of the ecliptic
  var HOUR0 = -58 * RAD;            // pose of the original engraving: the animation starts from it
  var PERIOD = 75000;               // ms per turn
  var GAP = 0.9;                    // clear halo between a hidden line and the edge that hides it, drawing units
  var STEP = 3 * RAD;               // sampling of the rings
  var FADE = 0.16 * R;              // depth over which the zodiac divisions grow as they come round the limb
  var CLIP = 152.5;                // the near static parts only need to hide the cage: disc of the sphere
  var WEIGHT = { o: [1.15, 1], h: [0.62, 0.8], f: [0.5, 0.62] };   // the three line weights: width, opacity

  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function unit(a) { var n = sqrt(dot(a, a)) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
  function mix(k1, a, k2, b) { return [k1 * a[0] + k2 * b[0], k1 * a[1] + k2 * b[1], k1 * a[2] + k2 * b[2]]; }

  // camera: Plate(560, 596, cx=280, cy=208, az=118, el=13); orthographic, depth grows towards the viewer
  var AZ = 118 * RAD, EL = 13 * RAD;
  var V = [cos(EL) * sin(AZ), -cos(EL) * cos(AZ), sin(EL)];
  var RV = [cos(AZ), sin(AZ), 0];
  var U = cross(V, RV);
  var LIGHT = unit([-0.62 * RV[0] + 0.52 * U[0] + 0.58 * V[0], -0.62 * RV[1] + 0.52 * U[1] + 0.58 * V[1],
                    -0.62 * RV[2] + 0.52 * U[2] + 0.58 * V[2]]);
  var POLE = [0, cos(LAT), sin(LAT)], EA = [1, 0, 0], EB = cross(POLE, EA);

  // ------------------------------------------------------------------ rings (grabado.py::Plate.band)
  // A ring is the strip of the sphere of radius r between the latitudes lat +- hw around its axis, with a
  // radial thickness t. Its near half is drawn in outline, its far half fine.
  function ring(r, lat, hw, streak, thr) {
    return { r: r, lat: lat, hw: hw, t: 0.02 * R, streak: streak, thr: thr, scale: false, turns: false,
             lo: {}, hi: {}, wall: {}, st: {}, c0: {}, c1: {} };
  }
  var ECL = ring(R, 0, 0.058, -0.55, 0.3);
  ECL.scale = true;
  var EQU = ring(0.985 * R, 0, 0.026, 0, 0.25);
  var PARALLELS = [EQU, ring(0.985 * R, EPS, 0.015, null), ring(0.985 * R, -EPS, 0.015, null),
                   ring(0.985 * R, PI / 2 - EPS, 0.015, null), ring(0.985 * R, -(PI / 2 - EPS), 0.015, null)];
  var COL1 = ring(0.97 * R, 0, 0.016, null), COL2 = ring(0.97 * R, 0, 0.016, null);
  var COLURES = [COL1, COL2], ECLIPTIC = [ECL];
  COL1.turns = COL2.turns = true;   // they pass edge-on twice a turn

  // One circle of a ring (a latitude, optionally shrunk towards the axis), ready to be sampled on the sheet:
  // x = x0 + ax cos(th) + bx sin(th), same for y and for the depth z; near the viewer for |th - thm| < w.
  function circ(b, c, la, shrink) {
    var k = b.r * sin(la), rho = b.r * cos(la) - shrink;
    c.x0 = CX + k * b.ar; c.y0 = CY - k * b.au; c.z0 = k * b.av;
    c.ax = rho * b.e1r; c.bx = rho * b.e2r;
    c.ay = -rho * b.e1u; c.by = -rho * b.e2u;
    c.az = rho * b.e1v; c.bz = rho * b.e2v;
    c.sg = b.av < 0 ? -1 : 1;                 // which way the circle runs on the sheet
    if (b.amp < 1e-9) c.w = c.z0 > 0 ? PI : 0;
    else {
      var q = -c.z0 / (rho * b.amp);
      c.w = q >= 1 ? 0 : q <= -1 ? PI : acos(q);
    }
  }

  // Puts a ring in space: axis a, and e1 a direction fixed to the ring (origin of its angles).
  function setFrame(b, a, e1) {
    var e2 = cross(a, e1);
    b.ar = dot(a, RV); b.au = dot(a, U); b.av = dot(a, V);
    b.e1r = dot(e1, RV); b.e1u = dot(e1, U); b.e1v = dot(e1, V);
    b.e2r = dot(e2, RV); b.e2u = dot(e2, U); b.e2v = dot(e2, V);
    b.thm = atan2(b.e2v, b.e1v);
    b.amp = sqrt(b.e1v * b.e1v + b.e2v * b.e2v);
    circ(b, b.lo, b.lat - b.hw, 0);
    circ(b, b.hi, b.lat + b.hw, 0);
    // the inner rim shows on the side the axis leans to the viewer; it is "near" where that edge is
    var edge = b.av > 0 ? b.hi : b.lo;
    circ(b, b.wall, b.av > 0 ? b.lat + b.hw : b.lat - b.hw, b.t);
    b.wall.w = edge.w;
    // Edge-on, the rim falls exactly on the edge line, and it jumps to the other edge as the ring turns
    // over. So the rim of a ring that does that fades out while it is that close, and returns on the other side.
    var k = b.turns ? (Math.abs(b.av) - 0.04) / 0.16 : 1;
    b.wall.k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
    if (b.streak !== null) {
      // bright line engraved where the ring faces the light: normal . L > thr
      var la = b.lat + b.streak * b.hw, al = dot(a, LIGHT), l1 = dot(e1, LIGHT), l2 = dot(e2, LIGHT);
      var q = (b.thr - sin(la) * al) / (cos(la) * (sqrt(l1 * l1 + l2 * l2) || 1e-9));
      circ(b, b.st, la, 0);
      b.st.lm = atan2(l2, l1);
      b.st.lw = q >= 1 ? 0 : q <= -1 ? PI : acos(q);
    }
    if (b.scale) { circ(b, b.c0, 0, 0); circ(b, b.c1, 0.034, 0); }
  }

  // Zodiac scale of the ecliptic: signs, decans and 2-degree divisions along one edge. The angles are
  // counted from the same origin the Python generator used, so the reference pose matches the engraving.
  var TICKS = (function () {
    var gam = mix(cos(HOUR0), EA, sin(HOUR0), EB), q = cross(POLE, gam);
    var ne = mix(cos(EPS), POLE, -sin(EPS), q);
    var e1o = unit(cross(ne, Math.abs(ne[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));      // grabado.perp()
    var ph = atan2(dot(e1o, cross(ne, gam)), dot(e1o, gam));
    var t = [];
    for (var d = 0; d < 360; d += 2) t.push(cos(ph + d * RAD), sin(ph + d * RAD), d % 30 === 0 ? 0 : d % 10 === 0 ? 1 : 2);
    return t;
  })();

  for (var i = 0; i < PARALLELS.length; i++) setFrame(PARALLELS[i], POLE, EA);    // these never change on the sheet

  var poseHour = null;
  function pose(hour) {
    if (hour === poseHour) return;
    poseHour = hour;
    var gam = mix(cos(hour), EA, sin(hour), EB);          // equinox
    var q = cross(POLE, gam);
    setFrame(ECL, mix(cos(EPS), POLE, -sin(EPS), q), gam);
    setFrame(COL1, q, POLE);
    setFrame(COL2, gam, POLE);
  }

  // ------------------------------------------------------------------ geometry -> path (g: a 2D context or a Path2D)
  // Arc of a circle from t0 to t1. The vertices sit on a lattice of angles FIXED TO THE RING (multiples of
  // STEP), plus the two exact ends: the polyline then turns rigidly with the ring. Resampling it from its
  // moving end at every frame would make every vertex slide along the curve, and the lines shimmer.
  // `off` displaces the arc sideways (drawing units; always towards the same side of the ring, whichever
  // way the arc is run and whichever face of the ring looks at the viewer): see lay().
  var COS_STEP = cos(STEP), SIN_STEP = sin(STEP);
  function vertex(g, c, cs, sn, off, move) {
    var x = c.x0 + c.ax * cs + c.bx * sn, y = c.y0 + c.ay * cs + c.by * sn;
    if (off) {
      var tx = c.bx * cs - c.ax * sn, ty = c.by * cs - c.ay * sn, k = off * c.sg / (sqrt(tx * tx + ty * ty) || 1);
      x -= ty * k; y += tx * k;
    }
    if (move) g.moveTo(x, y); else g.lineTo(x, y);
  }
  function arc(g, c, t0, t1, cont, off) {
    vertex(g, c, cos(t0), sin(t0), off, !cont);
    var up = t1 >= t0, a = t0 / STEP, b = t1 / STEP, k, k1, sd, tmp;
    if (up) { k = Math.floor(a + 0.02) + 1; k1 = Math.ceil(b - 0.02) - 1; sd = SIN_STEP; }
    else { k = Math.ceil(a - 0.02) - 1; k1 = Math.floor(b + 0.02) + 1; sd = -SIN_STEP; }
    var n = up ? k1 - k : k - k1;
    if (n >= 0) {
      var cs = cos(k * STEP), sn = sin(k * STEP);
      for (var i = 0; i <= n; i++) {
        vertex(g, c, cs, sn, off, false);
        tmp = cs * COS_STEP - sn * sd; sn = sn * COS_STEP + cs * sd; cs = tmp;
      }
    }
    vertex(g, c, cos(t1), sin(t1), off, false);
  }
  // the part of the sphere's outline between the ends of two circles: where a ring turns over the limb
  function limb(g, c0, t0, c1, t1, r) {
    var a0 = atan2(c0.y0 + c0.ay * cos(t0) + c0.by * sin(t0) - CY, c0.x0 + c0.ax * cos(t0) + c0.bx * sin(t0) - CX);
    var a1 = atan2(c1.y0 + c1.ay * cos(t1) + c1.by * sin(t1) - CY, c1.x0 + c1.ax * cos(t1) + c1.bx * sin(t1) - CX);
    var d = a1 - a0;
    while (d > PI) d -= TAU;
    while (d <= -PI) d += TAU;
    g.arc(CX, CY, r, a0, a1, d < 0);
  }
  var TINY = 1e-4;
  // closed outline of the near (or far) half of the strip
  function strip(g, b, near) {
    var lo = b.lo, hi = b.hi, m = b.thm, wl = lo.w, wh = hi.w, l0, l1, h0, h1;
    if (near) {
      if (wl < TINY && wh < TINY) return false;
      l0 = m - wl; l1 = m + wl; h0 = m - wh; h1 = m + wh;
    } else {
      if (wl > PI - TINY && wh > PI - TINY) return false;
      l0 = m + wl; l1 = m + TAU - wl; h0 = m + wh; h1 = m + TAU - wh;
    }
    var part = wl > TINY && wl < PI - TINY && wh > TINY && wh < PI - TINY;
    arc(g, lo, l0, l1, false, 0);
    if (part) limb(g, lo, l1, hi, h1, b.r);
    arc(g, hi, h1, h0, true, 0);
    if (part) limb(g, hi, h0, lo, l0, b.r);
    g.closePath();
    return true;
  }
  function half(g, c, m, near, off) {
    if (near) { if (c.w > TINY) arc(g, c, m - c.w, m + c.w, false, off); }
    else if (c.w < PI - TINY) arc(g, c, m + c.w, m + TAU - c.w, false, off);
  }
  function rim(g, b, near, off) { half(g, b.wall, b.thm, near, off); }
  // the rims of the rings that fade (see setFrame), each with its own opacity
  function rims(ctx, rings, near, inst) {
    for (var i = 0; i < rings.length; i++) {
      if (rings[i].turns) (function (b) { lay(ctx, 'f', inst, function (off) { rim(ctx, b, near, off); }, b.wall.k); })(rings[i]);
    }
  }
  function edges(g, b, near, off) { half(g, b.lo, b.thm, near, off); half(g, b.hi, b.thm, near, off); }
  function streak(g, b, off) {
    var c = b.st, w = c.w, d = c.lm - b.thm;
    while (d > PI) d -= TAU;
    while (d <= -PI) d += TAU;
    for (var k = -1; k <= 1; k++) {
      var a = Math.max(-w, d + k * TAU - c.lw), e = Math.min(w, d + k * TAU + c.lw);
      if (e - a > 1e-3) arc(g, c, b.thm + a, b.thm + e, false, off);
    }
  }
  function zodiac(g, b, off) {
    half(g, b.c0, b.thm, true, off);
    half(g, b.c1, b.thm, true, off);
    var from = [b.lo, b.c0, b.c1], c1 = b.hi;
    for (var i = 0; i < TICKS.length; i += 3) {
      var ct = TICKS[i], st = TICKS[i + 1], c0 = from[TICKS[i + 2]];
      var z0 = c0.z0 + c0.az * ct + c0.bz * st, z1 = c1.z0 + c1.az * ct + c1.bz * st;
      if (z1 <= 0) continue;
      var x0 = c0.x0 + c0.ax * ct + c0.bx * st, y0 = c0.y0 + c0.ay * ct + c0.by * st;
      var x1 = c1.x0 + c1.ax * ct + c1.bx * st, y1 = c1.y0 + c1.ay * ct + c1.by * st, k;
      // Towards the limb the divisions crowd together (closer than a line is wide) and a whole division
      // comes over the edge within three frames: it would twinkle. So over the last degrees before the
      // limb they grow from the outer edge of the band instead, as an engraver thins a scale out.
      k = z1 / FADE;
      if (k < 1) { k = k * k * (3 - 2 * k); x0 = x1 + (x0 - x1) * k; y0 = y1 + (y0 - y1) * k; z0 = z1 + (z0 - z1) * k; }
      if (z0 < 0) { k = z0 / (z0 - z1); x0 += (x1 - x0) * k; y0 += (y1 - y0) * k; }
      if (off) {
        var dx = x1 - x0, dy = y1 - y0, q = off / (sqrt(dx * dx + dy * dy) || 1);
        x0 -= dy * q; y0 += dx * q; x1 -= dy * q; y1 += dx * q;
      }
      g.moveTo(x0, y0); g.lineTo(x1, y1);
    }
  }

  // ------------------------------------------------------------------ laying a line
  // Browsers that draw the canvas on the GPU with multisampling render any stroke wider than one device
  // pixel with only a handful of coverage levels: a slowly moving line then crawls. Strokes of one pixel
  // or less take the exact (analytic) path instead. So a line of w pixels is laid as ceil(w) parallel
  // strokes of at most one pixel each, side by side, and their coverage is ADDED ('lighter'): the result
  // is the same line, with smooth edges, and it moves without shimmer. Elsewhere it changes nothing.
  // emit(off) must add the geometry, displaced `off` drawing units sideways, to the current path.
  function lay(ctx, k, inst, emit, fade) {
    var w = WEIGHT[k][0] * inst.boost, n = Math.max(1, Math.ceil(w * inst.s - 1e-6));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = WEIGHT[k][1] * (fade === undefined ? 1 : fade);
    ctx.lineWidth = w / n;
    for (var i = 0; i < n; i++) { ctx.beginPath(); emit((i - (n - 1) / 2) * w / n); ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ static parts: paths and masks, built once
  var PATHS = null, MASKS = null;
  // "M x yL x yL x y M ..." -> list of polylines [x, y, nx, ny, ...]; (nx, ny) is the sideways direction at
  // each vertex (the bisector, lengthened at the corners so that parallel copies stay parallel)
  function runs(d) {
    var out = [], parts = d.split('M'), i, j;
    for (i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var pts = parts[i].split(/[L ]/), n = pts.length >> 1, r = new Float32Array(4 * n);
      for (j = 0; j < n; j++) { r[4 * j] = +pts[2 * j]; r[4 * j + 1] = +pts[2 * j + 1]; }
      var closed = n > 2 && r[0] === r[4 * n - 4] && r[1] === r[4 * n - 3];
      for (j = 0; j < n; j++) {
        var a = j > 0 ? j - 1 : closed ? n - 2 : -1, b = j < n - 1 ? j + 1 : closed ? 1 : -1;
        var ux = 0, uy = 0, vx = 0, vy = 0, l;
        if (a >= 0) { ux = r[4 * j] - r[4 * a]; uy = r[4 * j + 1] - r[4 * a + 1]; l = sqrt(ux * ux + uy * uy) || 1; ux /= l; uy /= l; }
        if (b >= 0) { vx = r[4 * b] - r[4 * j]; vy = r[4 * b + 1] - r[4 * j + 1]; l = sqrt(vx * vx + vy * vy) || 1; vx /= l; vy /= l; }
        if (a < 0) { ux = vx; uy = vy; }
        if (b < 0) { vx = ux; vy = uy; }
        var mx = -(uy + vy), my = ux + vx, m2 = mx * mx + my * my;
        if (m2 < 0.3) { mx = -uy; my = ux; m2 = 1; }           // a hairpin: keep the incoming side
        var k = 2 / m2;                                         // = 1 / cos(half the turn) for the unit bisector
        r[4 * j + 2] = mx * k; r[4 * j + 3] = my * k;
      }
      out.push(r);
    }
    return out;
  }
  function trace(g, rs, off) {
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      g.moveTo(r[0] + r[2] * off, r[1] + r[3] * off);
      for (var j = 4; j < r.length; j += 4) g.lineTo(r[j] + r[j + 2] * off, r[j + 1] + r[j + 3] * off);
    }
  }
  function poly(p, a, dx, dy) {
    var n = a.length / 2, s = 0, i, j;
    for (i = 0; i < n; i++) { j = (i + 1) % n; s += a[2 * i] * a[2 * j + 1] - a[2 * j] * a[2 * i + 1]; }
    if (s >= 0) { p.moveTo(a[0] + dx, a[1] + dy); for (i = 1; i < n; i++) p.lineTo(a[2 * i] + dx, a[2 * i + 1] + dy); }
    else { p.moveTo(a[2 * n - 2] + dx, a[2 * n - 1] + dy); for (i = n - 2; i >= 0; i--) p.lineTo(a[2 * i] + dx, a[2 * i + 1] + dy); }
    p.closePath();
  }
  function maskPath(m) {
    var p = new Path2D(), i, j, k;
    for (i = 0; i < m.circles.length; i++) {
      var c = m.circles[i];
      p.moveTo(c[0] + c[2], c[1]); p.arc(c[0], c[1], c[2], 0, TAU); p.closePath();
    }
    for (i = 0; i < m.polys.length; i++) poly(p, m.polys[i], 0, 0);
    for (i = 0; i < m.sweeps.length; i++) {
      // a flat part with thickness: its front face, its back face and the band swept between them
      var a = m.sweeps[i].p, dx = m.sweeps[i].d[0], dy = m.sweeps[i].d[1], n = a.length / 2;
      poly(p, a, 0, 0); poly(p, a, dx, dy);
      for (j = 0; j < n; j++) {
        k = (j + 1) % n;
        poly(p, [a[2 * j], a[2 * j + 1], a[2 * k], a[2 * k + 1], a[2 * k] + dx, a[2 * k + 1] + dy, a[2 * j] + dx, a[2 * j + 1] + dy], 0, 0);
      }
    }
    return p;
  }
  function prepare() {
    if (PATHS) return;
    PATHS = {}; MASKS = {};
    ['far', 'mid', 'near'].forEach(function (la) {
      PATHS[la] = {};
      ['o', 'h', 'f'].forEach(function (k) { PATHS[la][k] = DATA[la][k] ? runs(DATA[la][k]) : null; });
      MASKS[la] = DATA[la].mask ? maskPath(DATA[la].mask) : null;
    });
  }

  function layer(inst, la) {
    var s = inst.s, b = DATA[la].box;
    var x0 = Math.max(0, Math.floor(b[0] * s + inst.ox)), y0 = Math.max(0, Math.floor(b[1] * s + inst.oy));
    var x1 = Math.min(inst.pw, Math.ceil(b[2] * s + inst.ox)), y1 = Math.min(inst.ph, Math.ceil(b[3] * s + inst.oy));
    var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    var L = { x: x0, y: y0, lines: document.createElement('canvas'), mask: null };
    L.lines.width = w; L.lines.height = h;
    var tmp = document.createElement('canvas'), c = tmp.getContext('2d'), out = L.lines.getContext('2d');
    tmp.width = w; tmp.height = h;
    c.lineCap = c.lineJoin = 'round';
    ['f', 'h', 'o'].forEach(function (k) {
      if (!PATHS[la][k]) return;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
      c.setTransform(s, 0, 0, s, inst.ox - x0, inst.oy - y0);
      lay(c, k, inst, function (off) { trace(c, PATHS[la][k], off); });
      out.drawImage(tmp, 0, 0);
    });
    if (MASKS[la]) {
      L.mask = document.createElement('canvas');
      L.mask.width = w; L.mask.height = h;
      c = L.mask.getContext('2d');
      c.setTransform(s, 0, 0, s, inst.ox - x0, inst.oy - y0);
      if (la === 'near') { c.beginPath(); c.arc(CX, CY, CLIP, 0, TAU); c.clip(); }
      c.lineJoin = 'round';
      c.lineWidth = 2 * GAP + WEIGHT.o[0] * inst.boost;
      c.fill(MASKS[la]); c.stroke(MASKS[la]);
    }
    return L;
  }

  // ------------------------------------------------------------------ one frame
  function blit(ctx, L) {
    if (L.mask) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(L.mask, L.x, L.y);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(L.lines, L.x, L.y);
  }
  // Rings that lie on the same sphere: first they all hide what is behind them, then they get their lines.
  function group(ctx, rings, near, inst) {
    var i, any = false, lit = false;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    for (i = 0; i < rings.length; i++) {
      ctx.beginPath();
      if (strip(ctx, rings[i], near)) { ctx.fill('evenodd'); any = true; }
      if (rings[i].streak !== null) lit = true;
    }
    if (!any) { ctx.globalCompositeOperation = 'source-over'; return; }
    ctx.beginPath();
    for (i = 0; i < rings.length; i++) edges(ctx, rings[i], near, 0);
    ctx.lineCap = 'butt';
    ctx.lineWidth = 2 * GAP + WEIGHT[near ? 'o' : 'f'][0] * inst.boost;
    ctx.stroke();                                           // the halo along both edges
    ctx.lineCap = 'round';
    if (near) {
      lay(ctx, 'f', inst, function (off) {
        for (var j = 0; j < rings.length; j++) {
          if (!rings[j].turns) rim(ctx, rings[j], true, off);
          if (rings[j].scale) zodiac(ctx, rings[j], off);
        }
      });
      rims(ctx, rings, true, inst);
      if (lit) lay(ctx, 'h', inst, function (off) { for (var j = 0; j < rings.length; j++) if (rings[j].streak !== null) streak(ctx, rings[j], off); });
      // The outline goes on top of the fine lines, as in the engraving: what it covers is removed first.
      // (Adding it over them would thicken it wherever a fine line runs along it: where the divisions meet
      // the edge and, above all, when a ring passes edge-on and its rim falls on the edge line.)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      for (i = 0; i < rings.length; i++) edges(ctx, rings[i], true, 0);
      ctx.lineWidth = WEIGHT.o[0] * inst.boost;
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.lineCap = 'round';
      lay(ctx, 'o', inst, function (off) { for (var j = 0; j < rings.length; j++) edges(ctx, rings[j], true, off); });
    } else {
      lay(ctx, 'f', inst, function (off) {
        for (var j = 0; j < rings.length; j++) { edges(ctx, rings[j], false, off); if (!rings[j].turns) rim(ctx, rings[j], false, off); }
      });
      rims(ctx, rings, false, inst);
    }
  }

  function draw(inst) {
    var ctx = inst.ctx, s = inst.s, k = inst;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, inst.pw, inst.ph);
    blit(ctx, inst.far);
    ctx.setTransform(s, 0, 0, s, inst.ox, inst.oy);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = '#000';
    group(ctx, ECLIPTIC, false, k);
    group(ctx, PARALLELS, false, k);
    group(ctx, COLURES, false, k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    blit(ctx, inst.mid);
    ctx.setTransform(s, 0, 0, s, inst.ox, inst.oy);
    group(ctx, COLURES, true, k);
    group(ctx, PARALLELS, true, k);
    group(ctx, ECLIPTIC, true, k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    blit(ctx, inst.near);
    ctx.globalCompositeOperation = 'source-in';             // everything was drawn as opacity: now the ink
    ctx.fillStyle = inst.color || '#e5b53f';
    ctx.fillRect(0, 0, inst.pw, inst.ph);
  }

  // ------------------------------------------------------------------ instances, clock and observers
  var list = [], raf = 0, last = 0, clock = 0, frozen = null, forced = false, lastDraw = 0;
  var wakeUntil = 0, wakeFrames = 0, lastInk = 0;
  var stat = { n: 0, sum: 0, max: 0 };
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(mq && mq.matches); }
  function still() { return frozen !== null || (reduced() && !forced); }
  function hourNow() { return HOUR0 - (frozen !== null ? frozen : TAU * (clock / PERIOD)); }
  function moving(inst) { return inst.seen && inst.pw > 0 && !document.hidden && !still(); }
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }

  function paint(inst) {
    if (!inst.pw || !inst.far) return;
    var t0 = now();
    pose(hourNow());
    draw(inst);
    inst.dirty = false;
    var dt = now() - t0;
    stat.n++; stat.sum += dt; if (dt > stat.max) stat.max = dt;
  }
  function ink(inst) {
    var c = window.getComputedStyle(inst.el).color;
    if (c && c !== inst.color) { inst.color = c; inst.dirty = true; wake(700); }   // still changing: keep looking
  }
  function tick(t) {
    raf = 0;
    var i, any = false, awake = t < wakeUntil || wakeFrames > 0;
    if (wakeFrames > 0) wakeFrames--;
    for (i = 0; i < list.length; i++) if (moving(list[i])) any = true;
    if (any && last) clock += Math.min(100, t - last);
    last = any ? t : 0;
    if (awake || t - lastDraw > 12) {                        // at most ~60 frames per second on fast displays
      lastDraw = t;
      var look = awake || t - lastInk > 500;                 // while turning, the ink is looked at twice a second anyway
      if (look) lastInk = t;
      for (i = 0; i < list.length; i++) {
        if (look) ink(list[i]);
        if (list[i].dirty || moving(list[i])) paint(list[i]);
      }
    }
    if (any || t < wakeUntil || wakeFrames > 0) raf = window.requestAnimationFrame(tick);
  }
  function run() { if (!raf && !document.hidden) raf = window.requestAnimationFrame(tick); }
  // Keeps the loop awake re-reading the ink, for a time AND for a number of frames (a throttled page may
  // draw a single frame in that time): a class change on <body> usually comes with a colour transition.
  function wake(ms) { wakeUntil = Math.max(wakeUntil, now() + ms); wakeFrames = Math.max(wakeFrames, 6); run(); }

  function size(inst, pw, ph) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (!pw || !ph) { pw = Math.round(inst.el.clientWidth * dpr); ph = Math.round(inst.el.clientHeight * dpr); }
    var cap = Math.min(1, 2600 / Math.max(pw, ph, 1));        // a huge box does not need a huge bitmap
    pw = Math.round(pw * cap); ph = Math.round(ph * cap); dpr *= cap;
    if (pw === inst.pw && ph === inst.ph) return;
    inst.pw = pw; inst.ph = ph;
    if (!pw || !ph) return;
    inst.cv.width = pw; inst.cv.height = ph;
    var s = Math.min(pw / W, ph / H), css = s / dpr;
    inst.s = s; inst.ox = (pw - s * W) / 2; inst.oy = (ph - s * H) / 2;
    inst.boost = css < 0.75 ? Math.pow(0.75 / css, 0.6) : 1;   // shown small, the lines get a little more body
    inst.far = layer(inst, 'far'); inst.mid = layer(inst, 'mid'); inst.near = layer(inst, 'near');
    ink(inst);
    paint(inst);                                               // at once: resizing a canvas blanks it
    run();
  }

  function mount(el) {
    if (!el || el.__armilar) return el && el.__armilar;
    var cv = document.createElement('canvas'), ctx = cv.getContext && cv.getContext('2d');
    if (!ctx || typeof Path2D === 'undefined') return null;   // the page keeps its static fallback
    prepare();
    cv.style.cssText = 'display:block;width:100%;height:100%';
    cv.setAttribute('aria-hidden', 'true');
    var inst = { el: el, cv: cv, ctx: ctx, pw: 0, ph: 0, s: 1, ox: 0, oy: 0, boost: 1, seen: true, dirty: true, color: '',
                 far: null, mid: null, near: null };
    el.__armilar = inst;
    el.appendChild(cv);
    list.push(inst);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function (es) {
        var e = es[es.length - 1], b = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
        if (b) size(inst, b.inlineSize, b.blockSize); else size(inst);
      });
      try { ro.observe(el, { box: 'device-pixel-content-box' }); } catch (err) { ro.observe(el); }
    } else window.addEventListener('resize', function () { size(inst); });
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) { inst.seen = es[es.length - 1].isIntersecting; if (inst.seen) run(); },
                               { rootMargin: '80px' }).observe(el);
    }
    size(inst);
    el.classList.add('is-live');
    return inst;
  }

  function init() {
    var els = document.querySelectorAll('[data-armilar]');
    for (var i = 0; i < els.length; i++) mount(els[i]);
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { wake(1600); });
      var opt = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
      mo.observe(document.documentElement, opt);
      if (document.body) mo.observe(document.body, opt);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(100); });
    var ev = function (e) { if (e.propertyName === 'color') wake(300); };       // the ink may be inherited: listen to all
    ['transitionrun', 'transitionend', 'transitioncancel'].forEach(function (n) { document.addEventListener(n, ev, true); });
    if (mq) {
      var on = function () { wake(100); };
      if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    }
    run();
  }

  window.Armilar = {
    mount: function (el) { var m = mount(el); run(); return !!m; },
    // debugging: hold the cage `deg` degrees past the pose of the engraving (null or resume() lets it turn again)
    freeze: function (deg) {
      frozen = deg === null || deg === undefined ? null : deg * RAD;
      for (var i = 0; i < list.length; i++) paint(list[i]);
      run();
    },
    resume: function () { this.freeze(null); },
    // The sphere stands still when the system asks for reduced motion. motion(true) lets it turn anyway
    // (for a control the visitor presses on purpose); motion(false) goes back to obeying the system.
    motion: function (on) { forced = !!on; run(); },
    // 'turning', 'still' (reduced motion, or frozen for debugging) or 'idle' (nothing on screen)
    state: function () {
      if (still()) return 'still';
      for (var i = 0; i < list.length; i++) if (moving(list[i])) return 'turning';
      return 'idle';
    },
    reducedMotion: reduced,
    // script time per frame, in ms, since the last call
    stats: function () {
      var r = { frames: stat.n, avg: stat.n ? stat.sum / stat.n : 0, max: stat.max, turned: (TAU * clock / PERIOD) / RAD % 360 };
      stat = { n: 0, sum: 0, max: 0 };
      return r;
    },
    // draws n consecutive poses of a whole turn on every instance and returns the mean ms per frame of each
    bench: function (n) {
      n = n || 240;
      var keep = frozen, out = [];
      for (var i = 0; i < list.length; i++) {
        var t0 = now();
        for (var j = 0; j < n; j++) { frozen = TAU * j / n; pose(hourNow()); draw(list[i]); }
        out.push({ height: list[i].ph, ms: (now() - t0) / n });
      }
      frozen = keep;
      for (i = 0; i < list.length; i++) paint(list[i]);
      return out;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
