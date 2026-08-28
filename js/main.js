/* =========================================================
   Linki — 交互脚本
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 移动端菜单 ---------- */
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('nav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', function () {
      const open = nav.classList.toggle('is-open');
      hamburger.classList.toggle('is-active', open);
      hamburger.setAttribute('aria-expanded', String(open));
    });
    // 点击导航链接后收起
    nav.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        hamburger.classList.remove('is-active');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- 购物车抽屉 ---------- */
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

  /* ---------- 手风琴 + 图片联动切换 ---------- */
  const accordion = document.getElementById('accordion');
  const featureImgs = document.querySelectorAll('.feature__img');
  if (accordion) {
    const items = accordion.querySelectorAll('.accordion__item');
    items.forEach(function (item) {
      const head = item.querySelector('.accordion__head');
      const index = item.getAttribute('data-index');

      head.addEventListener('click', function () {
        const isOpen = item.classList.contains('is-open');

        // 收起所有
        items.forEach(function (it) { it.classList.remove('is-open'); });

        // 展开当前（若原本关闭）
        if (!isOpen) {
          item.classList.add('is-open');
          // 切换对应图片
          featureImgs.forEach(function (img) {
            img.classList.toggle('is-active', img.getAttribute('data-panel') === index);
          });
        }
      });
    });
  }

  /* ---------- 角色模块横向滑动 ---------- */
  const moduleShowcase = document.getElementById('moduleShowcase');
  if (moduleShowcase) {
    document.querySelectorAll('[data-module-scroll]').forEach(function (button) {
      button.addEventListener('click', function () {
        const direction = button.getAttribute('data-module-scroll') === 'next' ? 1 : -1;
        moduleShowcase.scrollBy({ left: moduleShowcase.clientWidth * 0.8 * direction, behavior: 'smooth' });
      });
    });
  }

  /* ---------- 公告条角色灯带：按视口宽度补齐，保证固定间距下无空白 ---------- */
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

  /* ---------- 首屏视频：先显示海报图，再后台加载并淡入 ---------- */
  const heroVideo = document.querySelector('[data-hero-video]');
  function hydrateVideoSources(video) {
    video.querySelectorAll('source[data-src]').forEach(function (source) {
      source.src = source.dataset.src;
      source.removeAttribute('data-src');
    });
  }
  function loadHeroVideo() {
    if (!heroVideo) return;
    hydrateVideoSources(heroVideo);
    heroVideo.addEventListener('loadeddata', function () {
      heroVideo.classList.add('is-ready');
    }, { once: true });
    heroVideo.load();
    heroVideo.play().catch(function () {});
  }
  if (heroVideo && !(navigator.connection && navigator.connection.saveData)) {
    const scheduleHeroVideo = function () {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(loadHeroVideo, { timeout: 1200 });
      } else {
        window.setTimeout(loadHeroVideo, 700);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleHeroVideo, { once: true });
    } else {
      scheduleHeroVideo();
    }
  }

  /* ---------- 非首屏视频：接近可视区域再加载 ---------- */
  const lazyVideos = document.querySelectorAll('[data-lazy-video]');
  function loadLazyVideo(video) {
    hydrateVideoSources(video);
    video.load();
    video.play().catch(function () {});
  }
  if ('IntersectionObserver' in window) {
    const videoObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          loadLazyVideo(entry.target);
          videoObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '320px 0px' });
    lazyVideos.forEach(function (video) { videoObserver.observe(video); });
  } else {
    lazyVideos.forEach(loadLazyVideo);
  }

  /* ---------- 滚动揭示动画 ---------- */
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

  /* ---------- 顶部导航滚动态 ---------- */
  const header = document.getElementById('header');
  window.addEventListener('scroll', function () {
    const y = window.scrollY;
    if (header) {
      header.style.background = y > 40 ? 'rgba(251,247,240,.94)' : 'rgba(251,247,240,.82)';
      header.style.boxShadow = y > 40 ? '0 4px 20px rgba(61,43,31,.10)' : 'none';
    }
  }, { passive: true });

  /* ---------- 订阅表单（占位） ---------- */
  const form = document.getElementById('newsletterForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = form.querySelector('input');
      alert('感谢订阅：' + input.value);
      input.value = '';
    });
  }
})();
