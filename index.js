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
    
    Promise.all([
      fetch('novedades.json').then(r => r.json()).catch(e => { console.error(e); return []; }),
      fetch('equipamiento.json').then(r => r.json()).catch(e => { console.error(e); return []; })
    ]).then(([swData, hwData]) => {
      // Render software column (top 3)
      if (swData.length > 0) {
        swContainer.innerHTML = swData.slice(0, 3).map(item => {
          const title = isEn ? item.title_en : item.title_es;
          const summary = isEn ? item.summary_en : item.summary_es;
          const category = isEn ? item.category_en : item.category_es;
          return `
            <div class="dashboard-item">
              <a href="${item.url}" target="_blank" rel="noopener noreferrer">
                <div class="dashboard-meta">
                  <span>${item.date}</span>
                  <span>|</span>
                  <span>${category}</span>
                </div>
                <h4>${title}</h4>
                <p>${summary}</p>
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
          const summary = isEn ? item.summary_en : item.summary_es;
          const category = isEn ? item.category_en : item.category_es;
          return `
            <div class="dashboard-item">
              <a href="${item.url}" target="_blank" rel="noopener noreferrer">
                <div class="dashboard-meta">
                  <span>${item.date}</span>
                  <span>|</span>
                  <span>${category}</span>
                </div>
                <h4>${title}</h4>
                <p>${summary}</p>
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
});

