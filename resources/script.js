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

// Theme toggle removed

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

// Dynamic gallery population
(function populateGallery() {
  const grid = document.querySelector('.gallery-grid');
  if (!grid) return;
  const basePath = grid.getAttribute('data-gallery-path') || './resources/gallery-images';
  const max = parseInt(grid.getAttribute('data-max') || '500', 10);
  // Strict: only allow PNG files for gallery
  const supportedExts = ['.png'];
  const countEl = document.getElementById('gallery-count');
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');
  const pageIndicator = document.getElementById('page-indicator');

  const BATCH_SIZE = 12; // images per page
  const MAX_CONCURRENCY = 4; // simultaneous loads to avoid thrash
  let discovered = []; // all discovered image URLs
  let currentPage = 1;
  let rendered = 0;

  console.info('[gallery] running in strict PNG-only mode');

  function fileExists(src) {
    // Prefer a lightweight HEAD request to check for existence to avoid
    // creating Image objects that emit 404s in the console in some servers/browsers.
    // Fall back to using an Image when fetch/HEAD is not available or blocked.
    return new Promise(async (resolve) => {
      if (!src) return resolve(false);
      // Use fetch HEAD with timeout when possible
      if (window.fetch && window.AbortController) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const resp = await fetch(src, { method: 'HEAD', signal: controller.signal, cache: 'no-cache' });
          clearTimeout(timeout);
          // HTTP 200-299 means exists
          return resolve(resp.ok);
        } catch (e) {
          // network error, CORS, or aborted; fall through to image probe fallback
        }
      }

      // Fallback: use Image() but be tolerant of errors
      try {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function buildSequentialList() {
    const candidates = [];
    // First try to fetch a manifest `index.json` which should contain filenames (fast on Vercel/static hosts)
    try {
      const manifestUrl = `${basePath.replace(/\/$/, '')}/index.json`;
      const resp = await fetch(manifestUrl, { cache: 'no-cache' });
      if (resp.ok) {
        const list = await resp.json();
        if (Array.isArray(list) && list.length) {
          for (const fileName of list) {
            // Only honor .png entries when strict mode is enabled
            if (!/\.png$/i.test(fileName)) {
              // Log a warning for maintainers, but do not include non-PNG files
              console.warn('[gallery] ignoring non-PNG manifest entry:', fileName);
              continue;
            }
            const url = `${basePath}/${fileName}`;
            candidates.push({ url, caption: fileName.replace(/\.[a-zA-Z0-9]+$/, '') });
          }
          return candidates;
        }
      }
    } catch (e) {
      // manifest not available or parse failed — fall back to probing
    }

    // Fallback: probe sequentially (existing behavior)
    let consecutiveMisses = 0;
    for (let i = 1; i <= max; i++) {
      let foundForIndex = false;
      for (const ext of supportedExts) {
        const url = `${basePath}/${i}${ext}`;
        // eslint-disable-next-line no-await-in-loop
        const ok = await fileExists(url);
        if (ok) {
          candidates.push({ url, caption: String(i) });
          foundForIndex = true;
          consecutiveMisses = 0;
          break;
        }
      }
      if (!foundForIndex) {
        consecutiveMisses += 1;
        if (consecutiveMisses >= 15 && candidates.length > 0) break;
      }
    }
    return candidates;
  }

  function createItem({ url, caption }) {
    const a = document.createElement('a');
    a.href = url;
    a.className = 'gallery-item';
    a.setAttribute('data-caption', caption || '');

    // Image element
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = caption || 'Photo';

    // Skeleton overlay while image loads
    const overlay = document.createElement('div');
    overlay.className = 'skeleton-overlay';
    const spinner = document.createElement('div');
    spinner.className = 'image-spinner';
    overlay.appendChild(spinner);

    img.addEventListener('load', () => {
      img.classList.add('is-loaded');
      overlay.remove();
    });
    img.addEventListener('error', () => {
      // keep overlay and mark as failed
      overlay.remove();
      img.classList.add('is-loaded');
      img.alt = 'Failed to load image';
    });

    img.src = url;
    a.appendChild(img);
    a.appendChild(overlay);
    return a;
  }

  function updateCount() {
    if (countEl) countEl.textContent = discovered.length ? `(${discovered.length})` : '';
  }

  async function renderNextBatch() {
    const start = rendered;
    const end = Math.min(rendered + BATCH_SIZE, discovered.length);
    if (start >= end) return false;
    const fragment = document.createDocumentFragment();
    const queue = [];
    for (let i = start; i < end; i++) {
      const item = createItem(discovered[i]);
      fragment.appendChild(item);
      const img = item.querySelector('img');
      queue.push(new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        img.onload = finish;
        img.onerror = finish;
      }));
    }
    grid.appendChild(fragment);
    rendered = end;
    // throttle concurrent waits
    let index = 0;
    async function runNext() {
      if (index >= queue.length) return;
      const current = index++;
      await queue[current];
      await runNext();
    }
    const runners = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, runNext);
    await Promise.all(runners);
    return true;
  }

  function updatePager() {
    const totalPages = Math.max(1, Math.ceil(discovered.length / BATCH_SIZE));
    if (pageIndicator) pageIndicator.textContent = `Page ${Math.min(currentPage, totalPages)} / ${totalPages}`;
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
  }

  (async () => {
    // Show skeleton placeholders while we discover images
    grid.classList.add('loading', 'skeleton-loading');
    const skeletonCount = Math.min(12, BATCH_SIZE);
    const skeletonFrag = document.createDocumentFragment();
    for (let i = 0; i < skeletonCount; i++) {
      const s = document.createElement('div');
      s.className = 'skeleton-item';
      const sh = document.createElement('div'); sh.className = 'skeleton-shimmer';
      const ph = document.createElement('div'); ph.className = 'skeleton-placeholder';
      const cap = document.createElement('div'); cap.className = 'skeleton-caption'; ph.appendChild(cap);
      s.appendChild(sh); s.appendChild(ph);
      skeletonFrag.appendChild(s);
    }
    grid.innerHTML = '';
    grid.appendChild(skeletonFrag);

    discovered = await buildSequentialList();
    updateCount();
    await renderPage(1);
    // remove skeletons and loading overlay
    grid.classList.remove('loading', 'skeleton-loading');
    updatePager();
    document.dispatchEvent(new CustomEvent('gallery:populated'));
  })();

  async function renderPage(page) {
    currentPage = page;
    const start = (page - 1) * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, discovered.length);
    const fragment = document.createDocumentFragment();
    grid.innerHTML = '';
    const queue = [];
    for (let i = start; i < end; i++) {
      const item = createItem(discovered[i]);
      fragment.appendChild(item);
      const img = item.querySelector('img');
      queue.push(new Promise((resolve) => {
        let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
        img.onload = finish; img.onerror = finish;
      }));
    }
    grid.appendChild(fragment);
    let index = 0;
    async function runNext() {
      if (index >= queue.length) return;
      const current = index++;
      await queue[current];
      await runNext();
    }
    const runners = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, runNext);
    await Promise.all(runners);
  }

  prevPageBtn?.addEventListener('click', async () => {
    if (currentPage <= 1) return;
    prevPageBtn.disabled = true; nextPageBtn && (nextPageBtn.disabled = true);
    await renderPage(currentPage - 1);
    updatePager();
  });
  nextPageBtn?.addEventListener('click', async () => {
    const totalPages = Math.max(1, Math.ceil(discovered.length / BATCH_SIZE));
    if (currentPage >= totalPages) return;
    prevPageBtn && (prevPageBtn.disabled = true); nextPageBtn.disabled = true;
    await renderPage(currentPage + 1);
    updatePager();
  });
})();

