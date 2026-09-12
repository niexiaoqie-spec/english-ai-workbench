// 每日单词 - 完全离线版
// 今日 30 词由打包词库按天轮播（无需生成、无需网络），
// 学习进度 / 测验成绩 / 连续天数全部保存在本机 IndexedDB。
import { getData, showToast, escapeHtml, loadingInline } from './app.js';
import { DB } from './db.js';
import { makeQuiz, gradeQuiz } from './quiz.js';
import { tts } from './tts.js';

// --- Constants ---
const EPOCH = '2026-09-13';
const DAILY_COUNT = 30;
const QUIZ_COUNT = 10;

const FLAME_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-3.866 0-7-3.134-7-7 0-3 2-5.5 3.5-7.5S12 4 12 1c0 0 1.5 2.5 3.5 4.5S19 10 19 13c0 3.866-3.134 7-7 7zm0-2c2.761 0 5-2.239 5-5 0-2-1.5-4-3-5.5-.5-.5-1-1-1.5-1.5-.5.5-1 1-1.5 1.5C9.5 12 8 14 8 16c0 2.761 2.239 5 5 5z"/></svg>';

// --- Module state ---
let root = null;
let dailyState = 'hero'; // 'hero' | 'cards' | 'quiz' | 'result'
let bank = [];              // full word bank from getData()
let todayWordsList = [];    // today's 30 words (rotation slice)
let words = [];             // display list (category-filtered or wrong-words review)
let currentWordIndex = 0;
let reviewedWordIds = new Set();
let selectedCategory = '';
let streak = 0;

// Quiz state
let quizQuestions = [];
let currentQuizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let userAnswers = [];
let wrongWords = [];

