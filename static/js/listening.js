// Listening Page Module
import { API, showToast, showLoading, hideLoading, escapeHtml, emptyState, loadingInline, offlineGuard } from './app.js';
import { DB } from './db.js';
import { Sync } from './sync.js';

let currentSpeed = 1.0;
let isSpeaking = false;
let practiceData = null;
let selectedAnswers = {};

export function renderListenPage(container) {
  currentSpeed = 1.0;
  isSpeaking = false;
  practiceData = null;
  selectedAnswers = {};
  container.innerHTML = getMainHTML();
  bindEvents(container);
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
        <textarea class="textarea" id="listen-text" style="min-height:180px" placeholder="在此粘贴英文文本，系统将生成听力练习...&#10;&#10;支持新闻、对话、故事等各类英文材料"></textarea>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="generate-listen-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
        生成听力练习
      </button>
    </div>
  `;
}

function bindEvents(container) {
  container.addEventListener('click', async (e) => {
    // Segment control
    const segBtn = e.target.closest('.segment-btn[data-view]');
    if (segBtn) {
      const view = segBtn.dataset.view;
      container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      segBtn.classList.add('active');
      switchView(view, container);
      return;
    }

    // Generate button
    if (e.target.closest('#generate-listen-btn')) {
      await handleGenerate(container);
      return;
    }

    // Play button
    if (e.target.closest('#play-btn')) {
      handlePlay(container);
      return;
    }

    // Pause button
    if (e.target.closest('#pause-btn')) {
      handlePause();
      return;
    }

    // Replay button
    if (e.target.closest('#replay-btn')) {
      handleReplay(container);
      return;
    }

    // Speed buttons
    const speedBtn = e.target.closest('.speed-btn');
    if (speedBtn) {
      currentSpeed = parseFloat(speedBtn.dataset.speed);
      container.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      speedBtn.classList.add('active');
      return;
    }

    // Quiz option selection
    const quizOption = e.target.closest('.quiz-option');
    if (quizOption && !container.querySelector('#submit-quiz-btn')?.disabled) {
      const questionIdx = quizOption.dataset.question;
      const optionIdx = quizOption.dataset.option;
      selectedAnswers[questionIdx] = optionIdx;
      // Update UI
      const questionEl = quizOption.closest('.quiz-question');
      questionEl.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('selected'));
      quizOption.classList.add('selected');
      return;
    }

    // Submit quiz
    if (e.target.closest('#submit-quiz-btn')) {
      await handleSubmitQuiz(container);
      return;
    }

    // Back to input
    if (e.target.closest('#listen-back-btn')) {
      switchView('input', container);
      container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      container.querySelector('.segment-btn[data-view="input"]').classList.add('active');
      return;
    }

    // History item
    const historyItem = e.target.closest('.listen-history-item');
    if (historyItem) {
      await loadPracticeDetail(historyItem.dataset.id, container);
      return;
    }
  });
}

function switchView(view, container) {
  container.querySelector('#listen-input-view').classList.toggle('hidden', view !== 'input');
  container.querySelector('#listen-practice-view').classList.toggle('hidden', view !== 'practice');
  container.querySelector('#listen-history-view').classList.toggle('hidden', view !== 'history');

  if (view === 'history') {
    loadHistory(container);
  }
}

async function handleGenerate(container) {
  if (!offlineGuard('生成听力练习需要联网使用')) return;
  const text = container.querySelector('#listen-text').value.trim();
  if (!text) {
    showToast('请输入英文文本', 'warning');
    return;
  }

  const title = container.querySelector('#listen-title').value.trim();

  showLoading();
  try {
    const result = await API.post('/api/listening/generate', { text, title });
    hideLoading();
    // Cache generated practice locally for offline history browsing
    try {
      await DB.put('listening_history', {
        id: result.id || Date.now(),
        title,
        content: text,
        created_at: new Date().toISOString(),
      });
    } catch (e) { /* local cache failure is non-fatal */ }
    practiceData = result;
    selectedAnswers = {};
    showPracticeView(result, container);
  } catch (err) {
    hideLoading();
    showToast(err.message || '生成失败，请重试', 'error');
  }
}

function showPracticeView(data, container) {
  container.querySelector('#listen-input-view').classList.add('hidden');
  container.querySelector('#listen-history-view').classList.add('hidden');
  const practiceView = container.querySelector('#listen-practice-view');
  practiceView.classList.remove('hidden');

  const text = data.text || data.original_text || '';
  const keyPhrases = data.key_phrases || [];
  const questions = data.questions || data.quiz || [];

  // Highlight key phrases in text
  let displayText = escapeHtml(text);
  keyPhrases.forEach(phrase => {
    const escaped = escapeHtml(phrase.phrase || phrase);
    const regex = new RegExp(`(${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    displayText = displayText.replace(regex, '<span class="highlight-word">$1</span>');
  });

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
      <button class="btn btn-ghost btn-icon" id="replay-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
      <div class="audio-controls" style="margin-left:auto">
        <button class="speed-btn" data-speed="0.7">0.7x</button>
        <button class="speed-btn" data-speed="0.85">0.85x</button>
        <button class="speed-btn active" data-speed="1">1.0x</button>
        <button class="speed-btn" data-speed="1.2">1.2x</button>
      </div>
    </div>

    <div class="card card-static mb-16">
      <div class="card-title">听力材料</div>
      <div class="reading-content" id="listen-text-display">${displayText}</div>
    </div>
  `;

  // Key phrases section
  if (keyPhrases.length > 0) {
    html += `<div class="section"><div class="section-title">重点短语</div>`;
    keyPhrases.forEach(p => {
      const phrase = p.phrase || p;
      const meaning = p.meaning || p.definition || '';
      html += `
        <div class="card card-static mb-8" style="padding:12px 16px">
          <div class="flex-between">
            <span style="font-size:14px;font-weight:600;color:var(--color-primary)">${escapeHtml(phrase)}</span>
            ${meaning ? `<span style="font-size:13px;color:var(--color-text-secondary)">${escapeHtml(meaning)}</span>` : ''}
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  // Quiz section
  if (questions.length > 0) {
    html += `
      <div class="section">
        <div class="section-title">理解测验</div>
        <div id="quiz-container">
    `;
    questions.forEach((q, qIdx) => {
      const questionText = q.question || q;
      const options = q.options || q.choices || [];
      html += `
        <div class="quiz-question" data-qidx="${qIdx}">
          <div class="quiz-question-text">${qIdx + 1}. ${escapeHtml(questionText)}</div>
          <div class="quiz-options">
      `;
      const letters = ['A', 'B', 'C', 'D'];
      options.forEach((opt, oIdx) => {
        const optText = typeof opt === 'string' ? opt : (opt.text || opt);
        html += `
          <button class="quiz-option" data-question="${qIdx}" data-option="${oIdx}">
            <span class="quiz-option-letter">${letters[oIdx]}</span>
            <span>${escapeHtml(optText)}</span>
          </button>
        `;
      });
      html += `</div></div>`;
    });
    html += `
        </div>
        <button class="btn btn-primary btn-block mt-16" id="submit-quiz-btn">提交答案</button>
        <div id="quiz-result" class="hidden mt-16"></div>
      </div>
    `;
  }

  practiceView.innerHTML = html;
}

