// 复习（SRS）页面 - 完全离线版
// 所有复习操作都基于本机 IndexedDB + 浏览器内 FSRS 调度器，无任何网络请求。
import {
  showToast,
  showLoading,
  hideLoading,
  escapeHtml,
  emptyState,
  loadingInline,
} from './app.js';
import { DB } from './db.js';
import { schedule, filterDue, RATING, STATE } from './fsrs.js';

let root = null;
let reviewSession = null;
let currentCardIndex = 0;
let reviewedCount = 0;
let correctCount = 0;

const RATING_MAP = {
  again: RATING.AGAIN,
  hard: RATING.HARD,
  good: RATING.GOOD,
  easy: RATING.EASY,
};

export function renderReviewPage(container) {
  reviewSession = null;
  currentCardIndex = 0;
  reviewedCount = 0;
  correctCount = 0;

  // Fresh wrapper element per render: listeners die with it (no leaks)
  container.innerHTML = '<div id="srs-page"></div>';
  root = container.querySelector('#srs-page');
  root.innerHTML = getMainHTML();
  bindEvents();
  loadStats();
}

function getMainHTML() {
  return `
    <div id="srs-stats-section">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" id="stat-due">-</div>
          <div class="stat-label">今日待复习</div>
        </div>
        <div class="stat-card">
          <div class="stat-value secondary" id="stat-reviewed">-</div>
          <div class="stat-label">已复习</div>
        </div>
        <div class="stat-card">
          <div class="stat-value warning" id="stat-total">-</div>
          <div class="stat-label">总卡片</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-streak">-</div>
          <div class="stat-label">连续天数</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="start-review-btn" disabled>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        开始复习
      </button>
    </div>

    <div id="srs-review-session" class="hidden"></div>

    <div id="srs-add-section" class="mt-24">
      <div class="collapsible-header" id="add-card-toggle">
        <span class="collapsible-title">添加新卡片</span>
        <svg class="collapsible-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="collapsible-body" id="add-card-body">
        <div class="collapsible-content">
          <div class="input-group">
            <label class="input-label">卡片类型</label>
            <div class="segment-control" id="card-type-selector">
              <button class="segment-btn active" data-type="word">单词</button>
              <button class="segment-btn" data-type="phrase">短语</button>
              <button class="segment-btn" data-type="grammar">语法</button>
            </div>
          </div>
          <div class="input-group">
            <label class="input-label">正面（问题）</label>
            <input type="text" class="input" id="card-front" placeholder="例如: ubiquitous">
          </div>
          <div class="input-group">
            <label class="input-label">背面（答案）</label>
            <input type="text" class="input" id="card-back" placeholder="例如: 无处不在的">
          </div>
          <div class="input-group">
            <label class="input-label">补充信息（可选）</label>
            <input type="text" class="input" id="card-extra" placeholder="例如: 例句或用法说明">
          </div>
          <button class="btn btn-primary btn-block" id="add-card-btn">添加卡片</button>
        </div>
      </div>
    </div>

    <div id="srs-vocab-section" class="mt-24">
      <div class="section-title">生词本</div>
      <div class="input-group">
        <input type="text" class="input" id="vocab-search" placeholder="搜索生词...">
      </div>
      <div id="vocab-list">${loadingInline('加载生词本...')}</div>
    </div>
  `;
}

function bindEvents() {
  root.addEventListener('click', async (e) => {
    // Start review
    if (e.target.closest('#start-review-btn')) {
      await startReview();
      return;
    }

    // Card type selector
    const typeBtn = e.target.closest('#card-type-selector .segment-btn');
    if (typeBtn) {
      root.querySelectorAll('#card-type-selector .segment-btn').forEach(b => b.classList.remove('active'));
      typeBtn.classList.add('active');
      return;
    }

    // Add card toggle
    if (e.target.closest('#add-card-toggle')) {
      const body = root.querySelector('#add-card-body');
      const arrow = root.querySelector('#add-card-toggle .collapsible-arrow');
      if (body) body.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
      return;
    }

    // Add card submit
    if (e.target.closest('#add-card-btn')) {
      await handleAddCard();
      return;
    }

    // Flashcard flip
    const flashcard = e.target.closest('.flashcard');
    if (flashcard && !flashcard.classList.contains('flipped')) {
      flashcard.classList.add('flipped');
      const ratingButtons = root.querySelector('.rating-buttons');
      if (ratingButtons) ratingButtons.classList.remove('hidden');
      return;
    }

    // Rating buttons
    const ratingBtn = e.target.closest('.rating-btn');
    if (ratingBtn) {
      await handleRating(ratingBtn.dataset.rating);
      return;
    }

    // Delete vocab
    const deleteBtn = e.target.closest('.vocab-delete-btn');
    if (deleteBtn) {
      await handleDeleteVocab(deleteBtn);
      return;
    }

    // End review session
    if (e.target.closest('#end-review-btn')) {
      endReview();
      return;
    }

    // Back to stats after session
    if (e.target.closest('#back-to-stats-btn')) {
      showStatsView();
      loadStats();
      return;
    }
  });

  // Vocab search (client-side)
  const searchInput = root.querySelector('#vocab-search');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        loadVocabList(searchInput.value.trim());
      }, 200);
    });
  }
}

