from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsRequest(BaseModel):
    kimi_api_key: Optional[str] = None
    daily_goal: Optional[int] = None
    level: Optional[str] = None


def mask_api_key(key: str) -> str:
    """Mask API key, showing only last 4 characters."""
    if not key:
        return ""
    if len(key) <= 4:
        return "****"
    return "*" * (len(key) - 4) + key[-4:]


@router.get("")
async def get_settings():
    """Get current settings with masked API key."""
    try:
        settings = await database.get_all_settings()

        # Mask the API key
        result = dict(settings)
        if "kimi_api_key" in result:
            result["kimi_api_key"] = mask_api_key(result["kimi_api_key"])
            result["kimi_api_key_configured"] = bool(settings.get("kimi_api_key"))
        else:
            # Check env var
            env_key = os.environ.get("KIMI_API_KEY", "")
            result["kimi_api_key"] = mask_api_key(env_key) if env_key else ""
            result["kimi_api_key_configured"] = bool(env_key)

        # Set defaults for missing values
        if "daily_goal" not in result:
            result["daily_goal"] = "20"
        if "level" not in result:
            result["level"] = "intermediate"

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def save_settings(req: SettingsRequest):
    """Save settings."""
    try:
        if req.kimi_api_key is not None:
            await database.set_setting("kimi_api_key", req.kimi_api_key.strip())
        if req.daily_goal is not None:
            if req.daily_goal < 1 or req.daily_goal > 500:
                raise HTTPException(status_code=400, detail="Daily goal must be between 1 and 500")
            await database.set_setting("daily_goal", str(req.daily_goal))
        if req.level is not None:
            valid_levels = ["beginner", "elementary", "intermediate", "upper_intermediate", "advanced"]
            if req.level not in valid_levels:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid level. Valid options: {valid_levels}"
                )
            await database.set_setting("level", req.level)

        return {"message": "Settings saved successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
