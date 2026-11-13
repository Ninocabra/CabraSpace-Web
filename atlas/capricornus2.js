/* ==========================================================================
   CabraSpace · Atlas II — Capricornio animada (heroe de la portada)

   Mueve las diez estrellas de la figura desde hace 7 millones de anos (primeros
   hominidos) hasta hoy. Cada una va en linea recta en 3D desde su posicion,
   paralaje, movimiento propio y velocidad radial (SIMBAD, CDS, 2026-09-24); su
   brillo cambia con la distancia. Mas alla de ~1 millon de anos la linea recta
   ignora el tiron de la Galaxia: las posiciones antiguas son solo indicativas.

   Portado de Pagina Web/index.html (script generado por tools/capricornus.py).
   Lo que cambia respecto a la web actual:
     - Proyeccion: la de la carta de fondo (estereografica, mismo centro, misma
       escala y mismo marco de 2400 x 760), para que la figura REGISTRE con ella.
       La web actual usaba una gnomonica propia de su SVG pequeno.
     - Las estrellas llevan el simbolo que la carta da a su clase de magnitud, y
       las lineas se acortan al llegar a cada una (como en la carta), sin halo.

   Marcado que espera (lo escribe tools/atlas2/carta_capricornio.py en atlas/atlas2-muestra.html; en F3, tambien en la portada):
     svg#cap-chart  path#cap-s0..9 (lineas)  path#cap-<estrella>  text#cap-t-<estrella>
     #cap-time  #cap-play  #cap-dot  #cap-age  #cap-era  .cap-tick[data-age]
   Sin JS, o con prefers-reduced-motion, queda el cielo de hoy; el boton permite
   arrancarla a mano.

   El bloque de datos lo reescribe tools/atlas2/carta_capricornio.py: no editar a mano.
   ========================================================================== */
