from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database
import kimi

router = APIRouter(prefix="/api/daily", tags=["daily"])


# --- Request models ---

class GenerateRequest(BaseModel):
    count: Optional[int] = 30
    category: Optional[str] = "business"


class ReviewRequest(BaseModel):
    word_id: int


class QuizSubmitRequest(BaseModel):
    quiz_id: int
    user_answer: int


def _today_str() -> str:
    return date.today().isoformat()


@router.get("/today")
async def get_today():
    """Get today's words, quiz, and progress."""
    today = _today_str()
    try:
        streak = await database.get_daily_streak()
        total_words = await database.get_total_words_learned()

        words = await database.get_daily_words(today)
        if words:
            quiz = await database.get_daily_quiz(today)
            progress = await database.get_daily_progress(today) or {}
            return {
                "date": today,
                "has_words": True,
                "words": words,
                "quiz": quiz,
                "progress": {
                    **progress,
                    "streak": streak,
                    "total_words": total_words,
                },
            }

        return {
            "date": today,
            "has_words": False,
            "progress": {
                "streak": streak,
                "total_words": total_words,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate")
async def generate(req: GenerateRequest):
    """Generate today's words and quiz via Kimi, then persist them."""
    today = _today_str()
    count = req.count or 30
    category = req.category or "business"

    try:
        result = await kimi.generate_daily_words(count=count, category=category)
    except ValueError as e:
        # Missing API key / configuration problem
        raise HTTPException(status_code=502, detail=f"Kimi API configuration error: {e}")
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Kimi returned invalid JSON. Please try again. ({e})",
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to generate words from Kimi API: {e}",
        )

    words = result.get("words", []) if isinstance(result, dict) else []
    quiz = result.get("quiz", []) if isinstance(result, dict) else []

    if not words:
        raise HTTPException(
            status_code=502,
            detail="Kimi did not return any words. Please try again.",
        )

    try:
        # Assign sort_order if not present
        for idx, w in enumerate(words):
            if w.get("sort_order") is None:
                w["sort_order"] = idx

        await database.save_daily_words(today, words)
        await database.save_daily_quiz(today, quiz)
        await database.save_daily_progress(today, {
            "words_generated": len(words),
            "words_reviewed": 0,
            "quiz_score": 0,
            "quiz_total": len(quiz),
            "completed": 0,
        })

        saved_words = await database.get_daily_words(today)
        saved_quiz = await database.get_daily_quiz(today)
        progress = await database.get_daily_progress(today) or {}

        return {
            "date": today,
            "has_words": True,
            "words": saved_words,
            "quiz": saved_quiz,
            "progress": progress,
            "message": f"Generated {len(saved_words)} words and {len(saved_quiz)} quiz questions.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review")
async def review_word(req: ReviewRequest):
    """Mark a word as reviewed by incrementing today's words_reviewed counter."""
    today = _today_str()
    try:
        progress = await database.get_daily_progress(today)
        if progress is None:
            # No words generated today yet
            raise HTTPException(status_code=404, detail="No daily words found for today. Generate words first.")

        current_reviewed = int(progress.get("words_reviewed", 0) or 0)
        words_generated = int(progress.get("words_generated", 0) or 0)
        new_reviewed = min(current_reviewed + 1, words_generated) if words_generated else current_reviewed + 1

        updated = await database.save_daily_progress(today, {
            "words_reviewed": new_reviewed,
        })

        streak = await database.get_daily_streak()
        total_words = await database.get_total_words_learned()

        return {
            "date": today,
            "word_id": req.word_id,
            "progress": {
                **(updated or {}),
                "streak": streak,
                "total_words": total_words,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/quiz/submit")
async def submit_quiz(req: QuizSubmitRequest):
    """Submit an answer for a quiz question and update progress."""
    today = _today_str()
    try:
        quiz_item = await database.get_quiz_by_id(req.quiz_id)
        if quiz_item is None:
            raise HTTPException(status_code=404, detail="Quiz question not found")

        correct_answer = int(quiz_item.get("answer", 0) or 0)
        is_correct = int(req.user_answer) == correct_answer

        await database.update_quiz_answer(req.quiz_id, req.user_answer, is_correct)

        # Recompute progress for today from all quiz records
        all_quiz = await database.get_daily_quiz(quiz_item.get("date", today))
        total = len(all_quiz)
        answered = sum(1 for q in all_quiz if q.get("user_answer") is not None)
        score = sum(1 for q in all_quiz if q.get("is_correct") == 1)

        completed = 1 if (total > 0 and answered >= total) else 0

        await database.save_daily_progress(quiz_item.get("date", today), {
            "quiz_score": score,
            "quiz_total": total,
            "completed": completed,
        })

        return {
            "is_correct": is_correct,
            "correct_answer": correct_answer,
            "quiz_progress": {
                "answered": answered,
                "total": total,
                "score": score,
            },
            "completed": bool(completed),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_stats():
    """Get overall learning statistics."""
    try:
        streak = await database.get_daily_streak()
        total_words = await database.get_total_words_learned()
        stats = await database.get_daily_stats()

        return {
            "streak": streak,
            "total_words": total_words,
            "total_days": stats.get("total_days", 0),
            "avg_score": stats.get("avg_score", 0),
            "this_week": stats.get("this_week", []),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_history(page: int = 1, page_size: int = 7):
    """Get past days' word lists, paginated (most recent first)."""
    try:
        result = await database.get_daily_history(page=page, page_size=page_size)
        return {
            "days": result.get("days", []),
            "total": result.get("total", 0),
            "page": result.get("page", page),
            "page_size": result.get("page_size", page_size),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
