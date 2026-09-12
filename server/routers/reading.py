from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database
import kimi

router = APIRouter(prefix="/api/reading", tags=["reading"])


class AnalyzeRequest(BaseModel):
    text: str
    title: Optional[str] = ""
    source_url: Optional[str] = ""
    level: Optional[str] = "intermediate"


@router.post("/analyze")
async def analyze_text(req: AnalyzeRequest):
    """Analyze English text and extract vocabulary, questions, and grammar points."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        result = await kimi.analyze_text(req.text, level=req.level or "intermediate")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Kimi API error: {str(e)}")

    # Count words
    word_count = len(req.text.split())

    # Save to reading history
    vocabulary_list = result.get("vocabulary", [])
    new_words_count = 0

    try:
        history_id = await database.add_reading_history(
            title=req.title or "Untitled",
            content=req.text,
            source_url=req.source_url or "",
            word_count=word_count,
            new_words=len(vocabulary_list),
            comprehension_score=0,
        )

        # Auto-create vocabulary entries and SRS cards for new words
        for vocab in vocabulary_list:
            word = vocab.get("word", "").strip()
            if not word:
                continue

            # Check if word already exists
            existing = await database.get_vocabulary_by_word(word)
            if existing:
                continue

            new_words_count += 1
            await database.add_vocabulary(
                word=word,
                phonetic=vocab.get("phonetic", ""),
                definition=vocab.get("definition", ""),
                definition_cn=vocab.get("definition_cn", ""),
                example_sentence=vocab.get("example", ""),
                context=req.title or "",
                difficulty=vocab.get("difficulty", 3),
            )

            # Create SRS card for the word
            existing_card = await database.get_srs_card_by_front(word)
            if not existing_card:
                back = vocab.get("definition", "")
                if vocab.get("definition_cn"):
                    back += f"\n{vocab['definition_cn']}"
                await database.add_srs_card(
                    card_type="word",
                    front=word,
                    back=back,
                    extra=vocab.get("example", ""),
                )

        # Update new_words count if different
        if new_words_count != len(vocabulary_list):
            db = await database.get_db()
            try:
                await db.execute(
                    "UPDATE reading_history SET new_words = ? WHERE id = ?",
                    (new_words_count, history_id)
                )
                await db.commit()
            finally:
                await db.close()

    except Exception as e:
        # Don't fail the whole request if saving fails
        history_id = None

    return {
        "id": history_id,
        "title": req.title or "Untitled",
        "word_count": word_count,
        "new_words": new_words_count,
        "analysis": result,
    }


@router.get("/history")
async def get_history():
    """Get reading history list."""
    try:
        records = await database.list_reading_history()
        # Don't return full content in list view
        for r in records:
            if r.get("content") and len(r["content"]) > 200:
                r["content_preview"] = r["content"][:200] + "..."
                del r["content"]
        return {"records": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history/{record_id}")
async def get_history_record(record_id: int):
    """Get a single reading history record."""
    try:
        record = await database.get_reading_history(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")
        return record
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
