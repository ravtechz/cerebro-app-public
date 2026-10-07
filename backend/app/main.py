"""FastAPI application.

Binds 0.0.0.0:8000; ufw already restricts ingress to tailscale0 (Faza 02).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import db
from .auth import API_KEY_HEADER
from .config import get_settings
from .routes import health, read, sync
from .services.categorizer import build_categorizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    await db.connect()
    app.state.categorizer = build_categorizer(settings)
    logger.info(
        "cerebro-api up (categorizer=%s model=%s threshold=%.2f)",
        app.state.categorizer.name, settings.llm_model, settings.confidence_threshold,
    )
    try:
        yield
    finally:
        await db.disconnect()


app = FastAPI(title="Cerebro API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def require_api_key_header(request: Request, call_next):
    """Reject unauthenticated requests before they reach a handler.

    The per-route dependency is what resolves the user; this is the safety net
    that keeps a newly added route from being reachable without a key by
    omission. It only checks presence — the hash lookup happens in auth.py.
    """
    if request.url.path not in PUBLIC_PATHS and not request.headers.get(API_KEY_HEADER):
        return JSONResponse(
            status_code=401, content={"detail": f"missing {API_KEY_HEADER} header"}
        )
    return await call_next(request)


app.include_router(health.router)
app.include_router(sync.router)
app.include_router(read.router)
