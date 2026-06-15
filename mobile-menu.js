/**
 * CabraSpace Mobile Menu System
 * Hamburger toggle + accordion dropdowns for touch devices.
 * Include this script on ALL pages, alongside or instead of index.js.
 */
(function() {
  'use strict';

  // Only initialize once
  if (window.__cabraMobileMenuInit) return;
  window.__cabraMobileMenuInit = true;

  function init() {
    const MOBILE_BREAKPOINT = 1024;
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const navMenu = document.querySelector('.nav-menu');
    const menuOverlay = document.getElementById('mobile-menu-overlay');

    if (!hamburgerBtn || !navMenu) return;

    // Resaltado de la seccion actual por URL. El menu se genera identico en todas las paginas
    // (tools/sync_nav.py) sin la clase `active` incrustada; aqui se marca el enlace que coincide
    // con la pagina actual y todos sus toggles ancestros.
    (function highlightActive() {
      var current = (location.pathname.split('/').pop() || 'index.html');
      var links = navMenu.querySelectorAll('a[href]');
      links.forEach(function(link) {
        var href = link.getAttribute('href');
        if (!href || href === '#') return;
        var file = href.split('/').pop().split('?')[0].split('#')[0];
        if (file !== current) return;
        link.classList.add('active');
        var el = link.parentElement;
        while (el && el !== navMenu) {
          if (el.classList && (el.classList.contains('dropdown') || el.classList.contains('dropdown-submenu'))) {
            var toggle = el.querySelector(':scope > a.dropdown-toggle');
            if (toggle) toggle.classList.add('active');
          }
          el = el.parentElement;
        }
      });
    })();

    function isMobileView() {
      return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function closeMenu() {
      hamburgerBtn.classList.remove('active');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      navMenu.classList.remove('active');
      if (menuOverlay) menuOverlay.classList.remove('active');
      document.body.classList.remove('menu-open');
      // Close all open dropdowns
      document.querySelectorAll('.dropdown.open, .dropdown-submenu.open').forEach(function(el) {
        el.classList.remove('open');
      });
    }

    function openMenu() {
      hamburgerBtn.classList.add('active');
      hamburgerBtn.setAttribute('aria-expanded', 'true');
      navMenu.classList.add('active');
      if (menuOverlay) menuOverlay.classList.add('active');
      document.body.classList.add('menu-open');
    }

    function toggleMenu() {
      if (navMenu.classList.contains('active')) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    // Hamburger button click
    hamburgerBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleMenu();
    });

    // Overlay click closes menu
    if (menuOverlay) {
      menuOverlay.addEventListener('click', closeMenu);
    }

    // Escape key closes menu
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && navMenu.classList.contains('active')) {
        closeMenu();
      }
    });

    // Tap/click on dropdown toggles (accordion behavior on mobile)
    var toggles = document.querySelectorAll('.dropdown > .dropdown-toggle, .dropdown-submenu > .dropdown-toggle');
    toggles.forEach(function(toggle) {
      toggle.addEventListener('click', function(e) {
        if (!isMobileView()) return; // Let desktop hover behavior work

        e.preventDefault();
        e.stopPropagation();

        var parentDropdown = toggle.parentElement;
        var isOpen = parentDropdown.classList.contains('open');

        // Close sibling dropdowns at the same level
        var siblings = parentDropdown.parentElement.querySelectorAll(':scope > .dropdown.open, :scope > .dropdown-submenu.open');
        siblings.forEach(function(sib) {
          if (sib !== parentDropdown) {
            sib.classList.remove('open');
            sib.querySelectorAll('.dropdown.open, .dropdown-submenu.open').forEach(function(child) {
              child.classList.remove('open');
            });
          }
        });

        // Toggle current dropdown
        if (isOpen) {
          parentDropdown.classList.remove('open');
          parentDropdown.querySelectorAll('.dropdown.open, .dropdown-submenu.open').forEach(function(child) {
            child.classList.remove('open');
          });
        } else {
          parentDropdown.classList.add('open');
        }
      });
    });

    // Close menu when clicking a real navigation link (not a toggle)
    document.querySelectorAll('.nav-menu a:not(.dropdown-toggle)').forEach(function(link) {
      link.addEventListener('click', function() {
        if (isMobileView() && navMenu.classList.contains('active')) {
          setTimeout(closeMenu, 150);
        }
      });
    });

    // Resize handler: clean up mobile states if window grows past breakpoint
    var resizeTimer;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() {
        if (!isMobileView()) {
          closeMenu();
        }
      }, 150);
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
