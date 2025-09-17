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
const lightboxImageWrap = document.querySelector('.lightbox-image-wrap');
const zoomInBtn = document.querySelector('.lightbox-zoom-in');
const zoomOutBtn = document.querySelector('.lightbox-zoom-out');
const zoomResetBtn = document.querySelector('.lightbox-zoom-reset');
const zoomPercentEl = document.getElementById('lightbox-zoom-percent');
let lastFocusedBeforeLightbox = null;
let preloadedImages = new Map();
// Zoom state
let zoom = 1; // 1 = fit, >1 zoomed in
let translateX = 0;
let translateY = 0;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
let isDragging = false;
let dragStart = null;
let baseWidth = 0;
let baseHeight = 0;

// Global helper to update lightbox metadata (image position and page)
function updateLightboxMetaForIndexGlobal(idx) {
  try {
    const imgPosEl = document.getElementById('lightbox-image-pos');
    const pagePosEl = document.getElementById('lightbox-page-pos');
    const grid = document.querySelector('.gallery-grid');
    const list = (grid && Array.isArray(grid.__discovered)) ? grid.__discovered : (window.galleryState && Array.isArray(window.galleryState.discovered) ? window.galleryState.discovered : []);
    const total = Array.isArray(list) ? list.length : 0;
    const position = Number.isFinite(idx) ? (idx + 1) : undefined;
    const batch = (grid && grid.__batchSize) || (window.galleryState && window.galleryState.BATCH_SIZE) || 12;
    const page = position ? Math.floor((position - 1) / batch) + 1 : undefined;
    if (imgPosEl) imgPosEl.textContent = position ? String(position) : '';
    if (pagePosEl) pagePosEl.textContent = page ? `Page ${page} of ${Math.max(1, Math.ceil(total / batch))}` : '';
  } catch (e) { /* ignore */ }
}
try { window.__updateLightboxMetaForIndex = updateLightboxMetaForIndexGlobal; window.updateLightboxMetaForIndex = updateLightboxMetaForIndexGlobal; } catch (e) { /* ignore */ }

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
      // Reset transforms and record the baseline displayed size (fit-to-container)
      try {
        resetZoom();
        lightboxImage.style.transform = '';
        const r = lightboxImage.getBoundingClientRect();
        baseWidth = r.width || 0;
        baseHeight = r.height || 0;
      } catch (e) { baseWidth = 0; baseHeight = 0; }
      applyTransform();
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
  // If a gallery meta updater is available, attempt to compute index and update
  try {
    if (typeof window.__updateLightboxMetaForIndex === 'function') {
      const gridEl = document.querySelector('.gallery-grid');
      const list = (gridEl && Array.isArray(gridEl.__discovered)) ? gridEl.__discovered : (window.galleryState && Array.isArray(window.galleryState.discovered) ? window.galleryState.discovered : []);
      const normalize = (u) => { try { return new URL(u, window.location.href).toString(); } catch (e) { return String(u); } };
      const idx = list.findIndex(ent => normalize(ent.url) === normalize(src));
      window.__updateLightboxMetaForIndex(idx);
    }
  } catch (e) { /* ignore */ }
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
  resetZoom(); applyTransform();
  // Restore focus to the element that opened the lightbox
  if (lastFocusedBeforeLightbox && typeof lastFocusedBeforeLightbox.focus === 'function') {
    lastFocusedBeforeLightbox.focus();
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function applyTransform() {
  if (!lightboxImage) return;
  // Clamp translate values so user cannot pan image completely out of view.
  try {
    const wrap = lightboxImageWrap || lightboxImage.parentElement;
    const rect = lightboxImage.getBoundingClientRect();
    const containerRect = wrap.getBoundingClientRect();
    const visibleW = rect.width * zoom;
    const visibleH = rect.height * zoom;
    const maxOffsetX = Math.max(0, (visibleW - containerRect.width) / 2);
    const maxOffsetY = Math.max(0, (visibleH - containerRect.height) / 2);
    // visual translation is translateX * zoom (because translate happens before scale)
    const limitX = maxOffsetX / Math.max(0.0001, zoom);
    const limitY = maxOffsetY / Math.max(0.0001, zoom);
    translateX = clamp(translateX, -limitX, limitX);
    translateY = clamp(translateY, -limitY, limitY);
  } catch (e) {
    // ignore and apply without clamping
  }
  const t = `translate(${translateX}px, ${translateY}px) scale(${zoom})`;
  lightboxImage.style.transform = t;
  // Update zoom percentage display
  try { if (zoomPercentEl) zoomPercentEl.textContent = `${Math.round(zoom * 100)}%`; } catch (e) {}
}
function resetZoom() {
  zoom = 1; translateX = 0; translateY = 0; isDragging = false; dragStart = null;
  if (lightboxImage) {
    lightboxImage.style.transform = '';
    lightboxImage.classList.remove('dragging');
  }
  try { if (zoomPercentEl) zoomPercentEl.textContent = '100%'; } catch (e) {}
}

// Zoom controls handlers
function setZoom(newZoom, centerX = 0, centerY = 0) {
  const prevZoom = zoom;
  zoom = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  // When zooming, adjust translate so cursor remains over same point (approximate)
  if (lightboxImage && prevZoom !== zoom) {
    const rect = lightboxImage.getBoundingClientRect();
    const cx = centerX || (rect.left + rect.width / 2);
    const cy = centerY || (rect.top + rect.height / 2);
    const offsetX = (cx - rect.left) - rect.width / 2;
    const offsetY = (cy - rect.top) - rect.height / 2;
    translateX = translateX - offsetX * (zoom / prevZoom - 1);
    translateY = translateY - offsetY * (zoom / prevZoom - 1);
  }
  applyTransform();
}

// Mouse wheel zoom
function onWheelZoom(e) {
  if (lightbox.getAttribute('aria-hidden') === 'true') return;
  if (Math.abs(e.deltaY) < 1) return;
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  setZoom(zoom + delta, e.clientX, e.clientY);
  e.preventDefault();
}

// Drag to pan when zoomed
function onPointerDown(e) {
  if (zoom <= 1) return;
  isDragging = true;
  dragStart = { x: e.clientX, y: e.clientY, tx: translateX, ty: translateY };
  lightboxImage.classList.add('dragging');
  e.preventDefault();
}
function onPointerMove(e) {
  if (!isDragging || !dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  translateX = dragStart.tx + dx;
  translateY = dragStart.ty + dy;
  applyTransform();
}
function onPointerUp(e) {
  if (!isDragging) return;
  isDragging = false;
  dragStart = null;
  lightboxImage.classList.remove('dragging');
}

// Wire zoom control buttons if present
try {
  zoomInBtn?.addEventListener('click', (e) => { e.stopPropagation(); setZoom(zoom + ZOOM_STEP); });
  zoomOutBtn?.addEventListener('click', (e) => { e.stopPropagation(); setZoom(zoom - ZOOM_STEP); });
  zoomResetBtn?.addEventListener('click', (e) => { e.stopPropagation(); resetZoom(); applyTransform(); });
  // Wheel zoom
  lightbox?.addEventListener('wheel', onWheelZoom, { passive: false });
  // Pointer drag for pan
  lightboxImage?.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  // Keyboard +/- support
  window.addEventListener('keydown', (e) => {
    if (lightbox.getAttribute('aria-hidden') === 'true') return;
    if (e.key === '+' || e.key === '=' ) { setZoom(zoom + ZOOM_STEP); e.preventDefault(); }
    if (e.key === '-') { setZoom(zoom - ZOOM_STEP); e.preventDefault(); }
    if (e.key === '0') { resetZoom(); applyTransform(); e.preventDefault(); }
  });
} catch (err) { /* ignore if elements missing */ }

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
  let totalItems = 0;
  let totalPages = 1;

  // Debug helper: expose gallery runtime state for easy inspection in console
  function exposeState() {
    try {
      window.galleryState = {
        discovered: Array.isArray(discovered) ? discovered.slice() : [],
        currentPage,
        rendered,
        totalItems,
        totalPages,
        BATCH_SIZE,
        max,
        basePath
      };
    } catch (e) { /* ignore */ }
  }


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
              continue;
            }
            const url = `${basePath}/${fileName}`;
            candidates.push({ url, caption: fileName.replace(/\.[a-zA-Z0-9]+$/, '') });
          }
          return candidates;
        }
      }
    } catch (e) {
      console.error('[gallery] manifest load failed or unavailable:', e && e.message ? e.message : e);
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
    const currentEl = document.getElementById('page-current');
    const totalEl = document.getElementById('page-total');
    if (currentEl) currentEl.textContent = String(Math.min(currentPage, totalPages));
    if (totalEl) totalEl.textContent = String(totalPages);
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
    // keep debug state current
    try { exposeState(); } catch (e) { /* ignore */ }
  }

  // Ensure buttons reflect the discovered totals immediately after discovery
  function syncPagerButtons() {
    const total = Math.max(1, Math.ceil((Array.isArray(discovered) ? discovered.length : 0) / BATCH_SIZE));
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= total;
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
  // Compute total items and pages immediately so UI can show correct totals
  totalItems = Array.isArray(discovered) ? discovered.length : 0;
  totalPages = Math.max(1, Math.ceil(totalItems / BATCH_SIZE));
  // Sync button states immediately
  try { syncPagerButtons(); } catch (e) { /* ignore */ }
  // Update grid-exposed discovered list and expose runtime state
  // Expose the full discovered list on the grid element so other modules (like
  // the lightbox) can navigate across all images, even those not currently
  // rendered in the DOM (pagination pages).
  try { grid.__discovered = discovered; } catch (e) { /* ignore */ }
  try { grid.__batchSize = BATCH_SIZE; } catch (e) { /* ignore */ }
  exposeState();
  updateCount();
  // Ensure pager UI reflects correct totals before first render
  const currentEl = document.getElementById('page-current');
  const totalEl = document.getElementById('page-total');
  if (currentEl) currentEl.textContent = String(Math.min(currentPage, totalPages));
  if (totalEl) totalEl.textContent = String(totalPages);
    await renderPage(1);
    // remove skeletons and loading overlay
    grid.classList.remove('loading', 'skeleton-loading');
    updatePager();
    document.dispatchEvent(new CustomEvent('gallery:populated'));
  })();

  async function renderPage(page) {
    currentPage = page;
    try { exposeState(); } catch (e) { /* ignore */ }
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

  // Update lightbox meta (image position and page info) when an image opens
  function updateLightboxMetaForIndex(idx) {
    try {
      const imgPosEl = document.getElementById('lightbox-image-pos');
      const pagePosEl = document.getElementById('lightbox-page-pos');
      const list = Array.isArray(discovered) ? discovered : (grid.__discovered || []);
      const total = Array.isArray(list) ? list.length : 0;
      const position = Number.isFinite(idx) ? (idx + 1) : undefined;
      const batch = grid.__batchSize || BATCH_SIZE;
      const page = position ? Math.floor((position - 1) / batch) + 1 : undefined;
      if (imgPosEl) imgPosEl.textContent = position ? `${position}` : '';
      if (pagePosEl) pagePosEl.textContent = page ? `Page ${page} of ${Math.max(1, Math.ceil(total / batch))}` : '';
    } catch (e) { /* ignore */ }
  }
  // Expose helper for other code paths (openLightbox) to call after lightbox opens
  try { window.__updateLightboxMetaForIndex = updateLightboxMetaForIndex; } catch (e) { /* ignore */ }

  prevPageBtn?.addEventListener('click', async () => {
    if (currentPage <= 1) return;
    const newPage = currentPage - 1;
    // Update UI state immediately
    currentPage = newPage;
    updatePager();
    prevPageBtn.disabled = true; nextPageBtn && (nextPageBtn.disabled = true);
    await renderPage(newPage);
    updatePager();
  });
  nextPageBtn?.addEventListener('click', async () => {
    const totalPages = Math.max(1, Math.ceil(discovered.length / BATCH_SIZE));
    if (currentPage >= totalPages) return;
    const newPage = currentPage + 1;
    // Update UI state immediately
    currentPage = newPage;
    updatePager();
    prevPageBtn && (prevPageBtn.disabled = true); nextPageBtn.disabled = true;
    await renderPage(newPage);
    updatePager();
  });

  // Listen for requests from the lightbox to open a specific index so the
  // gallery can render the page that contains that image (keeps UI in sync).
  document.addEventListener('gallery:open-index', async (ev) => {
    try {
      const idx = Number(ev?.detail?.index);
      if (!Number.isFinite(idx)) return;
      const page = Math.floor(idx / BATCH_SIZE) + 1;
      if (page !== currentPage) {
        // Update UI to show the new page immediately while we load images
        currentPage = page;
        updatePager();
        prevPageBtn && (prevPageBtn.disabled = true);
        nextPageBtn && (nextPageBtn.disabled = true);
        await renderPage(page);
        updatePager();
      }
    } catch (e) { /* ignore */ }
  });

  // Harden pager buttons: pointerdown/pointerup with debounce to improve
  // reliability across touch and pointer devices. Keep click as a fallback.
  (function hardenPagerButtons() {
    const debounce = (fn, ms = 250) => {
      let last = 0;
      return (...args) => {
        const now = Date.now();
        if (now - last < ms) return;
        last = now;
        return fn(...args);
      };
    };

    if (prevPageBtn) {
      const safePrev = debounce(async () => {
        if (currentPage <= 1) return;
        const newPage = currentPage - 1;
        // update UI immediately
        currentPage = newPage;
        updatePager();
        prevPageBtn.disabled = true; nextPageBtn && (nextPageBtn.disabled = true);
        await renderPage(newPage);
        updatePager();
      }, 300);
      prevPageBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
      prevPageBtn.addEventListener('pointerup', (e) => { try { safePrev(); } catch (err) {} });
      // keep click for non-pointer devices
      prevPageBtn.addEventListener('click', (e) => { e.preventDefault(); safePrev(); });
    }

    if (nextPageBtn) {
      const safeNext = debounce(async () => {
        const totalPages = Math.max(1, Math.ceil(discovered.length / BATCH_SIZE));
        if (currentPage >= totalPages) return;
        const newPage = currentPage + 1;
        // update UI immediately
        currentPage = newPage;
        updatePager();
        prevPageBtn && (prevPageBtn.disabled = true); nextPageBtn.disabled = true;
        await renderPage(newPage);
        updatePager();
      }, 300);
      nextPageBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
      nextPageBtn.addEventListener('pointerup', (e) => { try { safeNext(); } catch (err) {} });
      nextPageBtn.addEventListener('click', (e) => { e.preventDefault(); safeNext(); });
    }
  })();
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

// Lightbox index and navigation (enhanced to use the full discovered list)
(function enhanceLightboxNavigation() {
  if (!lightbox) return;
  const gridEl = document.querySelector('.gallery-grid');
  const btnPrev = document.querySelector('.lightbox-prev');
  const btnNext = document.querySelector('.lightbox-next');
  let currentIndex = -1;

  function normalizeUrl(u) {
    try { return new URL(u, window.location.href).toString(); } catch (e) { return String(u); }
  }

  // Returns the authoritative list of items. Prefer the discovered manifest
  // attached to the grid; fall back to DOM-derived list when necessary.
  function getFullList() {
    try {
      if (gridEl && Array.isArray(gridEl.__discovered) && gridEl.__discovered.length) return gridEl.__discovered;
    } catch (e) { /* ignore */ }
    // Fallback to DOM mapping
    return Array.from(document.querySelectorAll('.gallery-item')).map(a => ({
      url: getItemSrc(a),
      caption: a.getAttribute('data-caption') || a.querySelector('img')?.getAttribute('alt') || ''
    }));
  }

  function updateControls() {
    const list = getFullList();
    const atStart = currentIndex <= 0;
    const atEnd = currentIndex >= list.length - 1;
    if (btnPrev) { btnPrev.disabled = atStart; btnPrev.setAttribute('aria-disabled', String(atStart)); }
    if (btnNext) { btnNext.disabled = atEnd; btnNext.setAttribute('aria-disabled', String(atEnd)); }
  }

  function openByIndex(idx) {
    const list = getFullList();
    if (idx < 0 || idx >= list.length) return;
    const entry = list[idx];
    if (!entry) return;
    currentIndex = idx;
    // Ensure gallery page containing this index is visible
    try { document.dispatchEvent(new CustomEvent('gallery:open-index', { detail: { index: currentIndex } })); } catch (e) { /* ignore */ }
    openLightbox(entry.url, entry.caption || '');
    // update page/image metadata in lightbox
    try { updateLightboxMetaForIndex(currentIndex); } catch (e) { /* ignore */ }
    updateControls();
    const nextSrc = list[idx + 1] ? list[idx + 1].url : undefined;
    const prevSrc = list[idx - 1] ? list[idx - 1].url : undefined;
    preload(nextSrc); preload(prevSrc);
  }

  // When user opens an image from the gallery, determine its index from the
  // full list (not just the current DOM page) so lightbox navigation can move
  // across pages.
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.gallery-item');
    if (!item) return;
    const src = getItemSrc(item);
    const list = getFullList();
    const idx = list.findIndex(ent => normalizeUrl(ent.url) === normalizeUrl(src));
    if (idx === -1) return;
    currentIndex = idx;
    try { document.dispatchEvent(new CustomEvent('gallery:open-index', { detail: { index: currentIndex } })); } catch (e) { /* ignore */ }
    setTimeout(() => {
      updateControls();
      try { updateLightboxMetaForIndex(currentIndex); } catch (e) { /* ignore */ }
      const nextSrc = list[idx + 1] ? list[idx + 1].url : undefined;
      const prevSrc = list[idx - 1] ? list[idx - 1].url : undefined;
      preload(nextSrc); preload(prevSrc);
    }, 0);
  });

  btnPrev?.addEventListener('click', (e) => { e.stopPropagation(); if (currentIndex > 0) openByIndex(currentIndex - 1); });
  btnNext?.addEventListener('click', (e) => { e.stopPropagation(); const list = getFullList(); if (currentIndex < list.length - 1) openByIndex(currentIndex + 1); });

  window.addEventListener('keydown', (e) => {
    const list = getFullList();
    if (lightbox.getAttribute('aria-hidden') === 'false') {
      if (e.key === 'ArrowLeft' && currentIndex > 0) openByIndex(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < list.length - 1) openByIndex(currentIndex + 1);
      return;
    }
    // When lightbox is closed, use Arrow keys to move gallery pages
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      const prevBtn = document.getElementById('prev-page');
      if (prevBtn && !prevBtn.disabled) {
        // update UI immediately and trigger navigation
        const newPage = Math.max(1, currentPage - 1);
        if (newPage !== currentPage) {
          currentPage = newPage; updatePager();
        }
        prevBtn.click();
      }
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      const nextBtn = document.getElementById('next-page');
      if (nextBtn && !nextBtn.disabled) {
        const totalPages = Math.max(1, Math.ceil(discovered.length / BATCH_SIZE));
        const newPage = Math.min(totalPages, currentPage + 1);
        if (newPage !== currentPage) {
          currentPage = newPage; updatePager();
        }
        nextBtn.click();
      }
    }
  });

  let startX = 0;
  // Touch handling: support both single-finger swipe for navigation and
  // two-finger pinch for zoom. We track whether a pinch is active to avoid
  // conflicts.
  let touchStartX = 0;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  function distance(t1, t2) { const dx = t1.clientX - t2.clientX; const dy = t1.clientY - t2.clientY; return Math.hypot(dx, dy); }

  lightbox.addEventListener('touchstart', (e) => {
    if (!e.touches) return;
    if (e.touches.length === 2) {
      // Begin pinch gesture
      pinchStartDist = distance(e.touches[0], e.touches[1]);
      pinchStartZoom = zoom;
      // Cancel any single-finger drag state
      isDragging = false; dragStart = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (zoom > 1) {
        // Start panning with single finger when zoomed
        isDragging = true;
        dragStart = { x: t.clientX, y: t.clientY, tx: translateX, ty: translateY };
      } else {
        // Prepare for swipe navigation when not zoomed
        touchStartX = t.clientX;
      }
    }
  }, { passive: true });

  lightbox.addEventListener('touchmove', (e) => {
    if (!e.touches) return;
    // Pinch-to-zoom
    if (e.touches.length === 2) {
      const d = distance(e.touches[0], e.touches[1]);
      if (pinchStartDist > 0) {
        const scale = d / pinchStartDist;
        setZoom(clamp(pinchStartZoom * scale, ZOOM_MIN, ZOOM_MAX));
      }
      e.preventDefault();
      return;
    }

    // Single-finger pan when zoomed
    if (e.touches.length === 1 && isDragging && zoom > 1) {
      const t = e.touches[0];
      const dx = t.clientX - dragStart.x;
      const dy = t.clientY - dragStart.y;
      translateX = dragStart.tx + dx;
      translateY = dragStart.ty + dy;
      applyTransform();
      e.preventDefault();
      return;
    }
    // Otherwise, allow default behavior (swipe nav handled on touchend when zoom <=1)
  }, { passive: false });

  lightbox.addEventListener('touchend', (e) => {
    if (!e.changedTouches) return;
    // If pinch was active, clear pinch tracking
    if (pinchStartDist > 0) {
      pinchStartDist = 0; pinchStartZoom = zoom;
      return;
    }
    // If we were panning, stop panning
    if (isDragging) {
      isDragging = false; dragStart = null; applyTransform();
      return;
    }
    // Single-finger swipe navigation (only when not zoomed and not panning)
    if (zoom <= 1) {
      const endX = e.changedTouches[0].clientX;
      const dx = endX - touchStartX;
      const list = getFullList();
      if (Math.abs(dx) > 40) {
        if (dx > 0 && currentIndex > 0) openByIndex(currentIndex - 1);
        else if (dx < 0 && currentIndex < list.length - 1) openByIndex(currentIndex + 1);
      }
    }
  }, { passive: true });
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
