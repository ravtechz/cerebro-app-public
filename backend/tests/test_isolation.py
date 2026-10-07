"""User isolation — the invariant the whole multi-user model rests on.

User A must not see, touch, or borrow anything belonging to user B, even by
accident and even when A sends a deliberately hostile payload.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)


def note(uuid, **overrides):
    payload = {
        "uuid": str(uuid),
        "text": "de vazut Dune 2",
        "category_id": None,
        "done": False,
        "deleted_at": None,
        "created_at": NOW.isoformat(),
        "updated_at": NOW.isoformat(),
        "needs_categorization": True,
    }
    payload.update(overrides)
    return payload


def headers(user):
    return {"X-Api-Key": user["key"]}


async def test_sync_returns_only_own_categories(client, users):
    """B was provisioned with --minimal: Inbox only. A's four must not leak."""
    response = await client.post("/sync", json={"notes": []}, headers=headers(users["b"]))
    names = {c["name"] for c in response.json()["categories"]}
    assert names == {"Inbox"}


async def test_notes_endpoint_is_scoped_to_the_owner(client, users):
    await client.post(
        "/sync", json={"notes": [note(uuid4(), text="secretul lui A")]},
        headers=headers(users["a"]),
    )

    mine = await client.get("/notes", headers=headers(users["a"]))
    theirs = await client.get("/notes", headers=headers(users["b"]))

    assert len(mine.json()["notes"]) == 1
    assert theirs.json()["notes"] == []


async def test_categories_endpoint_is_scoped_to_the_owner(client, users):
    response = await client.get("/categories", headers=headers(users["b"]))
    assert [c["name"] for c in response.json()] == ["Inbox"]


async def test_note_cannot_be_filed_under_another_users_category(client, users):
    """A sends B's category_id. It must be ignored, not honoured."""
    b_categories = await client.get("/categories", headers=headers(users["b"]))
    b_inbox_id = b_categories.json()[0]["id"]

    response = await client.post(
        "/sync",
        json={"notes": [note(uuid4(), category_id=b_inbox_id,
                             needs_categorization=False)]},
        headers=headers(users["a"]),
    )
    body = response.json()
    a_category_ids = {c["id"] for c in body["categories"]}

    assert body["notes"][0]["category_id"] != b_inbox_id
    assert body["notes"][0]["category_id"] in a_category_ids


async def test_user_cannot_overwrite_another_users_note(client, users, pool):
    """A note uuid is globally unique — B must not be able to hijack A's row."""
    uid = uuid4()
    await client.post(
        "/sync", json={"notes": [note(uid, text="nota lui A")]},
        headers=headers(users["a"]),
    )

    response = await client.post(
        "/sync",
        json={"notes": [note(uid, text="suprascris de B",
                             updated_at="2027-01-01T00:00:00+00:00")]},
        headers=headers(users["b"]),
    )

    assert response.json()["notes"][0]["status"] == "error"
    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            "SELECT text, user_id FROM notes WHERE uuid = $1", uid
        )
    assert row["text"] == "nota lui A"
    assert row["user_id"] == users["a"]["id"]


async def test_same_category_name_for_two_users_stays_separate(client, users):
    payload = {"notes": [], "new_categories": [
        {"local_ref": "tmp-1", "name": "Carti", "icon": "book"}
    ]}
    a = await client.post("/sync", json=payload, headers=headers(users["a"]))
    b = await client.post("/sync", json=payload, headers=headers(users["b"]))

    assert a.json()["category_refs"]["tmp-1"] != b.json()["category_refs"]["tmp-1"]


async def test_user_cannot_delete_another_users_category(client, users, pool):
    """A's ids mean nothing in B's request — the filter is user_id, not the id."""
    listed = await client.post("/sync", json={"notes": []}, headers=headers(users["a"]))
    filme_id = next(c["id"] for c in listed.json()["categories"] if c["name"] == "Filme")

    uid = uuid4()
    await client.post(
        "/sync",
        json={"notes": [note(uid, category_id=filme_id, needs_categorization=False)]},
        headers=headers(users["a"]),
    )

    response = await client.post(
        "/sync", json={"notes": [], "deleted_categories": [filme_id]},
        headers=headers(users["b"]),
    )

    assert response.status_code == 200
    async with pool.acquire() as connection:
        survives = await connection.fetchval(
            "SELECT COUNT(*) FROM categories WHERE id = $1", filme_id
        )
        note_row = await connection.fetchrow(
            "SELECT category_id, deleted_at FROM notes WHERE uuid = $1", uid
        )
    assert survives == 1
    assert note_row["category_id"] == filme_id
    assert note_row["deleted_at"] is None
