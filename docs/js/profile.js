// 我的（个人中心）页面 - 完全离线版
// 统计、设置、数据管理全部基于本机 IndexedDB，无任何网络请求。
import { getData, showToast, escapeHtml } from './app.js';
import { DB } from './db.js';

let root = null;

// Stores wiped by "清空学习数据"
const CLEAR_STORES = [
  'vocabulary',
  'srs_cards',
  'daily_progress',
  'daily_words',
  'daily_quiz',
  'reading_history',
  'speaking_history',
  'listening_history',
  'kv',
];

export function renderProfilePage(container) {
  container.innerHTML = '<div id="profile-page"></div>';
  root = container.querySelector('#profile-page');
  root.innerHTML = getMainHTML();
  bindEvents();
  loadSettings();
  loadStats();
}

function getMainHTML() {
  let wordsCount = 0;
  let dictCount = 0;
  let dialoguesCount = 0;
  try {
    const data = getData() || {};
    wordsCount = Array.isArray(data.words) ? data.words.length : 0;
    dictCount = data.dict ? Object.keys(data.dict).length : 0;
    dialoguesCount = Array.isArray(data.dialogues) ? data.dialogues.length : 0;
  } catch (e) { /* content stats unavailable */ }

  return `
    <div style="text-align:center;margin-bottom:20px;">
      <span class="offline-badge">离线版 v1.0 · 全部数据保存在本机</span>
    </div>

    <div class="settings-section">
      <div class="settings-title">学习统计</div>
      <div class="stats-grid" id="profile-stats">
        <div class="stat-card">
          <div class="stat-value" id="profile-vocab-count">-</div>
          <div class="stat-label">生词数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value secondary" id="profile-card-count">-</div>
          <div class="stat-label">卡片数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value warning" id="profile-reading-count">-</div>
          <div class="stat-label">阅读篇数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="profile-streak">-</div>
          <div class="stat-label">连续天数</div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">学习设置</div>
      <div class="card card-static">
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">每日目标（个单词）</label>
          <input type="number" class="input" id="daily-goal-input" placeholder="30" min="1" max="200" value="30">
          <div class="input-hint">离线版每日固定推送 30 词，此目标用于自我激励</div>
        </div>
        <div class="input-group" style="margin-bottom:16px">
          <label class="input-label">发音语速</label>
          <select class="select" id="tts-rate-select">
            <option value="0.8">慢速 (0.8x)</option>
            <option value="1" selected>正常 (1.0x)</option>
            <option value="1.2">快速 (1.2x)</option>
          </select>
          <div class="input-hint">应用于单词发音、阅读查词、听力朗读与口语跟读</div>
        </div>
        <button class="btn btn-primary btn-block" id="save-settings-btn">保存设置</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">数据管理</div>
      <div class="card card-static">
        <div class="settings-row">
          <span class="settings-row-label">存储位置</span>
          <span class="settings-row-value">本机浏览器 (IndexedDB)</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">网络权限</span>
          <span class="settings-row-value">无需联网，零网络请求</span>
        </div>
        <div style="margin-top:16px;">
          <button class="btn btn-danger btn-block" id="clear-data-btn">清空学习数据</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">关于</div>
      <div class="card card-static">
        <div class="settings-row">
          <span class="settings-row-label">应用名称</span>
          <span class="settings-row-value">English AI Workbench</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">版本</span>
          <span class="settings-row-value">离线版 v1.0</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">内置词库</span>
          <span class="settings-row-value">${wordsCount} 词</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">内置词典</span>
          <span class="settings-row-value">${dictCount} 词</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">情景对话</span>
          <span class="settings-row-value">${dialoguesCount} 组</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">简介</span>
          <span class="settings-row-value" style="max-width:180px;text-align:right">完全离线的英语学习工作台：每日单词、间隔复习、点读阅读、TTS 听力、跟读自评</span>
        </div>
      </div>
    </div>
  `;
}