// ---------------------------------------------------------------------------
// Stats: computed from local DB only
// ---------------------------------------------------------------------------
async function loadStats() {
  let localStats = { due_today: 0, reviewed_today: 0, total_cards: 0, streak: 0 };
  try {
    const allCards = await DB.getAll('srs_cards');
    const dueCards = filterDue(allCards);
    const todayKey = 'reviewed_today_' + DB.todayStr();
    const reviewedToday = await DB.kvGet(todayKey, 0);
    let streak = 0;
    try {
      streak = await DB.kvGet('streak', 0);
    } catch (e2) { /* ignore */ }
    localStats = {
      due_today: dueCards.length,
      reviewed_today: Number(reviewedToday) || 0,
      total_cards: allCards.length,
      streak: Number(streak) || 0,
      _by_state: countByState(allCards),
    };
  } catch (e) {
    // Local DB unavailable - render zeros
  }
  renderStats(localStats);
  loadVocabList();
}

function countByState(cards) {
  const counts = {
    [STATE.NEW]: 0,
    [STATE.LEARNING]: 0,
    [STATE.REVIEW]: 0,
    [STATE.RELEARNING]: 0,
  };
  cards.forEach((c) => {
    const s = c && c.state;
    if (s && Object.prototype.hasOwnProperty.call(counts, s)) counts[s]++;
  });
  return counts;
}

function renderStats(stats) {
  const dueEl = root.querySelector('#stat-due');
  const reviewedEl = root.querySelector('#stat-reviewed');
  const totalEl = root.querySelector('#stat-total');
  const streakEl = root.querySelector('#stat-streak');
  const startBtn = root.querySelector('#start-review-btn');
  if (!dueEl || !reviewedEl || !totalEl || !streakEl || !startBtn) return;

  dueEl.textContent = stats.due_today ?? 0;
  reviewedEl.textContent = stats.reviewed_today ?? 0;
  totalEl.textContent = stats.total_cards ?? 0;
  streakEl.textContent = stats.streak ?? 0;

  const due = Number(stats.due_today) || 0;
  if (due > 0) {
    startBtn.disabled = false;
    startBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      开始复习 (${due} 张)
    `;
  } else {
    startBtn.disabled = true;
    startBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
      今日复习已完成
    `;
  }
}

// ---------------------------------------------------------------------------
// Review session (local FSRS scheduling)
// ---------------------------------------------------------------------------
async function startReview() {
  showLoading();
  let cards = [];
  try {
    const allCards = await DB.getAll('srs_cards');
    cards = filterDue(allCards);
  } catch (e) {
    cards = [];
  } finally {
    hideLoading();
  }

  if (!cards || cards.length === 0) {
    showToast('没有待复习的卡片', 'info');
    return;
  }

  reviewSession = cards;
  currentCardIndex = 0;
  reviewedCount = 0;
  correctCount = 0;

  root.querySelector('#srs-stats-section').classList.add('hidden');
  root.querySelector('#srs-add-section').classList.add('hidden');
  root.querySelector('#srs-vocab-section').classList.add('hidden');
  const sessionEl = root.querySelector('#srs-review-session');
  sessionEl.classList.remove('hidden');
  renderCurrentCard();
}

