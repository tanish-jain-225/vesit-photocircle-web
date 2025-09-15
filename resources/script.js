// Mobile nav toggle
const navToggleButton = document.querySelector('.nav-toggle');
const siteNav = document.getElementById('site-nav');
if (navToggleButton && siteNav) {
  navToggleButton.addEventListener('click', () => {
    const expanded = navToggleButton.getAttribute('aria-expanded') === 'true';
    navToggleButton.setAttribute('aria-expanded', String(!expanded));
    siteNav.classList.toggle('open');
  });
  siteNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navToggleButton.setAttribute('aria-expanded', 'false');
      siteNav.classList.remove('open');
    });
  });
}

// Lightbox
const lightbox = document.querySelector('.lightbox');
const lightboxImage = document.querySelector('.lightbox-image');
const lightboxCaption = document.querySelector('.lightbox-caption');
const lightboxClose = document.querySelector('.lightbox-close');
const lightboxDialog = document.querySelector('.lightbox-dialog');
let lastFocusedBeforeLightbox = null;
let preloadedImages = new Map();

function preload(src) {
  if (!src || preloadedImages.has(src)) return preloadedImages.get(src);
  const img = new Image();
  const promise = new Promise((resolve, reject) => {
    img.onload = () => resolve(src);
    img.onerror = reject;
  });
  img.src = src;
  preloadedImages.set(src, promise);
  return promise;
}

function setLightboxSource(src) {
  if (!lightboxImage) return;
  lightboxImage.classList.remove('is-visible');
  lightboxDialog?.classList.add('loading');
  const doSet = () => {
    lightboxImage.onload = () => {
      lightboxImage.classList.add('is-visible');
      lightboxDialog?.classList.remove('loading');
      lightboxImage.onload = null;
    };
    lightboxImage.src = src;
  };
  const preloadPromise = preloadedImages.get(src) || preload(src);
  Promise.resolve(preloadPromise).then(doSet).catch(doSet);
}

function openLightbox(src, caption) {
  if (!lightbox || !lightboxImage) return;
  setLightboxSource(src);
  lightboxImage.alt = caption || 'Expanded photo';
  if (lightboxCaption) lightboxCaption.textContent = '';
  lastFocusedBeforeLightbox = document.activeElement;
  lightbox.removeAttribute('inert');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    (lightboxClose || lightboxDialog)?.focus?.();
  }, 0);
}

function closeLightbox() {
  if (!lightbox || !lightboxImage) return;
  // If focus is inside lightbox, blur before hiding to avoid aria-hidden on focused ancestor
  if (lightbox.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  lightbox.setAttribute('aria-hidden', 'true');
  lightbox.setAttribute('inert', '');
  lightboxImage.src = '';
  document.body.style.overflow = '';
  // Restore focus to the element that opened the lightbox
  if (lastFocusedBeforeLightbox && typeof lastFocusedBeforeLightbox.focus === 'function') {
    lastFocusedBeforeLightbox.focus();
  }
}

// Focus trap within lightbox when open
if (lightbox) {
  lightbox.addEventListener('keydown', (e) => {
    if (lightbox.getAttribute('aria-hidden') === 'true') return;
    if (e.key !== 'Tab') return;
    const focusables = getFocusableElements(lightboxDialog || lightbox);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// Open from gallery
const galleryItems = document.querySelectorAll('.gallery-item');

function upgradeUnsplashResolution(url) {
  try {
    if (!url) return url;
    const u = new URL(url);
    if (u.hostname.includes('images.unsplash.com')) {
      u.searchParams.set('w', '1600');
      u.searchParams.set('q', '85');
      u.searchParams.set('auto', 'format');
      u.searchParams.set('fit', 'crop');
      return u.toString();
    }
    return url;
  } catch { return url; }
}

function getItemSrc(item) {
  const data = item.getAttribute('data-fullsrc');
  if (data) return data;
  const href = item.getAttribute('href');
  if (href) return upgradeUnsplashResolution(href);
  const img = item.querySelector('img');
  return upgradeUnsplashResolution(img?.getAttribute('src') || '');
}

galleryItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const src = getItemSrc(item);
    const caption = item.getAttribute('data-caption') || item.querySelector('img')?.getAttribute('alt') || '';
    if (src) openLightbox(src, caption);
  });
});