function bindEvents() {
  root.addEventListener('click', async (e) => {
    if (e.target.closest('#save-settings-btn')) {
      await handleSaveSettings();
      return;
    }
    if (e.target.closest('#clear-data-btn')) {
      await handleClearData();
      return;
    }
  });
}

async function loadSettings() {
  try {
    const goal = await DB.kvGet('daily_goal', 30);
    const goalInput = root.querySelector('#daily-goal-input');
    if (goalInput && goal) goalInput.value = goal;
  } catch (e) { /* keep defaults */ }

  try {
    const rate = await DB.kvGet('tts_rate', 1);
    const rateSelect = root.querySelector('#tts-rate-select');
    if (rateSelect && rate !== null && rate !== undefined) {
      const normalized = String(Number(rate));
      const hasOption = Array.from(rateSelect.options).some(o => o.value === normalized);
      if (hasOption) rateSelect.value = normalized;
    }
  } catch (e) { /* keep defaults */ }
}

async function loadStats() {
  let vocabCount = 0;
  let cardCount = 0;
  let readingCount = 0;
  let streak = 0;
  try {
    vocabCount = (await DB.getAll('vocabulary')).length;
  } catch (e) { /* ignore */ }
  try {
    cardCount = (await DB.getAll('srs_cards')).length;
  } catch (e) { /* ignore */ }
  try {
    readingCount = (await DB.getAll('reading_history')).length;
  } catch (e) { /* ignore */ }
  try {
    streak = Number(await DB.kvGet('streak', 0)) || 0;
  } catch (e) { /* ignore */ }

  const set = (id, val) => {
    const el = root.querySelector(id);
    if (el) el.textContent = String(val);
  };
  set('#profile-vocab-count', vocabCount);
  set('#profile-card-count', cardCount);
  set('#profile-reading-count', readingCount);
  set('#profile-streak', streak);
}

async function handleSaveSettings() {
  const goalInput = root.querySelector('#daily-goal-input');
  const rateSelect = root.querySelector('#tts-rate-select');
  const goal = parseInt(goalInput.value, 10);

  if (!Number.isFinite(goal) || goal < 1 || goal > 200) {
    showToast('每日目标请输入 1-200 之间的数字', 'warning');
    return;
  }

  const btn = root.querySelector('#save-settings-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中...';
  }

  try {
    await DB.kvSet('daily_goal', goal);
    await DB.kvSet('tts_rate', Number(rateSelect.value) || 1);
    showToast('设置已保存', 'success');
  } catch (err) {
    showToast((err && err.message) || '保存失败', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '保存设置';
    }
  }
}

async function clearStore(storeName) {
  // Prefer DB.clear when the shell provides it; otherwise delete row by row.
  if (typeof DB.clear === 'function') {
    await DB.clear(storeName);
    return;
  }
  const rows = await DB.getAll(storeName);
  for (const row of rows) {
    const key = row && (row.id !== undefined ? row.id : row.date !== undefined ? row.date : row.key);
    if (key !== undefined && key !== null) {
      await DB.delete(storeName, key);
    }
  }
}

async function handleClearData() {
  if (!window.confirm('确定要清空所有学习数据吗？\n\n生词本、复习卡片、学习进度、连续天数和全部历史记录都会被删除，且无法恢复。')) {
    return;
  }

  const btn = root.querySelector('#clear-data-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '清空中...';
  }

  let failed = 0;
  for (const store of CLEAR_STORES) {
    try {
      await clearStore(store);
    } catch (e) {
      failed++;
    }
  }
  // The outbox is unused offline, but wipe it too if present
  try {
    await clearStore('outbox');
  } catch (e) { /* store may not exist */ }

  if (btn) {
    btn.disabled = false;
    btn.textContent = '清空学习数据';
  }

  if (failed > 0) {
    showToast('部分数据清空失败，请重试', 'error');
  } else {
    showToast('学习数据已清空', 'success');
  }
  loadStats();
}
