"""Test fixtures.

These tests need a real PostgreSQL — the behaviours under test (upsert
idempotency, last-write-wins, cross-user isolation) are SQL semantics, and a
mocked database would prove nothing. The LLM, by contrast, is always faked.

    docker run -d --name cerebro-test -p 55432:5432 \
      -e POSTGRES_USER=cerebro -e POSTGRES_PASSWORD=test -e POSTGRES_DB=cerebro postgres:18
    export TEST_DATABASE_URL=postgresql://cerebro:test@localhost:55432/cerebro
    pytest
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Sequence

import asyncpg
import pytest
import pytest_asyncio

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
MIGRATIONS = sorted((Path(__file__).resolve().parents[2] / "db" / "migrations").glob("*.sql"))

pytestmark = pytest.mark.asyncio

# Point the app at the test database before anything imports the settings.
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL


def requires_db() -> None:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not set; see tests/conftest.py")


class FakeCategorizer:
    """Stands in for the LLM. Deterministic, and records what it was asked."""

    name = "fake"

    def __init__(self, category: str | None = None, confidence: float = 0.95) -> None:
        self.category = category
        self.confidence = confidence
        self.calls: list[str] = []

    async def categorize(self, text: str, choices: Sequence[object]):
        from app.services.categorizer import Categorization

        self.calls.append(text)
        if self.category is None:
            return None
        return Categorization(category=self.category, confidence=self.confidence)


@pytest_asyncio.fixture
async def pool() -> asyncpg.Pool:
    requires_db()
    from app import db as db_module
    from app.config import get_settings

    get_settings.cache_clear()
    await db_module.disconnect()
    pool = await db_module.connect()

    async with pool.acquire() as connection:
        await connection.execute(
            "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
        )
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text())

    yield pool
    await db_module.disconnect()


async def _create_user(pool: asyncpg.Pool, name: str, minimal: bool = False):
    """Mirrors scripts/create_user.py: a user plus their default categories."""
    from app.auth import hash_api_key

    api_key = secrets.token_urlsafe(16)
    async with pool.acquire() as connection:
        user_id = await connection.fetchval(
            "INSERT INTO users (name, api_key_hash) VALUES ($1, $2) RETURNING id",
            name, hash_api_key(api_key),
        )
        categories = [("Inbox", "inbox", 0, True)]
        if not minimal:
            categories += [
                ("Idei YouTube", "smart_display", 1, False),
                ("Filme", "movie", 2, False),
                ("Todos", "check_circle", 3, False),
            ]
        for cname, icon, order, is_inbox in categories:
            await connection.execute(
                "INSERT INTO categories (user_id, name, icon, sort_order, is_inbox) "
                "VALUES ($1, $2, $3, $4, $5)",
                user_id, cname, icon, order, is_inbox,
            )
    return {"id": user_id, "name": name, "key": api_key}


@pytest_asyncio.fixture
async def users(pool: asyncpg.Pool) -> dict[str, dict]:
    return {
        "a": await _create_user(pool, "alice"),
        "b": await _create_user(pool, "bob", minimal=True),
    }


@pytest_asyncio.fixture
async def client(pool: asyncpg.Pool):
    """httpx client wired straight to the ASGI app — no network, no uvicorn."""
    import httpx
    from app.main import app

    categorizer = FakeCategorizer(category="Filme", confidence=0.95)
    app.state.categorizer = categorizer

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as http_client:
        http_client.categorizer = categorizer  # type: ignore[attr-defined]
        yield http_client
