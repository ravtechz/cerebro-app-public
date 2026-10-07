"""Unauthenticated liveness probe, for monitoring."""

from __future__ import annotations

from fastapi import APIRouter

from .. import db
from ..schemas import HealthOut

router = APIRouter()


@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    ok = await db.healthy()
    return HealthOut(status="ok" if ok else "degraded", db=ok)
