// Reading Page Module
import { API, showToast, showLoading, hideLoading, escapeHtml, formatDate, renderStars, emptyState, loadingInline, offlineGuard } from './app.js';
import { DB } from './db.js';
import { Sync } from './sync.js';

let currentView = 'input'; // 'input' | 'results' | 'history'

export function renderReadPage(container) {
  currentView = 'input';
  container.innerHTML = getPageHTML();
  bindEvents(container);
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
    <div id="read-history-view" class="hidden"></div>
    <div id="read-results-view" class="hidden"></div>
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
        <textarea class="textarea" id="read-text" style="min-height:200px" placeholder="在此粘贴英文文章、新闻、故事等..."></textarea>
      </div>
      <div class="input-group">
        <label class="input-label">来源链接（可选）</label>
        <input type="url" class="input" id="read-source" placeholder="https://...">
      </div>
      <div class="input-group">
        <label class="input-label">难度级别</label>
        <div class="segment-control" id="level-selector">
          <button class="segment-btn" data-level="beginner">初级</button>
          <button class="segment-btn active" data-level="intermediate">中级</button>
          <button class="segment-btn" data-level="advanced">高级</button>
        </div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="analyze-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        开始分析
      </button>
    </div>
  `;
}

function bindEvents(container) {
  // Segment control for input/history
  container.addEventListener('click', async (e) => {
    const segBtn = e.target.closest('.segment-btn[data-view]');
    if (segBtn) {
      const view = segBtn.dataset.view;
      container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      segBtn.classList.add('active');
      switchView(view, container);
      return;
    }

    // Level selector
    const levelBtn = e.target.closest('#level-selector .segment-btn');
    if (levelBtn) {
      container.querySelectorAll('#level-selector .segment-btn').forEach(b => b.classList.remove('active'));
      levelBtn.classList.add('active');
      return;
    }

    // Analyze button
    if (e.target.closest('#analyze-btn')) {
      await handleAnalyze(container);
      return;
    }

    // Add single word to vocabulary
    const addWordBtn = e.target.closest('.add-word-btn');
    if (addWordBtn) {
      await handleAddWord(addWordBtn);
      return;
    }

    // Add all words
    if (e.target.closest('#add-all-words-btn')) {
      await handleAddAllWords(container);
      return;
    }

    // Back to input
    if (e.target.closest('#back-to-input-btn')) {
      switchView('input', container);
      container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
      container.querySelector('.segment-btn[data-view="input"]').classList.add('active');
      return;
    }

    // Toggle expandable sections
    const expandBtn = e.target.closest('.expand-toggle');
    if (expandBtn) {
      const target = container.querySelector(expandBtn.dataset.target);
      if (target) {
        target.classList.toggle('hidden');
        expandBtn.querySelector('.collapsible-arrow').classList.toggle('open');
      }
      return;
    }

    // History item click
    const historyItem = e.target.closest('.history-item');
    if (historyItem) {
      await loadHistoryDetail(historyItem.dataset.id, container);
      return;
    }
  });
}

function switchView(view, container) {
  currentView = view;
  const inputView = container.querySelector('#read-input-view');
  const historyView = container.querySelector('#read-history-view');
  const resultsView = container.querySelector('#read-results-view');

  inputView.classList.toggle('hidden', view !== 'input');
  historyView.classList.toggle('hidden', view !== 'history');
  resultsView.classList.toggle('hidden', view !== 'results');

  if (view === 'history') {
    loadHistory(container);
  }
}

async function handleAnalyze(container) {
  if (!offlineGuard('文章分析需要联网使用')) return;
  const text = container.querySelector('#read-text').value.trim();
  if (!text) {
    showToast('请输入英文文本', 'warning');
    return;
  }

  const title = container.querySelector('#read-title').value.trim();
  const source = container.querySelector('#read-source').value.trim();
  const levelBtn = container.querySelector('#level-selector .segment-btn.active');
  const level = levelBtn ? levelBtn.dataset.level : 'intermediate';

  showLoading();
  try {
    const result = await API.post('/api/reading/analyze', { text, title, source_url: source, level });
    hideLoading();
    // Cache analysis result locally for offline history browsing
    try {
      await DB.put('reading_history', {
        id: result.id || Date.now(),
        title,
        content: text,
        word_count: result.word_count,
        new_words: result.new_words,
        created_at: new Date().toISOString(),
      });
    } catch (e) { /* local cache failure is non-fatal */ }
    showResults(result, container);
  } catch (err) {
    hideLoading();
    showToast(err.message || '分析失败，请重试', 'error');
  }
}

function showResults(data, container) {
  const resultsView = container.querySelector('#read-results-view');
  const inputView = container.querySelector('#read-input-view');
  const historyView = container.querySelector('#read-history-view');

  inputView.classList.add('hidden');
  historyView.classList.add('hidden');
  resultsView.classList.remove('hidden');

  const analysis = data.analysis || data;
  const vocab = analysis.vocabulary || [];
  const questions = analysis.comprehension_questions || [];
  const grammar = analysis.grammar_points || [];
  const summary = analysis.summary || '';

  let html = `
    <div class="flex-between mb-16">
      <button class="btn btn-ghost btn-sm" id="back-to-input-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回
      </button>
      ${vocab.length > 0 ? '<button class="btn btn-secondary btn-sm" id="add-all-words-btn">一键全部加入生词本</button>' : ''}
    </div>
  `;

  // Summary
  if (summary) {
    html += `
      <div class="card card-static mb-16">
        <div class="card-title">文章摘要</div>
        <p style="font-size:14px;color:var(--color-text-secondary);line-height:1.6">${escapeHtml(summary)}</p>
      </div>
    `;
  }

  // Vocabulary
  if (vocab.length > 0) {
    html += `<div class="section"><div class="section-title">生词 (${vocab.length})</div>`;
    vocab.forEach((word, idx) => {
      html += `
        <div class="vocab-card">
          <div class="flex-between">
            <div class="vocab-word">${escapeHtml(word.word)}</div>
            <span class="badge badge-primary">${escapeHtml(word.pos || '')}</span>
          </div>
          <div class="vocab-phonetic">${escapeHtml(word.phonetic || '')}</div>
          <div class="vocab-definition">${escapeHtml(word.definition_cn || word.definition || '')}</div>
          ${word.example ? `<div class="vocab-example">${escapeHtml(word.example)}</div>` : ''}
          <div class="vocab-footer">
            <div class="vocab-difficulty">${renderStars(word.difficulty || 3)}</div>
            <button class="btn btn-outline btn-sm add-word-btn" data-idx="${idx}">加入生词本</button>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  // Comprehension Questions
  if (questions.length > 0) {
    html += `
      <div class="section">
        <div class="collapsible-header expand-toggle" data-target="#questions-section">
          <span class="collapsible-title">阅读理解题 (${questions.length})</span>
          <svg class="collapsible-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div id="questions-section" class="hidden" style="padding:12px 0">
    `;
    questions.forEach((q, i) => {
      html += `
        <div class="card card-static mb-8">
          <div style="font-size:14px;font-weight:600;margin-bottom:8px">${i + 1}. ${escapeHtml(q.question || q)}</div>
          ${q.answer ? `<div style="font-size:13px;color:var(--color-secondary)">参考答案: ${escapeHtml(q.answer)}</div>` : ''}
        </div>
      `;
    });
    html += `</div></div>`;
  }

  // Grammar Points
  if (grammar.length > 0) {
    html += `
      <div class="section">
        <div class="collapsible-header expand-toggle" data-target="#grammar-section">
          <span class="collapsible-title">语法要点 (${grammar.length})</span>
          <svg class="collapsible-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div id="grammar-section" class="hidden" style="padding:12px 0">
    `;
    grammar.forEach((g) => {
      const point = typeof g === 'string' ? g : (g.point || g.title || '');
      const explanation = typeof g === 'string' ? '' : (g.explanation || g.description || '');
      html += `
        <div class="card card-static mb-8">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">${escapeHtml(point)}</div>
          ${explanation ? `<div style="font-size:13px;color:var(--color-text-secondary);line-height:1.5">${escapeHtml(explanation)}</div>` : ''}
        </div>
      `;
    });
    html += `</div></div>`;
  }

  resultsView.innerHTML = html;

  // Store vocab data for add operations
  resultsView._vocabData = vocab;
}

