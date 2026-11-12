/*
 * Continuity test for v2/js/armilar.js: does anything jump between two frames?
 *
 * Load it from the console of v2/armilar-demo.html:
 *     var s = document.createElement('script'); s.src = 'tools/armilar/test-continuity.js'; document.head.appendChild(s);
 *     await ArmilarTest.sweep(0, 360, 0.02)          // whole turn in steps of 0.02 degrees (a frame is ~0.08)
 *     await ArmilarTest.sweep(0, 20, 0.02, 7.5)      // positive control: a 3.6-unit segment pops in at 7.5 degrees
 *
 * It does NOT compare pixels: on a GPU canvas with multisampling the pixels of a moving edge change in
 * steps of 1/4 of coverage whatever the geometry does, so a pixel metric cannot tell a pop from the
 * rasteriser (measured: 60/255 jumps for a 0.001 px shift). It hooks the 2D context of the first sphere
 * and, for every fill and stroke of a frame, measures what was drawn:
 *     L   total length of the path          -> a segment appearing or vanishing is a jump in L
 *     C   centroid of the path (per length) -> a line jumping to another place is a jump in C
 *     A   signed area (fills)               -> an erased region flipping or folding is a jump in A
 *     a   opacity of the stroke             -> a line may fade, but slowly; what it does while invisible
 *                                              (opacity under 0.03) is not counted
 * For a smooth motion the change of each one per step is of the order of the rigid motion
 * (R * step = 0.05 units at 0.02 degrees); a discontinuity does not shrink with the step.
 */
(function () {
  'use strict';
  var cv = document.querySelector('[data-armilar] canvas'), ctx = cv.getContext('2d');
  var P = CanvasRenderingContext2D.prototype;
  var calls = null, cur = null, last = null, first = null, popAt = null, angle = 0;

  function fresh() { return { L: 0, mx: 0, my: 0, A: 0, n: 0 }; }
  function seg(x, y) {
    if (last) {
      var dx = x - last[0], dy = y - last[1], l = Math.sqrt(dx * dx + dy * dy);
      cur.L += l; cur.mx += l * (x + last[0]) / 2; cur.my += l * (y + last[1]) / 2;
      cur.A += (last[0] * y - x * last[1]) / 2; cur.n++;
    }
    last = [x, y];
  }
  function close() { if (first && last) { cur.A += (last[0] * first[1] - first[0] * last[1]) / 2; } }
  cur = fresh();
  ctx.beginPath = function () { cur = fresh(); last = first = null; return P.beginPath.call(this); };
  ctx.moveTo = function (x, y) { close(); last = [x, y]; first = [x, y]; return P.moveTo.call(this, x, y); };
  ctx.lineTo = function (x, y) { seg(x, y); return P.lineTo.call(this, x, y); };
  ctx.arc = function (x, y, r, a0, a1, cc) {
    var d = a1 - a0, i, n;
    if (cc) { while (d > 0) d -= 2 * Math.PI; } else { while (d < 0) d += 2 * Math.PI; }
    n = Math.max(1, Math.ceil(Math.abs(d) / 0.05));
    for (i = 0; i <= n; i++) seg(x + r * Math.cos(a0 + d * i / n), y + r * Math.sin(a0 + d * i / n));
    return P.arc.call(this, x, y, r, a0, a1, cc);
  };
  ctx.closePath = function () { close(); if (first) last = first.slice(); first = null; return P.closePath.call(this); };
  ctx.stroke = function () {
    if (arguments.length === 0) {
      // positive control: from popAt on, the last stroke of the frame gets an extra segment out of nowhere
      if (popAt !== null && angle >= popAt && this.lineWidth > 0.64 && this.globalCompositeOperation === 'lighter') {
        last = [300, 300]; seg(303.6, 300);
      }
      if (calls) calls.push(['S', this.globalCompositeOperation, this.lineWidth.toFixed(2), cur.L, cur.mx, cur.my, 0, this.globalAlpha]);
    }
    return P.stroke.apply(this, arguments);
  };
  ctx.fill = function () {
    close();
    if (calls) calls.push(['F', this.globalCompositeOperation, '', cur.L, cur.mx, cur.my, cur.A, 1]);
    return P.fill.apply(this, arguments);
  };

  function frame(a) { calls = []; angle = a; window.Armilar.freeze(a); return calls; }
  function pause() {
    return new Promise(function (r) { var c = new MessageChannel(); c.port1.onmessage = function () { r(); }; c.port2.postMessage(0); });
  }

  window.ArmilarTest = {
    frame: frame,
    // thresholds in drawing units per step; pass the step you sweep with
    sweep: async function (a0, a1, step, pop) {
      popAt = pop === undefined ? null : pop;
      var lim = { L: 3 * 150 * step * Math.PI / 180, C: 2 * 150 * step * Math.PI / 180, A: 60 * 150 * step * Math.PI / 180,
                  a: 0.25 * step };                       // a full fade may not take less than 4 degrees of turn
      var st = { frames: 0, calls: 0, limits: lim, max: { L: 0, C: 0, A: 0, a: 0 }, events: [] };
      var prev = frame(a0), n = Math.round((a1 - a0) / step), i, j;
      st.calls = prev.length;
      for (i = 1; i <= n; i++) {
        var a = a0 + i * step, c = frame(a);
        if (c.length !== prev.length) st.events.push({ angle: +a.toFixed(3), what: 'number of draw calls ' + prev.length + ' -> ' + c.length });
        else for (j = 0; j < c.length; j++) {
          var p = prev[j], q = c[j], dL = Math.abs(q[3] - p[3]), Lm = Math.max(q[3], p[3], 60);
          var cx = p[4] / Math.max(p[3], 1e-9), cy = p[5] / Math.max(p[3], 1e-9);
          var dC = Math.hypot(q[4] - p[4] - (q[3] - p[3]) * cx, q[5] - p[5] - (q[3] - p[3]) * cy) / Lm;
          var dA = Math.abs(q[6] - p[6]), da = Math.abs(q[7] - p[7]);
          if (Math.min(p[7], q[7]) < 0.03) dL = dC = 0;
          if (dL > st.max.L) st.max.L = dL;
          if (dC > st.max.C) st.max.C = dC;
          if (dA > st.max.A) st.max.A = dA;
          if (da > st.max.a) st.max.a = da;
          if (dL > lim.L || dC > lim.C || dA > lim.A || da > lim.a) {
            st.events.push({ angle: +a.toFixed(3), call: j, kind: q[0] + ' ' + q[1] + ' ' + q[2],
                             dL: +dL.toFixed(3), dC: +dC.toFixed(4), dA: +dA.toFixed(2), da: +da.toFixed(4) });
          }
        }
        prev = c; st.frames = i;
        if (i % 200 === 0) await pause();
      }
      popAt = null;
      window.Armilar.freeze(0);
      return st;
    }
  };
})();
