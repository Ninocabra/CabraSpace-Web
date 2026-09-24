// Mobile/tablet menu for the Atlas mock-up
(function () {
  var btn = document.querySelector('.hamb');
  var menu = document.getElementById('mmenu');
  if (!btn || !menu) return;
  function set(open) {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
  }
  btn.addEventListener('click', function () { set(menu.hidden); });
  menu.addEventListener('click', function (e) { if (e.target === menu) set(false); });
  var close = menu.querySelector('[aria-label="Cerrar menú"]');
  if (close) close.addEventListener('click', function () { set(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
})();
