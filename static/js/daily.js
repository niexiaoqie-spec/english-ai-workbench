// Daily Words Page Module - LOCAL-FIRST (offline-capable)
// Data flow: IndexedDB is the primary source; the server is used for
// generation (online only) and receives tracking events via the outbox.
import { API, showToast, escapeHtml, loadingInline, offlineGuard, isOnline } from './app.js';
import { DB } from './db.js';
import { Sync } from './sync.js';

// --- State ---
let dailyState = 'hero'; // 'hero' | 'cards' | 'quiz' | 'result'
let words = [];
let currentWordIndex = 0;
let reviewedWordIds = new Set();
let selectedCategory = '';
let streak = 0;
let totalWords = 0;

// Quiz state
let quizQuestions = [];
let currentQuizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let wrongWords = [];

const FLAME_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-3.866 0-7-3.134-7-7 0-3 2-5.5 3.5-7.5S12 4 12 1c0 0 1.5 2.5 3.5 4.5S19 10 19 13c0 3.866-3.134 7-7 7zm0-2c2.761 0 5-2.239 5-5 0-2-1.5-4-3-5.5-.5-.5-1-1-1.5-1.5-.5.5-1 1-1.5 1.5C9.5 12 8 14 8 16c0 2.761 2.239 5 5 5z"/></svg>';

// --- Helpers ---
function speakWord(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  // Prefer the shared DB helper; fall back to local computation
  try {
    return DB.todayStr();
  } catch (e) {
    return getTodayStr();
  }
}

function getTodayDisplay() {
  const d = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
}

const CATEGORIES = ['商务策略', '职场沟通', '金融财务', '市场营销', '项目管理', '人力资源'];

/** Default progress record (all zeros) for a given day. */
function defaultProgress(date) {
  return { date, words_reviewed: 0, quiz_score: 0, quiz_total: 0, completed: 0 };
}

/** Read today's progress record from local DB, falling back to zeros. */
async function getLocalProgress(date) {
  try {
    const p = await DB.get('daily_progress', date);
    return p || defaultProgress(date);
  } catch (e) {
    return defaultProgress(date);
  }
}

/** Stable key for a word record (server id when present). */
function wordKey(w) {
  return w.id !== undefined && w.id !== null ? w.id : w.word;
}

/** Flush queued offline ops in the background when online. */
function flushInBackground() {
  if (isOnline()) {
    try {
      Sync.flushOutbox().catch(() => {});
    } catch (e) { /* sync engine unavailable */ }
  }
}

// --- Main Render ---
export function renderDailyPage(container) {
  dailyState = 'hero';
  words = [];
  currentWordIndex = 0;
  reviewedWordIds = new Set();
  selectedCategory = '';
  quizQuestions = [];
  currentQuizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  wrongWords = [];

  container.innerHTML = loadingInline('加载中...');
  initFromLocal(container);
}

/**
 * Local-first initial load:
 * - today's words come from IndexedDB (instant, works offline)
 * - streak/total come from the kv cache, refreshed in background when online
 */
async function initFromLocal(container) {
  const today = todayStr();

  // 1. Stats from local kv cache (instant display)
  try {
    streak = (await DB.kvGet('streak', 0)) || 0;
    totalWords = (await DB.kvGet('total_words', 0)) || 0;
  } catch (e) {
    streak = 0;
    totalWords = 0;
  }

  // 2. Today's words from local DB
  let localWords = [];
  try {
    localWords = (await DB.queryByIndex('daily_words', 'date', today)) || [];
  } catch (e) {
    localWords = []; // DB unavailable - degrade to hero / online-only
  }

  if (localWords.length > 0) {
    // State B straight from cache
    words = localWords;
    reviewedWordIds = new Set(words.filter(w => w.reviewed).map(wordKey));
    dailyState = 'cards';
    renderCards(container);
  } else {
    // State A hero (button disabled with note when offline & uncached)
    renderHero(container);
  }

  // 3. Background refresh of stats when online
  refreshStatsInBackground(container);
}

/**
 * Fetch stats from the server in the background (online only),
 * update the kv cache and re-render stats elements if present.
 */