// --- Helpers ---
function safeTodayStr() {
  try {
    return DB.todayStr();
  } catch (e) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayIndex() {
  const epoch = new Date(EPOCH + 'T00:00:00');
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((todayMidnight.getTime() - epoch.getTime()) / 86400000);
  return Math.max(0, isNaN(diff) ? 0 : diff);
}

function getTodayWords() {
  if (!Array.isArray(bank) || bank.length === 0) return [];
  const start = (dayIndex() * DAILY_COUNT) % bank.length;
  const out = [];
  const n = Math.min(DAILY_COUNT, bank.length);
  for (let i = 0; i < n; i++) {
    out.push(bank[(start + i) % bank.length]);
  }
  return out;
}

function getTodayDisplay() {
  const d = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
}

async function getTtsRate() {
  try {
    const r = Number(await DB.kvGet('tts_rate', 1));
    return (r >= 0.5 && r <= 2) ? r : 1;
  } catch (e) {
    return 1;
  }
}

function speakWord(text) {
  if (!text) return;
  if (!tts.available()) {
    showToast('您的浏览器不支持语音合成', 'warning');
    return;
  }
  tts.speak(text, { onFail: () => showToast(tts.hint, 'warning') });
}

function defaultProgress(date) {
  return { date, words_reviewed: 0, quiz_score: 0, quiz_total: 0, completed: 0 };
}

/** Index of the correct option for a quiz question (answer may be index or text). */
function answerIndex(q) {
  if (!q) return -1;
  if (typeof q.answer === 'number') return q.answer;
  const opts = q.options || [];
  return opts.indexOf(q.answer);
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
  userAnswers = [];
  wrongWords = [];

  try {
    const data = getData() || {};
    bank = Array.isArray(data.words) ? data.words : [];
  } catch (e) {
    bank = [];
  }
  todayWordsList = getTodayWords();

  // Fresh wrapper element per render: event listeners die with it (no leaks)
  container.innerHTML = '<div id="daily-page"></div>';
  root = container.querySelector('#daily-page');
  root.innerHTML = loadingInline('加载中...');
  bindRootEvents();
  initPage();
}

async function initPage() {
  try {
    streak = Number(await DB.kvGet('streak', 0)) || 0;
  } catch (e) {
    streak = 0;
  }
  // Restore today's reviewed word ids (survives page switches / reloads)
  const date = safeTodayStr();
  try {
    const ids = await DB.kvGet('reviewed_ids_' + date, []);
    if (Array.isArray(ids)) {
      const todayIds = new Set(todayWordsList.map(w => w.id));
      reviewedWordIds = new Set(ids.filter(id => todayIds.has(id)));
    }
  } catch (e) { /* start fresh */ }

  if (todayWordsList.length === 0) {
    root.innerHTML = `
      <div class="daily-hero">
        <div class="daily-hero-date">${getTodayDisplay()}</div>
        <div class="daily-hero-title">每日单词</div>
        <p style="font-size:14px;color:var(--color-text-secondary);">词库数据未加载，请刷新重试</p>
      </div>
    `;
    return;
  }
  renderHero();
}

// --- State A: Hero ---
function renderHero() {
  dailyState = 'hero';
  const cats = [];
  todayWordsList.forEach(w => {
    if (w.category && cats.indexOf(w.category) === -1) cats.push(w.category);
  });
  const chipsHtml = cats.map(cat =>
    `<button class="category-chip${selectedCategory === cat ? ' active' : ''}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
  ).join('');

  const start = bank.length > 0 ? (dayIndex() * DAILY_COUNT) % bank.length : 0;
  const bankPct = bank.length > 0
    ? Math.min(100, Math.round(((start + todayWordsList.length) / bank.length) * 100))
    : 0;

  root.innerHTML = `
    <div class="daily-hero">
      <div class="daily-hero-date">${getTodayDisplay()}</div>
      <div class="daily-hero-title">每日单词</div>
      <div class="daily-hero-streak">
        ${FLAME_SVG}
        已连续学习 ${streak} 天
      </div>
      <p style="font-size:14px;color:var(--color-text-secondary);margin-bottom:20px;">今日 ${todayWordsList.length} 个商务词汇已备好，全程离线学习</p>
      <div class="category-chips">
        <button class="category-chip${selectedCategory === '' ? ' active' : ''}" data-category="">全部</button>
        ${chipsHtml}
      </div>
      <div style="margin-top:20px;text-align:left;">
        <div class="bank-progress-row">
          <span class="bank-progress-label">词库轮播 · 第 ${dayIndex() + 1} 天</span>
          <span class="bank-progress-label">${start + 1}-${start + todayWordsList.length} / 共 ${bank.length} 词</span>
        </div>
        <div class="bank-progress">
          <div class="bank-progress-fill" style="width:${bankPct}%"></div>
        </div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="start-learning-btn" style="margin-top:24px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 19l.5 1.5L7 21l-1.5.5L5 23l-.5-1.5L3 21l1.5-.5L5 19z"/><path d="M19 13l.5 1.5L21 15l-1.5.5L19 17l-.5-1.5L17 15l1.5-.5L19 13z"/></svg>
        开始今日学习
      </button>
    </div>
  `;
}

function startLearning() {
  if (selectedCategory) {
    words = todayWordsList.filter(w => w.category === selectedCategory);
  }
  if (!words || words.length === 0) {
    words = todayWordsList.slice();
  }
  currentWordIndex = 0;
  renderCards();
}

// --- State B: Word Cards ---
function renderCards() {
  dailyState = 'cards';
  const total = todayWordsList.length;
  const reviewed = reviewedWordIds.size;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const listLen = words.length;

  root.innerHTML = `
    <div class="quiz-progress">
      <div class="quiz-progress-bar">
        <div class="quiz-progress-fill" style="width:${progressPct}%"></div>
      </div>
      <span class="quiz-progress-text">${reviewed}/${total} 已学习</span>
    </div>
    <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;">${getTodayDisplay()}${selectedCategory ? ' · ' + escapeHtml(selectedCategory) : ''}</div>
    <div id="word-card-container"></div>
    <div class="word-nav">
      <button class="btn btn-ghost" id="prev-word-btn" ${currentWordIndex === 0 ? 'disabled' : ''}>上一个</button>
      ${currentWordIndex >= listLen - 1
        ? '<button class="btn btn-primary" id="start-quiz-btn">开始测验</button>'
        : '<button class="btn btn-primary" id="next-word-btn">下一个</button>'}
    </div>
    <div class="word-counter">${currentWordIndex + 1} / ${listLen}</div>
  `;

  renderCurrentWord();
  bindSwipeEvents();
}

function renderCurrentWord() {
  const wordEl = root.querySelector('#word-card-container');
  if (!wordEl || words.length === 0) return;

  const w = words[currentWordIndex];
  const collocations = w.collocations || [];
  const synonyms = w.synonyms || [];

  let tagsHtml = '';
  if (collocations.length > 0) {
    tagsHtml = `
      <div class="word-section">
        <div class="word-section-label">常用搭配</div>
        <div class="word-collocations">
          ${collocations.map(c => `<span class="word-collocation-tag">${escapeHtml(c)}</span>`).join('')}
        </div>
      </div>`;
  } else if (synonyms.length > 0) {
    tagsHtml = `
      <div class="word-section">
        <div class="word-section-label">近义词</div>
        <div class="word-collocations">
          ${synonyms.map(c => `<span class="word-collocation-tag">${escapeHtml(c)}</span>`).join('')}
        </div>
      </div>`;
  }

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
        ${w.definition ? `<div class="word-def-en">${escapeHtml(w.definition)}</div>` : ''}
      </div>
      ${tagsHtml}
      <div class="word-section">
        <div class="word-section-label">例句</div>
        <div class="word-example">
          <div class="word-example-en">${escapeHtml(w.example || '')}</div>
          <div class="word-example-cn">${escapeHtml(w.example_cn || '')}</div>
        </div>
      </div>
      ${mnemonicHtml}
      ${categoryHtml}
      <div style="margin-top:16px;">
        <button class="btn btn-outline btn-sm" id="add-vocab-btn">加入生词本</button>
      </div>
    </div>
  `;

  // Mark as reviewed on first view (fully local)
  markWordReviewed(w);
}

async function markWordReviewed(word) {
  if (!word || reviewedWordIds.has(word.id)) return;
  reviewedWordIds.add(word.id);
  updateWordProgressUI();

  const date = safeTodayStr();
  try {
    const progress = (await DB.get('daily_progress', date)) || defaultProgress(date);
    progress.words_reviewed = (progress.words_reviewed || 0) + 1;
    await DB.put('daily_progress', progress);
  } catch (e) { /* tracking degrades silently */ }

  try {
    const key = 'reviewed_ids_' + date;
    const ids = (await DB.kvGet(key, [])) || [];
    if (Array.isArray(ids) && !ids.includes(word.id)) {
      ids.push(word.id);
      await DB.kvSet(key, ids);
    }
  } catch (e) { /* ignore */ }
}

function updateWordProgressUI() {
  const total = todayWordsList.length;
  const reviewed = reviewedWordIds.size;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const fill = root.querySelector('.quiz-progress-fill');
  const text = root.querySelector('.quiz-progress-text');
  if (fill) fill.style.width = `${progressPct}%`;
  if (text) text.textContent = `${reviewed}/${total} 已学习`;
}

function bindSwipeEvents() {
  const cardContainer = root.querySelector('#word-card-container');
  if (!cardContainer) return;
  let touchStartX = 0;

  cardContainer.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  cardContainer.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 60) {
      navigateWord(diff > 0 ? 1 : -1);
    }
  }, { passive: true });
}