// Open from gallery (event delegation to support dynamic items)
const galleryContainer = document.querySelector('.gallery-grid');

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

if (galleryContainer) {
  galleryContainer.addEventListener('click', (e) => {
    const item = e.target.closest('.gallery-item');
    if (!item || !galleryContainer.contains(item)) return;
    e.preventDefault();
    const src = getItemSrc(item);
    const caption = item.getAttribute('data-caption') || item.querySelector('img')?.getAttribute('alt') || '';
    if (src) openLightbox(src, caption);
  });
}

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

// Make meta tags and JSON-LD absolute so previews work on any environment
(function normalizeMetaAndSocialLinks() {
  try {
    const origin = window.location.origin === 'null' ? '' : window.location.origin; // file:// may be 'null'

    // Helper to make root-relative -> absolute
    function toAbsolute(url) {
      if (!url) return url;
      try {
        const u = new URL(url, origin || window.location.href);
        return u.toString();
      } catch (e) {
        return url;
      }
    }

    // Canonical
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = toAbsolute(canonical.getAttribute('href'));

    // OG & Twitter images and og:url
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', toAbsolute(ogUrl.getAttribute('content')));
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) ogImage.setAttribute('content', toAbsolute(ogImage.getAttribute('content')));
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (twitterImage) twitterImage.setAttribute('content', toAbsolute(twitterImage.getAttribute('content')));

    // Update JSON-LD script contents (Organization) to absolute urls
    const ld = document.querySelector('script[type="application/ld+json"]');
    if (ld) {
      try {
        const data = JSON.parse(ld.textContent);
        if (data && typeof data === 'object') {
          if (data.url) data.url = toAbsolute(String(data.url));
          if (data.logo) data.logo = toAbsolute(String(data.logo));
          if (Array.isArray(data.sameAs)) data.sameAs = data.sameAs.map(s => toAbsolute(s));
          ld.textContent = JSON.stringify(data, null, 2);
        }
      } catch (e) {
        // ignore JSON parse errors
      }
    }

    // Ensure social links in contact list use absolute URLs
    const contactList = document.querySelector('.contact-list');
    if (contactList) {
      contactList.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href');
        if (!href) return;
        // Only adjust root-relative links
        if (href.startsWith('/')) a.href = toAbsolute(href);
        // For known social short-hand links (instagram without protocol), ensure absolute
        if (href.startsWith('https://instagram.com') || href.startsWith('http://instagram.com')) return;
        if (/^https?:\/\//i.test(href)) return;
        if (href.startsWith('@')) return;
      });
    }
  } catch (e) {
    // no-op
  }
})();

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
  function getItems() { return Array.from(document.querySelectorAll('.gallery-item')); }
  const btnPrev = document.querySelector('.lightbox-prev');
  const btnNext = document.querySelector('.lightbox-next');
  let currentIndex = -1;

  function updateControls() {
    const atStart = currentIndex <= 0;
    const atEnd = currentIndex >= getItems().length - 1;
    if (btnPrev) { btnPrev.disabled = atStart; btnPrev.setAttribute('aria-disabled', String(atStart)); }
    if (btnNext) { btnNext.disabled = atEnd; btnNext.setAttribute('aria-disabled', String(atEnd)); }
  }

  function openByIndex(idx) {
    const items = getItems();
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

  document.addEventListener('click', (e) => {
    const item = e.target.closest('.gallery-item');
    if (!item) return;
    const items = getItems();
    const idx = items.indexOf(item);
    if (idx === -1) return;
    currentIndex = idx;
    setTimeout(() => {
      updateControls();
      const nextSrc = items[idx + 1] ? getItemSrc(items[idx + 1]) : undefined;
      const prevSrc = items[idx - 1] ? getItemSrc(items[idx - 1]) : undefined;
      preload(nextSrc); preload(prevSrc);
    }, 0);
  });

  btnPrev?.addEventListener('click', (e) => { e.stopPropagation(); if (currentIndex > 0) openByIndex(currentIndex - 1); });
  btnNext?.addEventListener('click', (e) => { e.stopPropagation(); if (currentIndex < items.length - 1) openByIndex(currentIndex + 1); });

  window.addEventListener('keydown', (e) => {
    if (lightbox.getAttribute('aria-hidden') === 'true') return;
    const items = getItems();
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