async function refreshStatsInBackground(container) {
  if (!isOnline()) return;
  try {
    const data = await API.get('/api/daily/stats');
    if (!data) return;
    const newStreak = data.streak !== undefined ? data.streak : (data.progress && data.progress.streak);
    const newTotal = data.total_words !== undefined ? data.total_words : (data.progress && data.progress.total_words);
    if (newStreak !== undefined && newStreak !== null) streak = newStreak;
    if (newTotal !== undefined && newTotal !== null) totalWords = newTotal;
    try {
      await DB.kvSet('streak', streak);
      await DB.kvSet('total_words', totalWords);
    } catch (e) { /* kv cache unavailable */ }
    updateStatsDisplay(container);
  } catch (e) {
    // Offline mid-flight or endpoint error - keep cached values
  }
}

/** Patch streak/total displays in the current DOM without a full re-render. */
function updateStatsDisplay(container) {
  if (!container || !container.isConnected) return;
  const streakEl = container.querySelector('.daily-hero-streak');
  if (streakEl) {
    streakEl.innerHTML = `${FLAME_SVG}\n        已连续学习 ${streak} 天\n      `;
  }
  // Quiz result: third stat is 连续打卡
  const statValues = container.querySelectorAll('.quiz-stat-value');
  if (statValues.length >= 3) {
    statValues[2].textContent = String(streak);
  }
}