function navigateWord(direction) {
  const newIndex = currentWordIndex + direction;
  if (newIndex < 0 || newIndex >= words.length) return;

  const cardEl = root.querySelector('#word-card');
  if (cardEl) {
    cardEl.classList.add(direction > 0 ? 'card-exit-left' : 'card-exit-right');
    setTimeout(() => {
      currentWordIndex = newIndex;
      renderCards();
    }, 200);
  } else {
    currentWordIndex = newIndex;
    renderCards();
  }
}

// --- 加入生词本 (local vocabulary + auto SRS card) ---
async function addToVocabulary(w, btn) {
  if (!w || !w.word) return;
  try {
    const existing = await DB.getAll('vocabulary');
    const lower = String(w.word).toLowerCase();
    if (existing.some(v => String(v.word || '').toLowerCase() === lower)) {
      showToast(`"${w.word}" 已在生词本中`, 'info');
      return;
    }
    const nowIso = new Date().toISOString();
    await DB.put('vocabulary', {
      id: DB.localId('v'),
      word: w.word,
      phonetic: w.phonetic || '',
      definition_cn: w.definition_cn || '',
      definition: w.definition || '',
      example_sentence: w.example || '',
      difficulty: w.difficulty || 3,
      created_at: nowIso,
    });
    await DB.put('srs_cards', {
      id: DB.localId('card'),
      card_type: 'word',
      front: w.word,
      back: w.definition_cn || w.definition || '',
      extra: w.example || '',
      stability: 0.5,
      difficulty: 5,
      due: nowIso,
      last_review: '',
      reps: 0,
      lapses: 0,
      state: 'new',
    });
    showToast(`"${w.word}" 已加入生词本`, 'success');
    if (btn) {
      btn.textContent = '已添加';
      btn.disabled = true;
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-ghost');
    }
  } catch (e) {
    showToast('加入生词本失败', 'error');
  }
}