// Close handlers
lightboxClose?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// Fixed header offset and smooth scroll without changing URL
(function initSmoothScrollWithOffset() {
  const header = document.querySelector('.site-header');
  const root = document.documentElement;

  function setHeaderHeightVar() {
    const headerHeight = header ? header.offsetHeight : 64;
    root.style.setProperty('--header-height', headerHeight + 'px');
  }

  // Set on load and on resize
  setHeaderHeightVar();
  window.addEventListener('resize', setHeaderHeightVar);

  function smoothScrollTo(target) {
    const rect = target.getBoundingClientRect();
    const headerHeight = parseInt(getComputedStyle(root).getPropertyValue('--header-height')) || 64;
    const absoluteTop = window.pageYOffset + rect.top;
    const offsetTop = absoluteTop - headerHeight - 8; // small gap
    window.scrollTo({ top: offsetTop, behavior: 'smooth' });
  }

  // Intercept in-page anchor clicks but keep the URL unchanged
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute('href');
    if (!hash || hash === '#' || hash === '#top') {
      if (hash === '#top') window.scrollTo({ top: 0, behavior: 'smooth' });
      e.preventDefault();
      return;
    }
    const target = document.querySelector(hash);
    if (target) {
      e.preventDefault();
      smoothScrollTo(target);
      // Do not update location.hash to maintain constant link
    }
  });

  // If page loads with a hash, scroll to it with offset but don't alter the URL further
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) setTimeout(() => smoothScrollTo(target), 0);
  }
})();

// (scrollspy removed as per request)

// Lightbox index and navigation
(function enhanceLightboxNavigation() {
  if (!lightbox) return;
  const items = Array.from(document.querySelectorAll('.gallery-item'));
  const btnPrev = document.querySelector('.lightbox-prev');
  const btnNext = document.querySelector('.lightbox-next');
  let currentIndex = -1;

  function updateControls() {
    const atStart = currentIndex <= 0;
    const atEnd = currentIndex >= items.length - 1;
    if (btnPrev) { btnPrev.disabled = atStart; btnPrev.setAttribute('aria-disabled', String(atStart)); }
    if (btnNext) { btnNext.disabled = atEnd; btnNext.setAttribute('aria-disabled', String(atEnd)); }
  }

  function openByIndex(idx) {
    if (idx < 0 || idx >= items.length) return;
    const a = items[idx];
    if (!a) return;
    const src = getItemSrc(a);
    currentIndex = idx;
    openLightbox(src, '');
    updateControls();
    const nextSrc = items[idx + 1] ? getItemSrc(items[idx + 1]) : undefined;
    const prevSrc = items[idx - 1] ? getItemSrc(items[idx - 1]) : undefined;
    preload(nextSrc);
    preload(prevSrc);
  }

  items.forEach((item, idx) => {
    item.addEventListener('click', () => {
      currentIndex = idx;
      setTimeout(() => {
        updateControls();
        const nextSrc = items[idx + 1] ? getItemSrc(items[idx + 1]) : undefined;
        const prevSrc = items[idx - 1] ? getItemSrc(items[idx - 1]) : undefined;
        preload(nextSrc); preload(prevSrc);
      }, 0);
    });
  });

  btnPrev?.addEventListener('click', (e) => { e.stopPropagation(); if (currentIndex > 0) openByIndex(currentIndex - 1); });
  btnNext?.addEventListener('click', (e) => { e.stopPropagation(); if (currentIndex < items.length - 1) openByIndex(currentIndex + 1); });

  window.addEventListener('keydown', (e) => {
    if (lightbox.getAttribute('aria-hidden') === 'true') return;
    if (e.key === 'ArrowLeft' && currentIndex > 0) openByIndex(currentIndex - 1);
    if (e.key === 'ArrowRight' && currentIndex < items.length - 1) openByIndex(currentIndex + 1);
  });

  let startX = 0;
  lightbox.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', (e) => {
    const endX = e.changedTouches[0].clientX;
    const dx = endX - startX;
    if (Math.abs(dx) > 40) {
      if (dx > 0 && currentIndex > 0) openByIndex(currentIndex - 1);
      else if (dx < 0 && currentIndex < items.length - 1) openByIndex(currentIndex + 1);
    }
  });
})();

// Reveal on scroll
(function initRevealAnimations() {
  const revealables = Array.from(document.querySelectorAll('.reveal, .card, .hero-text, .hero-media'));
  if (!revealables.length) return;
  const obs = new IntersectionObserver((entries, o) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal-visible');
        o.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealables.forEach(el => el.classList.add('reveal'));
  revealables.forEach(el => obs.observe(el));
})();

// Back-to-top floating button behavior
(function initBackToTop() {
  const btn = document.querySelector('.to-top-floating');
  if (!btn) return;
  const root = document.documentElement;
  function toggle() {
    const show = window.scrollY > 300;
    btn.classList.toggle('visible', show);
  }
  window.addEventListener('scroll', toggle, { passive: true });
  toggle();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})(); 