// AI英语 · 离线版 - Main App Module
// 100% offline: no backend, no API calls, no network requests.
// All content is loaded once from precached local JSON (see initApp).

import { DB } from './db.js';
import { initTTS } from './tts.js';
export { DB };

// --- Toast Notification ---
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = {
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  };
  toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Loading Helpers ---
export function showLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.remove('hidden');
}

export function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.add('hidden');
}

// --- Bottom Sheet (local UI, no network) ---
export function showSheet(title, contentHTML) {
  const sheetTitle = document.getElementById('sheet-title');
  const sheetBody = document.getElementById('sheet-body');
  const overlay = document.getElementById('sheet-overlay');
  const sheet = document.getElementById('bottom-sheet');
  if (sheetTitle) sheetTitle.textContent = title;
  if (sheetBody) sheetBody.innerHTML = contentHTML;
  if (overlay) overlay.classList.remove('hidden');
  if (sheet) sheet.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function hideSheet() {
  const overlay = document.getElementById('sheet-overlay');
  const sheet = document.getElementById('bottom-sheet');
  if (overlay) overlay.classList.add('hidden');
  if (sheet) sheet.classList.add('hidden');
  document.body.style.overflow = '';
}

// --- Utility ---
export function escapeHtml(str) {
  if (str === null || str === undefined || str === '') return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hours}:${mins}`;
}

export function renderStars(count, max = 5) {
  let html = '';
  for (let i = 0; i < max; i++) {
    if (i < count) {
      html += '<svg class="star" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    } else {
      html += '<svg class="star empty" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    }
  }
  return html;
}

export function emptyState(icon, title, desc) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${title}</div>
      <div class="empty-desc">${desc}</div>
    </div>
  `;
}

export function loadingInline(text = '加载中...') {
  return `<div class="loading-inline"><div class="spinner spinner-sm"></div><span>${text}</span></div>`;
}

// --- In-memory Data Cache ---
// Loaded ONCE in initApp from precached local JSON files. Never hits the network.
export function getData() {
  return window.__DATA__ || { words: [], dict: {}, dialogues: [] };
}

// --- Router ---
const routes = {};
export const pageTitles = {
  '#daily': '每日单词',
  '#read': '阅读',
  '#review': '复习',
  '#listen': '听力',
  '#speak': '口语',
  '#profile': '我的',
};

export function registerRoute(hash, renderer) {
  routes[hash] = renderer;
}

function getCurrentRoute() {
  return window.location.hash || '#daily';
}

export function navigate() {
  const hash = getCurrentRoute();
  const renderer = routes[hash];
  const container = document.getElementById('page-content');
  const title = document.getElementById('header-title');

  // Update active nav tab
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const tabHash = tab.getAttribute('href');
    tab.classList.toggle('active', tabHash === hash);
  });

  // Update header title
  if (title) title.textContent = pageTitles[hash] || '每日单词';

  // Render page
  if (!container) return;
  if (renderer) {
    container.innerHTML = '';
    container.className = 'page-enter';
    try {
      renderer(container);
    } catch (e) {
      console.error('[offline] route render failed:', hash, e);
      container.innerHTML = emptyState(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        '页面加载出错',
        '请重试或切换到其它页面'
      );
    }
    // Remove animation class after it plays
    setTimeout(() => { container.className = ''; }, 300);
  } else {
    container.innerHTML = emptyState(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
      '页面不存在',
      '请从底部导航选择一个页面'
    );
  }
}

// --- Local JSON loader (fetches precached files; falls back gracefully) ---
async function loadJSON(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`[offline] failed to load ${path}:`, e);
    return fallback;
  }
}

// --- App Init ---
async function initApp() {
  // Wire header gear button -> profile
  const gear = document.getElementById('settings-btn');
  if (gear) gear.addEventListener('click', () => { window.location.hash = '#profile'; });

  // Wire bottom-sheet close controls
  const sheetClose = document.getElementById('sheet-close-btn');
  const sheetOverlay = document.getElementById('sheet-overlay');
  if (sheetClose) sheetClose.addEventListener('click', hideSheet);
  if (sheetOverlay) sheetOverlay.addEventListener('click', hideSheet);

  // Listen for hash changes
  window.addEventListener('hashchange', navigate);

  // 1) Local IndexedDB init (non-fatal if unavailable)
  try {
    await DB.init();
  } catch (e) {
    console.warn('[offline] IndexedDB init failed:', e);
  }

  // 1b) TTS init: preload voices + unlock mobile audio on first gesture
  try {
    initTTS();
  } catch (e) {
    console.warn('[offline] TTS init failed:', e);
  }

  // 2) Preload all content ONCE into memory (files are precached by the SW)
  const [words, dict, dialogues] = await Promise.all([
    loadJSON('./data/words.json', []),
    loadJSON('./data/dict.json', {}),
    loadJSON('./data/dialogues.json', []),
  ]);
  window.__DATA__ = { words, dict, dialogues };

  // 3) Register routes via dynamic imports (resilient to missing modules)
  const routeModules = [
    ['#daily', './daily.js', 'renderDailyPage'],
    ['#read', './reading.js', 'renderReadPage'],
    ['#review', './srs.js', 'renderReviewPage'],
    ['#listen', './listening.js', 'renderListenPage'],
    ['#speak', './speaking.js', 'renderSpeakPage'],
    ['#profile', './profile.js', 'renderProfilePage'],
  ];
  for (const [hash, path, fnName] of routeModules) {
    try {
      const mod = await import(path);
      if (mod && typeof mod[fnName] === 'function') {
        registerRoute(hash, mod[fnName]);
      } else {
        console.warn(`[offline] ${path} missing export ${fnName}`);
      }
    } catch (e) {
      console.warn(`[offline] route module not available: ${path}`, e);
    }
  }

  // 4) Hide splash, reveal app
  const splash = document.getElementById('splash-screen');
  if (splash) splash.classList.add('splash-hidden');
  const app = document.getElementById('app');
  if (app) {
    app.classList.remove('app-hidden');
    app.classList.add('app-visible');
  }

  // 5) Navigate to default (or current) route
  if (!window.location.hash) {
    window.location.hash = '#daily'; // triggers hashchange -> navigate
  } else {
    navigate();
  }

  // 6) Register service worker (relative to app root).
  // Register directly: initApp is async, so window 'load' may have already
  // fired by now and a 'load' listener could never run.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => {
      console.warn('[offline] service worker registration failed:', e);
    });
  }
}

// Start the app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
