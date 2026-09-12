// 移动端加固 TTS（speechSynthesis）
// 解决：iOS 手势链断裂（await 后 speak 被静默拦截）、voices 异步加载为空、
// 长文本 iOS 静默截断、队列卡死、静音键无声等问题。
import { DB } from './db.js';

let voices = [];
let bestVoice = null;
let rate = 1;
let inited = false;

export const tts = {
  available() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  },
  getRate() { return rate; },
  setRate(r) { rate = parseFloat(r) || 1; },
  hint: '没有声音？请检查：① iPhone 静音键（侧边拨键）会静音网页语音 ② 系统媒体音量 ③ 系统设置中已安装英语语音包 ④ 尝试重新点一次播放',
};

function loadVoices() {
  try {
    voices = window.speechSynthesis.getVoices() || [];
    bestVoice =
      voices.find((v) => v.lang === 'en-US') ||
      voices.find((v) => (v.lang || '').replace('_', '-').startsWith('en')) ||
      voices.find((v) => v.default) ||
      null;
  } catch (e) { /* ignore */ }
}

export function initTTS() {
  if (inited || !tts.available()) return;
  inited = true;
  loadVoices();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  } catch (e) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  // 预加载语速设置（启动时异步读取，点击时同步使用，保住手势链）
  DB.kvGet('tts_rate', 1).then((r) => { tts.setRate(r); }).catch(() => {});
  // iOS 解锁：首次用户手势内发一条静音 utterance，激活音频会话
  const unlock = () => {
    try {
      window.speechSynthesis.resume();
      const u = new SpeechSynthesisUtterance('unlock');
      u.volume = 0;
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('click', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('click', unlock, true);
}

// 按句子切块，单块 ≤140 字符（iOS 长文本静默截断的规避）
function chunkText(text) {
  const src = String(text || '').trim();
  if (!src) return [];
  const sentences = src.match(/[^.!?!?]+[.!?]*/g) || [src];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > 140) {
      chunks.push(cur);
      cur = '';
    }
    let piece = s;
    while (piece.length > 140) {
      chunks.push(piece.slice(0, 140));
      piece = piece.slice(140);
    }
    cur += piece;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.length ? chunks : [src];
}

function makeUtterance(text, useVoice) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  u.pitch = 1;
  u.volume = 1;
  if (useVoice && bestVoice) u.voice = bestVoice;
  return u;
}

/**
 * 朗读文本。hooks: {onStart, onEnd, onFail}
 * 返回 session: {pause(), resume(), stop(), playing, paused}
 */
export function speak(text, hooks = {}) {
  const session = {
    playing: false,
    paused: false,
    _stopped: false,
    _idx: 0,
    _chunks: chunkText(text),
    _started: false,
    _retried: false,
    pause() {
      if (!this.playing || this.paused) return;
      this.paused = true;
      try { window.speechSynthesis.pause(); } catch (e) { /* ignore */ }
    },
    resume() {
      if (!this.paused) return;
      this.paused = false;
      try {
        window.speechSynthesis.resume();
        // iOS resume 有时静默失败：400ms 后仍无声则从当前块重播
        setTimeout(() => {
          if (this.playing && !this.paused && !window.speechSynthesis.speaking && !this._stopped) {
            this._speakAt(this._idx);
          }
        }, 400);
      } catch (e) { /* ignore */ }
    },
    stop() {
      this._stopped = true;
      this.playing = false;
      this.paused = false;
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
    _speakAt(i) {
      if (this._stopped) return;
      if (i >= this._chunks.length) {
        this.playing = false;
        hooks.onEnd && hooks.onEnd();
        return;
      }
      this._idx = i;
      const u = makeUtterance(this._chunks[i], true);
      u.onstart = () => { this._started = true; };
      u.onend = () => { if (!this._stopped && !this.paused) this._speakAt(i + 1); };
      u.onerror = (ev) => {
        const err = ev && ev.error;
        if (err === 'interrupted' || err === 'canceled') return;
        if (!this._stopped) this._speakAt(i + 1); // 跳过坏块继续
      };
      try {
        window.speechSynthesis.speak(u);
      } catch (e) {
        this.playing = false;
        hooks.onFail && hooks.onFail();
      }
    },
    start() {
      if (!tts.available() || this._chunks.length === 0) {
        hooks.onFail && hooks.onFail();
        return this;
      }
      this.playing = true;
      this._started = false;
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      this._speakAt(0);
      // 看门狗：1.5s 未开始 → 去掉 voice 重试一次；再失败 → onFail 提示
      setTimeout(() => {
        if (this._stopped || this._started) return;
        if (!this._retried) {
          this._retried = true;
          try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
          const u = makeUtterance(this._chunks[0], false);
          u.onstart = () => { this._started = true; };
          u.onend = () => { if (!this._stopped) this._speakAt(1); };
          try { window.speechSynthesis.speak(u); } catch (e) { /* ignore */ }
          setTimeout(() => {
            if (!this._stopped && !this._started) {
              this.playing = false;
              hooks.onFail && hooks.onFail();
            }
          }, 1500);
        }
      }, 1500);
      return this;
    },
  };
  return session.start();
}
