// Speaking Page Module
import { API, showToast, showLoading, hideLoading, escapeHtml, emptyState, loadingInline, offlineGuard } from './app.js';
import { DB } from './db.js';
import { Sync } from './sync.js';

let currentScenario = null;
let chatMessages = [];
let isRecording = false;
let recognition = null;
let autoSpeak = true;
let conversationId = null;

const DEFAULT_SCENARIOS = [
  { id: 'daily_chat', emoji: '💬', name_cn: '日常闲聊', difficulty: 1 },
  { id: 'job_interview', emoji: '💼', name_cn: '求职面试', difficulty: 3 },
  { id: 'travel', emoji: '✈️', name_cn: '旅行出行', difficulty: 2 },
  { id: 'business_meeting', emoji: '📊', name_cn: '商务会议', difficulty: 3 },
  { id: 'restaurant', emoji: '🍽️', name_cn: '餐厅点餐', difficulty: 1 },
  { id: 'shopping', emoji: '🛍️', name_cn: '购物砍价', difficulty: 2 },
  { id: 'doctor', emoji: '🏥', name_cn: '看医生', difficulty: 2 },
  { id: 'tech_support', emoji: '🔧', name_cn: '技术支持', difficulty: 3 },
];

export function renderSpeakPage(container) {
  currentScenario = null;
  chatMessages = [];
  isRecording = false;
  conversationId = null;
  container.innerHTML = getMainHTML();
  bindEvents(container);
  loadScenarios(container);
}

