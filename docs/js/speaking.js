// 口语页面 - 完全离线版（跟读自评模式）
// 场景对话来自打包内容库 (getData().dialogues)，无 AI 对话、无语音识别、无网络请求。
// 练习流程：对方句子（自动朗读）→ 你的句子（看中文提示跟读，自评"说出来了/没说出来"）。
import { getData, showToast, escapeHtml, formatDate, emptyState, loadingInline } from './app.js';
import { DB } from './db.js';
import { tts } from './tts.js';

const EMOJI_MAP = {
  daily_chat: '💬',
  job_interview: '💼',
  travel: '✈️',
  business_meeting: '📊',
  restaurant: '🍽️',
  shopping: '🛍️',
  doctor_visit: '🏥',
  tech_support: '🔧',
};

let root = null;
let dialogues = [];
let current = null;      // current dialogue object
let practiceId = null;   // id for the current practice session (also history record id)
let turnIndex = 0;
let saidCount = 0;
let userTotal = 0;

// --- Helpers ---
async function getTtsRate() {
  try {
    const r = Number(await DB.kvGet('tts_rate', 1));
    return (r >= 0.5 && r <= 2) ? r : 1;
  } catch (e) {
    return 1;
  }
}

function speakText(text) {
  if (!text) return;
  if (!tts.available()) {
    showToast('您的浏览器不支持语音合成', 'warning');
    return;
  }
  tts.speak(text, { onFail: () => showToast(tts.hint, 'warning') });
}

function stopSpeak() {
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch (e) { /* ignore */ }
}

function emojiFor(scenario) {
  return EMOJI_MAP[scenario] || '💬';
}

// --- Main Render ---
export function renderSpeakPage(container) {
  current = null;
  practiceId = null;
  turnIndex = 0;
  saidCount = 0;
  userTotal = 0;
  stopSpeak();

  try {
    const data = getData() || {};
    dialogues = Array.isArray(data.dialogues) ? data.dialogues : [];
  } catch (e) {
    dialogues = [];
  }

  container.innerHTML = '<div id="speak-page"></div>';
  root = container.querySelector('#speak-page');
  root.innerHTML = getMainHTML();
  bindEvents();
  loadScenarios();
}

function getMainHTML() {
  return `
    <div class="segment-control">
      <button class="segment-btn active" data-view="scenarios">场景</button>
      <button class="segment-btn" data-view="history">历史</button>
    </div>
    <div id="speak-scenarios-view"></div>
    <div id="speak-practice-view" class="hidden"></div>
    <div id="speak-history-view" class="hidden"></div>
  `;
}

function bindEvents() {
  root.addEventListener('click', async (e) => {
    // Segment control
    const segBtn = e.target.closest('.segment-btn[data-view]');
    if (segBtn) {
      const view = segBtn.dataset.view;
      stopSpeak();
      root.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      segBtn.classList.add('active');
      switchView(view);
      return;
    }

    // Scenario card
    const scenarioCard = e.target.closest('.scenario-card');
    if (scenarioCard) {
      startDialogue(scenarioCard.dataset.scenario);
      return;
    }

    // Back to scenarios
    if (e.target.closest('#speak-back-btn')) {
      stopSpeak();
      switchView('scenarios');
      root.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      const tab = root.querySelector('.segment-btn[data-view="scenarios"]');
      if (tab) tab.classList.add('active');
      return;
    }

    // Speak current turn's English
    if (e.target.closest('#turn-speak-btn')) {
      const turn = current && current.turns && current.turns[turnIndex];
      if (turn) speakText(turn.en);
      return;
    }

    // Partner turn: continue
    if (e.target.closest('#turn-next-btn')) {
      advanceTurn();
      return;
    }

    // User turn: reveal answer
    if (e.target.closest('#reveal-answer-btn')) {
      const answerArea = root.querySelector('#answer-area');
      const revealBtn = root.querySelector('#reveal-answer-btn');
      if (answerArea) {
        answerArea.classList.remove('hidden');
        const turn = current && current.turns && current.turns[turnIndex];
        if (turn) speakText(turn.en);
      }
      if (revealBtn) revealBtn.classList.add('hidden');
      return;
    }

    // User turn: self-assessment
    if (e.target.closest('#said-btn')) {
      saidCount++;
      advanceTurn();
      return;
    }
    if (e.target.closest('#not-said-btn')) {
      advanceTurn();
      return;
    }

    // Summary: retry / new scenario
    if (e.target.closest('#retry-btn')) {
      if (current) startDialogue(current.scenario);
      return;
    }
    if (e.target.closest('#new-scenario-btn')) {
      stopSpeak();
      switchView('scenarios');
      root.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      const tab = root.querySelector('.segment-btn[data-view="scenarios"]');
      if (tab) tab.classList.add('active');
      return;
    }
  });
}

