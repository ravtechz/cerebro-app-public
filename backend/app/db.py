"""asyncpg connection pool. Plain SQL, no ORM.

The pool is created on startup and stored on the FastAPI app state; `get_pool`
is what routes and services depend on.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg

from .config import get_settings

_pool: asyncpg.Pool | None = None


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
        )
    return _pool


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("database pool is not initialised")
    return _pool


@asynccontextmanager
async def acquire() -> AsyncIterator[asyncpg.Connection]:
    async with get_pool().acquire() as connection:
        yield connection


async def healthy() -> bool:
    """Used by /health — a failure here is reported, never raised."""
    try:
        async with acquire() as connection:
            await connection.fetchval("SELECT 1")
        return True
    except Exception:
        return False
