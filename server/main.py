import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Ensure the server directory is in the path
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SERVER_DIR)

import database
from routers import reading, srs, listening, speaking, vocabulary, settings, daily


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize DB on startup."""
    await database.init_db()
    yield


app = FastAPI(
    title="English AI Workbench",
    description="AI-powered English learning workbench with reading, speaking, listening, and SRS features",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(reading.router)
app.include_router(srs.router)
app.include_router(listening.router)
app.include_router(speaking.router)
app.include_router(vocabulary.router)
app.include_router(settings.router)
app.include_router(daily.router)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


# Mount static files LAST so API routes take priority
static_dir = os.path.join(SERVER_DIR, "..", "static")
static_dir = os.path.abspath(static_dir)
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
