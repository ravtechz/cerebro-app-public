"""POST /sync — the endpoint the mobile worker talks to."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..auth import CurrentUser
from ..config import get_settings
from ..db import acquire
from ..schemas import SyncPayload, SyncResponse
from ..services.sync import run_sync

router = APIRouter()


@router.post("/sync", response_model=SyncResponse)
async def sync(payload: SyncPayload, user: CurrentUser, request: Request) -> SyncResponse:
    categorizer = request.app.state.categorizer
    async with acquire() as connection:
        # One transaction per sync: a batch either lands whole or not at all.
        async with connection.transaction():
            return await run_sync(connection, user, payload, categorizer, get_settings())