function getMainHTML() {
  return `
    <div class="segment-control">
      <button class="segment-btn active" data-view="scenarios">场景</button>
      <button class="segment-btn" data-view="history">历史</button>
    </div>
    <div id="speak-scenarios-view"></div>
    <div id="speak-chat-view" class="hidden"></div>
    <div id="speak-history-view" class="hidden"></div>
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

    // Scenario card
    const scenarioCard = e.target.closest('.scenario-card');
    if (scenarioCard) {
      await startConversation(scenarioCard.dataset.id, container);
      return;
    }

    // Send message
    if (e.target.closest('#chat-send-btn')) {
      await handleSendMessage(container);
      return;
    }

    // Mic button
    if (e.target.closest('#chat-mic-btn')) {
      toggleVoiceInput(container);
      return;
    }

    // End conversation
    if (e.target.closest('#end-chat-btn')) {
      await endConversation(container);
      return;
    }

    // Back to scenarios
    if (e.target.closest('#chat-back-btn')) {
      switchView('scenarios', container);
      container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      container.querySelector('.segment-btn[data-view="scenarios"]').classList.add('active');
      return;
    }

    // Toggle auto speak
    if (e.target.closest('#toggle-speak-btn')) {
      autoSpeak = !autoSpeak;
      const btn = container.querySelector('#toggle-speak-btn');
      btn.style.color = autoSpeak ? 'var(--color-primary)' : 'var(--color-text-muted)';
      showToast(autoSpeak ? '已开启语音朗读' : '已关闭语音朗读', 'info');
      return;
    }

    // Start new conversation from summary
    if (e.target.closest('#new-chat-btn')) {
      switchView('scenarios', container);
      container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      container.querySelector('.segment-btn[data-view="scenarios"]').classList.add('active');
      return;
    }

    // History item
    const historyItem = e.target.closest('.speak-history-item');
    if (historyItem) {
      await loadConversationDetail(historyItem.dataset.id, container);
      return;
    }
  });

  // Enter key to send
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'chat-input') {
      e.preventDefault();
      handleSendMessage(container);
    }
  });
}

function switchView(view, container) {
  container.querySelector('#speak-scenarios-view').classList.toggle('hidden', view !== 'scenarios');
  container.querySelector('#speak-chat-view').classList.toggle('hidden', view !== 'chat');
  container.querySelector('#speak-history-view').classList.toggle('hidden', view !== 'history');

  if (view === 'history') {
    loadHistory(container);
  }
}

async function loadScenarios(container) {
  const view = container.querySelector('#speak-scenarios-view');
  view.innerHTML = loadingInline('加载场景...');

  let scenarios = DEFAULT_SCENARIOS;
  try {
    const data = await API.get('/api/speaking/scenarios');
    if (Array.isArray(data) && data.length > 0) {
      scenarios = data;
    } else if (data.scenarios && data.scenarios.length > 0) {
      scenarios = data.scenarios;
    }
  } catch (e) {
    // Use defaults
  }

  let html = '<div class="scenario-grid">';
  scenarios.forEach(s => {
    const difficulty = s.difficulty || 2;
    let dots = '';
    for (let i = 0; i < 3; i++) {
      dots += `<span class="difficulty-dot ${i < difficulty ? 'filled' : ''}"></span>`;
    }
    html += `
      <div class="scenario-card" data-id="${s.id}">
        <div class="scenario-emoji">${s.emoji || '💬'}</div>
        <div class="scenario-name">${escapeHtml(s.name_cn || s.name || '')}</div>
        <div class="scenario-difficulty">${dots}</div>
      </div>
    `;
  });
  html += '</div>';
  view.innerHTML = html;
}

async function startConversation(scenarioId, container) {
  if (!offlineGuard('AI口语对练需要联网使用')) return;
  showLoading();
  try {
    let result;
    try {
      result = await API.post('/api/speaking/start', { scenario_id: scenarioId });
    } catch (e) {
      // If API not available, start locally
      result = null;
    }
    hideLoading();

    currentScenario = scenarioId;
    chatMessages = [];
    conversationId = result?.conversation_id || null;

    // Add AI greeting
    const greeting = result?.message || result?.greeting || getDefaultGreeting(scenarioId);
    addMessage('ai', greeting, null, null);

    showChatView(container);
  } catch (err) {
    hideLoading();
    showToast(err.message || '开始对话失败', 'error');
  }
}

function getDefaultGreeting(scenarioId) {
  const greetings = {
    daily_chat: "Hi there! How's your day going? Did you do anything interesting recently?",
    job_interview: "Good morning! Thank you for coming in today. Could you start by telling me a little about yourself?",
    travel: "Welcome to the travel agency! Where are you thinking of going for your next vacation?",
    business_meeting: "Hello everyone, let's get started. Could you give us a brief update on your project progress?",
    restaurant: "Good evening! Welcome to our restaurant. Here's the menu. Can I get you something to drink first?",
    shopping: "Hi! Welcome to our store. Are you looking for anything specific today?",
    doctor: "Hello, I'm Dr. Smith. What brings you in today? How are you feeling?",
    tech_support: "Thank you for calling tech support. My name is Alex. How can I help you today?",
  };
  return greetings[scenarioId] || "Hello! Let's start our conversation. How are you today?";
}

function showChatView(container) {
  container.querySelector('#speak-scenarios-view').classList.add('hidden');
  container.querySelector('#speak-history-view').classList.add('hidden');
  const chatView = container.querySelector('#speak-chat-view');
  chatView.classList.remove('hidden');

  const scenario = DEFAULT_SCENARIOS.find(s => s.id === currentScenario);
  const scenarioName = scenario ? `${scenario.emoji} ${scenario.name_cn}` : '对话练习';

  chatView.innerHTML = `
    <div class="flex-between mb-12">
      <button class="btn btn-ghost btn-sm" id="chat-back-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回
      </button>
      <span style="font-size:14px;font-weight:600">${scenarioName}</span>
      <div class="flex gap-8">
        <button class="btn btn-ghost btn-icon" id="toggle-speak-btn" style="color:var(--color-primary);width:36px;height:36px">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>
        <button class="btn btn-danger btn-sm" id="end-chat-btn">结束</button>
      </div>
    </div>
    <div class="chat-container" id="chat-messages"></div>
    <div class="chat-input-area">
      <button class="chat-mic-btn" id="chat-mic-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
      <input type="text" class="input" id="chat-input" placeholder="输入英文回复..." autocomplete="off">
      <button class="chat-send-btn" id="chat-send-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;

  renderMessages(container);

  // Speak greeting
  if (autoSpeak && chatMessages.length > 0) {
    speakText(chatMessages[0].text);
  }
}

function addMessage(role, text, correction, score) {
  chatMessages.push({ role, text, correction, score });
}

