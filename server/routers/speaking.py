from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database
import kimi

router = APIRouter(prefix="/api/speaking", tags=["speaking"])

# Predefined conversation scenarios
SCENARIOS = [
    {
        "id": "daily_chat",
        "name": "Daily Chat",
        "name_cn": "日常闲聊",
        "description": "Casual everyday conversation about life, hobbies, and interests",
        "difficulty": 1,
        "emoji": "💬",
    },
    {
        "id": "job_interview",
        "name": "Job Interview",
        "name_cn": "求职面试",
        "description": "Practice answering common job interview questions",
        "difficulty": 4,
        "emoji": "💼",
    },
    {
        "id": "travel",
        "name": "Travel",
        "name_cn": "旅行出行",
        "description": "Conversations at airports, hotels, and tourist spots",
        "difficulty": 2,
        "emoji": "✈️",
    },
    {
        "id": "business_meeting",
        "name": "Business Meeting",
        "name_cn": "商务会议",
        "description": "Professional discussions, presentations, and negotiations",
        "difficulty": 5,
        "emoji": "📊",
    },
    {
        "id": "restaurant",
        "name": "Restaurant",
        "name_cn": "餐厅点餐",
        "description": "Ordering food, asking about menus, and dining etiquette",
        "difficulty": 2,
        "emoji": "🍽️",
    },
    {
        "id": "shopping",
        "name": "Shopping",
        "name_cn": "购物砍价",
        "description": "Browsing, asking prices, and negotiating deals",
        "difficulty": 2,
        "emoji": "🛍️",
    },
    {
        "id": "doctor_visit",
        "name": "Doctor Visit",
        "name_cn": "看医生",
        "description": "Describing symptoms and understanding medical advice",
        "difficulty": 3,
        "emoji": "🏥",
    },
    {
        "id": "tech_support",
        "name": "Tech Support",
        "name_cn": "技术支持",
        "description": "Troubleshooting technical issues and explaining problems",
        "difficulty": 3,
        "emoji": "🔧",
    },
]


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    scenario: str
    message: str
    history: List[ChatMessage] = []


class SaveRequest(BaseModel):
    scenario: str
    messages: List[ChatMessage]
    score: float = 0
    feedback: Optional[str] = ""


@router.get("/scenarios")
async def get_scenarios():
    """Get list of predefined speaking scenarios."""
    return {"scenarios": SCENARIOS}


@router.post("/chat")
async def chat(req: ChatRequest):
    """Send a message in a speaking scenario and get AI response with evaluation."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Validate scenario
    valid_ids = [s["id"] for s in SCENARIOS]
    if req.scenario not in valid_ids:
        raise HTTPException(status_code=400, detail=f"Invalid scenario. Valid options: {valid_ids}")

    try:
        conversation_history = [{"role": m.role, "content": m.content} for m in req.history]
        result = await kimi.evaluate_speaking(
            scenario=req.scenario,
            user_message=req.message,
            conversation_history=conversation_history,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Kimi API error: {str(e)}")


@router.post("/save")
async def save_conversation(req: SaveRequest):
    """Save a speaking conversation to history."""
    try:
        messages = [{"role": m.role, "content": m.content} for m in req.messages]
        record_id = await database.add_speaking_history(
            scenario=req.scenario,
            messages=messages,
            score=req.score,
            feedback=req.feedback or "",
        )
        return {"id": record_id, "message": "Conversation saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_history():
    """Get speaking history list."""
    try:
        records = await database.list_speaking_history()
        return {"records": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
