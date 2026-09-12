// FSRS (Free Spaced Repetition Scheduler) - JavaScript port of server/fsrs.py
// Keeps offline grading identical to server-side scheduling.

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
export const STATE = { NEW: 'new', LEARNING: 'learning', REVIEW: 'review', RELEARNING: 'relearning' };

const W = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];
const DECAY = -0.5;
const FACTOR = 19 / 81;

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

export function initStability(rating) {
  return Math.max(W[rating - 1], 0.1);
}

export function initDifficulty(rating) {
  const d = W[4] - (rating - 3) * W[5];
  return clamp(d, 1.0, 10.0);
}

export function nextInterval(stability) {
  return Math.max(Math.round(stability), 1);
}

export function retrievability(elapsedDays, stability) {
  if (stability <= 0) return 0.0;
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

export function nextDifficulty(d, rating) {
  const d0 = W[4];
  const newD = W[7] * d0 + (1 - W[7]) * (d - W[6] * (rating - 3));
  return clamp(newD, 1.0, 10.0);
}

export function nextStability(s, d, r, rating) {
  if (rating === RATING.AGAIN) {
    const newS = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
    return Math.max(newS, 0.1);
  }
  const hardPenalty = rating === RATING.HARD ? W[15] : 1.0;
  const easyBonus = rating === RATING.EASY ? W[16] : 1.0;
  const newS = s * (
    Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus + 1
  );
  return Math.max(newS, 0.1);
}

function addMinutes(date, mins) { return new Date(date.getTime() + mins * 60000); }
function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }

/**
 * Schedule a card review.
 * @param {object} card - {stability, difficulty, due, last_review, reps, lapses, state}
 * @param {number} rating - 1..4
 * @returns {object} - {stability, difficulty, due, interval, state, reps, lapses}
 */
export function schedule(card, rating) {
  const now = new Date();
  const state = card.state || STATE.NEW;
  const stability = card.stability ?? 0.5;
  const difficulty = card.difficulty ?? 5.0;
  const reps = card.reps ?? 0;
  const lapses = card.lapses ?? 0;
  const lastReview = card.last_review || '';

  let newStability, newDifficulty, newReps, newLapses, newState, interval, due;

  if (state === STATE.NEW) {
    newStability = initStability(rating);
    newDifficulty = initDifficulty(rating);
    newReps = 1;
    newLapses = rating === RATING.AGAIN ? 1 : 0;
    if (rating === RATING.AGAIN) {
      newState = STATE.LEARNING; interval = 0; due = addMinutes(now, 1);
    } else if (rating === RATING.HARD) {
      newState = STATE.LEARNING; interval = 0; due = addMinutes(now, 5);
    } else {
      newState = STATE.REVIEW; interval = nextInterval(newStability); due = addDays(now, interval);
    }
  } else if (state === STATE.LEARNING || state === STATE.RELEARNING) {
    newDifficulty = nextDifficulty(difficulty, rating);
    newReps = reps + 1;
    if (rating === RATING.AGAIN) {
      newStability = initStability(RATING.AGAIN);
      newState = state;
      newLapses = lapses + (state === STATE.RELEARNING ? 1 : 0);
      interval = 0; due = addMinutes(now, 5);
    } else if (rating === RATING.HARD) {
      newStability = initStability(RATING.HARD);
      newState = state; newLapses = lapses;
      interval = 0; due = addMinutes(now, 10);
    } else {
      newStability = initStability(rating);
      newState = STATE.REVIEW; newLapses = lapses;
      interval = nextInterval(newStability); due = addDays(now, interval);
    }
  } else { // REVIEW
    let elapsed = 0;
    if (lastReview) {
      const lastDt = new Date(lastReview);
      if (!isNaN(lastDt.getTime())) {
        elapsed = Math.max((now - lastDt) / 86400000, 0);
      }
    }
    const r = retrievability(elapsed, stability);
    newStability = nextStability(stability, difficulty, r, rating);
    newDifficulty = nextDifficulty(difficulty, rating);
    newReps = reps + 1;
    if (rating === RATING.AGAIN) {
      newState = STATE.RELEARNING; newLapses = lapses + 1;
      interval = 0; due = addMinutes(now, 5);
    } else {
      newState = STATE.REVIEW; newLapses = lapses;
      interval = nextInterval(newStability); due = addDays(now, interval);
    }
  }

  return {
    stability: Math.round(newStability * 10000) / 10000,
    difficulty: Math.round(newDifficulty * 10000) / 10000,
    due: due.toISOString(),
    interval,
    state: newState,
    reps: newReps,
    lapses: newLapses,
  };
}

/** Cards due now (due <= now), sorted by due date. */
export function filterDue(cards, now = new Date()) {
  return cards
    .filter((c) => {
      if (!c.due) return true;
      const d = new Date(c.due);
      return !isNaN(d.getTime()) && d <= now;
    })
    .sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0));
}
