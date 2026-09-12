// quiz.js - Shared LOCAL quiz generator (100% offline, no network).
// Builds multiple-choice questions from a word list and grades answers.
// Word shape (from data/words.json):
//   { id, word, phonetic, pos, definition, definition_cn, collocations[],
//     example, example_cn, mnemonic, category, difficulty, synonyms[] }

/**
 * Fisher-Yates shuffle (returns a new array; does not mutate input).
 * @param {Array} arr
 * @returns {Array}
 */
function shuffle(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Primary Chinese meaning for a word, with sensible fallbacks. */
function meaningOf(w) {
  if (!w) return '';
  if (w.definition_cn) return w.definition_cn;
  if (Array.isArray(w.synonyms) && w.synonyms.length && w.synonyms[0]) return w.synonyms[0];
  if (w.definition) return w.definition;
  return '';
}

/**
 * Collect up to `need` unique distractor values from a (pre-shuffled) pool.
 * Skips falsy values, the excluded correct value, and duplicates.
 */
function takeUnique(pool, mapper, excludeValue, need, caseInsensitive = false) {
  const out = [];
  const seen = new Set();
  const norm = (v) => (caseInsensitive ? String(v).toLowerCase() : String(v));
  if (excludeValue !== undefined && excludeValue !== null && excludeValue !== '') {
    seen.add(norm(excludeValue));
  }
  for (const item of pool) {
    const raw = mapper(item);
    if (raw === undefined || raw === null || raw === '') continue;
    const key = norm(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= need) break;
  }
  return out;
}

/**
 * Blank out the target word inside an example sentence (case-insensitive,
 * whole-word). Returns the blanked sentence, or null if the word does not
 * appear as a standalone token (caller then uses a fallback prompt).
 */
function blankOut(example, word) {
  if (!example || !word) return null;
  const re = new RegExp('\\b' + escapeRegExp(word) + '\\b', 'i');
  if (re.test(example)) return example.replace(re, '___');
  return null;
}

/** Same-word identity test using id when present, else the word string. */
function isSameWord(a, b) {
  if (!a || !b) return false;
  if (a.id !== undefined && b.id !== undefined) return a.id === b.id;
  return String(a.word).toLowerCase() === String(b.word).toLowerCase();
}

/** Decide a feasible, well-mixed question type for a word at index idx. */
function chooseType(w, idx) {
  const hasMeaning = !!meaningOf(w);
  const hasFill = !!w.example || hasMeaning; // example preferred; fallback prompt otherwise
  const hasPhonetic = !!w.phonetic;

  const feasible = [];
  if (hasMeaning) feasible.push('meaning');
  if (hasFill) feasible.push('fill');
  if (hasPhonetic) feasible.push('phonetic');
  if (feasible.length === 0) return null;

  // Rotate the preferred starting type across questions to guarantee a mix.
  const order = ['meaning', 'fill', 'phonetic'];
  const start = idx % order.length;
  for (let j = 0; j < order.length; j++) {
    const cand = order[(start + j) % order.length];
    if (feasible.indexOf(cand) !== -1) return cand;
  }
  return feasible[0];
}

/** Build a single question object of the given type for word w. */
function buildQuestion(type, w, pool, idx) {
  const others = pool.filter((x) => !isSameWord(x, w)); // pre-shuffled distractor pool

  if (type === 'meaning') {
    const correct = meaningOf(w);
    const distractors = takeUnique(shuffle(others), (x) => meaningOf(x), correct, 3);
    const options = shuffle([correct].concat(distractors));
    return {
      type: 'meaning',
      question: `What does "${w.word}" mean?`,
      options,
      answer: options.indexOf(correct),
      word: w.word,
    };
  }

  if (type === 'fill') {
    const blanked = blankOut(w.example, w.word);
    const question = blanked !== null
      ? blanked
      : `Complete: ___ (${meaningOf(w)})`;
    const correct = w.word;
    const distractors = takeUnique(shuffle(others), (x) => x.word, correct, 3, true);
    const options = shuffle([correct].concat(distractors));
    return {
      type: 'fill',
      question,
      options,
      answer: options.indexOf(correct),
      word: w.word,
    };
  }

  // type === 'phonetic'
  const correct = w.phonetic;
  const distractors = takeUnique(shuffle(others), (x) => x.phonetic, correct, 3);
  const options = shuffle([correct].concat(distractors));
  return {
    type: 'phonetic',
    question: `Which is the correct pronunciation of "${w.word}"?`,
    options,
    answer: options.indexOf(correct),
    word: w.word,
  };
}

/**
 * Build a mixed set of multiple-choice questions from a word list.
 * @param {Array} words  Array of word objects (see data/words.json).
 * @param {number} count Maximum number of questions to produce (default 10).
 * @returns {Array<{type:string, question:string, options:string[], answer:number, word:string}>}
 *          `answer` is the index into `options` of the correct choice.
 */
export function makeQuiz(words, count = 10) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const n = Math.max(0, Math.min(count | 0 || 0, words.length));
  if (n === 0) return [];

  const pool = shuffle(words.filter((w) => w && w.word));
  if (pool.length === 0) return [];

  const selected = pool.slice(0, n);
  const questions = [];
  for (let i = 0; i < selected.length; i++) {
    const w = selected[i];
    const type = chooseType(w, i);
    if (!type) continue;
    const q = buildQuestion(type, w, pool, i);
    // Sanity: a valid question needs a resolvable answer index.
    if (q && q.answer >= 0 && q.options.length >= 2) questions.push(q);
  }
  return questions;
}

/**
 * Grade a completed quiz.
 * @param {Array} questions Array produced by makeQuiz.
 * @param {Array<number|null>} answers User-selected option indices, parallel to questions.
 * @returns {{score:number, total:number, results:Array<{q:object, chosen:number|null, correct:boolean}>}}
 */
export function gradeQuiz(questions, answers) {
  const qs = Array.isArray(questions) ? questions : [];
  const ans = Array.isArray(answers) ? answers : [];
  const results = qs.map((q, i) => {
    const raw = ans[i];
    const chosen = (raw === undefined || raw === null || raw === '') ? null : raw;
    const correct = chosen !== null && Number(chosen) === Number(q.answer);
    return { q, chosen, correct };
  });
  const score = results.filter((r) => r.correct).length;
  return { score, total: qs.length, results };
}