function switchView(view) {
  const scenariosView = root.querySelector('#speak-scenarios-view');
  const practiceView = root.querySelector('#speak-practice-view');
  const historyView = root.querySelector('#speak-history-view');
  if (scenariosView) scenariosView.classList.toggle('hidden', view !== 'scenarios');
  if (practiceView) practiceView.classList.toggle('hidden', view !== 'practice');
  if (historyView) historyView.classList.toggle('hidden', view !== 'history');

  if (view === 'history') {
    loadHistory();
  }
}

// --- Scenario grid ---
function loadScenarios() {
  const view = root.querySelector('#speak-scenarios-view');
  if (!view) return;

  if (dialogues.length === 0) {
    view.innerHTML = emptyState(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      '对话内容未加载',
      '请刷新页面重试'
    );
    return;
  }

  let html = '<div style="font-size:12px;color:var(--color-text-muted);margin:8px 0 12px;text-align:center;">离线版：跟读自评模式</div>';
  html += '<div class="scenario-grid">';
  dialogues.forEach(d => {
    const difficulty = d.difficulty || 2;
    let dots = '';
    for (let i = 0; i < 3; i++) {
      dots += `<span class="difficulty-dot ${i < difficulty ? 'filled' : ''}"></span>`;
    }
    html += `
      <div class="scenario-card" data-scenario="${escapeHtml(String(d.scenario || ''))}">
        <div class="scenario-emoji">${emojiFor(d.scenario)}</div>
        <div class="scenario-name">${escapeHtml(d.title_cn || d.scenario || '')}</div>
        <div class="scenario-difficulty">${dots}</div>
      </div>
    `;
  });
  html += '</div>';
  view.innerHTML = html;
}

// --- Practice ---
function startDialogue(scenarioId) {
  const dialogue = dialogues.find(d => String(d.scenario) === String(scenarioId));
  if (!dialogue) {
    showToast('未找到该场景对话', 'error');
    return;
  }
  current = dialogue;
  practiceId = Date.now();
  turnIndex = 0;
  saidCount = 0;
  userTotal = (dialogue.turns || []).filter(t => t.role === 'user').length;

  root.querySelector('#speak-scenarios-view').classList.add('hidden');
  root.querySelector('#speak-history-view').classList.add('hidden');
  const practiceView = root.querySelector('#speak-practice-view');
  practiceView.classList.remove('hidden');

  practiceView.innerHTML = `
    <div class="flex-between mb-12">
      <button class="btn btn-ghost btn-sm" id="speak-back-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回
      </button>
      <span style="font-size:14px;font-weight:600">${emojiFor(current.scenario)} ${escapeHtml(current.title_cn || '')}</span>
      <span class="badge badge-neutral" id="turn-progress">-</span>
    </div>
    <div class="progress-bar mb-16">
      <div class="progress-fill" id="turn-progress-fill" style="width:0%"></div>
    </div>
    <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;text-align:center;">离线版：跟读自评模式 · 听对方说话，看中文提示跟读你的句子</div>
    <div id="turn-container" class="dialogue-turns"></div>
  `;

  renderTurn();
}

function advanceTurn() {
  stopSpeak();
  turnIndex++;
  renderTurn();
}

