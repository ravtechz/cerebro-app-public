"""The /sync batch: categories in, notes upserted, full state back.

Everything here is scoped by user_id. Two places where that is load-bearing and
easy to get wrong:

  * a note uuid is globally unique, so a uuid that already belongs to another
    user must never be written by this one — see `_foreign_uuids`;
  * an incoming category_id is client-supplied and is only honoured if it
    belongs to this user, otherwise the note falls back to their Inbox.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from uuid import UUID

import asyncpg

from ..auth import User
from ..config import Settings
from ..schemas import (
    CategoryOut,
    SyncNoteIn,
    SyncNoteOut,
    SyncPayload,
    SyncResponse,
)
from .categorizer import CategoryChoice, Categorizer

logger = logging.getLogger(__name__)


async def list_categories(
    connection: asyncpg.Connection, user_id: int
) -> list[CategoryOut]:
    rows = await connection.fetch(
        """
        SELECT id, name, icon, sort_order, is_inbox
        FROM categories
        WHERE user_id = $1
        ORDER BY sort_order ASC, name ASC
        """,
        user_id,
    )
    return [CategoryOut(**dict(row)) for row in rows]


async def inbox_id(connection: asyncpg.Connection, user_id: int) -> int:
    """Every user has exactly one Inbox — 002_one_inbox_per_user.sql enforces it."""
    value = await connection.fetchval(
        "SELECT id FROM categories WHERE user_id = $1 AND is_inbox LIMIT 1",
        user_id,
    )
    if value is None:
        raise RuntimeError(f"user {user_id} has no Inbox category")
    return value


async def _create_categories(
    connection: asyncpg.Connection, user_id: int, payload: SyncPayload
) -> dict[str, int]:
    """Insert the phone's new categories, mapping each local_ref to a real id.

    A name the user already has is not an error — the phone simply learns the
    existing id, which is what makes a retried sync idempotent.
    """
    refs: dict[str, int] = {}
    if not payload.new_categories:
        return refs

    next_order = await connection.fetchval(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE user_id = $1",
        user_id,
    )

    for index, incoming in enumerate(payload.new_categories):
        name = incoming.name.strip()
        if not name:
            continue

        category_id = await connection.fetchval(
            """
            INSERT INTO categories (user_id, name, icon, sort_order)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, name) DO NOTHING
            RETURNING id
            """,
            user_id,
            name,
            incoming.icon,
            next_order + index,
        )
        if category_id is None:
            category_id = await connection.fetchval(
                "SELECT id FROM categories WHERE user_id = $1 AND name = $2",
                user_id,
                name,
            )
        if category_id is not None:
            refs[incoming.local_ref] = category_id

    return refs


async def _delete_categories(
    connection: asyncpg.Connection, user_id: int, ids: list[int]
) -> list[int]:
    """Drop the categories the phone deleted, trashing the notes they held.

    Scoped by user_id and filtered through the database, so an id belonging to
    somebody else simply does not match — this endpoint can never reach across
    users. Inbox is excluded for the same reason the phone refuses it: it is
    where these notes land, and 002_one_inbox_per_user.sql makes it structural.

    The notes are soft-deleted rather than dropped. notes.category_id is
    NOT NULL REFERENCES categories(id), so they need somewhere to point, and
    parking them in Inbox with deleted_at set matches what the phone does — the
    30-day purge collects them from there, on both sides, as usual.

    An already-trashed note keeps its original deleted_at: re-stamping it would
    restart its retention clock.
    """
    if not ids:
        return []

    owned = [
        row["id"]
        for row in await connection.fetch(
            """
            SELECT id FROM categories
            WHERE id = ANY($1::int[]) AND user_id = $2 AND NOT is_inbox
            """,
            ids,
            user_id,
        )
    ]
    if not owned:
        return []

    fallback_id = await inbox_id(connection, user_id)
    await connection.execute(
        """
        UPDATE notes
           SET category_id = $1,
               deleted_at = COALESCE(deleted_at, now()),
               updated_at = now(),
               server_received_at = now()
         WHERE user_id = $2 AND category_id = ANY($3::int[])
        """,
        fallback_id,
        user_id,
        owned,
    )
    await connection.execute(
        "DELETE FROM categories WHERE id = ANY($1::int[]) AND user_id = $2",
        owned,
        user_id,
    )
    return owned


async def _foreign_uuids(
    connection: asyncpg.Connection, user_id: int, uuids: list[UUID]
) -> set[UUID]:
    """Note uuids in this batch that already belong to somebody else."""
    if not uuids:
        return set()
    rows = await connection.fetch(
        "SELECT uuid FROM notes WHERE uuid = ANY($1::uuid[]) AND user_id <> $2",
        uuids,
        user_id,
    )
    return {row["uuid"] for row in rows}


async def _resolve_category(
    note: SyncNoteIn,
    valid_ids: set[int],
    fallback_id: int,
    categorizer: Categorizer,
    choices: list[CategoryChoice],
    threshold: float,
) -> tuple[int, float | None]:
    """Decide where a note lands, and how sure we are.

    Honest fallback: an unusable answer — no answer, a timeout, or confidence
    below the threshold — sends the note to Inbox with the confidence recorded
    anyway. A surviving note beats a perfectly categorised one.
    """
    if note.category_id is not None and note.category_id in valid_ids:
        return note.category_id, None

    if not note.needs_categorization or note.deleted_at is not None:
        return fallback_id, None

    result = await categorizer.categorize(note.text, choices)
    if result is None:
        return fallback_id, None

    if result.confidence < threshold:
        return fallback_id, result.confidence

    chosen = next((c.id for c in choices if c.name == result.category), fallback_id)
    return chosen, result.confidence


async def run_sync(
    connection: asyncpg.Connection,
    user: User,
    payload: SyncPayload,
    categorizer: Categorizer,
    settings: Settings,
) -> SyncResponse:
    started = time.perf_counter()

    # Deletions first, so the list the LLM chooses from never contains a
    # category that is going away in this same request.
    deleted = await _delete_categories(connection, user.id, payload.deleted_categories)
    refs = await _create_categories(connection, user.id, payload)

    categories = await list_categories(connection, user.id)
    fallback_id = await inbox_id(connection, user.id)
    valid_ids = {category.id for category in categories}
    choices = [CategoryChoice(id=c.id, name=c.name) for c in categories]

    foreign = await _foreign_uuids(
        connection, user.id, [note.uuid for note in payload.notes]
    )

    results: list[SyncNoteOut] = []
    categorized = 0

    for note in payload.notes:
        if note.uuid in foreign:
            # Belongs to another user; refuse rather than overwrite.
            logger.warning(
                "user %s tried to write note %s owned by another user",
                user.id,
                note.uuid,
            )
            results.append(
                SyncNoteOut(
                    uuid=note.uuid, category_id=fallback_id, confidence=None,
                    status="error",
                )
            )
            continue

        category_id, confidence = await _resolve_category(
            note, valid_ids, fallback_id, categorizer, choices,
            settings.confidence_threshold,
        )
        if note.needs_categorization and note.deleted_at is None:
            categorized += 1

        await connection.execute(
            """
            INSERT INTO notes (uuid, user_id, text, category_id, confidence,
                               done, deleted_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (uuid) DO UPDATE SET
                text = EXCLUDED.text,
                category_id = EXCLUDED.category_id,
                confidence = EXCLUDED.confidence,
                done = EXCLUDED.done,
                deleted_at = EXCLUDED.deleted_at,
                updated_at = EXCLUDED.updated_at,
                server_received_at = now()
            WHERE notes.user_id = EXCLUDED.user_id
              AND EXCLUDED.updated_at > notes.updated_at
            """,
            note.uuid, user.id, note.text, category_id, confidence,
            note.done, note.deleted_at, note.created_at, note.updated_at,
        )

        # The upsert is last-write-wins, so a stale retry changes nothing. Read
        # back what actually stands, so the phone converges on the server.
        stored = await connection.fetchrow(
            "SELECT category_id, confidence FROM notes WHERE uuid = $1 AND user_id = $2",
            note.uuid, user.id,
        )
        results.append(
            SyncNoteOut(
                uuid=note.uuid,
                category_id=stored["category_id"] if stored else category_id,
                confidence=stored["confidence"] if stored else confidence,
                status="synced",
            )
        )

    # Categories may have changed (new ones created); re-read for the response.
    categories = await list_categories(connection, user.id)

    logger.info(
        "sync user=%s notes=%d categorized=%d new_categories=%d "
        "deleted_categories=%d duration_ms=%d",
        user.id, len(payload.notes), categorized, len(refs), len(deleted),
        int((time.perf_counter() - started) * 1000),
    )

    return SyncResponse(notes=results, categories=categories, category_refs=refs)


async def purge_expired(connection: asyncpg.Connection, retention_days: int = 30) -> int:
    """Delete trashed notes past the retention window, for every user.

    The phone runs the identical purge locally, which is why deletions do not
    need to travel over /sync.
    """
    # Both casts are load-bearing. Without them Postgres has no type to infer $1
    # from, resolves `$1 - make_interval(...)` as interval minus interval, and
    # the comparison dies with "operator does not exist: timestamp with time
    # zone < interval". This went unnoticed because nothing called the function
    # until the purge timer existed.
    cutoff = datetime.now(timezone.utc)
    result = await connection.execute(
        "DELETE FROM notes WHERE deleted_at IS NOT NULL "
        "AND deleted_at < $1::timestamptz - make_interval(days => $2::int)",
        cutoff, retention_days,
    )
    return int(result.split()[-1])
