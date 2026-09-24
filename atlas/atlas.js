// CabraSpace · Atlas — common header behaviour (drawer, active section, night mode, scroll state).
// Replaces mobile-menu.js. Markup comes from tools/sync_nav.py.
(function () {
  if (window.__atlasInit) return;
  window.__atlasInit = true;

  var SECTIONS = {
    obs: ['observaciones', 'eclipse-', 'transito-'],
    herr: ['herramientas', 'cabraspace-imaging-workflow', 'pi-workflow', 'astroforecast', 'autoghs', 'contaminacion-mapa', 'pixelmath'],
    prog: ['programas', 'cabrascripts'],
    bit: ['bitacora', 'novedades', 'equipamiento', 'cursos-youtube', 'contaminacion', 'divulgacion-']
  };

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var header = document.querySelector('header.ah');

    // Active section, from the page file name.
    var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var sec = null;
    Object.keys(SECTIONS).some(function (k) {
      // contaminacion-mapa is a tool, contaminacion.html is a log entry
      var hit = SECTIONS[k].some(function (p) {
        if (p === 'contaminacion') return /^contaminacion(-en)?\.html$/.test(file);
        return file.indexOf(p) === 0;
      });
      if (hit) sec = k;
      return hit;
    });
    if (sec) {
      document.querySelectorAll('[data-sec="' + sec + '"]').forEach(function (el) {
        el.classList.add('on');
        if (el.tagName === 'A') el.setAttribute('aria-current', 'page');
      });
    }

    // Header background once the page scrolls.
    if (header) {
      var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 20); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    // Drawer (tablet and phone).
    var burger = document.querySelector('.ah-burger');
    var drawer = document.getElementById('atlas-drawer');
    if (burger && drawer) {
      var set = function (open) {
        drawer.hidden = !open;
        burger.setAttribute('aria-expanded', String(open));
        document.body.classList.toggle('menu-open', open);
        if (open) {
          var first = drawer.querySelector('.ad-close');
          if (first) first.focus();
        } else {
          burger.focus();
        }
      };
      burger.addEventListener('click', function () { set(drawer.hidden); });
      drawer.addEventListener('click', function (e) { if (e.target === drawer) set(false); });
      drawer.querySelectorAll('.ad-close').forEach(function (b) {
        b.addEventListener('click', function () { set(false); });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !drawer.hidden) set(false);
      });
      window.addEventListener('resize', function () {
        if (window.innerWidth > 1100 && !drawer.hidden) set(false);
      });
    }

    // Night mode (red), same localStorage key as before.
    document.querySelectorAll('.ah-night').forEach(function (btn) {
      var sync = function () {
        btn.setAttribute('aria-pressed', String(document.body.classList.contains('night-vision')));
      };
      sync();
      btn.addEventListener('click', function () {
        var on = document.body.classList.toggle('night-vision');
        try { localStorage.setItem('night-vision', on ? 'enabled' : 'disabled'); } catch (e) {}
        document.querySelectorAll('.ah-night').forEach(function (b) { b.setAttribute('aria-pressed', String(on)); });
      });
      sync();
    });
  });
})();
