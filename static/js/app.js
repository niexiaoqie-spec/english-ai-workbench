// English AI Workbench - Main App Module

// --- API Client ---
export const API = {
  async request(method, url, data = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `请求失败 (${res.status})` }));
        throw new Error(err.detail || err.message || `请求失败 (${res.status})`);
      }
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await res.json();
      }
      return await res.text();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('网络连接失败，请检查网络');
      }
      throw err;
    }
  },

  get(url) {
    return this.request('GET', url);
  },

  post(url, data) {
    return this.request('POST', url, data);
  },

  patch(url, data) {
    return this.request('PATCH', url, data);
  },

  del(url) {
    return this.request('DELETE', url);
  },
};

// --- Toast Notification ---
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
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
  document.getElementById('loading-overlay').classList.remove('hidden');
}

export function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// --- Offline Support ---
export function isOnline() {
  return navigator.onLine !== false;
}

function ensureOfflineBanner() {
  let banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.className = 'offline-banner hidden';
    banner.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg><span>离线模式 · 学习记录已保存在本地，联网后自动同步</span>';
    document.body.appendChild(banner);
  }
  return banner;
}

export function updateOfflineBanner() {
  const banner = ensureOfflineBanner();
  banner.classList.toggle('hidden', isOnline());
}

/** Call before network-only operations. Returns true if online; shows toast if offline. */
export function offlineGuard(message = '此功能需要联网使用') {
  if (isOnline()) return true;
  showToast(message, 'warning');
  return false;
}


// --- Bottom Sheet ---
export function showSheet(title, contentHTML) {
  document.getElementById('sheet-title').textContent = title;
  document.getElementById('sheet-body').innerHTML = contentHTML;
  document.getElementById('sheet-overlay').classList.remove('hidden');
  document.getElementById('bottom-sheet').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function hideSheet() {
  document.getElementById('sheet-overlay').classList.add('hidden');
  document.getElementById('bottom-sheet').classList.add('hidden');
  document.body.style.overflow = '';
}

// --- Utility ---
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
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

// --- Router ---
const routes = {};
const pageTitles = {
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

function navigate() {
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
  title.textContent = pageTitles[hash] || '每日单词';

  // Render page
  if (renderer) {
    container.innerHTML = '';
    container.className = 'page-enter';
    renderer(container);
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

// --- App Init ---
async function initApp() {
  // Register routes
  const { renderDailyPage } = await import('./daily.js');
  const { renderReadPage } = await import('./reading.js');
  const { renderReviewPage } = await import('./srs.js');
  const { renderListenPage } = await import('./listening.js');
  const { renderSpeakPage } = await import('./speaking.js');
  const { renderProfilePage } = await import('./profile.js');

  registerRoute('#daily', renderDailyPage);
  registerRoute('#read', renderReadPage);
  registerRoute('#review', renderReviewPage);
  registerRoute('#listen', renderListenPage);
  registerRoute('#speak', renderSpeakPage);
  registerRoute('#profile', renderProfilePage);

  // Setup sheet close
  document.getElementById('sheet-close-btn').addEventListener('click', hideSheet);
  document.getElementById('sheet-overlay').addEventListener('click', hideSheet);

  // Listen for hash changes
  window.addEventListener('hashchange', navigate);

  // Offline-first bootstrap: local DB init + sync engine (non-blocking)
  try {
    const { DB } = await import('./db.js');
    const { Sync } = await import('./sync.js');
    await DB.init();
    Sync.init();
    Sync.onOnline(() => {
      updateOfflineBanner();
      showToast('网络已恢复，正在同步...', 'info');
    });
    Sync.onOffline(() => {
      updateOfflineBanner();
    });
    updateOfflineBanner();
    // Background sync: flush pending offline ops, then seed server data
    if (Sync.isOnline()) {
      Sync.flushOutbox().then(() => Sync.seedFromServer()).catch(() => {});
    }
  } catch (e) {
    // Local DB unavailable - app still works in online-only mode
  }

  // Hide splash, show app
  document.getElementById('splash-screen').classList.add('splash-hidden');
  const app = document.getElementById('app');
  app.classList.remove('app-hidden');
  app.classList.add('app-visible');

  // Navigate to current route
  if (!window.location.hash) {
    window.location.hash = '#daily';
  } else {
    navigate();
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// Start the app
document.addEventListener('DOMContentLoaded', initApp);