// --- State C: Quiz (built locally from today's words) ---
function startQuiz() {
  let questions = [];
  try {
    questions = makeQuiz(todayWordsList, QUIZ_COUNT) || [];
  } catch (e) {
    questions = [];
  }
  if (questions.length === 0) {
    showToast('暂无测验题目', 'warning');
    renderCards();
    return;
  }
  quizQuestions = questions;
  currentQuizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  userAnswers = [];
  wrongWords = [];
  renderQuiz();
}

function renderQuiz() {
  dailyState = 'quiz';
  const total = quizQuestions.length;
  const progressPct = total > 0 ? Math.round((currentQuizIndex / total) * 100) : 0;

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="font-size:18px;font-weight:700;">今日测验</h2>
      <span style="font-size:13px;color:var(--color-text-secondary);" id="quiz-counter">${currentQuizIndex + 1}/${total}</span>
    </div>
    <div class="quiz-progress">
      <div class="quiz-progress-bar">
        <div class="quiz-progress-fill" style="width:${progressPct}%"></div>
      </div>
    </div>
    <div id="quiz-content"></div>
  `;

  renderQuizQuestion();
}

function renderQuizQuestion() {
  const quizContent = root.querySelector('#quiz-content');
  if (!quizContent) return;

  const q = quizQuestions[currentQuizIndex];
  const letters = ['A', 'B', 'C', 'D'];
  const optionsHtml = (q.options || []).map((opt, i) => `
    <button class="quiz-option" data-index="${i}">
      <span class="quiz-option-letter">${letters[i]}</span>
      <span>${escapeHtml(String(opt))}</span>
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

/**
 * Resolve the full word object for a quiz question.
 * quiz.js provides q.word as a string (the word text); older/other
 * shapes may embed the object directly - handle both.
 */
function findWordObject(q) {
  if (!q) return null;
  if (q.word && typeof q.word === 'object') return q.word;
  if (typeof q.word === 'string') {
    return todayWordsList.find(w => w.word === q.word) || null;
  }
  return null;
}

function handleQuizAnswer(optionBtn) {
  quizAnswered = true;
  const q = quizQuestions[currentQuizIndex];
  const selectedIndex = parseInt(optionBtn.dataset.index, 10);
  const correctIndex = answerIndex(q);
  userAnswers[currentQuizIndex] = selectedIndex;

  const allOptions = root.querySelectorAll('.quiz-option');
  allOptions.forEach(opt => opt.classList.add('disabled'));
  allOptions.forEach((opt, i) => {
    if (i === correctIndex) {
      opt.classList.add('correct');
    } else if (i === selectedIndex && i !== correctIndex) {
      opt.classList.add('wrong');
    }
  });

  const isCorrect = selectedIndex === correctIndex;
  const qWord = findWordObject(q);
  if (isCorrect) {
    quizScore++;
  } else if (qWord && !wrongWords.some(w => w.id === qWord.id)) {
    wrongWords.push(qWord);
  }

  const explanation = qWord
    ? `${qWord.word}：${qWord.definition_cn || qWord.definition || ''}`
    : (q.explanation || '');

  const feedback = root.querySelector('#quiz-feedback');
  if (feedback) {
    feedback.classList.remove('hidden');
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

function nextQuestion() {
  currentQuizIndex++;
  if (currentQuizIndex >= quizQuestions.length) {
    finishQuiz();
    return;
  }
  const total = quizQuestions.length;
  const progressPct = Math.round((currentQuizIndex / total) * 100);
  const fill = root.querySelector('.quiz-progress-fill');
  if (fill) fill.style.width = `${progressPct}%`;
  const counter = root.querySelector('#quiz-counter');
  if (counter) counter.textContent = `${currentQuizIndex + 1}/${total}`;
  renderQuizQuestion();
}

async function finishQuiz() {
  dailyState = 'result';

  // Final score: prefer gradeQuiz (canonical), fall back to inline count
  let finalScore = quizScore;
  try {
    const r = gradeQuiz(quizQuestions, userAnswers);
    if (r && Number.isFinite(r.score) && r.total === quizQuestions.length) {
      finalScore = r.score;
    }
  } catch (e) { /* keep inline score */ }

  // Persist completion + streak (all local)
  const date = safeTodayStr();
  try {
    const progress = (await DB.get('daily_progress', date)) || defaultProgress(date);
    progress.completed = 1;
    progress.quiz_score = finalScore;
    progress.quiz_total = quizQuestions.length;
    await DB.put('daily_progress', progress);
  } catch (e) { /* ignore */ }

  try {
    const lastComplete = await DB.kvGet('last_complete_date', '');
    if (lastComplete !== date) {
      const yd = yesterdayStr();
      streak = (lastComplete === yd) ? streak + 1 : 1;
      await DB.kvSet('streak', streak);
      await DB.kvSet('last_complete_date', date);
    }
  } catch (e) { /* ignore */ }

  renderQuizResult(finalScore);
}

// --- Quiz Result ---
function renderQuizResult(score) {
  const total = quizQuestions.length;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  let message = '再接再厉，明天会更好🌱';
  if (pct >= 90) message = '太棒了！🎉';
  else if (pct >= 70) message = '不错！继续加油💪';

  const wrongBtnHtml = wrongWords.length > 0
    ? `<button class="btn btn-outline btn-block" id="review-wrong-btn" style="margin-top:12px;">复习错词 (${wrongWords.length})</button>`
    : '';

  root.innerHTML = `
    <div class="quiz-result">
      <div class="quiz-score-circle">
        <span class="quiz-score-number">${score}/${total}</span>
        <span class="quiz-score-label">${pct}%</span>
      </div>
      <div class="quiz-message">${message}</div>
      <div class="quiz-stats-row">
        <div class="quiz-stat">
          <div class="quiz-stat-value">${todayWordsList.length}</div>
          <div class="quiz-stat-label">今日学习</div>
        </div>
        <div class="quiz-stat">
          <div class="quiz-stat-value">${score}/${total}</div>
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
}

function reviewWrongWords() {
  if (wrongWords.length === 0) return;
  words = wrongWords.slice();
  wrongWords = [];
  currentWordIndex = 0;
  selectedCategory = '';
  renderCards();
}

// --- Event delegation (bound once per page render) ---
function bindRootEvents() {
  root.addEventListener('click', (e) => {
    // Hero: category chips (decorative filters over today's words)
    const chip = e.target.closest('.category-chip');
    if (chip && dailyState === 'hero') {
      root.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedCategory = chip.dataset.category || '';
      return;
    }

    // Hero: start learning
    if (e.target.closest('#start-learning-btn')) {
      startLearning();
      return;
    }

    // Cards: speak
    if (e.target.closest('#speak-btn')) {
      const w = words[currentWordIndex];
      if (w) speakWord(w.word);
      return;
    }

    // Cards: add to vocabulary
    const addBtn = e.target.closest('#add-vocab-btn');
    if (addBtn) {
      const w = words[currentWordIndex];
      if (w) addToVocabulary(w, addBtn);
      return;
    }

    // Cards: navigation
    if (e.target.closest('#next-word-btn')) {
      navigateWord(1);
      return;
    }
    if (e.target.closest('#prev-word-btn')) {
      navigateWord(-1);
      return;
    }
    if (e.target.closest('#start-quiz-btn')) {
      startQuiz();
      return;
    }

    // Quiz: option answer
    const optionBtn = e.target.closest('.quiz-option');
    if (optionBtn && dailyState === 'quiz' && !quizAnswered) {
      handleQuizAnswer(optionBtn);
      return;
    }
    if (e.target.closest('#quiz-next-btn')) {
      nextQuestion();
      return;
    }

    // Result: buttons
    if (e.target.closest('#tomorrow-btn')) {
      renderHero();
      return;
    }
    if (e.target.closest('#review-wrong-btn')) {
      reviewWrongWords();
      return;
    }
  });
}
