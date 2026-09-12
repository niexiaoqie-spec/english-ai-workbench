// Profile Page Module
import { API, showToast, showLoading, hideLoading, escapeHtml, loadingInline, offlineGuard } from './app.js';
import { DB } from './db.js';
import { Sync } from './sync.js';

export function renderProfilePage(container) {
  container.innerHTML = getMainHTML();
  bindEvents(container);
  loadSettings(container);
  loadStats(container);
}

function getMainHTML() {
  return `
    <div class="settings-section">
      <div class="settings-title">API 设置</div>
      <div class="card card-static">
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">Kimi API Key</label>
          <div class="input-password-wrap">
            <input type="password" class="input" id="api-key-input" placeholder="输入你的 Kimi API Key...">
            <button class="input-toggle-vis" id="toggle-key-vis">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="input-hint">用于 AI 分析功能，从 Kimi 开放平台获取</div>
        </div>
        <button class="btn btn-primary btn-block" id="save-settings-btn">保存设置</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">学习偏好</div>
      <div class="card card-static">
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">当前水平</label>
          <select class="select" id="level-select">
            <option value="beginner">初级 (Beginner)</option>
            <option value="intermediate" selected>中级 (Intermediate)</option>
            <option value="advanced">高级 (Advanced)</option>
          </select>
        </div>
        <div class="input-group" style="margin-bottom:0">
          <label class="input-label">每日目标（张卡片）</label>
          <input type="number" class="input" id="daily-goal-input" placeholder="20" min="1" max="200" value="20">
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">学习统计</div>
      <div class="stats-grid" id="profile-stats">
        <div class="stat-card">
          <div class="stat-value" id="profile-total-words">-</div>
          <div class="stat-label">总词汇量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value secondary" id="profile-total-readings">-</div>
          <div class="stat-label">阅读篇数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value warning" id="profile-total-speaking">-</div>
          <div class="stat-label">口语对话</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="profile-streak">-</div>
          <div class="stat-label">连续天数</div>
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
          <span class="settings-row-value">1.0.0</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-label">简介</span>
          <span class="settings-row-value" style="max-width:180px;text-align:right">个人AI英语学习工作台，集阅读、复习、听力、口语于一体</span>
        </div>
      </div>
    </div>
  `;
}

function bindEvents(container) {
  container.addEventListener('click', async (e) => {
    // Toggle password visibility
    if (e.target.closest('#toggle-key-vis')) {
      const input = container.querySelector('#api-key-input');
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      const btn = container.querySelector('#toggle-key-vis');
      btn.innerHTML = isPassword
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      return;
    }

    // Save settings
    if (e.target.closest('#save-settings-btn')) {
      await handleSaveSettings(container);
      return;
    }
  });
}

async function loadSettings(container) {
  try {
    const settings = await API.get('/api/settings');
    if (settings.kimi_api_key_configured) {
      container.querySelector('#api-key-input').placeholder = settings.kimi_api_key || '已配置';
    }
    if (settings.level) {
      container.querySelector('#level-select').value = settings.level;
    }
    if (settings.daily_goal) {
      container.querySelector('#daily-goal-input').value = settings.daily_goal;
    }
  } catch (e) {
    // Settings not available yet
  }
}

async function loadStats(container) {
  // Local-first: compute stats from local DB instantly
  try {
    const [vocab, readings, speaking, streak] = await Promise.all([
      DB.getAll('vocabulary'),
      DB.getAll('reading_history'),
      DB.getAll('speaking_history'),
      DB.kvGet('streak', 0),
    ]);
    container.querySelector('#profile-total-words').textContent = vocab.length;
    container.querySelector('#profile-total-readings').textContent = readings.length;
    container.querySelector('#profile-total-speaking').textContent = speaking.length;
    container.querySelector('#profile-streak').textContent = streak;
  } catch (e) {
    container.querySelector('#profile-total-words').textContent = '0';
    container.querySelector('#profile-total-readings').textContent = '0';
    container.querySelector('#profile-total-speaking').textContent = '0';
    container.querySelector('#profile-streak').textContent = '0';
  }

  // Secondary: refresh from server when online (wrapped so offline never breaks the page)
  if (Sync.isOnline()) {
    try {
      const stats = await API.get('/api/stats');
      container.querySelector('#profile-total-words').textContent = stats.total_words ?? stats.vocabulary_count ?? 0;
      container.querySelector('#profile-total-readings').textContent = stats.total_readings ?? stats.reading_count ?? 0;
      container.querySelector('#profile-total-speaking').textContent = stats.total_speaking ?? stats.speaking_count ?? 0;
      container.querySelector('#profile-streak').textContent = stats.streak ?? stats.study_streak ?? 0;
    } catch (e) {
      // Keep local stats
    }
  }
}

async function handleSaveSettings(container) {
  if (!offlineGuard('保存设置需要联网使用')) return;
  const apiKey = container.querySelector('#api-key-input').value.trim();
  const level = container.querySelector('#level-select').value;
  const dailyGoal = parseInt(container.querySelector('#daily-goal-input').value) || 20;

  if (!apiKey) {
    showToast('请输入 API Key', 'warning');
    return;
  }

  const btn = container.querySelector('#save-settings-btn');
  btn.disabled = true;
  btn.textContent = '保存中...';

  try {
    await API.post('/api/settings', {
      kimi_api_key: apiKey,
      level,
      daily_goal: dailyGoal,
    });
    showToast('设置已保存', 'success');
  } catch (err) {
    showToast(err.message || '保存失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存设置';
  }
}