(function () {
  'use strict';
/* DATA-BEGIN */
  var D = {"stars":[{"n":"alf02","r":[18.488816,-26.887755,-7.260942],"v":[8.618531e-06,4.975238e-06,2.26082e-07],"m":3.58,"d":33.42916,"p":4,"ro":3.8,"ri":1.35},{"n":"bet01","r":[66.465421,-94.036724,-30.385157],"v":[9.995203e-06,3.000748e-05,5.158588e-06],"m":3.08,"d":119.09582,"p":6,"ro":4.9,"ri":2.1},{"n":"del","r":[9.534465,-6.248646,-3.296217],"v":[1.493304e-06,1.702247e-05,-1.5431836e-05],"m":2.83,"d":11.86662,"p":6,"ro":4.9,"ri":2.1},{"n":"eps","r":[208.11305,-149.708978,-90.613049],"v":[-9.153375e-06,2.6035741e-05,8.69507e-06],"m":4.55,"d":271.90907,"p":0,"ro":1.3,"ri":0},{"n":"gam","r":[41.090167,-28.747401,-15.009208],"v":[3.505538e-06,5.9551702e-05,6.820562e-06],"m":3.67,"d":52.34588,"p":4,"ro":3.8,"ri":1.35},{"n":"iot","r":[45.616812,-37.521234,-17.871798],"v":[1.5193496e-05,-1.106902e-06,-2.228775e-06],"m":4.27,"d":61.71011,"p":4,"ro":3.8,"ri":1.35},{"n":"ome","r":[103.025573,-110.654054,-76.766853],"v":[-2.89266e-07,-1.0566099e-05,-5.714606e-06],"m":4.12,"d":169.56337,"p":4,"ro":3.8,"ri":1.35},{"n":"psi","r":[8.772543,-9.90723,-6.246961],"v":[1.0936345e-05,-1.7975364e-05,-2.2087626e-05],"m":4.122,"d":14.63336,"p":4,"ro":3.8,"ri":1.35},{"n":"tet","r":[31.621219,-30.02128,-13.524641],"v":[1.887403e-06,2.3323177e-05,-9.730565e-06],"m":4.07,"d":45.65189,"p":4,"ro":3.8,"ri":1.35},{"n":"zet","r":[98.380241,-77.788653,-51.722679],"v":[4.6423e-06,-6.913061e-06,1.3593675e-05],"m":3.74,"d":135.66496,"p":4,"ro":3.8,"ri":1.35}],"segs":[["alf02","bet01"],["bet01","tet"],["tet","iot"],["iot","gam"],["gam","del"],["bet01","psi"],["psi","ome"],["ome","zet"],["zet","eps"],["eps","del"]],"greek":{"alf02":[10,-7],"bet01":[10,9],"gam":[2,-10],"del":[-17,-8],"eps":[-3,17],"zet":[-6,19],"tet":[-3,-10],"iot":[-2,-9],"psi":[9,-4],"ome":[9,12]},"proj":{"ra0":315.5,"de0":-19.5,"k":888.0846,"cx":1200.0,"cy":380.0},"view":[965,226,470,312],"gap":3.4,"maxAge":7000000.0};
/* DATA-END */
  var svg = document.getElementById('cap-chart');
  var ui = document.getElementById('cap-time');
  if (!svg || !ui || !D) return;

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var en = (document.documentElement.lang || 'es').slice(0, 2) === 'en';
  var P = D.proj, V = D.view;

  // base of the projection: C towards the centre, E east, N north
  var r0 = P.ra0 * Math.PI / 180, d0 = P.de0 * Math.PI / 180;
  var C = [Math.cos(d0) * Math.cos(r0), Math.cos(d0) * Math.sin(r0), Math.sin(d0)];
  var E = [-Math.sin(r0), Math.cos(r0), 0];
  var N = [C[1] * E[2] - C[2] * E[1], C[2] * E[0] - C[0] * E[2], C[0] * E[1] - C[1] * E[0]];
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var el = {};
  D.stars.forEach(function (s) {
    el[s.n] = { star: document.getElementById('cap-' + s.n), label: document.getElementById('cap-t-' + s.n) };
  });
  var segs = D.segs.map(function (_, i) { return document.getElementById('cap-s' + i); });
  if (D.stars.some(function (s) { return !el[s.n].star; }) || segs.some(function (p) { return !p; })) return;

  // 1 inside the window, falling to 0 over the last m pixels before its edge
  function inside(x, y, m) {
    return clamp(Math.min(x - V[0], V[0] + V[2] - x, y - V[1], V[1] + V[3] - y) / m, 0, 1);
  }

  function place(age) {
    var pos = {};
    D.stars.forEach(function (s) {
      var p = [s.r[0] - s.v[0] * age, s.r[1] - s.v[1] * age, s.r[2] - s.v[2] * age];
      var d = Math.sqrt(dot(p, p)), cc = dot(p, C) / d;
      var mag = s.m + 5 * Math.log10(d / s.d);
      var ok = cc > 0.2, k = P.k * 2 / (1 + cc);
      var x = ok ? P.cx - k * dot(p, E) / d : -999, y = ok ? P.cy - k * dot(p, N) / d : -999;
      var vis = ok ? inside(x, y, 24) * clamp((6.5 - mag) / 1.5, 0, 1) : 0;
      var ro = clamp(s.ro + (s.m - mag) * 1.2, 0.8, 9);   // today: exactly the chart's symbol
      pos[s.n] = [x, y, vis, ro];
      var e = el[s.n];
      e.star.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + (ro / s.ro).toFixed(3) + ')');
      e.star.style.opacity = vis.toFixed(3);
      if (e.label) {
        var o = D.greek[s.n];
        e.label.setAttribute('x', (x + o[0]).toFixed(1)); e.label.setAttribute('y', (y + o[1]).toFixed(1));
        e.label.style.opacity = vis.toFixed(3);
      }
    });
    D.segs.forEach(function (sg, i) {
      var a = pos[sg[0]], b = pos[sg[1]], dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.sqrt(dx * dx + dy * dy), ga = a[3] + D.gap, gb = b[3] + D.gap;
      var vis = Math.min(a[2], b[2]);
      if (len <= ga + gb + 2 || vis <= 0) { segs[i].style.opacity = '0'; return; }
      var ux = dx / len, uy = dy / len;
      segs[i].setAttribute('d', 'M' + (a[0] + ux * ga).toFixed(1) + ' ' + (a[1] + uy * ga).toFixed(1)
        + 'L' + (b[0] - ux * gb).toFixed(1) + ' ' + (b[1] - uy * gb).toFixed(1));
      segs[i].style.opacity = (vis * vis).toFixed(3);
    });
  }

  // time runs slower near today, where the figure takes shape
  function ageAt(s) { return D.maxAge * Math.pow(1 - s, 4); }
  function sAt(age) { return 1 - Math.pow(age / D.maxAge, 0.25); }

  var ageEl = document.getElementById('cap-age'), eraEl = document.getElementById('cap-era');
  var dotEl = document.getElementById('cap-dot'), btn = document.getElementById('cap-play');
  if (!ageEl || !eraEl || !dotEl || !btn) return;
  ui.hidden = false;
  ui.querySelectorAll('.cap-tick').forEach(function (t) {
    t.style.left = (sAt(+t.getAttribute('data-age')) * 100).toFixed(2) + '%';
  });

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
  function show(s) {
    var a = ageAt(s);
    place(a);
    ageEl.textContent = fmt(a); eraEl.textContent = era(a); dotEl.style.left = (s * 100).toFixed(2) + '%';
  }

  var RUN = 24000, HOLD = 7000, FADE = 1200, t0 = null, paused = false, pauseAt = 0, visible = true;
  function frame(ts) {
    if (paused || !visible) { t0 = null; return; }
    if (t0 === null) t0 = ts - pauseAt;
    var t = (ts - t0) % (RUN + HOLD);
    pauseAt = t;
    show(Math.min(1, t / RUN));
    var fade = t > RUN + HOLD - FADE ? (RUN + HOLD - t) / FADE : t < FADE ? t / FADE : 1;
    svg.style.opacity = (0.35 + 0.65 * fade).toFixed(3);
    requestAnimationFrame(frame);
  }
  function setPaused(p) {
    paused = p; btn.classList.toggle('paused', p);
    btn.setAttribute('aria-label', btn.getAttribute(p ? 'data-play' : 'data-pause'));
  }
  btn.addEventListener('click', function () {
    setPaused(!paused);
    if (!paused) requestAnimationFrame(frame);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      var was = visible; visible = es[0].isIntersecting;
      if (visible && !was && !paused) requestAnimationFrame(frame);
    }).observe(ui);
  }
  if (reduced) {
    // no autoplay: today's sky, and the button starts it by hand (from the beginning)
    setPaused(true); show(1);
  } else {
    requestAnimationFrame(frame);
  }

  // for checks from the console or a test: where the animation puts things at a given age
  window.capricornus = { place: place, show: show, data: D };
})();
