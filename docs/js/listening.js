// 听力页面 - 完全离线版
// 使用浏览器 speechSynthesis 朗读文本（无网络音频），理解题在本地生成（完形填空），
// 练习记录保存在本机 IndexedDB。无任何网络请求。
import { getData, showToast, escapeHtml, formatDate, emptyState, loadingInline } from './app.js';
import { DB } from './db.js';

let root = null;
let dict = {};
let currentSpeed = 1.0;
let practiceData = null; // { id, title, text, questions, createdAt }
let selectedAnswers = {};

// --- Helpers ---
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

/** Build up to `count` local cloze questions (same algorithm as reading). */
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

function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// --- Main Render ---
export function renderListenPage(container) {
  practiceData = null;
  selectedAnswers = {};
  currentSpeed = 1.0;
  try {
    const data = getData() || {};
    dict = data.dict || {};
  } catch (e) {
    dict = {};
  }

  container.innerHTML = '<div id="listen-page"></div>';
  root = container.querySelector('#listen-page');
  root.innerHTML = getMainHTML();
  bindEvents();
  initSpeedFromSettings();
}

async function initSpeedFromSettings() {
  try {
    const rate = Number(await DB.kvGet('tts_rate', 1)) || 1;
    currentSpeed = rate;
    if (!root) return;
    root.querySelectorAll('.speed-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === rate);
    });
  } catch (e) {
    currentSpeed = 1.0;
  }
}

function getMainHTML() {
  return `
    <div class="segment-control">
      <button class="segment-btn active" data-view="input">练习</button>
      <button class="segment-btn" data-view="history">历史</button>
    </div>
    <div id="listen-input-view">
      ${getInputViewHTML()}
    </div>
    <div id="listen-practice-view" class="hidden"></div>
    <div id="listen-history-view" class="hidden"></div>
  `;
}

function getInputViewHTML() {
  return `
    <div class="card card-static">
      <div class="input-group">
        <label class="input-label">标题（可选）</label>
        <input type="text" class="input" id="listen-title" placeholder="给听力材料起个名字...">
      </div>
      <div class="input-group">
        <label class="input-label">英文文本 / 听力材料</label>
        <textarea class="textarea" id="listen-text" style="min-height:180px" placeholder="在此粘贴英文文本，使用本机语音朗读进行听力练习...&#10;&#10;支持新闻、对话、故事等各类英文材料（完全离线）"></textarea>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="start-listen-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
        开始听力
      </button>
    </div>
  `;
}

function bindEvents() {
  root.addEventListener('click', async (e) => {
    // Segment control
    const segBtn = e.target.closest('.segment-btn[data-view]');
    if (segBtn) {
      const view = segBtn.dataset.view;
      root.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      segBtn.classList.add('active');
      switchView(view);
      return;
    }

    // Start practice
    if (e.target.closest('#start-listen-btn')) {
      await handleStart();
      return;
    }

    // Play button
    if (e.target.closest('#play-btn')) {
      handlePlay();
      return;
    }

    // Pause button
    if (e.target.closest('#pause-btn')) {
      handlePause();
      return;
    }

    // Stop button
    if (e.target.closest('#stop-btn')) {
      handleStop();
      return;
    }

    // Speed buttons
    const speedBtn = e.target.closest('.speed-btn');
    if (speedBtn) {
      currentSpeed = parseFloat(speedBtn.dataset.speed) || 1.0;
      root.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      speedBtn.classList.add('active');
      // If currently speaking, restart with the new rate
      if (speechAvailable() && window.speechSynthesis.speaking) {
        handlePlay();
      }
      return;
    }

    // Transcript toggle
    if (e.target.closest('#transcript-toggle')) {
      const body = root.querySelector('#transcript-body');
      const arrow = root.querySelector('#transcript-toggle .collapsible-arrow');
      if (body) body.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
      return;
    }

    // Quiz option selection
    const quizOption = e.target.closest('.quiz-option');
    if (quizOption && !quizOption.classList.contains('disabled')) {
      const qIdx = quizOption.dataset.question;
      const oIdx = quizOption.dataset.option;
      selectedAnswers[qIdx] = parseInt(oIdx, 10);
      const questionEl = quizOption.closest('.quiz-question');
      if (questionEl) {
        questionEl.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('selected'));
      }
      quizOption.classList.add('selected');
      return;
    }

    // Submit quiz
    if (e.target.closest('#submit-quiz-btn')) {
      await handleSubmitQuiz();
      return;
    }

    // Back to input
    if (e.target.closest('#listen-back-btn')) {
      handleStop();
      switchView('input');
      root.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      const inputTab = root.querySelector('.segment-btn[data-view="input"]');
      if (inputTab) inputTab.classList.add('active');
      return;
    }
  });
}

