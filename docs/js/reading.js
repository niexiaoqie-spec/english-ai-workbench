// 阅读页面 - 完全离线版
// 点读查词使用打包词典 (getData().dict)，理解题在本地生成（完形填空），
// 阅读记录保存在本机 IndexedDB。无任何网络请求。
import { getData, showToast, escapeHtml, formatDate, emptyState, loadingInline } from './app.js';
import { DB } from './db.js';
import { tts } from './tts.js';

let root = null;
let dict = {};
let session = null;
// session = { text, title, wordCount, tapped:Set, addedCount, historyId, createdAt, score, total }

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

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split text into sentences, keeping terminal punctuation. */
function splitSentences(text) {
  const parts = String(text).split(/([.!?]+\s+)/);
  const sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = ((parts[i] || '') + (parts[i + 1] || '')).trim();
    if (s) sentences.push(s);
  }
  return sentences;
}

/**
 * Build up to `count` cloze questions locally:
 * pick 40-160 char sentences containing a dict token of length >= 5,
 * blank that token, options = [token, 3 random dict keys].
 */
function buildClozeQuestions(text, count = 5) {
  const sentences = splitSentences(text);
  const tokenRe = /[A-Za-z][A-Za-z'\-]*/g;
  const candidates = [];
  sentences.forEach((s) => {
    if (s.length < 40 || s.length > 160) return;
    const tokens = s.match(tokenRe) || [];
    const dictTokens = tokens.filter(t => t.length >= 5 && dict[t.toLowerCase()]);
    if (dictTokens.length === 0) return;
    const token = dictTokens[Math.floor(Math.random() * dictTokens.length)];
    candidates.push({ sentence: s, token });
  });

  const dictKeys = Object.keys(dict);
  const questions = [];
  const used = new Set();
  shuffle(candidates).forEach((c) => {
    if (questions.length >= count) return;
    if (used.has(c.sentence)) return;
    used.add(c.sentence);
    const answerWord = c.token.toLowerCase();
    const distractors = new Set();
    let guard = 0;
    while (distractors.size < Math.min(3, Math.max(0, dictKeys.length - 1)) && guard < 200) {
      guard++;
      const k = dictKeys[Math.floor(Math.random() * dictKeys.length)];
      if (k !== answerWord) distractors.add(k);
    }
    const options = shuffle([c.token, ...distractors]);
    const answer = options.indexOf(c.token);
    const blanked = c.sentence.replace(new RegExp(escapeRegExp(c.token)), '______');
    questions.push({
      type: 'cloze',
      question: blanked,
      options,
      answer,
      sentence: c.sentence,
      token: c.token,
    });
  });
  return questions;
}

/** Tokenize text and wrap dict words in .tap-word spans (HTML-safe). */
function buildReadingHTML(text) {
  const parts = String(text).split(/([A-Za-z][A-Za-z'\-]*)/g);
  return parts.map((p) => {
    if (!p) return '';
    if (/^[A-Za-z]/.test(p)) {
      const lower = p.toLowerCase();
      if (dict[lower]) {
        return `<span class="tap-word" data-w="${escapeHtml(lower)}">${escapeHtml(p)}</span>`;
      }
    }
    return escapeHtml(p);
  }).join('');
}

// --- Main Render ---
export function renderReadPage(container) {
  session = null;
  try {
    const data = getData() || {};
    dict = data.dict || {};
  } catch (e) {
    dict = {};
  }

  container.innerHTML = '<div id="read-page"></div>';
  root = container.querySelector('#read-page');
  root.innerHTML = getPageHTML();
  bindEvents();
}

function getPageHTML() {
  return `
    <div class="segment-control">
      <button class="segment-btn active" data-view="input">阅读</button>
      <button class="segment-btn" data-view="history">历史</button>
    </div>
    <div id="read-input-view">
      ${getInputViewHTML()}
    </div>
    <div id="read-reading-view" class="hidden"></div>
    <div id="read-history-view" class="hidden"></div>
  `;
}

function getInputViewHTML() {
  return `
    <div class="card card-static">
      <div class="input-group">
        <label class="input-label">标题（可选）</label>
        <input type="text" class="input" id="read-title" placeholder="给文章起个名字...">
      </div>
      <div class="input-group">
        <label class="input-label">英文文本</label>
        <textarea class="textarea" id="read-text" style="min-height:200px" placeholder="在此粘贴英文文章、新闻、故事等...&#10;&#10;点击文中高亮单词即可离线查词"></textarea>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="start-read-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        开始阅读
      </button>
    </div>
  `;
}

function bindEvents() {
  root.addEventListener('click', async (e) => {
    // Segment control (阅读 / 历史)
    const segBtn = e.target.closest('.segment-btn[data-view]');
    if (segBtn) {
      const view = segBtn.dataset.view;
      root.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      segBtn.classList.add('active');
      switchView(view);
      return;
    }

    // Start reading
    if (e.target.closest('#start-read-btn')) {
      await startReading();
      return;
    }

    // Back to input
    if (e.target.closest('#read-back-btn')) {
      switchView('input');
      root.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      const inputTab = root.querySelector('.segment-btn[data-view="input"]');
      if (inputTab) inputTab.classList.add('active');
      return;
    }

    // Tap word -> popover
    const tapWord = e.target.closest('.tap-word');
    if (tapWord) {
      await handleTapWord(tapWord.dataset.w);
      return;
    }

    // Generate comprehension quiz
    if (e.target.closest('#gen-quiz-btn')) {
      handleGenerateQuiz();
      return;
    }

    // Quiz option selection
    const quizOption = e.target.closest('.quiz-option');
    if (quizOption && !quizOption.classList.contains('disabled')) {
      const qIdx = quizOption.dataset.question;
      const oIdx = quizOption.dataset.option;
      if (!session) return;
      session.answers = session.answers || {};
      session.answers[qIdx] = parseInt(oIdx, 10);
      const questionEl = quizOption.closest('.quiz-question');
      if (questionEl) {
        questionEl.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('selected'));
      }
      quizOption.classList.add('selected');
      return;
    }

    // Submit quiz
    if (e.target.closest('#submit-read-quiz-btn')) {
      await handleSubmitQuiz();
      return;
    }
  });
}

function switchView(view) {
  const inputView = root.querySelector('#read-input-view');
  const readingView = root.querySelector('#read-reading-view');
  const historyView = root.querySelector('#read-history-view');
  if (inputView) inputView.classList.toggle('hidden', view !== 'input');
  if (readingView) readingView.classList.toggle('hidden', view !== 'reading');
  if (historyView) historyView.classList.toggle('hidden', view !== 'history');

  if (view === 'history') {
    loadHistory();
  }
}

// --- Reading session ---
async function startReading() {
  const textEl = root.querySelector('#read-text');
  const titleEl = root.querySelector('#read-title');
  const text = textEl.value.trim();
  if (!text) {
    showToast('请输入英文文本', 'warning');
    return;
  }
  const title = titleEl.value.trim() || '未命名文章';
  const wordCount = (text.match(/[A-Za-z][A-Za-z'\-]*/g) || []).length;

  session = {
    text,
    title,
    wordCount,
    tapped: new Set(),
    addedCount: 0,
    historyId: Date.now(),
    createdAt: new Date().toISOString(),
    score: null,
    total: 0,
    questions: [],
    answers: {},
  };

  showReadingView();
  saveHistoryRecord();
}

function showReadingView() {
  const view = root.querySelector('#read-reading-view');
  const bodyHtml = buildReadingHTML(session.text);

  view.innerHTML = `
    <div class="flex-between mb-16">
      <button class="btn btn-ghost btn-sm" id="read-back-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回
      </button>
      <span style="font-size:14px;font-weight:600">${escapeHtml(session.title)}</span>
      <span style="width:56px"></span>
    </div>
    <div class="stats-grid mb-16">
      <div class="stat-card">
        <div class="stat-value" id="stat-words">${session.wordCount}</div>
        <div class="stat-label">词数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value secondary" id="stat-lookups">0</div>
        <div class="stat-label">查词数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value warning" id="stat-added">0</div>
        <div class="stat-label">加入生词本</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="stat-score">-</div>
        <div class="stat-label">理解题得分</div>
      </div>
    </div>
    <div class="card card-static mb-16">
      <div class="card-title">文章内容</div>
      <div class="reading-content" id="reading-text" style="line-height:1.9;white-space:pre-wrap;">${bodyHtml}</div>
      <div style="font-size:12px;color:var(--color-text-muted);margin-top:10px;">点击文中高亮单词可离线查词、发音并加入生词本</div>
    </div>
    <button class="btn btn-primary btn-block btn-lg" id="gen-quiz-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
      生成理解题
    </button>
    <div id="read-quiz-section" class="hidden mt-24"></div>
  `;

  root.querySelector('#read-input-view').classList.add('hidden');
  root.querySelector('#read-history-view').classList.add('hidden');
  view.classList.remove('hidden');
}

function updateStatsUI() {
  if (!session || !root) return;
  const lookups = root.querySelector('#stat-lookups');
  const added = root.querySelector('#stat-added');
  const score = root.querySelector('#stat-score');
  if (lookups) lookups.textContent = session.tapped.size;
  if (added) added.textContent = session.addedCount;
  if (score) score.textContent = session.score !== null ? `${session.score}/${session.total}` : '-';
}

async function handleTapWord(wordLower) {
  if (!session || !wordLower) return;
  const isNew = !session.tapped.has(wordLower);
  session.tapped.add(wordLower);
  if (isNew) {
    updateStatsUI();
    saveHistoryRecord();
  }
  showWordPopover(wordLower);
}

// --- Word popover ---
function closeWordPopover() {
  const overlay = document.getElementById('word-popover-overlay');
  if (overlay) overlay.remove();
}

function showWordPopover(wordLower) {
  closeWordPopover();
  const entry = dict[wordLower] || ['', ''];
  const phonetic = entry[0] ? `/${entry[0]}/` : '';
  const cn = entry[1] || '';

  const overlay = document.createElement('div');
  overlay.className = 'popover-overlay';
  overlay.id = 'word-popover-overlay';
  overlay.innerHTML = `
    <div class="word-popover">
      <div class="word-popover-head">
        <div>
          <div class="word-popover-word">${escapeHtml(wordLower)}</div>
          ${phonetic ? `<div class="word-popover-phonetic">${escapeHtml(phonetic)}</div>` : ''}
        </div>
        <button class="word-popover-close" id="popover-close-x" aria-label="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="word-popover-def">${cn ? escapeHtml(cn) : '<span class="word-popover-empty">暂无中文释义</span>'}</div>
      <div class="word-popover-actions">
        <button class="btn btn-secondary" id="popover-speak-btn">🔊 发音</button>
        <button class="btn btn-primary" id="popover-add-btn">加入生词本</button>
        <button class="btn btn-ghost" id="popover-close-btn">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // CSS base rule keeps .popover-overlay at opacity 0; fade it in explicitly
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });

  overlay.addEventListener('click', async (ev) => {
    if (ev.target === overlay) {
      closeWordPopover();
      return;
    }
    if (ev.target.closest('#popover-speak-btn')) {
      speakText(wordLower);
      return;
    }
    const addBtn = ev.target.closest('#popover-add-btn');
    if (addBtn) {
      const ok = await addDictWordToVocab(wordLower, addBtn);
      if (ok && session) {
        session.addedCount++;
        updateStatsUI();
      }
      return;
    }
    if (ev.target.closest('#popover-close-btn') || ev.target.closest('#popover-close-x')) {
      closeWordPopover();
    }
  });
}

async function addDictWordToVocab(wordLower, btn) {
  const entry = dict[wordLower] || ['', ''];
  try {
    const existing = await DB.getAll('vocabulary');
    if (existing.some(v => String(v.word || '').toLowerCase() === wordLower)) {
      showToast(`"${wordLower}" 已在生词本中`, 'info');
      return false;
    }
    const nowIso = new Date().toISOString();
    await DB.put('vocabulary', {
      id: DB.localId('v'),
      word: wordLower,
      phonetic: entry[0] || '',
      definition_cn: entry[1] || '',
      definition: '',
      example_sentence: '',
      difficulty: 3,
      created_at: nowIso,
    });
    await DB.put('srs_cards', {
      id: DB.localId('card'),
      card_type: 'word',
      front: wordLower,
      back: entry[1] || '',
      extra: '',
      stability: 0.5,
      difficulty: 5,
      due: nowIso,
      last_review: '',
      reps: 0,
      lapses: 0,
      state: 'new',
    });
    showToast(`"${wordLower}" 已加入生词本`, 'success');
    if (btn) {
      btn.textContent = '已添加';
      btn.disabled = true;
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-ghost');
    }
    return true;
  } catch (e) {
    showToast('加入生词本失败', 'error');
    return false;
  }
}

// --- Local comprehension quiz ---
function handleGenerateQuiz() {
  if (!session) return;
  const questions = buildClozeQuestions(session.text, 5);
  if (questions.length === 0) {
    showToast('文本太短或词典命中不足，无法生成理解题', 'warning');
    return;
  }
  session.questions = questions;
  session.answers = {};

  const section = root.querySelector('#read-quiz-section');
  const letters = ['A', 'B', 'C', 'D'];
  section.innerHTML = `
    <div class="section">
      <div class="section-title">理解测验 (${questions.length})</div>
      ${questions.map((q, i) => `
        <div class="quiz-question" data-qidx="${i}">
          <div class="quiz-question-text">${i + 1}. ${escapeHtml(q.question)}</div>
          <div class="quiz-options">
            ${q.options.map((opt, j) => `
              <button class="quiz-option" data-question="${i}" data-option="${j}">
                <span class="quiz-option-letter">${letters[j]}</span>
                <span>${escapeHtml(String(opt))}</span>
              </button>
            `).join('')}
          </div>
          <div class="quiz-sentence hidden" data-sentence="${i}" style="font-size:13px;color:var(--color-text-secondary);margin-top:8px;line-height:1.6;"></div>
        </div>
      `).join('')}
      <button class="btn btn-primary btn-block mt-16" id="submit-read-quiz-btn">提交答案</button>
      <div id="read-quiz-result" class="hidden mt-16"></div>
    </div>
  `;
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const genBtn = root.querySelector('#gen-quiz-btn');
  if (genBtn) {
    genBtn.textContent = '重新生成理解题';
  }
}

async function handleSubmitQuiz() {
  if (!session || session.questions.length === 0) return;
  const questions = session.questions;
  const answers = session.answers || {};

  const unanswered = questions.filter((_, idx) => answers[idx] === undefined);
  if (unanswered.length > 0) {
    showToast(`还有 ${unanswered.length} 题未作答`, 'warning');
    return;
  }

  const btn = root.querySelector('#submit-read-quiz-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '已提交';
  }

  // Grade inline (questions carry .answer as the correct option index)
  let correct = 0;
  questions.forEach((q, qIdx) => {
    const correctIdx = q.answer;
    const selectedIdx = answers[qIdx];
    if (selectedIdx === correctIdx) correct++;

    const questionEl = root.querySelector(`.quiz-question[data-qidx="${qIdx}"]`);
    if (!questionEl) return;
    questionEl.querySelectorAll('.quiz-option').forEach((opt, oIdx) => {
      opt.classList.remove('selected');
      opt.classList.add('disabled');
      if (oIdx === correctIdx) {
        opt.classList.add('correct');
      } else if (oIdx === selectedIdx && oIdx !== correctIdx) {
        opt.classList.add('incorrect');
      }
    });
    const sentenceEl = questionEl.querySelector(`.quiz-sentence[data-sentence="${qIdx}"]`);
    if (sentenceEl) {
      sentenceEl.classList.remove('hidden');
      sentenceEl.innerHTML = `原句：${escapeHtml(q.sentence)}<br>空格处：<strong style="color:var(--color-primary)">${escapeHtml(q.token)}</strong>`;
    }
  });

  session.score = correct;
  session.total = questions.length;

  const total = questions.length;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  let emoji = '🎉';
  if (percent < 60) emoji = '💪';
  else if (percent < 80) emoji = '👍';

  const resultEl = root.querySelector('#read-quiz-result');
  if (resultEl) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `
      <div class="card card-static text-center">
        <div style="font-size:36px;margin-bottom:8px">${emoji}</div>
        <div style="font-size:24px;font-weight:800;color:var(--color-primary)">${correct} / ${total}</div>
        <div style="font-size:14px;color:var(--color-text-secondary);margin-top:4px">正确率 ${percent}%</div>
      </div>
    `;
  }

  updateStatsUI();
  await saveHistoryRecord();
  showToast(`理解题得分 ${correct}/${total}`, 'success');
}

// --- History record (local) ---
async function saveHistoryRecord() {
  if (!session) return;
  try {
    await DB.put('reading_history', {
      id: session.historyId,
      title: session.title,
      word_count: session.wordCount,
      looked_up: session.tapped.size,
      score: session.score,
      quiz_total: session.total,
      created_at: session.createdAt,
    });
  } catch (e) { /* history is best-effort */ }
}

// --- History tab ---
async function loadHistory() {
  const historyView = root.querySelector('#read-history-view');
  if (!historyView) return;
  historyView.innerHTML = loadingInline('加载历史记录...');

  let items = [];
  try {
    items = await DB.getAll('reading_history');
  } catch (e) {
    items = [];
  }
  items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderHistoryList(historyView, items);
}

function renderHistoryList(historyView, items) {
  if (!items || items.length === 0) {
    historyView.innerHTML = emptyState(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      '暂无阅读记录',
      '在"阅读"标签页粘贴英文文本开始点读吧'
    );
    return;
  }

  let html = '';
  items.forEach(item => {
    const title = item.title || '未命名文章';
    const date = formatDate(item.created_at || item.date);
    const wordCount = item.word_count || 0;
    const lookedUp = item.looked_up || 0;
    const scoreText = (item.score !== undefined && item.score !== null && item.quiz_total)
      ? ` · 理解题 ${item.score}/${item.quiz_total}`
      : '';
    html += `
      <div class="list-item">
        <div class="list-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </div>
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(title)}</div>
          <div class="list-item-subtitle">${wordCount} 词 · 查词 ${lookedUp} 次${scoreText}</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-date">${date}</div>
        </div>
      </div>
    `;
  });
  historyView.innerHTML = html;
}