async function handleAddWord(btn) {
  const idx = parseInt(btn.dataset.idx);
  const resultsView = document.querySelector('#read-results-view');
  const vocab = resultsView._vocabData;
  if (!vocab || !vocab[idx]) return;

  const word = vocab[idx];
  btn.disabled = true;
  btn.textContent = '添加中...';

  try {
    await API.post('/api/vocabulary', {
      word: word.word,
      phonetic: word.phonetic || '',
      definition_cn: word.definition_cn || word.definition || '',
      definition_en: word.definition_en || '',
      example: word.example || '',
      pos: word.pos || '',
      difficulty: word.difficulty || 3,
    });
    btn.textContent = '已添加';
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-ghost');
    showToast(`"${word.word}" 已加入生词本`, 'success');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '加入生词本';
    showToast(err.message || '添加失败', 'error');
  }
}

async function handleAddAllWords(container) {
  const resultsView = container.querySelector('#read-results-view');
  const vocab = resultsView._vocabData;
  if (!vocab || vocab.length === 0) return;

  const btn = container.querySelector('#add-all-words-btn');
  btn.disabled = true;
  btn.textContent = '添加中...';

  let successCount = 0;
  for (const word of vocab) {
    try {
      await API.post('/api/vocabulary', {
        word: word.word,
        phonetic: word.phonetic || '',
        definition_cn: word.definition_cn || word.definition || '',
        definition_en: word.definition_en || '',
        example: word.example || '',
        pos: word.pos || '',
        difficulty: word.difficulty || 3,
      });
      successCount++;
    } catch (e) {
      // Skip duplicates silently
    }
  }

  btn.textContent = `已添加 ${successCount} 词`;
  showToast(`成功添加 ${successCount} 个生词`, 'success');

  // Update individual buttons
  container.querySelectorAll('.add-word-btn').forEach(b => {
    b.textContent = '已添加';
    b.disabled = true;
    b.classList.remove('btn-outline');
    b.classList.add('btn-ghost');
  });
}

