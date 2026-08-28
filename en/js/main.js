/* =========================================================
   Linki — interaction script
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Mobile menu ---------- */
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('nav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', function () {
      const open = nav.classList.toggle('is-open');
      hamburger.classList.toggle('is-active', open);
      hamburger.setAttribute('aria-expanded', String(open));
    });
    // Collapse after clicking a nav link
    nav.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        hamburger.classList.remove('is-active');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Cart drawer ---------- */
  const cartToggle = document.getElementById('cartToggle');
  const cartClose = document.getElementById('cartClose');
  const cartDrawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('drawerOverlay');

  function openCart() {
    cartDrawer.classList.add('is-open');
    overlay.classList.add('is-open');
    cartDrawer.setAttribute('aria-hidden', 'false');
  }
  function closeCart() {
    cartDrawer.classList.remove('is-open');
    overlay.classList.remove('is-open');
    cartDrawer.setAttribute('aria-hidden', 'true');
  }
  if (cartToggle) cartToggle.addEventListener('click', openCart);
  if (cartClose) cartClose.addEventListener('click', closeCart);
  if (overlay) overlay.addEventListener('click', closeCart);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCart();
  });

  /* ---------- Accordion + linked image switching ---------- */
  const accordion = document.getElementById('accordion');
  const featureImgs = document.querySelectorAll('.feature__img');
  if (accordion) {
    const items = accordion.querySelectorAll('.accordion__item');
    items.forEach(function (item) {
      const head = item.querySelector('.accordion__head');
      const index = item.getAttribute('data-index');

      head.addEventListener('click', function () {
        const isOpen = item.classList.contains('is-open');

        // Collapse all
        items.forEach(function (it) { it.classList.remove('is-open'); });

        // Expand current (if it was closed)
        if (!isOpen) {
          item.classList.add('is-open');
          // Switch to the matching image
          featureImgs.forEach(function (img) {
            img.classList.toggle('is-active', img.getAttribute('data-panel') === index);
          });
        }
      });
    });
  }

  /* ---------- Character module horizontal scroll ---------- */
  const moduleShowcase = document.getElementById('moduleShowcase');
  if (moduleShowcase) {
    document.querySelectorAll('[data-module-scroll]').forEach(function (button) {
      button.addEventListener('click', function () {
        const direction = button.getAttribute('data-module-scroll') === 'next' ? 1 : -1;
        moduleShowcase.scrollBy({ left: moduleShowcase.clientWidth * 0.8 * direction, behavior: 'smooth' });
      });
    });
  }

  /* ---------- Announcement marquee: fill to viewport width for gap-free spacing ---------- */
  const announcementTrack = document.querySelector('.announcement__track');
  const announcementSets = document.querySelectorAll('.announcement__set');
  if (announcementTrack && announcementSets.length === 2) {
    function fillAnnouncementTrack() {
      const minimumWidth = window.innerWidth + 104;

      announcementSets.forEach(function (set) {
        const sequence = Array.from(set.children);
        while (set.scrollWidth < minimumWidth) {
          sequence.forEach(function (icon) {
            set.appendChild(icon.cloneNode(true));
          });
        }
      });

      announcementTrack.style.animationDuration = Math.max(40, announcementSets[0].scrollWidth / 34) + 's';
    }

    fillAnnouncementTrack();
    window.addEventListener('resize', fillAnnouncementTrack, { passive: true });
  }

  /* ---------- Scroll reveal animation ---------- */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Header scroll state ---------- */
  const header = document.getElementById('header');
  window.addEventListener('scroll', function () {
    const y = window.scrollY;
    if (header) {
      header.style.background = y > 40 ? 'rgba(251,247,240,.94)' : 'rgba(251,247,240,.82)';
      header.style.boxShadow = y > 40 ? '0 4px 20px rgba(61,43,31,.10)' : 'none';
    }
  }, { passive: true });

  /* ---------- Newsletter form (placeholder) ---------- */
  const form = document.getElementById('newsletterForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = form.querySelector('input');
      alert('Thanks for subscribing: ' + input.value);
      input.value = '';
    });
  }
})();