// --- State A: Hero ---
function renderHero(container) {
  dailyState = 'hero';
  const chipsHtml = CATEGORIES.map(cat =>
    `<button class="category-chip" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
  ).join('');

  // Offline with no cached words for today: generation is impossible
  const offlineNoCache = !isOnline() && words.length === 0;
  const disabledAttr = offlineNoCache ? 'disabled' : '';
  const offlineNoteHtml = offlineNoCache
    ? '<div style="font-size:12px;color:var(--color-text-muted);margin-top:10px;text-align:center;">离线且今日单词未缓存，联网后可生成</div>'
    : '';

  container.innerHTML = `
    <div class="daily-hero">
      <div class="daily-hero-date">${getTodayDisplay()}</div>
      <div class="daily-hero-title">每日单词</div>
      <div class="daily-hero-streak">
        ${FLAME_SVG}
        已连续学习 ${streak} 天
      </div>
      <p style="font-size:14px;color:var(--color-text-secondary);margin-bottom:20px;">选择主题，生成今日30个商务词汇</p>
      <div class="category-chips">
        <button class="category-chip active" data-category="">随机混合</button>
        ${chipsHtml}
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="generate-btn" style="margin-top:24px;" ${disabledAttr}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 19l.5 1.5L7 21l-1.5.5L5 23l-.5-1.5L3 21l1.5-.5L5 19z"/><path d="M19 13l.5 1.5L21 15l-1.5.5L19 17l-.5-1.5L17 15l1.5-.5L19 13z"/></svg>
        生成今日单词
      </button>
      ${offlineNoteHtml}
    </div>
  `;

  bindHeroEvents(container);
}

function bindHeroEvents(container) {
  container.addEventListener('click', async (e) => {
    // Category chip selection
    const chip = e.target.closest('.category-chip');
    if (chip) {
      container.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedCategory = chip.dataset.category || '';
      return;
    }

    // Generate button
    if (e.target.closest('#generate-btn')) {
      await handleGenerate(container);
    }
  });
}

async function handleGenerate(container) {
  // Generation requires the network (LLM-backed endpoint)
  if (!offlineGuard('生成单词需要联网')) return;

  const btn = container.querySelector('#generate-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner spinner-sm"></div> 正在生成...';
  }
  try {
    const payload = {};
    if (selectedCategory) {
      payload.category = selectedCategory;
    }
    const data = await API.post('/api/daily/generate', payload);
    const generated = data.words || [];
    if (generated.length === 0) {
      showToast('未能生成单词，请稍后重试', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '生成今日单词';
      }
      return;
    }

    // Persist to local DB so the day survives reloads / offline revisits
    const today = todayStr();
    const wordsToStore = generated.map(w => ({ ...w, date: w.date || today }));
    try {
      await DB.bulkPut('daily_words', wordsToStore);
      if (Array.isArray(data.quiz) && data.quiz.length > 0) {
        await DB.bulkPut('daily_quiz', data.quiz.map(q => ({ ...q, date: q.date || today })));
      }
      if (data.progress) {
        await DB.put('daily_progress', { ...data.progress, date: data.progress.date || today });
      }
      await DB.kvSet('daily_date', today);
    } catch (e) {
      // DB unavailable - continue with in-memory data (online-only mode)
    }

    words = wordsToStore;
    if (data.streak !== undefined && data.streak !== null) {
      streak = data.streak;
      try { await DB.kvSet('streak', streak); } catch (e) { /* ignore */ }
    }
    currentWordIndex = 0;
    reviewedWordIds = new Set();
    dailyState = 'cards';
    renderCards(container);
    showToast(`已生成 ${words.length} 个单词`, 'success');
  } catch (err) {
    showToast(err.message || '生成失败', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '生成今日单词';
    }
  }
}

// --- State B: Word Cards ---
function renderCards(container) {
  dailyState = 'cards';
  const total = words.length;
  const reviewed = reviewedWordIds.size;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  container.innerHTML = `
    <div class="quiz-progress">
      <div class="quiz-progress-bar">
        <div class="quiz-progress-fill" style="width:${progressPct}%"></div>
      </div>
      <span class="quiz-progress-text">${reviewed}/${total} 已学习</span>
    </div>
    <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;">${getTodayDisplay()}</div>
    <div id="word-card-container"></div>
    <div class="word-nav">
      <button class="btn btn-ghost" id="prev-word-btn" ${currentWordIndex === 0 ? 'disabled' : ''}>上一个</button>
      ${currentWordIndex >= total - 1
        ? '<button class="btn btn-primary" id="start-quiz-btn">开始测验</button>'
        : '<button class="btn btn-primary" id="next-word-btn">下一个</button>'}
    </div>
    <div class="word-counter">${currentWordIndex + 1} / ${total}</div>
  `;

  renderCurrentWord(container);
  bindCardEvents(container);
}

function renderCurrentWord(container) {
  const wordEl = container.querySelector('#word-card-container');
  if (!wordEl || words.length === 0) return;

  const w = words[currentWordIndex];
  const collocations = (w.collocations || []);
  const collocationsHtml = collocations.length > 0
    ? `<div class="word-section">
        <div class="word-section-label">常用搭配</div>
        <div class="word-collocations">
          ${collocations.map(c => `<span class="word-collocation-tag">${escapeHtml(c)}</span>`).join('')}
        </div>
      </div>`
    : '';

  const mnemonicHtml = w.mnemonic
    ? `<div class="word-mnemonic">
        <div class="word-mnemonic-label">💡 记忆技巧</div>
        <div class="word-mnemonic-text">${escapeHtml(w.mnemonic)}</div>
      </div>`
    : '';

  const categoryHtml = w.category
    ? `<span class="word-category-badge">${escapeHtml(w.category)}</span>`
    : '';

  wordEl.innerHTML = `
    <div class="word-card" id="word-card">
      <div class="word-card-header">
        <span class="word-card-word">${escapeHtml(w.word)}</span>
        <span class="word-card-phonetic">${escapeHtml(w.phonetic || '')}</span>
        ${w.pos ? `<span class="word-card-pos">${escapeHtml(w.pos)}</span>` : ''}
      </div>
      <button class="word-card-speak" id="speak-btn" title="发音">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
      </button>
      <div class="word-section">
        <div class="word-section-label">中文释义</div>
        <div class="word-def-cn">${escapeHtml(w.definition_cn || '')}</div>
        <div class="word-def-en">${escapeHtml(w.definition || '')}</div>
      </div>
      ${collocationsHtml}
      <div class="word-section">
        <div class="word-section-label">例句</div>
        <div class="word-example">
          <div class="word-example-en">${escapeHtml(w.example || '')}</div>
          <div class="word-example-cn">${escapeHtml(w.example_cn || '')}</div>
        </div>
      </div>
      ${mnemonicHtml}
      ${categoryHtml}
    </div>
  `;

  // Mark as reviewed (local-first tracking)
  markWordReviewed(w, container);
}

/**
 * Local-first review tracking:
 * - flag the word record as reviewed in IndexedDB
 * - increment today's progress (words_reviewed)
 * - queue a 'daily_review' op in the outbox for server sync (numeric ids only)
 */
async function markWordReviewed(word, container) {
  const key = wordKey(word);
  if (key === undefined || key === null || reviewedWordIds.has(key)) return;
  reviewedWordIds.add(key);

  // Update progress bar UI immediately
  updateWordProgressUI(container);

  if (word.reviewed) return; // Already recorded locally on a previous visit
  word.reviewed = true;

  try {
    const today = todayStr();
    if (!word.date) word.date = today;
    await DB.put('daily_words', word);

    const progress = await getLocalProgress(today);
    progress.words_reviewed = (progress.words_reviewed || 0) + 1;
    await DB.put('daily_progress', progress);

    if (typeof word.id === 'number') {
      await DB.outboxEnqueue('daily_review', { word_id: word.id });
      flushInBackground();
    }
  } catch (e) {
    // DB unavailable - review tracking degrades silently (online-only mode)
  }
}

function updateWordProgressUI(container) {
  const total = words.length;
  const reviewed = reviewedWordIds.size;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const fill = container.querySelector('.quiz-progress-fill');
  const text = container.querySelector('.quiz-progress-text');
  if (fill) fill.style.width = `${progressPct}%`;
  if (text) text.textContent = `${reviewed}/${total} 已学习`;
}

function bindCardEvents(container) {
  // Touch swipe support
  let touchStartX = 0;
  let touchEndX = 0;
  const cardContainer = container.querySelector('#word-card-container');

  if (cardContainer) {
    cardContainer.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    cardContainer.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchStartX - touchEndX;
      if (Math.abs(diff) > 60) {
        if (diff > 0) {
          // Swipe left -> next
          navigateWord(container, 1);
        } else {
          // Swipe right -> prev
          navigateWord(container, -1);
        }
      }
    }, { passive: true });
  }

  container.addEventListener('click', (e) => {
    // Speak button
    if (e.target.closest('#speak-btn')) {
      const w = words[currentWordIndex];
      if (w) speakWord(w.word);
      return;
    }

    // Next button
    if (e.target.closest('#next-word-btn')) {
      navigateWord(container, 1);
      return;
    }

    // Prev button
    if (e.target.closest('#prev-word-btn')) {
      navigateWord(container, -1);
      return;
    }

    // Start quiz
    if (e.target.closest('#start-quiz-btn')) {
      startQuiz(container);
      return;
    }
  });
}

function navigateWord(container, direction) {
  const newIndex = currentWordIndex + direction;
  if (newIndex < 0 || newIndex >= words.length) return;

  const cardEl = container.querySelector('#word-card');
  if (cardEl) {
    cardEl.classList.add(direction > 0 ? 'card-exit-left' : 'card-exit-right');
    setTimeout(() => {
      currentWordIndex = newIndex;
      renderCards(container);
    }, 200);
  } else {
    currentWordIndex = newIndex;
    renderCards(container);
  }
}

// --- State C: Quiz (fully local, works offline) ---
async function startQuiz(container) {
  dailyState = 'quiz';
  container.innerHTML = loadingInline('正在准备测验...');

  const today = todayStr();
  let questions = [];
  try {
    questions = (await DB.queryByIndex('daily_quiz', 'date', today)) || [];
  } catch (e) {
    questions = [];
  }

  // Fallback: nothing cached locally and we're online -> generate + cache
  if (questions.length === 0 && isOnline()) {
    try {
      const data = await API.post('/api/daily/quiz/generate', {});
      const generated = data.questions || [];
      if (generated.length > 0) {
        questions = generated.map(q => ({ ...q, date: q.date || today }));
        try {
          await DB.bulkPut('daily_quiz', questions);
        } catch (e) { /* continue in memory */ }
      }
    } catch (err) {
      showToast(err.message || '测验加载失败', 'error');
      renderCards(container);
      return;
    }
  }

  if (questions.length === 0) {
    showToast('暂无测验题目', 'warning');
    renderCards(container);
    return;
  }

  quizQuestions = questions;
  currentQuizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  wrongWords = [];
  renderQuiz(container);
}

function renderQuiz(container) {
  dailyState = 'quiz';
  const total = quizQuestions.length;
  const progressPct = total > 0 ? Math.round((currentQuizIndex / total) * 100) : 0;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="font-size:18px;font-weight:700;">今日测验</h2>
      <span style="font-size:13px;color:var(--color-text-secondary);">${currentQuizIndex + 1}/${total}</span>
    </div>
    <div class="quiz-progress">
      <div class="quiz-progress-bar">
        <div class="quiz-progress-fill" style="width:${progressPct}%"></div>
      </div>
    </div>
    <div id="quiz-content"></div>
  `;

  renderQuizQuestion(container);
  bindQuizEvents(container);
}

function renderQuizQuestion(container) {
  const quizContent = container.querySelector('#quiz-content');
  if (!quizContent) return;

  const q = quizQuestions[currentQuizIndex];
  const letters = ['A', 'B', 'C', 'D'];
  const optionsHtml = (q.options || []).map((opt, i) => `
    <button class="quiz-option" data-index="${i}">
      <span class="quiz-option-letter">${letters[i]}</span>
      <span>${escapeHtml(opt)}</span>
    </button>
  `).join('');

  quizContent.innerHTML = `
    <div class="quiz-question">${escapeHtml(q.question || '')}</div>
    <div class="quiz-options" id="quiz-options">
      ${optionsHtml}
    </div>
    <div id="quiz-feedback" class="hidden" style="margin-top:16px;"></div>
  `;
  quizAnswered = false;
}

function bindQuizEvents(container) {
  container.addEventListener('click', async (e) => {
    const optionBtn = e.target.closest('.quiz-option');
    if (optionBtn && !quizAnswered) {
      await handleQuizAnswer(container, optionBtn);
      return;
    }

    // Next question button
    if (e.target.closest('#quiz-next-btn')) {
      currentQuizIndex++;
      if (currentQuizIndex >= quizQuestions.length) {
        renderQuizResult(container);
      } else {
        // Update progress
        const total = quizQuestions.length;
        const progressPct = Math.round((currentQuizIndex / total) * 100);
        const fill = container.querySelector('.quiz-progress-fill');
        if (fill) fill.style.width = `${progressPct}%`;
        const counter = container.querySelector('span[style*="font-size:13px"]');
        if (counter) counter.textContent = `${currentQuizIndex + 1}/${total}`;
        renderQuizQuestion(container);
      }
      return;
    }

    // Result buttons
    if (e.target.closest('#tomorrow-btn')) {
      renderHero(container);
      return;
    }

    if (e.target.closest('#review-wrong-btn')) {
      reviewWrongWords(container);
      return;
    }
  });
}

/**
 * Grade the answer LOCALLY (no server call):
 * - compare user_answer with the question's stored answer
 * - persist user_answer / is_correct on the quiz record
 * - update progress quiz_score / quiz_total; completed=1 when all answered
 * - queue 'daily_quiz_submit' in the outbox (numeric ids only)
 */
async function handleQuizAnswer(container, optionBtn) {
  quizAnswered = true;
  const q = quizQuestions[currentQuizIndex];
  const selectedIndex = parseInt(optionBtn.dataset.index, 10);
  const correctIndex = q.correct_index !== undefined ? q.correct_index : q.answer;

  // Disable all options
  const allOptions = container.querySelectorAll('.quiz-option');
  allOptions.forEach(opt => opt.classList.add('disabled'));

  // Highlight correct and wrong
  allOptions.forEach((opt, i) => {
    if (i === correctIndex) {
      opt.classList.add('correct');
    } else if (i === selectedIndex && i !== correctIndex) {
      opt.classList.add('wrong');
    }
  });

  const isCorrect = selectedIndex === correctIndex;
  if (isCorrect) {
    quizScore++;
  } else {
    // Track wrong word
    if (q.word_id) {
      const wrongWord = words.find(w => w.id === q.word_id);
      if (wrongWord) wrongWords.push(wrongWord);
    }
  }

  // Local grading persistence + outbox (works fully offline)
  q.user_answer = selectedIndex;
  q.is_correct = isCorrect;
  let quizCompleted = false;
  try {
    const today = todayStr();
    if (!q.date) q.date = today;
    await DB.put('daily_quiz', q);

    const progress = await getLocalProgress(today);
    progress.quiz_total = (progress.quiz_total || 0) + 1;
    if (isCorrect) progress.quiz_score = (progress.quiz_score || 0) + 1;
    const answeredCount = quizQuestions.filter(x => x.user_answer !== undefined && x.user_answer !== null).length;
    if (answeredCount >= quizQuestions.length) {
      progress.completed = 1;
      quizCompleted = true;
    }
    await DB.put('daily_progress', progress);

    if (typeof q.id === 'number') {
      await DB.outboxEnqueue('daily_quiz_submit', { quiz_id: q.id, user_answer: selectedIndex });
      flushInBackground();
    }
  } catch (e) {
    // DB unavailable - grading UI still works, tracking is lost gracefully
  }

  if (quizCompleted && isOnline()) {
    // Refresh streak/total after the outbox has had a chance to flush
    setTimeout(() => refreshStatsInBackground(container), 1500);
  }

  // Show feedback
  const feedback = container.querySelector('#quiz-feedback');
  if (feedback) {
    feedback.classList.remove('hidden');
    const explanation = q.explanation || '';
    feedback.innerHTML = `
      <div style="padding:12px;border-radius:12px;background:${isCorrect ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};border:1px solid ${isCorrect ? 'var(--color-secondary)' : 'var(--color-danger)'};">
        <div style="font-size:14px;font-weight:600;color:${isCorrect ? 'var(--color-secondary)' : 'var(--color-danger)'};">
          ${isCorrect ? '✓ 回答正确' : '✗ 回答错误'}
        </div>
        ${explanation ? `<div style="font-size:13px;color:var(--color-text-secondary);margin-top:6px;">${escapeHtml(explanation)}</div>` : ''}
      </div>
      <button class="btn btn-primary btn-block" id="quiz-next-btn" style="margin-top:12px;">
        ${currentQuizIndex >= quizQuestions.length - 1 ? '查看结果' : '下一题'}
      </button>
    `;
  }
}

// --- Quiz Result ---
function renderQuizResult(container) {
  dailyState = 'result';
  const total = quizQuestions.length;
  const pct = total > 0 ? Math.round((quizScore / total) * 100) : 0;

  let message = '再接再厉，明天会更好🌱';
  if (pct >= 90) message = '太棒了！🎉';
  else if (pct >= 70) message = '不错！继续加油💪';

  const wrongBtnHtml = wrongWords.length > 0
    ? `<button class="btn btn-outline btn-block" id="review-wrong-btn" style="margin-top:12px;">复习错词 (${wrongWords.length})</button>`
    : '';

  container.innerHTML = `
    <div class="quiz-result">
      <div class="quiz-score-circle">
        <span class="quiz-score-number">${quizScore}/${total}</span>
        <span class="quiz-score-label">${pct}%</span>
      </div>
      <div class="quiz-message">${message}</div>
      <div class="quiz-stats-row">
        <div class="quiz-stat">
          <div class="quiz-stat-value">${words.length}</div>
          <div class="quiz-stat-label">今日学习</div>
        </div>
        <div class="quiz-stat">
          <div class="quiz-stat-value">${quizScore}/${total}</div>
          <div class="quiz-stat-label">测验得分</div>
        </div>
        <div class="quiz-stat">
          <div class="quiz-stat-value">${streak}</div>
          <div class="quiz-stat-label">连续打卡</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="tomorrow-btn">明天见 👋</button>
      ${wrongBtnHtml}
    </div>
  `;

  // Bind result events
  container.addEventListener('click', (e) => {
    if (e.target.closest('#tomorrow-btn')) {
      renderHero(container);
      return;
    }
    if (e.target.closest('#review-wrong-btn')) {
      reviewWrongWords(container);
    }
  });
}

function reviewWrongWords(container) {
  if (wrongWords.length === 0) return;
  words = wrongWords;
  currentWordIndex = 0;
  // Preserve already-reviewed flags so progress tracking isn't double-counted
  reviewedWordIds = new Set(words.filter(w => w.reviewed).map(wordKey));
  wrongWords = [];
  renderCards(container);
}
