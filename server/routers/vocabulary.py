from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database

router = APIRouter(prefix="/api/vocabulary", tags=["vocabulary"])


class AddVocabRequest(BaseModel):
    word: str
    phonetic: Optional[str] = ""
    definition: Optional[str] = ""
    definition_cn: Optional[str] = ""
    example_sentence: Optional[str] = ""
    difficulty: Optional[int] = 3


class UpdateVocabRequest(BaseModel):
    word: Optional[str] = None
    phonetic: Optional[str] = None
    definition: Optional[str] = None
    definition_cn: Optional[str] = None
    example_sentence: Optional[str] = None
    context: Optional[str] = None
    difficulty: Optional[int] = None
    mastery: Optional[float] = None


@router.get("")
async def list_vocabulary(
    search: str = Query(default="", description="Search term"),
    sort_by: str = Query(default="created_at", description="Sort field: mastery, created_at, difficulty"),
):
    """List all vocabulary with optional search and sorting."""
    try:
        words = await database.list_vocabulary(search=search, sort_by=sort_by)
        return {"words": words, "total": len(words)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def add_vocabulary(req: AddVocabRequest):
    """Add a new vocabulary word and auto-create an SRS card."""
    if not req.word.strip():
        raise HTTPException(status_code=400, detail="Word cannot be empty")

    word = req.word.strip()

    # Check if word already exists
    existing = await database.get_vocabulary_by_word(word)
    if existing:
        raise HTTPException(status_code=409, detail=f"Word '{word}' already exists")

    try:
        vocab_id = await database.add_vocabulary(
            word=word,
            phonetic=req.phonetic or "",
            definition=req.definition or "",
            definition_cn=req.definition_cn or "",
            example_sentence=req.example_sentence or "",
            difficulty=req.difficulty or 3,
        )

        # Auto-create SRS card
        back = req.definition or ""
        if req.definition_cn:
            back += f"\n{req.definition_cn}" if back else req.definition_cn
        if not back:
            back = word  # fallback

        await database.add_srs_card(
            card_type="word",
            front=word,
            back=back,
            extra=req.example_sentence or "",
        )

        vocab = await database.get_vocabulary_by_id(vocab_id)
        return {"word": vocab, "message": "Word added successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{vocab_id}")
async def delete_vocabulary(vocab_id: int):
    """Delete a vocabulary word and its associated SRS card."""
    try:
        vocab = await database.get_vocabulary_by_id(vocab_id)
        if not vocab:
            raise HTTPException(status_code=404, detail="Word not found")

        # Delete associated SRS card
        await database.delete_srs_card_by_front(vocab["word"])

        # Delete the vocabulary entry
        await database.delete_vocabulary(vocab_id)

        return {"message": f"Word '{vocab['word']}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{vocab_id}")
async def update_vocabulary(vocab_id: int, req: UpdateVocabRequest):
    """Update a vocabulary word's information."""
    try:
        vocab = await database.get_vocabulary_by_id(vocab_id)
        if not vocab:
            raise HTTPException(status_code=404, detail="Word not found")

        # Build update fields from non-None values
        fields = {}
        if req.word is not None:
            fields["word"] = req.word.strip()
        if req.phonetic is not None:
            fields["phonetic"] = req.phonetic
        if req.definition is not None:
            fields["definition"] = req.definition
        if req.definition_cn is not None:
            fields["definition_cn"] = req.definition_cn
        if req.example_sentence is not None:
            fields["example_sentence"] = req.example_sentence
        if req.context is not None:
            fields["context"] = req.context
        if req.difficulty is not None:
            fields["difficulty"] = req.difficulty
        if req.mastery is not None:
            fields["mastery"] = req.mastery

        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")

        # If word is being renamed, update SRS card too
        if "word" in fields and fields["word"] != vocab["word"]:
            card = await database.get_srs_card_by_front(vocab["word"])
            if card:
                await database.update_srs_card(card["id"], front=fields["word"])

        await database.update_vocabulary(vocab_id, **fields)
        updated = await database.get_vocabulary_by_id(vocab_id)
        return {"word": updated, "message": "Word updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
