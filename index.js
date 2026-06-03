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
  const cards = document.querySelectorAll('.feature-card, .video-preview-card, .newsletter-card, .support-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left; // x position within the element
      const y = e.clientY - rect.top;  // y position within the element
      
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  });

  // 3. Subscription Form Handling
  const subscribeForm = document.getElementById('subscribeForm');
  const formMessage = document.getElementById('formMessage');

  if (subscribeForm) {
    subscribeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const emailInput = subscribeForm.querySelector('.subscribe-input');
      const email = emailInput.value.trim();
      
      if (email) {
        // Show success animation/message
        const isEn = document.documentElement.lang.startsWith('en');
        formMessage.textContent = isEn 
          ? `Thank you for subscribing! We will notify you at: ${email}`
          : `¡Gracias por suscribirte! Te avisaremos al email: ${email}`;
        formMessage.className = 'form-message success';
        emailInput.value = '';
        
        // Hide message after 5 seconds
        setTimeout(() => {
          formMessage.style.opacity = '0';
          setTimeout(() => {
            formMessage.textContent = '';
            formMessage.className = 'form-message';
            formMessage.style.opacity = '1';
          }, 300);
        }, 5000);
      }
    });
  }

  // 4. Payment Modal & Simulated Checkout Logic
  const modal = document.getElementById('paymentModal');
  const openModalBtns = document.querySelectorAll('.open-checkout');
  const closeModalBtn = document.getElementById('closeModal');
  const paymentForm = document.getElementById('paymentForm');
  const paymentStatus = document.getElementById('paymentStatus');
  const btnPay = document.querySelector('.btn-pay');
  const modalTitle = document.querySelector('.modal-title');
  const modalSubtitle = document.querySelector('.modal-subtitle');

  // Live Card Update Elements
  const cardNumberInput = document.getElementById('cardNumber');
  const cardExpiryInput = document.getElementById('cardExpiry');

  const cardNumDisplay = document.querySelector('.card-number-display');
  const cardExpiryDisplay = document.querySelector('.card-expiry');

  let selectedAmount = "3.00";
  let selectedCurrency = "€";

  const isEnLanguage = document.documentElement.lang.startsWith('en');

  // Open modal and set checkout amount details
  openModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.support-card');
      const amount = card.getAttribute('data-amount');
      const itemName = card.getAttribute('data-item');
      selectedAmount = amount;
      
      if (isEnLanguage) {
        selectedCurrency = "£";
        modalTitle.textContent = `Support with ${itemName}`;
        modalSubtitle.textContent = "Enter your mock card details to support the project.";
        document.querySelector('label[for="cardNumber"]').textContent = "Card Number";
        document.querySelector('label[for="cardExpiry"]').textContent = "Expiry Date";
        btnPay.textContent = `Confirm Payment (${selectedCurrency}${amount})`;
      } else {
        selectedCurrency = "€";
        modalTitle.textContent = `Invitar a ${itemName}`;
        modalSubtitle.textContent = "Introduce los detalles de pago para realizar tu aportación.";
        document.querySelector('label[for="cardNumber"]').textContent = "Número de Tarjeta";
        document.querySelector('label[for="cardExpiry"]').textContent = "Fecha de Caducidad";
        btnPay.textContent = `Confirmar Pago (${amount} ${selectedCurrency})`;
      }
      
      modal.classList.add('active');
    });
  });

  // Hide modal and reset inputs
  const hideModal = () => {
    if (modal) modal.classList.remove('active');
    if (paymentForm) paymentForm.reset();
    if (paymentStatus) {
      paymentStatus.textContent = '';
      paymentStatus.className = 'payment-status';
    }
    if (cardNumDisplay) cardNumDisplay.textContent = '•••• •••• •••• ••••';
    if (cardExpiryDisplay) cardExpiryDisplay.textContent = 'MM/YY';
  };

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', hideModal);
  }

  // Close modal on outside clicks
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideModal();
      }
    });
  }

  // Format and update card number on typing
  if (cardNumberInput) {
    cardNumberInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
      let matches = value.match(/\d{4,16}/g);
      let match = (matches && matches[0]) || '';
      let parts = [];

      for (let i = 0, len = match.length; i < len; i += 4) {
        parts.push(match.substring(i, i + 4));
      }

      if (parts.length > 0) {
        e.target.value = parts.join(' ');
      } else {
        e.target.value = value;
      }
      
      if (cardNumDisplay) {
        cardNumDisplay.textContent = e.target.value || '•••• •••• •••• ••••';
      }
    });
  }

  // Format and update card expiry on typing
  if (cardExpiryInput) {
    cardExpiryInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
      if (value.length > 2) {
        e.target.value = value.substring(0, 2) + '/' + value.substring(2, 4);
      } else {
        e.target.value = value;
      }
      if (cardExpiryDisplay) {
        cardExpiryDisplay.textContent = e.target.value || 'MM/YY';
      }
    });
  }

  // Mock payment processing form submit
  if (paymentForm) {
    paymentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      btnPay.disabled = true;
      const originalText = btnPay.textContent;
      
      if (isEnLanguage) {
        btnPay.textContent = "Processing payment...";
      } else {
        btnPay.textContent = "Procesando pago...";
      }

      // Simulate payment network delay
      setTimeout(() => {
        if (paymentStatus) {
          paymentStatus.className = 'payment-status success';
          if (isEnLanguage) {
            paymentStatus.textContent = "✦ Payment simulated successfully! Thank you for your support! ✦";
          } else {
            paymentStatus.textContent = "✦ ¡Pago simulado con éxito! Muchísimas gracias por tu apoyo. ✦";
          }
        }
        
        btnPay.disabled = false;
        btnPay.textContent = originalText;

        // Auto close checkout overlay after 3 seconds
        setTimeout(() => {
          hideModal();
        }, 3000);
      }, 2000);
    });
  }

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