function renderCurrentCard() {
  const sessionEl = root.querySelector('#srs-review-session');
  if (!sessionEl) return;

  if (currentCardIndex >= reviewSession.length) {
    renderSessionComplete();
    return;
  }

  const card = reviewSession[currentCardIndex];
  const total = reviewSession.length;
  const progress = Math.round((currentCardIndex / total) * 100);

  sessionEl.innerHTML = `
    <div class="flex-between mb-12">
      <button class="btn btn-ghost btn-sm" id="end-review-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        结束
      </button>
      <span style="font-size:13px;color:var(--color-text-secondary);font-weight:600">${currentCardIndex + 1} / ${total}</span>
    </div>
    <div class="progress-bar mb-16">
      <div class="progress-fill" style="width:${progress}%"></div>
    </div>
    <div class="flashcard-container">
      <div class="flashcard" id="current-flashcard">
        <div class="flashcard-face flashcard-front">
          <div class="flashcard-word">${escapeHtml(card.front || card.word || '')}</div>
          ${card.card_type ? `<span class="badge badge-neutral">${getCardTypeLabel(card.card_type)}</span>` : ''}
          <div class="flashcard-hint">点击翻转查看答案</div>
        </div>
        <div class="flashcard-face flashcard-back">
          <div class="flashcard-definition">${escapeHtml(card.back || card.definition_cn || '')}</div>
          ${card.example ? `<div class="flashcard-example">${escapeHtml(card.example)}</div>` : ''}
          ${card.extra ? `<div class="flashcard-extra">${escapeHtml(card.extra)}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="rating-buttons hidden">
      <button class="rating-btn rating-again" data-rating="again">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        忘了
      </button>
      <button class="rating-btn rating-hard" data-rating="hard">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
        困难
      </button>
      <button class="rating-btn rating-good" data-rating="good">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
        记得
      </button>
      <button class="rating-btn rating-easy" data-rating="easy">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        简单
      </button>
    </div>
  `;
}

async function handleRating(ratingKey) {
  const card = reviewSession[currentCardIndex];
  const flashcard = root.querySelector('#current-flashcard');
  if (!card || !flashcard) return;

  const ratingNum = RATING_MAP[ratingKey] || RATING.GOOD;

  // Track session stats
  reviewedCount++;
  if (ratingKey === 'good' || ratingKey === 'easy') {
    correctCount++;
  }

  // Animate card out
  const animClass = (ratingKey === 'again' || ratingKey === 'hard') ? 'card-exit-left' : 'card-exit-right';
  flashcard.classList.add(animClass);

  // --- Local FSRS scheduling + persistence ---
  try {
    const result = schedule(card, ratingNum);
    card.stability = result.stability;
    card.difficulty = result.difficulty;
    card.due = result.due;
    card.interval = result.interval;
    card.state = result.state;
    card.reps = result.reps;
    card.lapses = result.lapses;
    card.last_review = new Date().toISOString();
    await DB.put('srs_cards', card);

    // Increment today's reviewed counter
    const todayKey = 'reviewed_today_' + DB.todayStr();
    const current = Number(await DB.kvGet(todayKey, 0)) || 0;
    await DB.kvSet(todayKey, current + 1);
  } catch (e) {
    // Silent fail - session continues
  }

  // Move to next card after animation
  setTimeout(() => {
    currentCardIndex++;
    renderCurrentCard();
  }, 300);
}

function renderSessionComplete() {
  const sessionEl = root.querySelector('#srs-review-session');
  if (!sessionEl) return;
  const accuracy = reviewedCount > 0 ? Math.round((correctCount / reviewedCount) * 100) : 0;

  sessionEl.innerHTML = `
    <div class="celebration">
      <div class="celebration-emoji">🎉</div>
      <div class="celebration-title">复习完成！</div>
      <div class="celebration-desc">
        共复习 ${reviewedCount} 张卡片，正确率 ${accuracy}%
      </div>
      <div class="stats-grid mb-24">
        <div class="stat-card">
          <div class="stat-value">${reviewedCount}</div>
          <div class="stat-label">复习卡片</div>
        </div>
        <div class="stat-card">
          <div class="stat-value secondary">${accuracy}%</div>
          <div class="stat-label">正确率</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="back-to-stats-btn">返回</button>
    </div>
  `;

  triggerConfetti();
}

function triggerConfetti() {
  const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.top = '-10px';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 0.5 + 's';
      piece.style.animationDuration = (1.5 + Math.random()) + 's';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3000);
    }, i * 50);
  }
}

function endReview() {
  showStatsView();
  loadStats();
}

function showStatsView() {
  const stats = root.querySelector('#srs-stats-section');
  const add = root.querySelector('#srs-add-section');
  const vocab = root.querySelector('#srs-vocab-section');
  const session = root.querySelector('#srs-review-session');
  if (stats) stats.classList.remove('hidden');
  if (add) add.classList.remove('hidden');
  if (vocab) vocab.classList.remove('hidden');
  if (session) session.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Add card - local only
// ---------------------------------------------------------------------------
async function handleAddCard() {
  const frontEl = root.querySelector('#card-front');
  const backEl = root.querySelector('#card-back');
  const extraEl = root.querySelector('#card-extra');
  const front = frontEl.value.trim();
  const back = backEl.value.trim();
  const extra = extraEl.value.trim();
  const typeBtn = root.querySelector('#card-type-selector .segment-btn.active');
  const cardType = typeBtn ? typeBtn.dataset.type : 'word';

  if (!front || !back) {
    showToast('请填写正面和背面内容', 'warning');
    return;
  }

  const btn = root.querySelector('#add-card-btn');
  btn.disabled = true;
  btn.textContent = '添加中...';

  try {
    const nowIso = new Date().toISOString();
    const localCard = {
      id: DB.localId('card'),
      card_type: cardType,
      front,
      back,
      extra: extra || '',
      stability: 0.5,
      difficulty: 5,
      due: nowIso,
      last_review: '',
      reps: 0,
      lapses: 0,
      state: 'new',
      created_at: nowIso,
    };
    await DB.put('srs_cards', localCard);
    showToast('卡片添加成功', 'success');

    frontEl.value = '';
    backEl.value = '';
    extraEl.value = '';
    loadStats();
  } catch (err) {
    showToast((err && err.message) || '添加失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '添加卡片';
  }
}

// ---------------------------------------------------------------------------
// Vocabulary list - local, client-side search & sort
// ---------------------------------------------------------------------------
async function loadVocabList(search = '') {
  const listEl = root.querySelector('#vocab-list');
  if (!listEl) return;

  let items = [];
  try {
    items = await DB.getAll('vocabulary');
  } catch (e) {
    items = [];
  }
  renderVocabList(listEl, items, search);
}

function renderVocabList(listEl, items, search) {
  const q = (search || '').trim().toLowerCase();
  let filtered = items;
  if (q) {
    filtered = items.filter((it) => {
      const word = String(it.word || '').toLowerCase();
      const def = String(it.definition_cn || it.definition || '').toLowerCase();
      const phon = String(it.phonetic || '').toLowerCase();
      return word.includes(q) || def.includes(q) || phon.includes(q);
    });
  }
  // Sort: recently added first (created_at desc), fallback alphabetical by word
  filtered = filtered.slice().sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta && tb && ta !== tb) return tb - ta;
    const wa = String(a.word || '').toLowerCase();
    const wb = String(b.word || '').toLowerCase();
    return wa.localeCompare(wb);
  });

  if (filtered.length === 0) {
    listEl.innerHTML = emptyState(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      q ? '没有找到匹配的生词' : '生词本为空',
      q ? '试试其他关键词' : '在每日单词或阅读模块中添加生词'
    );
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const mastery = item.mastery || item.mastery_level || 0;
    const masteryPercent = Math.min(100, Math.round(mastery * 20));
    const masteryClass = masteryPercent < 40 ? 'low' : masteryPercent < 70 ? 'mid' : 'high';
    html += `
      <div class="vocab-card">
        <div class="flex-between">
          <div>
            <div class="vocab-word">${escapeHtml(item.word)}</div>
            <div class="vocab-phonetic">${escapeHtml(item.phonetic || '')}</div>
          </div>
          <button class="btn btn-ghost btn-sm vocab-delete-btn" data-id="${escapeHtml(String(item.id))}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
        <div class="vocab-definition">${escapeHtml(item.definition_cn || item.definition || '')}</div>
        <div class="flex gap-8" style="align-items:center;margin-top:8px">
          <div class="mastery-bar"><div class="mastery-fill ${masteryClass}" style="width:${masteryPercent}%"></div></div>
          <span style="font-size:11px;color:var(--color-text-muted);white-space:nowrap">${masteryPercent}%</span>
        </div>
      </div>
    `;
  });
  listEl.innerHTML = html;
}

async function handleDeleteVocab(btn) {
  const rawId = btn.dataset.id;
  btn.disabled = true;

  // Coerce numeric ids back to numbers; keep local string ids as-is
  let id = rawId;
  if (/^-?\d+$/.test(String(rawId))) id = Number(rawId);

  try {
    // Look up the word so we can also drop the matching SRS card
    let word = '';
    try {
      const row = await DB.get('vocabulary', id);
      if (row) word = String(row.word || '');
    } catch (e) { /* ignore */ }

    await DB.delete('vocabulary', id);

    if (word) {
      try {
        const cards = await DB.getAll('srs_cards');
        const toDelete = cards.filter((c) => c && String(c.front || '') === word);
        for (const c of toDelete) {
          await DB.delete('srs_cards', c.id);
        }
      } catch (e) { /* ignore */ }
    }

    showToast('已删除', 'success');
    const searchInput = root.querySelector('#vocab-search');
    loadVocabList(searchInput ? searchInput.value.trim() : '');
    loadStats();
  } catch (err) {
    btn.disabled = false;
    showToast((err && err.message) || '删除失败', 'error');
  }
}

function getCardTypeLabel(type) {
  const labels = { word: '单词', phrase: '短语', grammar: '语法' };
  return labels[type] || type;
}