function renderTurn() {
  const practiceView = root.querySelector('#speak-practice-view');
  if (!practiceView || !current) return;
  const turns = current.turns || [];

  if (turnIndex >= turns.length) {
    finishPractice();
    return;
  }

  const turn = turns[turnIndex];
  const progressEl = practiceView.querySelector('#turn-progress');
  const fillEl = practiceView.querySelector('#turn-progress-fill');
  if (progressEl) progressEl.textContent = `${turnIndex + 1}/${turns.length}`;
  if (fillEl) fillEl.style.width = `${Math.round((turnIndex / turns.length) * 100)}%`;

  const turnContainer = practiceView.querySelector('#turn-container');

  if (turn.role === 'partner') {
    turnContainer.innerHTML = `
      <div class="dialogue-turn turn-partner">
        <div class="turn-role">对方</div>
        <div class="turn-en">${escapeHtml(turn.en || '')}</div>
        <div class="turn-cn">${escapeHtml(turn.cn || '')}</div>
        <div class="flex gap-8" style="margin-top:12px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" id="turn-speak-btn">🔊 播放发音</button>
          <button class="btn btn-primary btn-sm" id="turn-next-btn">继续</button>
        </div>
      </div>
    `;
    // Auto-speak partner line (guarded)
    speakText(turn.en);
  } else {
    turnContainer.innerHTML = `
      <div class="dialogue-turn turn-user">
        <div class="turn-role">轮到你 · 试着用英文说出来</div>
        <div class="turn-cn">${escapeHtml(turn.cn || '')}</div>
        ${turn.tip ? `<div class="turn-tip">💡 ${escapeHtml(turn.tip)}</div>` : ''}
        <button class="reveal-btn" id="reveal-answer-btn">查看答案</button>
        <div id="answer-area" class="hidden" style="margin-top:10px;">
          <div class="turn-en">${escapeHtml(turn.en || '')}</div>
          <button class="btn btn-secondary btn-sm" id="turn-speak-btn" style="margin-top:8px;">🔊 播放发音</button>
        </div>
        <div class="word-nav" style="margin-top:14px;">
          <button class="btn btn-primary" id="said-btn">我说出来了 ✔</button>
          <button class="btn btn-outline" id="not-said-btn">没说出来 ✘</button>
        </div>
      </div>
    `;
  }
}

async function finishPractice() {
  stopSpeak();
  const total = userTotal;
  const pct = total > 0 ? Math.round((saidCount / total) * 100) : 0;

  // Save practice record locally
  try {
    await DB.put('speaking_history', {
      id: practiceId,
      scenario: current.scenario,
      title_cn: current.title_cn || '',
      said: saidCount,
      total,
      created_at: new Date().toISOString(),
    });
  } catch (e) { /* history is best-effort */ }

  const practiceView = root.querySelector('#speak-practice-view');
  if (!practiceView) return;
  practiceView.innerHTML = `
    <div class="celebration">
      <div class="celebration-emoji">🗣️</div>
      <div class="celebration-title">练习完成！</div>
      <div class="celebration-desc">
        ${escapeHtml(current.title_cn || '')}：共 ${total} 句跟读，你说出了 ${saidCount} 句
      </div>
      <div class="stats-grid mb-24">
        <div class="stat-card">
          <div class="stat-value">${saidCount}/${total}</div>
          <div class="stat-label">说出句数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value secondary">${pct}%</div>
          <div class="stat-label">完成度</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="retry-btn">再练一遍</button>
      <button class="btn btn-ghost btn-block" id="new-scenario-btn" style="margin-top:12px;">选择新场景</button>
    </div>
  `;
}

// --- History tab ---
async function loadHistory() {
  const historyView = root.querySelector('#speak-history-view');
  if (!historyView) return;
  historyView.innerHTML = loadingInline('加载历史记录...');

  let items = [];
  try {
    items = await DB.getAll('speaking_history');
  } catch (e) {
    items = [];
  }
  items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderHistoryList(historyView, items);
}

function renderHistoryList(historyView, items) {
  if (!items || items.length === 0) {
    historyView.innerHTML = emptyState(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      '暂无跟读记录',
      '选择一个场景开始口语跟读练习吧'
    );
    return;
  }

  let html = '';
  items.forEach(item => {
    const scenario = item.scenario || item.scenario_id || '';
    const emoji = emojiFor(scenario);
    const name = item.title_cn || item.scenario_name || '对话练习';
    const said = item.said !== undefined ? item.said : '-';
    const total = item.total !== undefined ? item.total : '-';
    const date = formatDate(item.created_at || item.date);
    html += `
      <div class="list-item">
        <div class="list-item-icon">${emoji}</div>
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(name)}</div>
          <div class="list-item-subtitle">说出 ${said}/${total} 句</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-date">${date}</div>
        </div>
      </div>
    `;
  });
  historyView.innerHTML = html;
}
