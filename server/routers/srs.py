from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database
import fsrs

router = APIRouter(prefix="/api/srs", tags=["srs"])


class ReviewRequest(BaseModel):
    card_id: int
    rating: int = Field(..., ge=1, le=4)


class AddCardRequest(BaseModel):
    card_type: str = "word"
    front: str
    back: str
    extra: Optional[str] = ""


@router.get("/today")
async def get_today_cards():
    """Get cards due today, ordered by due date."""
    try:
        cards = await database.get_due_cards()

        # Count by state
        new_count = sum(1 for c in cards if c["state"] == "new")
        learning_count = sum(1 for c in cards if c["state"] in ("learning", "relearning"))
        review_count = sum(1 for c in cards if c["state"] == "review")

        return {
            "cards": cards,
            "count": {
                "total": len(cards),
                "new": new_count,
                "learning": learning_count,
                "review": review_count,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review")
async def review_card(req: ReviewRequest):
    """Review a card and apply FSRS algorithm."""
    try:
        card = await database.get_srs_card(req.card_id)
        if not card:
            raise HTTPException(status_code=404, detail="Card not found")

        # Apply FSRS scheduling
        card_state = {
            "stability": card["stability"],
            "difficulty": card["difficulty"],
            "due": card["due"],
            "last_review": card["last_review"],
            "reps": card["reps"],
            "lapses": card["lapses"],
            "state": card["state"],
        }

        new_state = fsrs.schedule(card_state, req.rating)

        # Update the card in database
        from database import now_iso
        await database.update_srs_card(
            req.card_id,
            stability=new_state["stability"],
            difficulty=new_state["difficulty"],
            due=new_state["due"],
            last_review=now_iso(),
            reps=new_state["reps"],
            lapses=new_state["lapses"],
            state=new_state["state"],
        )

        # Get updated card
        updated_card = await database.get_srs_card(req.card_id)

        return {
            "card": updated_card,
            "next_due": new_state["due"],
            "interval_days": new_state["interval"],
            "new_state": new_state["state"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_stats():
    """Get SRS statistics."""
    try:
        stats = await database.get_srs_stats()

        # Calculate streak days
        db = await database.get_db()
        try:
            cursor = await db.execute(
                """SELECT DISTINCT substr(last_review, 1, 10) as day
                   FROM srs_cards
                   WHERE last_review != ''
                   ORDER BY day DESC
                   LIMIT 365"""
            )
            rows = await cursor.fetchall()
            days = [row["day"] for row in rows]
        finally:
            await db.close()

        # Calculate streak
        from datetime import datetime, timedelta, timezone
        streak = 0
        if days:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            check_date = datetime.strptime(today, "%Y-%m-%d")

            for i in range(len(days)):
                expected = (check_date - timedelta(days=i)).strftime("%Y-%m-%d")
                if expected in days:
                    streak += 1
                else:
                    # Allow today to be missing (haven't reviewed yet)
                    if i == 0:
                        continue
                    break

        stats["streak_days"] = streak
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add")
async def add_card(req: AddCardRequest):
    """Manually add a new SRS card."""
    if not req.front.strip():
        raise HTTPException(status_code=400, detail="Front side cannot be empty")
    if not req.back.strip():
        raise HTTPException(status_code=400, detail="Back side cannot be empty")

    try:
        card_id = await database.add_srs_card(
            card_type=req.card_type,
            front=req.front.strip(),
            back=req.back.strip(),
            extra=req.extra or "",
        )
        card = await database.get_srs_card(card_id)
        return {"card": card, "message": "Card added successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
