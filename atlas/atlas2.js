/* ==========================================================================
   CabraSpace · Atlas II — comportamiento del MARCO de todas las paginas (unico script de cabecera)
   Desde F2 (12-11-2026) sustituye a atlas/atlas.js en las 54 paginas (lo enlaza tools/sync_nav.py).
     1. Orla graduada de la hoja (.hoja): 24 horas arriba y abajo, de +90 a -90 grados a los lados,
        y una estrella en cada esquina.
     2. Filtro SVG de noche #cb-noche: viene en la cabecera (svg.cab-filtros); si una pagina no lo
        trae (prototipo, muestrario), se inyecta aqui.
     3. Modo noche: body.night-vision, botones .cab-noche, localStorage 'night-vision'
        ('enabled' / 'disabled'), la misma clave de siempre. Los <script> en linea de cada pagina
        aplican la clase antes de pintar; aqui solo se sincroniza el boton y se alterna.
        UN solo manejador por boton: no cargar tambien atlas/atlas.js (se anularian los clics).
     4. Cajon movil: .cab-burger abre y cierra #atlas-drawer (atributo hidden, clase .cab.is-open,
        aria-expanded). Se cierra con Escape y al pasar a escritorio (> 980 px).
   La seccion actual (aria-current) la escribe tools/sync_nav.py en el marcado: aqui no se calcula.
   Sin dependencias. Se carga al final del <body>.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__atlas2Init) return;
  window.__atlas2Init = true;

  // ---- 1. orla
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,1.5 13.38,8.67 19.42,4.58 15.33,10.62 22.5,12 15.33,13.38 19.42,19.42 13.38,15.33 12,22.5 10.62,15.33 4.58,19.42 8.67,13.38 1.5,12 8.67,10.62 4.58,4.58 10.62,8.67" fill="currentColor"></polygon></svg>';
  function roman(n) {
    var out = '', t = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    t.forEach(function (p) { while (n >= p[0]) { out += p[1]; n -= p[0]; } });
    return out;
  }
  function cells(labels) {
    return labels.map(function (l) { return l ? '<i><b>' + l + '</b></i>' : '<i></i>'; }).join('');
  }
  function strip(cls, labels) {
    var d = document.createElement('div');
    d.className = 'orla ' + cls;
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = cells(labels);
    return d;
  }
  // the side scales run from +90 to -90 degrees; each 10 degrees takes 1, 2 or 4 cells so that a cell
  // stays near 44 px whatever the height of the page (a short page gets fewer, wider divisions)
  function perTen(hoja) { return Math.max(1, Math.min(4, Math.pow(2, Math.round(Math.log(hoja.offsetHeight / 18 / 44) / Math.LN2)))) || 1; }
  function degrees(per) {
    var out = [], i, v;
    for (i = 0; i < 18 * per; i++) {
      v = 90 - 10 * (i / per);
      out.push(i % per === 0 && i > 0 ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°' : '');
    }
    return out;
  }
  document.querySelectorAll('.hoja').forEach(function (hoja) {
    if (hoja.querySelector(':scope > .orla')) return;
    var hours = [''], i, per = perTen(hoja);
    for (i = 23; i >= 1; i--) hours.push(roman(i));                 // XXIII ... I, as right ascension grows to the left
    var frag = document.createDocumentFragment();
    frag.appendChild(strip('orla-t', hours));
    frag.appendChild(strip('orla-b', hours));
    var left = strip('orla-l', degrees(per)), right = strip('orla-r', degrees(per));
    frag.appendChild(left);
    frag.appendChild(right);
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'esq esq-' + c;
      s.setAttribute('aria-hidden', 'true');
      s.innerHTML = STAR;
      frag.appendChild(s);
    });
    hoja.insertBefore(frag, hoja.firstChild);
    // the page grows or shrinks (images arrive, the window changes): redo the side scales only if the count changes
    function refit() {
      var p = perTen(hoja);
      if (p === per) return;
      per = p;
      left.innerHTML = right.innerHTML = cells(degrees(per));
    }
    if ('ResizeObserver' in window) new ResizeObserver(refit).observe(hoja);
    else window.addEventListener('resize', refit);
  });

  // ---- 2. filtro de noche (respaldo: normalmente ya viene en la cabecera)
  // la luminancia va entera al canal rojo (verde y azul casi a cero): ninguna zona brillante sale verde o amarilla
  if (!document.getElementById('cb-noche')) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    var f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', 'cb-noche'); f.setAttribute('color-interpolation-filters', 'sRGB');
    var m = document.createElementNS(ns, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', '0.17 0.57 0.06 0 0  0.008 0.028 0.003 0 0  0 0 0 0 0  0 0 0 1 0');
    f.appendChild(m); svg.appendChild(f); document.body.appendChild(svg);
  }

  // ---- 3. modo noche
  function nightOn() { return document.body.classList.contains('night-vision'); }
  var nightBtns = document.querySelectorAll('.cab-noche');
  function syncNight() {
    nightBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(nightOn())); });
  }
  try { if (localStorage.getItem('night-vision') === 'enabled') document.body.classList.add('night-vision'); } catch (e) {}
  syncNight();
  nightBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var on = document.body.classList.toggle('night-vision');
      try { localStorage.setItem('night-vision', on ? 'enabled' : 'disabled'); } catch (e) {}
      syncNight();
    });
  });

  // ---- 4. cajon movil
  document.querySelectorAll('.cab').forEach(function (cab) {
    var burger = cab.querySelector('.cab-burger');
    var drawer = document.getElementById(burger ? burger.getAttribute('aria-controls') || 'atlas-drawer' : 'atlas-drawer');
    if (!burger || !drawer) return;
    var labels = { open: burger.getAttribute('data-open') || burger.getAttribute('aria-label'),
                   close: burger.getAttribute('data-close') || burger.getAttribute('aria-label') };
    function set(open, focusBurger) {
      drawer.hidden = !open;
      cab.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? labels.close : labels.open);
      if (!open && focusBurger) burger.focus();
    }
    set(false);
    burger.addEventListener('click', function () { set(drawer.hidden); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !drawer.hidden) set(false, true);
    });
    var mq = window.matchMedia('(min-width: 981px)');
    var onWide = function () { if (mq.matches && !drawer.hidden) set(false); };
    if (mq.addEventListener) mq.addEventListener('change', onWide); else window.addEventListener('resize', onWide);
  });
})();