function renderMessages(container) {
  const messagesEl = container.querySelector('#chat-messages');
  if (!messagesEl) return;

  let html = '';
  chatMessages.forEach(msg => {
    if (msg.role === 'ai') {
      html += `<div class="chat-bubble chat-bubble-ai">${escapeHtml(msg.text)}`;
      if (msg.correction) {
        html += `
          <div class="chat-correction">
            <div class="chat-correction-title">修改建议</div>
            ${escapeHtml(msg.correction)}
          </div>
        `;
      }
      html += `</div>`;
    } else {
      html += `<div class="chat-bubble chat-bubble-user">${escapeHtml(msg.text)}`;
      if (msg.score !== null && msg.score !== undefined) {
        html += `<div class="chat-score-badge">⭐ ${msg.score}/10</div>`;
      }
      html += `</div>`;
    }
  });
  messagesEl.innerHTML = html;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function handleSendMessage(container) {
  const input = container.querySelector('#chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMessage('user', text, null, null);
  renderMessages(container);

  // Disable input while waiting
  input.disabled = true;
  const sendBtn = container.querySelector('#chat-send-btn');
  sendBtn.disabled = true;

  try {
    const result = await API.post('/api/speaking/chat', {
      message: text,
      scenario_id: currentScenario,
      conversation_id: conversationId,
      history: chatMessages.slice(0, -1).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text })),
    });

    const aiMessage = result.message || result.reply || result.response || '';
    const correction = result.correction || null;
    const score = result.score ?? null;

    // Update user message with score
    if (score !== null) {
      chatMessages[chatMessages.length - 1].score = score;
    }

    addMessage('ai', aiMessage, correction, null);
    renderMessages(container);

    if (autoSpeak && aiMessage) {
      speakText(aiMessage);
    }
  } catch (err) {
    // Fallback response
    const fallback = getFallbackResponse(text);
    addMessage('ai', fallback, null, null);
    renderMessages(container);
    if (autoSpeak) speakText(fallback);
    showToast('AI 回复失败，使用本地回复', 'warning');
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function getFallbackResponse(userText) {
  const responses = [
    "That's interesting! Could you tell me more about that?",
    "I see. What do you think about this topic?",
    "Good point! How would you describe your experience with this?",
    "Nice! Can you elaborate on that a bit more?",
    "That makes sense. What would you do differently next time?",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function toggleVoiceInput(container) {
  if (isRecording) {
    stopRecording();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('您的浏览器不支持语音识别', 'error');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    isRecording = true;
    const micBtn = container.querySelector('#chat-mic-btn');
    if (micBtn) micBtn.classList.add('recording');
    showToast('正在聆听...', 'info');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const input = container.querySelector('#chat-input');
    if (input) {
      input.value = transcript;
      input.focus();
    }
  };

  recognition.onerror = (event) => {
    if (event.error !== 'aborted') {
      showToast('语音识别失败: ' + event.error, 'error');
    }
  };

  recognition.onend = () => {
    isRecording = false;
    const micBtn = container.querySelector('#chat-mic-btn');
    if (micBtn) micBtn.classList.remove('recording');
  };

  recognition.start();
}

function stopRecording() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  isRecording = false;
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const enVoice = voices.find(v => v.lang.startsWith('en'));
  if (enVoice) utterance.voice = enVoice;
  window.speechSynthesis.speak(utterance);
}

async function endConversation(container) {
  if (chatMessages.length <= 1) {
    switchView('scenarios', container);
    container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
    container.querySelector('.segment-btn[data-view="scenarios"]').classList.add('active');
    return;
  }

  showLoading();
  let summary = null;
  try {
    summary = await API.post('/api/speaking/save', {
      scenario_id: currentScenario,
      conversation_id: conversationId,
      messages: chatMessages.map(m => ({ role: m.role, content: m.text, correction: m.correction, score: m.score })),
    });
  } catch (e) {
    // Save failed, still show summary
  }
  hideLoading();

  // Calculate stats
  const userMessages = chatMessages.filter(m => m.role === 'user');
  const scores = userMessages.filter(m => m.score !== null && m.score !== undefined).map(m => m.score);
  const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-';
  const totalTurns = userMessages.length;

  // Cache saved conversation locally for offline history browsing
  if (summary) {
    try {
      await DB.put('speaking_history', {
        id: summary.id || conversationId || Date.now(),
        scenario_id: currentScenario,
        scenario_name: (DEFAULT_SCENARIOS.find(s => s.id === currentScenario) || {}).name_cn || '',
        overall_score: summary.overall_score || null,
        turns: totalTurns,
        messages: chatMessages.map(m => ({ role: m.role, content: m.text, correction: m.correction, score: m.score })),
        created_at: new Date().toISOString(),
      });
    } catch (e) { /* local cache failure is non-fatal */ }
  }

  const chatView = container.querySelector('#speak-chat-view');
  chatView.innerHTML = `
    <div class="celebration">
      <div class="celebration-emoji">🗣️</div>
      <div class="celebration-title">对话结束！</div>
      <div class="celebration-desc">
        本次对话共 ${totalTurns} 轮${summary?.overall_score ? `，综合评分 ${summary.overall_score}/10` : avgScore !== '-' ? `，平均评分 ${avgScore}/10` : ''}
      </div>
      <div class="stats-grid mb-24">
        <div class="stat-card">
          <div class="stat-value">${totalTurns}</div>
          <div class="stat-label">对话轮数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value secondary">${avgScore}</div>
          <div class="stat-label">平均评分</div>
        </div>
      </div>
      ${summary?.feedback ? `<div class="card card-static mb-16 text-left"><div class="card-title">AI 反馈</div><p style="font-size:14px;color:var(--color-text-secondary);line-height:1.6">${escapeHtml(summary.feedback)}</p></div>` : ''}
      <button class="btn btn-primary btn-block" id="new-chat-btn">选择新场景</button>
    </div>
  `;
}

async function loadHistory(container) {
  const historyView = container.querySelector('#speak-history-view');
  historyView.innerHTML = loadingInline('加载历史记录...');

  // Local-first: render cached history immediately
  let local = [];
  try {
    local = await DB.getAll('speaking_history');
    local.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    if (local.length > 0) {
      renderHistoryList(historyView, local);
    }
  } catch (e) { /* local DB unavailable */ }

  // Background refresh from server when online
  if (Sync.isOnline()) {
    try {
      const data = await API.get('/api/speaking/history');
      const items = Array.isArray(data) ? data : (data.items || data.conversations || []);
      if (items.length > 0) {
        try {
          await DB.bulkPut('speaking_history', items);
          const merged = await DB.getAll('speaking_history');
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
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      '暂无对话记录',
      '选择一个场景开始口语练习吧'
    );
    return;
  }

  let html = '';
  items.forEach(item => {
    const scenario = DEFAULT_SCENARIOS.find(s => s.id === item.scenario_id);
    const emoji = scenario?.emoji || item.emoji || '💬';
    const name = scenario?.name_cn || item.scenario_name || '对话练习';
    const score = item.overall_score || item.score || '-';
    const date = item.created_at || item.date || '';
    const turns = item.turns || item.message_count || '';
    html += `
      <div class="list-item speak-history-item" data-id="${item.id}">
        <div class="list-item-icon">${emoji}</div>
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(name)}</div>
          <div class="list-item-subtitle">${turns ? turns + ' 轮对话' : ''} ${score !== '-' ? '· 评分 ' + score : ''}</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-date">${formatDateShort(date)}</div>
        </div>
      </div>
    `;
  });
  historyView.innerHTML = html;
}

async function loadConversationDetail(id, container) {
  showLoading();
  try {
    const data = await API.get(`/api/speaking/${id}`);
    hideLoading();

    const messages = data.messages || [];
    const score = data.overall_score || data.score || '-';

    const chatView = container.querySelector('#speak-chat-view');
    container.querySelector('#speak-scenarios-view').classList.add('hidden');
    container.querySelector('#speak-history-view').classList.add('hidden');
    chatView.classList.remove('hidden');

    let messagesHtml = '';
    messages.forEach(msg => {
      const role = msg.role === 'assistant' ? 'ai' : msg.role;
      if (role === 'ai') {
        messagesHtml += `<div class="chat-bubble chat-bubble-ai">${escapeHtml(msg.content || msg.text || '')}</div>`;
      } else {
        messagesHtml += `<div class="chat-bubble chat-bubble-user">${escapeHtml(msg.content || msg.text || '')}</div>`;
      }
    });

    chatView.innerHTML = `
      <div class="flex-between mb-12">
        <button class="btn btn-ghost btn-sm" id="chat-back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          返回
        </button>
        <span style="font-size:14px;font-weight:600">对话回顾</span>
        <span class="badge badge-secondary">评分: ${score}</span>
      </div>
      <div class="chat-container">${messagesHtml}</div>
    `;

    container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
  } catch (err) {
    hideLoading();
    showToast(err.message || '加载对话详情失败', 'error');
  }
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