function handlePlay(container) {
  const text = practiceData?.text || practiceData?.original_text || '';
  if (!text) {
    showToast('没有可播放的文本', 'warning');
    return;
  }

  if (!('speechSynthesis' in window)) {
    showToast('您的浏览器不支持语音合成', 'error');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = currentSpeed;
  utterance.pitch = 1;

  // Try to find an English voice
  const voices = window.speechSynthesis.getVoices();
  const enVoice = voices.find(v => v.lang.startsWith('en'));
  if (enVoice) utterance.voice = enVoice;

  utterance.onstart = () => {
    isSpeaking = true;
    updatePlayButtons(container, true);
  };
  utterance.onend = () => {
    isSpeaking = false;
    updatePlayButtons(container, false);
  };
  utterance.onerror = () => {
    isSpeaking = false;
    updatePlayButtons(container, false);
  };

  window.speechSynthesis.speak(utterance);
}

function handlePause() {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    const container = document.querySelector('#page-content');
    updatePlayButtons(container, false);
  }
}

function handleReplay(container) {
  window.speechSynthesis.cancel();
  setTimeout(() => handlePlay(container), 100);
}

function updatePlayButtons(container, playing) {
  const playBtn = container.querySelector('#play-btn');
  const pauseBtn = container.querySelector('#pause-btn');
  if (playBtn) playBtn.style.display = playing ? 'none' : 'flex';
  if (pauseBtn) pauseBtn.style.display = playing ? 'flex' : 'none';
}

async function handleSubmitQuiz(container) {
  const questions = practiceData?.questions || practiceData?.quiz || [];
  if (questions.length === 0) return;

  // Check all questions answered
  const unanswered = questions.filter((_, idx) => selectedAnswers[idx] === undefined);
  if (unanswered.length > 0) {
    showToast(`还有 ${unanswered.length} 题未作答`, 'warning');
    return;
  }

  const btn = container.querySelector('#submit-quiz-btn');
  btn.disabled = true;
  btn.textContent = '评分中...';

  try {
    const answers = Object.entries(selectedAnswers).map(([qIdx, aIdx]) => ({
      question_index: parseInt(qIdx),
      selected: parseInt(aIdx),
    }));

    const result = await API.post('/api/listening/evaluate', {
      answers,
      practice_id: practiceData.id,
    });

    showQuizResult(result, container);
  } catch (err) {
    // Fallback: evaluate locally if API fails
    evaluateLocally(container);
  } finally {
    btn.textContent = '已提交';
  }
}