async function loadHistory(container) {
  const historyView = container.querySelector('#read-history-view');
  historyView.innerHTML = loadingInline('加载历史记录...');

  // Local-first: render cached history immediately
  let local = [];
  try {
    local = await DB.getAll('reading_history');
    local.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    if (local.length > 0) {
      renderHistoryList(historyView, local);
    }
  } catch (e) { /* local DB unavailable */ }

  // Background refresh from server when online
  if (Sync.isOnline()) {
    try {
      const data = await API.get('/api/reading/history');
      const items = Array.isArray(data) ? data : (data.items || data.history || []);
      if (items.length > 0) {
        try {
          await DB.bulkPut('reading_history', items);
          const merged = await DB.getAll('reading_history');
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
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      '暂无阅读记录',
      '在"阅读"标签页粘贴英文文本开始分析吧'
    );
    return;
  }

  let html = '';
  items.forEach(item => {
    const title = item.title || '未命名文章';
    const date = formatDate(item.created_at || item.date);
    const wordCount = item.word_count || item.new_words_count || 0;
    const newWords = item.new_words_count || item.vocabulary_count || 0;
    html += `
      <div class="list-item history-item" data-id="${item.id}">
        <div class="list-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </div>
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(title)}</div>
          <div class="list-item-subtitle">${wordCount} 词 · ${newWords} 个生词</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-date">${date}</div>
        </div>
      </div>
    `;
  });
  historyView.innerHTML = html;
}

async function loadHistoryDetail(id, container) {
  showLoading();
  try {
    const data = await API.get(`/api/reading/${id}`);
    hideLoading();
    showResults(data, container);
    container.querySelectorAll('.segment-btn[data-view]').forEach(b => b.classList.remove('active'));
  } catch (err) {
    hideLoading();
    showToast(err.message || '加载详情失败', 'error');
  }
}