function switchView(view) {
  const inputView = root.querySelector('#listen-input-view');
  const practiceView = root.querySelector('#listen-practice-view');
  const historyView = root.querySelector('#listen-history-view');
  if (inputView) inputView.classList.toggle('hidden', view !== 'input');
  if (practiceView) practiceView.classList.toggle('hidden', view !== 'practice');
  if (historyView) historyView.classList.toggle('hidden', view !== 'history');

  if (view === 'history') {
    loadHistory();
  }
}

// --- Start practice ---
async function handleStart() {
  const textEl = root.querySelector('#listen-text');
  const titleEl = root.querySelector('#listen-title');
  const text = textEl.value.trim();
  if (!text) {
    showToast('请输入英文文本', 'warning');
    return;
  }
  const title = titleEl.value.trim() || '未命名练习';

  const questions = buildClozeQuestions(text, 5);
  practiceData = {
    id: Date.now(),
    title,
    text,
    questions,
    createdAt: new Date().toISOString(),
    wordCount: (text.match(/[A-Za-z][A-Za-z'\-]*/g) || []).length,
  };
  selectedAnswers = {};
  showPracticeView();
}

function showPracticeView() {
  root.querySelector('#listen-input-view').classList.add('hidden');
  root.querySelector('#listen-history-view').classList.add('hidden');
  const practiceView = root.querySelector('#listen-practice-view');
  practiceView.classList.remove('hidden');

  const questions = practiceData.questions || [];

  let html = `
    <button class="btn btn-ghost btn-sm mb-16" id="listen-back-btn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      返回
    </button>

    <div class="audio-player">
      <button class="audio-play-btn" id="play-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon" id="pause-btn" style="display:none">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon" id="stop-btn" title="停止">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
      </button>
      <div class="audio-controls" style="margin-left:auto">
        <button class="speed-btn${currentSpeed === 0.7 ? ' active' : ''}" data-speed="0.7">0.7x</button>
        <button class="speed-btn${currentSpeed === 0.85 ? ' active' : ''}" data-speed="0.85">0.85x</button>
        <button class="speed-btn${currentSpeed === 1 ? ' active' : ''}" data-speed="1">1.0x</button>
        <button class="speed-btn${currentSpeed === 1.2 ? ' active' : ''}" data-speed="1.2">1.2x</button>
      </div>
    </div>
    <div style="font-size:12px;color:var(--color-text-muted);margin:8px 0 16px;text-align:center;">使用本机语音朗读（离线 TTS），建议先盲听再查看原文</div>

    <div class="card card-static mb-16" style="padding-top:8px;">
      <div class="collapsible-header" id="transcript-toggle">
        <span class="collapsible-title">听力材料（点击展开原文）</span>
        <svg class="collapsible-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="collapsible-body" id="transcript-body">
        <div class="collapsible-content">
          <div class="reading-content" id="listen-text-display" style="line-height:1.9;white-space:pre-wrap;">${escapeHtml(practiceData.text)}</div>
        </div>
      </div>
    </div>
  `;

  if (questions.length > 0) {
    const letters = ['A', 'B', 'C', 'D'];
    html += `
      <div class="section">
        <div class="section-title">理解测验 (${questions.length})</div>
        <div id="quiz-container">
    `;
    questions.forEach((q, qIdx) => {
      html += `
        <div class="quiz-question" data-qidx="${qIdx}">
          <div class="quiz-question-text">${qIdx + 1}. ${escapeHtml(q.question)}</div>
          <div class="quiz-options">
      `;
      q.options.forEach((opt, oIdx) => {
        html += `
          <button class="quiz-option" data-question="${qIdx}" data-option="${oIdx}">
            <span class="quiz-option-letter">${letters[oIdx]}</span>
            <span>${escapeHtml(String(opt))}</span>
          </button>
        `;
      });
      html += `</div>
          <div class="quiz-sentence hidden" data-sentence="${qIdx}" style="font-size:13px;color:var(--color-text-secondary);margin-top:8px;line-height:1.6;"></div>
        </div>`;
    });
    html += `
        </div>
        <button class="btn btn-primary btn-block mt-16" id="submit-quiz-btn">提交答案</button>
        <div id="quiz-result" class="hidden mt-16"></div>
      </div>
    `;
  } else {
    html += `<div style="font-size:13px;color:var(--color-text-muted);text-align:center;">文本较短，本次未生成理解题，可专注听写练习</div>`;
  }

  practiceView.innerHTML = html;

  if (!speechAvailable()) {
    showToast('您的浏览器不支持语音合成，无法朗读，但理解测验仍可使用', 'warning');
    const playBtn = practiceView.querySelector('#play-btn');
    if (playBtn) playBtn.disabled = true;
  }
}

// --- Playback (speechSynthesis) ---
function handlePlay() {
  if (!practiceData || !practiceData.text) {
    showToast('没有可播放的文本', 'warning');
    return;
  }
  if (!speechAvailable()) {
    showToast('您的浏览器不支持语音合成', 'error');
    return;
  }

  // Resume if paused
  if (window.speechSynthesis.paused) {
    try {
      window.speechSynthesis.resume();
      updatePlayButtons(true);
      return;
    } catch (e) { /* fall through to restart */ }
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(practiceData.text);
    utterance.lang = 'en-US';
    utterance.rate = currentSpeed;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang && v.lang.startsWith('en'));
    if (enVoice) utterance.voice = enVoice;

    utterance.onstart = () => updatePlayButtons(true);
    utterance.onend = () => updatePlayButtons(false);
    utterance.onerror = () => updatePlayButtons(false);

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    showToast('播放失败', 'error');
    updatePlayButtons(false);
  }
}

function handlePause() {
  if (!speechAvailable()) return;
  try {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      updatePlayButtons(false);
    }
  } catch (e) { /* ignore */ }
}

function handleStop() {
  if (!speechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (e) { /* ignore */ }
  updatePlayButtons(false);
}

function updatePlayButtons(playing) {
  if (!root) return;
  const playBtn = root.querySelector('#play-btn');
  const pauseBtn = root.querySelector('#pause-btn');
  if (playBtn) playBtn.style.display = playing ? 'none' : 'flex';
  if (pauseBtn) pauseBtn.style.display = playing ? 'flex' : 'none';
}

// --- Quiz grading (inline, local) ---
async function handleSubmitQuiz() {
  const questions = (practiceData && practiceData.questions) || [];
  if (questions.length === 0) return;

  const unanswered = questions.filter((_, idx) => selectedAnswers[idx] === undefined);
  if (unanswered.length > 0) {
    showToast(`还有 ${unanswered.length} 题未作答`, 'warning');
    return;
  }

  const btn = root.querySelector('#submit-quiz-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '已提交';
  }

  let correct = 0;
  questions.forEach((q, qIdx) => {
    const correctIdx = q.answer;
    const selectedIdx = selectedAnswers[qIdx];
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
    // Show the correct sentence
    const sentenceEl = questionEl.querySelector(`.quiz-sentence[data-sentence="${qIdx}"]`);
    if (sentenceEl) {
      sentenceEl.classList.remove('hidden');
      sentenceEl.innerHTML = `原句：${escapeHtml(q.sentence)}<br>空格处：<strong style="color:var(--color-primary)">${escapeHtml(q.token)}</strong>`;
    }
  });

  const total = questions.length;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  let emoji = '🎉';
  if (percent < 60) emoji = '💪';
  else if (percent < 80) emoji = '👍';

  const resultEl = root.querySelector('#quiz-result');
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

  // Save practice record locally
  try {
    await DB.put('listening_history', {
      id: practiceData.id,
      title: practiceData.title,
      word_count: practiceData.wordCount,
      score: correct,
      total,
      created_at: practiceData.createdAt,
    });
  } catch (e) { /* history is best-effort */ }

  showToast(`理解题得分 ${correct}/${total}`, 'success');
}

// --- History tab ---
async function loadHistory() {
  const historyView = root.querySelector('#listen-history-view');
  if (!historyView) return;
  historyView.innerHTML = loadingInline('加载历史记录...');

  let items = [];
  try {
    items = await DB.getAll('listening_history');
  } catch (e) {
    items = [];
  }
  items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderHistoryList(historyView, items);
}

function renderHistoryList(historyView, items) {
  if (!items || items.length === 0) {
    historyView.innerHTML = emptyState(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
      '暂无听力练习记录',
      '在"练习"标签页粘贴英文文本开始听力训练吧'
    );
    return;
  }

  let html = '';
  items.forEach(item => {
    const title = item.title || '未命名练习';
    const date = formatDate(item.created_at || item.date);
    const score = (item.score !== undefined && item.score !== null)
      ? `得分: ${item.score}${item.total ? '/' + item.total : ''}`
      : '';
    html += `
      <div class="list-item">
        <div class="list-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/></svg>
        </div>
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(title)}</div>
          <div class="list-item-subtitle">${score}</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-date">${date}</div>
        </div>
      </div>
    `;
  });
  historyView.innerHTML = html;
}