function showQuizResult(result, container) {
  const score = result.score ?? result.correct_count ?? 0;
  const total = result.total ?? (practiceData?.questions?.length || 0);
  const correctAnswers = result.correct_answers || result.details || [];

  const resultEl = container.querySelector('#quiz-result');
  resultEl.classList.remove('hidden');

  const percent = total > 0 ? Math.round((score / total) * 100) : 0;
  let emoji = '🎉';
  if (percent < 60) emoji = '💪';
  else if (percent < 80) emoji = '👍';

  resultEl.innerHTML = `
    <div class="card card-static text-center">
      <div style="font-size:36px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:24px;font-weight:800;color:var(--color-primary)">${score} / ${total}</div>
      <div style="font-size:14px;color:var(--color-text-secondary);margin-top:4px">正确率 ${percent}%</div>
    </div>
  `;

  // Highlight correct/incorrect in quiz
  const questions = practiceData?.questions || practiceData?.quiz || [];
  questions.forEach((q, qIdx) => {
    const questionEl = container.querySelector(`.quiz-question[data-qidx="${qIdx}"]`);
    if (!questionEl) return;
    const correctIdx = q.correct_answer ?? q.answer ?? q.correct ?? -1;
    const selectedIdx = parseInt(selectedAnswers[qIdx]);

    questionEl.querySelectorAll('.quiz-option').forEach((opt, oIdx) => {
      opt.classList.remove('selected');
      if (oIdx === correctIdx) {
        opt.classList.add('correct');
      } else if (oIdx === selectedIdx && oIdx !== correctIdx) {
        opt.classList.add('incorrect');
      }
    });
  });
}

function evaluateLocally(container) {
  const questions = practiceData?.questions || practiceData?.quiz || [];
  let correct = 0;

  questions.forEach((q, qIdx) => {
    const correctIdx = q.correct_answer ?? q.answer ?? q.correct ?? -1;
    const selectedIdx = parseInt(selectedAnswers[qIdx]);
    if (selectedIdx === correctIdx) correct++;

    const questionEl = container.querySelector(`.quiz-question[data-qidx="${qIdx}"]`);
    if (!questionEl) return;
    questionEl.querySelectorAll('.quiz-option').forEach((opt, oIdx) => {
      opt.classList.remove('selected');
      if (oIdx === correctIdx) {
        opt.classList.add('correct');
      } else if (oIdx === selectedIdx && oIdx !== correctIdx) {
        opt.classList.add('incorrect');
      }
    });
  });

  showQuizResult({ score: correct, total: questions.length }, container);
}

async function loadHistory(container) {
  const historyView = container.querySelector('#listen-history-view');
  historyView.innerHTML = loadingInline('加载历史记录...');

  // Local-first: render cached history immediately
  let local = [];
  try {
    local = await DB.getAll('listening_history');
    local.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    if (local.length > 0) {
      renderHistoryList(historyView, local);
    }
  } catch (e) { /* local DB unavailable */ }

  // Background refresh from server when online
  if (Sync.isOnline()) {
    try {
      const data = await API.get('/api/listening/history');
      const items = Array.isArray(data) ? data : (data.items || data.history || []);
      if (items.length > 0) {
        try {
          await DB.bulkPut('listening_history', items);
          const merged = await DB.getAll('listening_history');
          merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
          renderHistoryList(historyView, merged);
        } catch (e) { /* cache failure is non-fatal */ }
      } else if (local.length === 0) {
        renderHistoryList(historyView, []);
      }
    } catch (err) {
      if (local.length === 0) {
        historyView.innerHTML = emptyState(
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
          '加载失败',
          err.message || '请稍后重试'
        );
      }
    }
  } else if (local.length === 0) {
    renderHistoryList(historyView, []);
  }
}

function renderHistoryList(historyView, items) {
  if (!items || items.length === 0) {
    historyView.innerHTML = emptyState(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
      '暂无听力练习记录',
      '在"练习"标签页生成听力材料吧'
    );
    return;
  }

  let html = '';
  items.forEach(item => {
    const title = item.title || '未命名练习';
    const date = item.created_at || item.date || '';
    const score = item.score !== undefined ? `得分: ${item.score}` : '';
    html += `
      <div class="list-item listen-history-item" data-id="${item.id}">
        <div class="list-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/></svg>
        </div>
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(title)}</div>
          <div class="list-item-subtitle">${score}</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-date">${formatDateShort(date)}</div>
        </div>
      </div>
    `;
  });
  historyView.innerHTML = html;
}

async function loadPracticeDetail(id, container) {
  showLoading();
  try {
    const data = await API.get(`/api/listening/${id}`);
    hideLoading();
    practiceData = data;
    selectedAnswers = {};
    showPracticeView(data, container);
    container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
  } catch (err) {
    hideLoading();
    showToast(err.message || '加载详情失败', 'error');
  }
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
