"""Sync semantics: auth, idempotency, last-write-wins, honest fallback."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)


def note(uuid, text="de vazut Dune 2", updated_at=NOW, **overrides):
    payload = {
        "uuid": str(uuid),
        "text": text,
        "category_id": None,
        "done": False,
        "deleted_at": None,
        "created_at": NOW.isoformat(),
        "updated_at": updated_at.isoformat(),
        "needs_categorization": True,
    }
    payload.update(overrides)
    return payload


def headers(user):
    return {"X-Api-Key": user["key"]}


async def test_health_needs_no_auth(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": True}


async def test_sync_without_key_is_401(client):
    response = await client.post("/sync", json={"notes": [], "new_categories": []})
    assert response.status_code == 401


async def test_sync_with_unknown_key_is_401(client, users):
    response = await client.post(
        "/sync", json={"notes": []}, headers={"X-Api-Key": "not-a-real-key"}
    )
    assert response.status_code == 401


async def test_note_is_categorized(client, users):
    uid = uuid4()
    response = await client.post(
        "/sync", json={"notes": [note(uid)]}, headers=headers(users["a"])
    )
    assert response.status_code == 200
    body = response.json()

    filme = next(c for c in body["categories"] if c["name"] == "Filme")
    assert body["notes"][0]["category_id"] == filme["id"]
    assert body["notes"][0]["status"] == "synced"
    assert body["notes"][0]["confidence"] == pytest.approx(0.95)


async def test_same_request_twice_creates_no_duplicate(client, users, pool):
    uid = uuid4()
    payload = {"notes": [note(uid)]}

    first = await client.post("/sync", json=payload, headers=headers(users["a"]))
    second = await client.post("/sync", json=payload, headers=headers(users["a"]))

    assert first.json()["notes"][0] == second.json()["notes"][0]
    async with pool.acquire() as connection:
        count = await connection.fetchval(
            "SELECT count(*) FROM notes WHERE uuid = $1", uid
        )
    assert count == 1


async def test_last_write_wins_ignores_stale_retry(client, users, pool):
    uid = uuid4()
    later = NOW + timedelta(minutes=5)

    await client.post(
        "/sync",
        json={"notes": [note(uid, text="versiune noua", updated_at=later,
                             needs_categorization=False)]},
        headers=headers(users["a"]),
    )
    # A retry of the older mutation arrives afterwards and must not win.
    await client.post(
        "/sync",
        json={"notes": [note(uid, text="versiune veche", updated_at=NOW,
                             needs_categorization=False)]},
        headers=headers(users["a"]),
    )

    async with pool.acquire() as connection:
        stored = await connection.fetchval("SELECT text FROM notes WHERE uuid = $1", uid)
    assert stored == "versiune noua"


async def test_editing_text_keeps_the_category_and_skips_the_llm(client, users, pool):
    """Editing a note in the app is an ordinary mutation: the new text lands,
    but the category the note already has is the user's and must survive, and
    a typo fix must not spend seconds of inference on the VM."""
    uid = uuid4()
    created = await client.post(
        "/sync", json={"notes": [note(uid)]}, headers=headers(users["a"])
    )
    category_before = created.json()["notes"][0]["category_id"]

    client.categorizer.calls.clear()
    await client.post(
        "/sync",
        json={"notes": [note(uid, text="de vazut Dune 2 la cinema",
                             updated_at=NOW + timedelta(minutes=1),
                             category_id=category_before,
                             needs_categorization=False)]},
        headers=headers(users["a"]),
    )

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            "SELECT text, category_id FROM notes WHERE uuid = $1", uid
        )
    assert row["text"] == "de vazut Dune 2 la cinema"
    assert row["category_id"] == category_before
    assert client.categorizer.calls == []


async def test_low_confidence_falls_back_to_inbox(client, users):
    client.categorizer.category = "Filme"
    client.categorizer.confidence = 0.2  # below CONFIDENCE_THRESHOLD

    response = await client.post(
        "/sync", json={"notes": [note(uuid4(), text="aaa bbb ccc")]},
        headers=headers(users["a"]),
    )
    body = response.json()
    inbox = next(c for c in body["categories"] if c["is_inbox"])

    assert body["notes"][0]["category_id"] == inbox["id"]
    # Confidence is still recorded — we want to know how unsure it was.
    assert body["notes"][0]["confidence"] == pytest.approx(0.2)


async def test_llm_failure_falls_back_to_inbox(client, users):
    client.categorizer.category = None  # categorizer gave up

    response = await client.post(
        "/sync", json={"notes": [note(uuid4())]}, headers=headers(users["a"])
    )
    body = response.json()
    inbox = next(c for c in body["categories"] if c["is_inbox"])
    assert body["notes"][0]["category_id"] == inbox["id"]
    assert body["notes"][0]["status"] == "synced"


async def test_new_category_is_created_and_mapped(client, users):
    response = await client.post(
        "/sync",
        json={"notes": [], "new_categories": [
            {"local_ref": "tmp-100000", "name": "Carti", "icon": "book"}
        ]},
        headers=headers(users["a"]),
    )
    body = response.json()
    assert "tmp-100000" in body["category_refs"]
    carti = next(c for c in body["categories"] if c["name"] == "Carti")
    assert body["category_refs"]["tmp-100000"] == carti["id"]


async def test_creating_an_existing_category_is_idempotent(client, users):
    payload = {"notes": [], "new_categories": [
        {"local_ref": "tmp-1", "name": "Carti", "icon": "book"}
    ]}
    first = await client.post("/sync", json=payload, headers=headers(users["a"]))
    second = await client.post("/sync", json=payload, headers=headers(users["a"]))

    assert first.json()["category_refs"]["tmp-1"] == second.json()["category_refs"]["tmp-1"]
    names = [c["name"] for c in second.json()["categories"]]
    assert names.count("Carti") == 1


async def test_mutations_propagate(client, users, pool):
    uid = uuid4()
    await client.post("/sync", json={"notes": [note(uid)]}, headers=headers(users["a"]))

    trashed_at = NOW + timedelta(hours=1)
    await client.post(
        "/sync",
        json={"notes": [note(uid, updated_at=trashed_at, done=True,
                             deleted_at=trashed_at.isoformat(),
                             needs_categorization=False)]},
        headers=headers(users["a"]),
    )

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            "SELECT done, deleted_at FROM notes WHERE uuid = $1", uid
        )
    assert row["done"] is True
    assert row["deleted_at"] is not None


async def test_purge_expires_only_past_the_retention_window(client, users, pool):
    """The boundary is the whole contract: the phone runs the same 30-day rule
    locally, so an off-by-one here makes the two sides disagree about what
    still exists."""
    from app.services.sync import purge_expired

    old, recent, live = uuid4(), uuid4(), uuid4()
    now = datetime.now(timezone.utc)

    for uid, deleted_at in (
        (old, now - timedelta(days=31)),
        (recent, now - timedelta(days=29)),
        (live, None),
    ):
        await client.post(
            "/sync",
            json={"notes": [note(uid, deleted_at=deleted_at.isoformat() if deleted_at else None,
                                 needs_categorization=False)]},
            headers=headers(users["a"]),
        )

    async with pool.acquire() as connection:
        removed = await purge_expired(connection, retention_days=30)
        survivors = {
            r["uuid"] for r in await connection.fetch("SELECT uuid FROM notes")
        }

    assert removed == 1
    assert survivors == {recent, live}


async def test_deleted_note_is_not_sent_to_the_llm(client, users):
    client.categorizer.calls.clear()
    await client.post(
        "/sync",
        json={"notes": [note(uuid4(), deleted_at=NOW.isoformat())]},
        headers=headers(users["a"]),
    )
    assert client.categorizer.calls == []


async def test_deleting_a_category_trashes_its_notes(client, users, pool):
    """The category goes for good; its notes land in Inbox, in the trash."""
    filme = await client.post("/sync", json={"notes": []}, headers=headers(users["a"]))
    filme_id = next(c["id"] for c in filme.json()["categories"] if c["name"] == "Filme")

    uid = uuid4()
    await client.post(
        "/sync",
        json={"notes": [note(uid, category_id=filme_id, needs_categorization=False)]},
        headers=headers(users["a"]),
    )

    response = await client.post(
        "/sync",
        json={"notes": [], "deleted_categories": [filme_id]},
        headers=headers(users["a"]),
    )

    names = {c["name"] for c in response.json()["categories"]}
    assert "Filme" not in names

    async with pool.acquire() as connection:
        row = await connection.fetchrow(
            "SELECT category_id, deleted_at FROM notes WHERE uuid = $1", uid
        )
        inbox = await connection.fetchval(
            "SELECT id FROM categories WHERE user_id = $1 AND is_inbox", users["a"]["id"]
        )
    assert row["deleted_at"] is not None
    assert row["category_id"] == inbox


async def test_deleting_a_category_keeps_an_already_trashed_notes_clock(client, users, pool):
    """Re-stamping deleted_at would hand a note another 30 days in the trash."""
    listed = await client.post("/sync", json={"notes": []}, headers=headers(users["a"]))
    filme_id = next(c["id"] for c in listed.json()["categories"] if c["name"] == "Filme")

    uid = uuid4()
    trashed_at = NOW - timedelta(days=20)
    await client.post(
        "/sync",
        json={"notes": [note(uid, category_id=filme_id, needs_categorization=False,
                             deleted_at=trashed_at.isoformat())]},
        headers=headers(users["a"]),
    )
    await client.post(
        "/sync",
        json={"notes": [], "deleted_categories": [filme_id]},
        headers=headers(users["a"]),
    )

    async with pool.acquire() as connection:
        deleted_at = await connection.fetchval(
            "SELECT deleted_at FROM notes WHERE uuid = $1", uid
        )
    assert deleted_at == trashed_at


async def test_inbox_cannot_be_deleted(client, users):
    listed = await client.post("/sync", json={"notes": []}, headers=headers(users["a"]))
    inbox_id = next(c["id"] for c in listed.json()["categories"] if c["is_inbox"])

    response = await client.post(
        "/sync",
        json={"notes": [], "deleted_categories": [inbox_id]},
        headers=headers(users["a"]),
    )

    assert any(c["id"] == inbox_id for c in response.json()["categories"])


async def test_deleting_a_category_twice_is_idempotent(client, users):
    """The phone retries until the id stops coming back; the second one is a no-op."""
    listed = await client.post("/sync", json={"notes": []}, headers=headers(users["a"]))
    filme_id = next(c["id"] for c in listed.json()["categories"] if c["name"] == "Filme")

    first = await client.post(
        "/sync", json={"notes": [], "deleted_categories": [filme_id]},
        headers=headers(users["a"]),
    )
    second = await client.post(
        "/sync", json={"notes": [], "deleted_categories": [filme_id]},
        headers=headers(users["a"]),
    )

    assert second.status_code == 200
    assert first.json()["categories"] == second.json()["categories"]
