// Sync Engine - local-first data with background server sync
// - Offline operations are queued in the outbox (IndexedDB)
// - When online, the outbox is flushed to the server
// - Server data (daily words, histories) is seeded into local DB for offline use

import { DB } from './db.js';
import { API } from './app.js';

let onlineListeners = [];
let offlineListeners = [];
let flushing = false;

export const Sync = {
  isOnline() {
    return navigator.onLine !== false;
  },

  onOnline(cb) { onlineListeners.push(cb); },
  onOffline(cb) { offlineListeners.push(cb); },

  _emit(list) { list.forEach((cb) => { try { cb(); } catch (e) { /* ignore */ } }); },

  init() {
    window.addEventListener('online', () => {
      Sync._emit(onlineListeners);
      Sync.flushOutbox().catch(() => {});
    });
    window.addEventListener('offline', () => {
      Sync._emit(offlineListeners);
    });
  },

  /**
   * Flush pending offline operations to the server.
   * Each op: {id, type, payload, ts}
   */
  async flushOutbox() {
    if (flushing || !Sync.isOnline()) return { flushed: 0, failed: 0 };
    flushing = true;
    let flushed = 0;
    let failed = 0;
    try {
      const ops = await DB.outboxAll();
      for (const op of ops) {
        try {
          await Sync._applyOp(op);
          await DB.outboxRemove(op.id);
          flushed++;
        } catch (e) {
          // If the server rejects permanently (404/409), drop it; otherwise keep for retry
          const msg = (e && e.message) || '';
          if (msg.includes('(404)') || msg.includes('(409)')) {
            await DB.outboxRemove(op.id);
          }
          failed++;
          break; // stop flushing on first network failure to preserve order
        }
      }
    } finally {
      flushing = false;
    }
    return { flushed, failed };
  },

  async _applyOp(op) {
    const { type, payload } = op;
    switch (type) {
      case 'srs_review':
        await API.post('/api/srs/review', { card_id: payload.server_card_id ?? payload.card_id, rating: payload.rating });
        return;
      case 'srs_add': {
        const res = await API.post('/api/srs/add', payload.body);
        // Replace local id with server id
        if (res && res.card && res.card.id && payload.local_id) {
          const local = await DB.get('srs_cards', payload.local_id);
          if (local) {
            await DB.delete('srs_cards', payload.local_id);
            local.id = res.card.id;
            local.synced = true;
            await DB.put('srs_cards', local);
          }
        }
        return;
      }
      case 'vocab_add': {
        const res = await API.post('/api/vocabulary', payload.body);
        if (res && res.word && res.word.id && payload.local_id) {
          const local = await DB.get('vocabulary', payload.local_id);
          if (local) {
            await DB.delete('vocabulary', payload.local_id);
            local.id = res.word.id;
            local.synced = true;
            await DB.put('vocabulary', local);
          }
        }
        return;
      }
      case 'vocab_delete':
        await API.del(`/api/vocabulary/${payload.server_id}`);
        return;
      case 'daily_review':
        await API.post('/api/daily/review', { word_id: payload.word_id });
        return;
      case 'daily_quiz_submit':
        await API.post('/api/daily/quiz/submit', { quiz_id: payload.quiz_id, user_answer: payload.user_answer });
        return;
      default:
        // Unknown op type: drop it
        return;
    }
  },

  /**
   * Seed local DB from server (called on startup when online).
   * Server wins for daily words/quiz/progress and histories;
   * local wins for srs_cards/vocabulary review state (local-first).
   */
  async seedFromServer() {
    if (!Sync.isOnline()) return;
    const today = DB.todayStr();

    // 1. Daily words for today
    try {
      const daily = await API.get('/api/daily/today');
      if (daily && daily.has_words && daily.words && daily.words.length > 0) {
        await DB.bulkPut('daily_words', daily.words);
        if (daily.quiz) await DB.bulkPut('daily_quiz', daily.quiz);
        if (daily.progress) await DB.put('daily_progress', daily.progress);
        await DB.kvSet('daily_date', today);
      }
      if (daily && daily.progress) {
        await DB.kvSet('streak', daily.progress.streak ?? daily.streak ?? 0);
        await DB.kvSet('total_words', daily.progress.total_words ?? daily.total_words ?? 0);
      }
    } catch (e) { /* offline or error - keep local */ }

    // 2. SRS cards: merge server cards into local (server provides cards local doesn't have)
    try {
      const due = await API.get('/api/srs/today');
      const serverCards = (due && (due.cards || due.due_cards)) || [];
      if (serverCards.length > 0) {
        const localCards = await DB.getAll('srs_cards');
        const localById = new Map(localCards.map((c) => [String(c.id), c]));
        const toAdd = [];
        for (const sc of serverCards) {
          const local = localById.get(String(sc.id));
          if (!local) {
            toAdd.push({ ...sc, synced: true });
          } else if (!local.pending_review) {
            // Server has newer scheduling if local hasn't unsynced reviews
            toAdd.push({ ...sc, synced: true });
          }
        }
        if (toAdd.length > 0) await DB.bulkPut('srs_cards', toAdd);
      }
    } catch (e) { /* ignore */ }

    // 3. Vocabulary list (server as backup source for words local doesn't have)
    try {
      const vocab = await API.get('/api/vocabulary');
      const serverWords = (vocab && vocab.words) || [];
      if (serverWords.length > 0) {
        const localWords = await DB.getAll('vocabulary');
        const localByWord = new Map(localWords.map((w) => [w.word, w]));
        const toAdd = serverWords.filter((sw) => !localByWord.has(sw.word)).map((sw) => ({ ...sw, synced: true }));
        if (toAdd.length > 0) await DB.bulkPut('vocabulary', toAdd);
      }
    } catch (e) { /* ignore */ }

    // 4. Histories (cache for offline browsing)
    try {
      const rh = await API.get('/api/reading/history');
      const records = (rh && (rh.records || rh.items)) || [];
      if (records.length > 0) await DB.bulkPut('reading_history', records);
    } catch (e) { /* ignore */ }
    try {
      const sh = await API.get('/api/speaking/history');
      const records = (sh && (sh.records || sh.history)) || [];
      if (records.length > 0) await DB.bulkPut('speaking_history', records);
    } catch (e) { /* ignore */ }

    await DB.kvSet('last_seed', Date.now());
  },
};
