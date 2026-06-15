document.addEventListener('DOMContentLoaded', () => {
  // 1. Header Scroll Class
  const header = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // 2. Spotlight Effect on Interactive Cards
  const cards = document.querySelectorAll('.feature-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left; // x position within the element
      const y = e.clientY - rect.top;  // y position within the element
      
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  });

  // 5. Live Dashboard Fetch and Rendering
  const swContainer = document.getElementById('softwareDashboardContainer');
  const hwContainer = document.getElementById('hardwareDashboardContainer');

  if (swContainer && hwContainer) {
    const isEn = document.documentElement.lang.startsWith('en');
    
    // Dashboard ligero: latest.json (3+3 items, ~2 KB) en vez de las dos BD completas
    // (~217 KB). Lo regenera tools/build_latest.py al final del scraper.
    fetch('latest.json').then(r => r.json()).then((data) => {
      const swData = data.software || [];
      const hwData = data.hardware || [];
      // Render software column (top 3)
      if (swData.length > 0) {
        swContainer.innerHTML = swData.slice(0, 3).map(item => {
          const title = isEn ? item.title_en : item.title_es;
          const category = isEn ? item.category_en : item.category_es;
          const page = isEn ? 'novedades-en.html' : 'novedades.html';
          return `
            <div class="dashboard-item">
              <a href="${page}?search=${encodeURIComponent(title)}">
                <div class="dashboard-meta">
                  <span>${item.date}</span>
                  <span>|</span>
                  <span>${category}</span>
                </div>
                <h4>${title}</h4>
              </a>
            </div>
          `;
        }).join('');
      } else {
        swContainer.innerHTML = `<div class="dashboard-loading">${isEn ? 'No updates found.' : 'No se encontraron actualizaciones.'}</div>`;
      }

      // Render hardware column (top 3)
      if (hwData.length > 0) {
        hwContainer.innerHTML = hwData.slice(0, 3).map(item => {
          const title = isEn ? item.title_en : item.title_es;
          const category = isEn ? item.category_en : item.category_es;
          const page = isEn ? 'equipamiento-en.html' : 'equipamiento.html';
          return `
            <div class="dashboard-item">
              <a href="${page}?search=${encodeURIComponent(title)}">
                <div class="dashboard-meta">
                  <span>${item.date}</span>
                  <span>|</span>
                  <span>${category}</span>
                </div>
                <h4>${title}</h4>
              </a>
            </div>
          `;
        }).join('');
      } else {
        hwContainer.innerHTML = `<div class="dashboard-loading">${isEn ? 'No updates found.' : 'No se encontraron actualizaciones.'}</div>`;
      }
    }).catch(err => {
      console.error("Dashboard error:", err);
      swContainer.innerHTML = `<div class="dashboard-loading">${isEn ? 'Error loading data.' : 'Error al cargar datos.'}</div>`;
      hwContainer.innerHTML = `<div class="dashboard-loading">${isEn ? 'Error loading data.' : 'Error al cargar datos.'}</div>`;
    });
  }

  // 6. Night Vision Toggle Event
  const nightToggle = document.getElementById('nightmode-toggle');
  if (nightToggle) {
    nightToggle.addEventListener('click', () => {
      document.body.classList.toggle('night-vision');
      
      if (document.body.classList.contains('night-vision')) {
        localStorage.setItem('night-vision', 'enabled');
      } else {
        localStorage.setItem('night-vision', 'disabled');
      }
    });
  }

  // =======================================================================
  // 7. Mobile Menu System (Hamburger + Accordion Dropdowns)
  // =======================================================================
  const MOBILE_BREAKPOINT = 1024;
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const navMenu = document.querySelector('.nav-menu');
  const menuOverlay = document.getElementById('mobile-menu-overlay');

  function isMobileView() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function closeMenu() {
    if (!hamburgerBtn || !navMenu) return;
    hamburgerBtn.classList.remove('active');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    navMenu.classList.remove('active');
    if (menuOverlay) menuOverlay.classList.remove('active');
    document.body.classList.remove('menu-open');
    // Close all open dropdowns
    document.querySelectorAll('.dropdown.open, .dropdown-submenu.open').forEach(el => {
      el.classList.remove('open');
    });
  }

  function openMenu() {
    if (!hamburgerBtn || !navMenu) return;
    hamburgerBtn.classList.add('active');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
    navMenu.classList.add('active');
    if (menuOverlay) menuOverlay.classList.add('active');
    document.body.classList.add('menu-open');
  }

  function toggleMenu() {
    if (navMenu && navMenu.classList.contains('active')) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  // Hamburger button click
  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
  }

  // Overlay click closes menu
  if (menuOverlay) {
    menuOverlay.addEventListener('click', closeMenu);
  }

  // Escape key closes menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navMenu && navMenu.classList.contains('active')) {
      closeMenu();
    }
  });

  // Tap/click on dropdown toggles (accordion behavior on mobile)
  document.querySelectorAll('.dropdown > .dropdown-toggle, .dropdown-submenu > .dropdown-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      if (!isMobileView()) return; // Let desktop hover behavior work
      
      e.preventDefault();
      e.stopPropagation();
      
      const parentDropdown = toggle.parentElement;
      const isOpen = parentDropdown.classList.contains('open');
      
      // Close sibling dropdowns at the same level
      const siblings = parentDropdown.parentElement.querySelectorAll(':scope > .dropdown.open, :scope > .dropdown-submenu.open');
      siblings.forEach(sib => {
        if (sib !== parentDropdown) {
          sib.classList.remove('open');
          // Also close nested children
          sib.querySelectorAll('.dropdown.open, .dropdown-submenu.open').forEach(child => {
            child.classList.remove('open');
          });
        }
      });
      
      // Toggle current dropdown
      if (isOpen) {
        parentDropdown.classList.remove('open');
        parentDropdown.querySelectorAll('.dropdown.open, .dropdown-submenu.open').forEach(child => {
          child.classList.remove('open');
        });
      } else {
        parentDropdown.classList.add('open');
      }
    });
  });

  // Close menu when clicking a real navigation link (not a toggle)
  document.querySelectorAll('.nav-menu a:not(.dropdown-toggle)').forEach(link => {
    link.addEventListener('click', () => {
      if (isMobileView() && navMenu && navMenu.classList.contains('active')) {
        // Small delay to allow navigation to start
        setTimeout(closeMenu, 150);
      }
    });
  });

  // Resize handler: clean up mobile states if window grows past breakpoint
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMobileView()) {
        closeMenu();
      }
    }, 150);
  });
});

