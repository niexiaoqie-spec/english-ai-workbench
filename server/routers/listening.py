from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database
import kimi

router = APIRouter(prefix="/api/listening", tags=["listening"])


class GenerateRequest(BaseModel):
    text: str
    title: Optional[str] = ""


class EvaluateRequest(BaseModel):
    history_id: int
    answers: List[int]


@router.post("/generate")
async def generate_comprehension(req: GenerateRequest):
    """Generate listening comprehension questions from text."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        result = await kimi.generate_listening_comprehension(req.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Kimi API error: {str(e)}")

    # Estimate duration (average reading speed ~150 words/min for listening)
    word_count = len(req.text.split())
    duration_seconds = int(word_count / 150 * 60)

    # Save to listening history
    try:
        history_id = await database.add_listening_history(
            title=req.title or "Untitled",
            content=req.text,
            source_url="",
            duration_seconds=duration_seconds,
            comprehension_score=0,
        )

        # Store questions in a way we can retrieve them for evaluation
        # We'll store them as part of the content metadata via settings or a separate approach
        # For simplicity, store questions JSON in a settings-like manner tied to the record
        await database.set_setting(
            f"listening_questions_{history_id}",
            json.dumps(result.get("questions", []), ensure_ascii=False)
        )
    except Exception as e:
        history_id = None

    return {
        "id": history_id,
        "title": req.title or "Untitled",
        "content": req.text,
        "duration_seconds": duration_seconds,
        "questions": result.get("questions", []),
        "key_phrases": result.get("key_phrases", []),
    }


@router.get("/history")
async def get_history():
    """Get listening history list."""
    try:
        records = await database.list_listening_history()
        # Don't return full content in list view
        for r in records:
            if r.get("content") and len(r["content"]) > 200:
                r["content_preview"] = r["content"][:200] + "..."
                del r["content"]
        return {"records": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evaluate")
async def evaluate_answers(req: EvaluateRequest):
    """Score listening comprehension answers."""
    try:
        # Get the stored questions
        questions_json = await database.get_setting(f"listening_questions_{req.history_id}", "")
        if not questions_json:
            raise HTTPException(status_code=404, detail="No questions found for this record")

        questions = json.loads(questions_json)

        if not questions:
            raise HTTPException(status_code=404, detail="No questions available")

        # Score the answers
        correct_count = 0
        correct_answers = []
        explanations = []

        for i, q in enumerate(questions):
            correct_idx = q.get("answer", 0)
            correct_answers.append(correct_idx)

            user_answer = req.answers[i] if i < len(req.answers) else -1

            if user_answer == correct_idx:
                correct_count += 1
                explanations.append(f"Question {i+1}: Correct!")
            else:
                options = q.get("options", [])
                correct_text = options[correct_idx] if correct_idx < len(options) else "N/A"
                explanations.append(
                    f"Question {i+1}: Incorrect. The correct answer is: {correct_text}"
                )

        score = (correct_count / len(questions)) * 100 if questions else 0

        # Update the listening history with the score
        await database.update_listening_history(req.history_id, comprehension_score=score)

        return {
            "score": round(score, 1),
            "correct_count": correct_count,
            "total_questions": len(questions),
            "correct_answers": correct_answers,
            "explanations": explanations,
        }
    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse stored questions")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
