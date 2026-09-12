"""
FSRS (Free Spaced Repetition Scheduler) Algorithm Implementation.

Based on the FSRS-4.5 algorithm by Jarrett Ye.
"""

import math
from datetime import datetime, timedelta, timezone

# Rating constants
AGAIN = 1
HARD = 2
GOOD = 3
EASY = 4

# Card states
NEW = "new"
LEARNING = "learning"
REVIEW = "review"
RELEARNING = "relearning"

# Default FSRS parameters (w0..w16)
DEFAULT_WEIGHTS = [
    0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01,
    1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61
]

DECAY = -0.5
FACTOR = 19 / 81  # 0.9^(1/DECAY) - 1


def init_stability(rating: int) -> float:
    """Calculate initial stability for a new card based on first rating.

    S0(G) = w[G-1]
    """
    w = DEFAULT_WEIGHTS
    # rating 1-4 maps to w[0]-w[3]
    return max(w[rating - 1], 0.1)


def init_difficulty(rating: int) -> float:
    """Calculate initial difficulty for a new card based on first rating.

    D0(G) = w[4] - (G-3) * w[5]
    Clamped to [1, 10]
    """
    w = DEFAULT_WEIGHTS
    d = w[4] - (rating - 3) * w[5]
    return min(max(d, 1.0), 10.0)


def next_interval(stability: float) -> int:
    """Calculate the next interval in days from stability.

    I(r, S) = (S / FACTOR) * (r^(1/DECAY) - 1)
    With desired retention r = 0.9:
    I = S * 1  (since (0.9^(1/-0.5) - 1) / FACTOR ≈ 1 when FACTOR = 19/81)

    Simplified: interval = round(stability) with minimum of 1 day.
    """
    # desired retention = 0.9
    # interval = (S / FACTOR) * (R^(1/DECAY) - 1)
    # With R=0.9, DECAY=-0.5: R^(1/DECAY) = 0.9^(-2) = 1/0.81
    # (1/0.81 - 1) = 19/81 = FACTOR
    # So interval = S / FACTOR * FACTOR = S
    interval = round(stability)
    return max(interval, 1)


def retrievability(elapsed_days: float, stability: float) -> float:
    """Calculate the probability of recall after elapsed_days.

    R(t, S) = (1 + FACTOR * t / S)^DECAY
    """
    if stability <= 0:
        return 0.0
    return (1 + FACTOR * elapsed_days / stability) ** DECAY


def next_difficulty(d: float, rating: int) -> float:
    """Calculate next difficulty after a review.

    D'(D, G) = w[7] * D0(3) + (1 - w[7]) * (D - w[6] * (G - 3))
    Clamped to [1, 10]
    """
    w = DEFAULT_WEIGHTS
    d0 = w[4]  # D0(3) = w[4] - 0*w[5] = w[4]
    new_d = w[7] * d0 + (1 - w[7]) * (d - w[6] * (rating - 3))
    return min(max(new_d, 1.0), 10.0)


def next_stability(s: float, d: float, r: float, rating: int) -> float:
    """Calculate next stability after a review.

    For successful recall (rating >= 2):
    S'_r = S * (e^(w[8]) * (11-D) * S^(-w[9]) * (e^(w[10]*(1-R)) - 1) * hard_penalty * easy_bonus + 1)

    For forgetting (rating == 1):
    S'_f = w[11] * D^(-w[12]) * ((S+1)^w[13] - 1) * e^(w[14]*(1-R))
    """
    w = DEFAULT_WEIGHTS

    if rating == AGAIN:
        # Forgetting stability
        new_s = (
            w[11]
            * (d ** (-w[12]))
            * (((s + 1) ** w[13]) - 1)
            * math.exp(w[14] * (1 - r))
        )
        return max(new_s, 0.1)
    else:
        # Successful recall stability
        hard_penalty = w[15] if rating == HARD else 1.0
        easy_bonus = w[16] if rating == EASY else 1.0

        new_s = s * (
            math.exp(w[8])
            * (11 - d)
            * (s ** (-w[9]))
            * (math.exp(w[10] * (1 - r)) - 1)
            * hard_penalty
            * easy_bonus
            + 1
        )
        return max(new_s, 0.1)


def schedule(card_state: dict, rating: int) -> dict:
    """Schedule a card review using FSRS algorithm.

    Args:
        card_state: dict with keys: stability, difficulty, due, last_review, reps, lapses, state
        rating: 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)

    Returns:
        dict with: stability, difficulty, due, interval, state, reps, lapses
    """
    now = datetime.now(timezone.utc)
    state = card_state.get("state", NEW)
    stability = card_state.get("stability", 0.5)
    difficulty = card_state.get("difficulty", 5.0)
    reps = card_state.get("reps", 0)
    lapses = card_state.get("lapses", 0)
    last_review = card_state.get("last_review", "")

    if state == NEW:
        # First review of a new card
        new_stability = init_stability(rating)
        new_difficulty = init_difficulty(rating)
        new_reps = 1
        new_lapses = 0 if rating != AGAIN else 1

        if rating == AGAIN:
            new_state = LEARNING
            interval = 0  # Review again soon (same day)
            due = now + timedelta(minutes=1)
        elif rating == HARD:
            new_state = LEARNING
            interval = 0
            due = now + timedelta(minutes=5)
        elif rating == GOOD:
            new_state = REVIEW
            interval = next_interval(new_stability)
            due = now + timedelta(days=interval)
        else:  # EASY
            new_state = REVIEW
            interval = next_interval(new_stability)
            due = now + timedelta(days=interval)

    elif state in (LEARNING, RELEARNING):
        # In learning/relearning phase
        new_difficulty = next_difficulty(difficulty, rating)
        new_reps = reps + 1

        if rating == AGAIN:
            new_stability = init_stability(AGAIN)
            new_state = state  # Stay in learning/relearning
            new_lapses = lapses + (1 if state == RELEARNING else 0)
            interval = 0
            due = now + timedelta(minutes=5)
        elif rating == HARD:
            new_stability = init_stability(HARD)
            new_state = state
            interval = 0
            due = now + timedelta(minutes=10)
        elif rating == GOOD:
            new_stability = init_stability(GOOD)
            new_state = REVIEW
            new_lapses = lapses
            interval = next_interval(new_stability)
            due = now + timedelta(days=interval)
        else:  # EASY
            new_stability = init_stability(EASY)
            new_state = REVIEW
            new_lapses = lapses
            interval = next_interval(new_stability)
            due = now + timedelta(days=interval)

    else:  # REVIEW state
        # Calculate elapsed days and retrievability
        if last_review:
            try:
                last_dt = datetime.fromisoformat(last_review)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                elapsed = max((now - last_dt).total_seconds() / 86400, 0)
            except (ValueError, TypeError):
                elapsed = 0
        else:
            elapsed = 0

        r = retrievability(elapsed, stability)
        new_stability = next_stability(stability, difficulty, r, rating)
        new_difficulty = next_difficulty(difficulty, rating)
        new_reps = reps + 1

        if rating == AGAIN:
            new_state = RELEARNING
            new_lapses = lapses + 1
            interval = 0
            due = now + timedelta(minutes=5)
        else:
            new_state = REVIEW
            new_lapses = lapses
            interval = next_interval(new_stability)
            due = now + timedelta(days=interval)

    return {
        "stability": round(new_stability, 4),
        "difficulty": round(new_difficulty, 4),
        "due": due.isoformat(),
        "interval": interval,
        "state": new_state,
        "reps": new_reps,
        "lapses": new_lapses,
    }
