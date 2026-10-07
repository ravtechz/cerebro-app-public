"""Read-only endpoints for the Faza 06 web page. Scoped by user, like everything else."""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..auth import CurrentUser
from ..db import acquire
from ..schemas import CategoryOut, NoteListOut, NoteOut
from ..services.sync import list_categories

router = APIRouter()


@router.get("/categories", response_model=list[CategoryOut])
async def get_categories(user: CurrentUser) -> list[CategoryOut]:
    async with acquire() as connection:
        return await list_categories(connection, user.id)


@router.get("/notes", response_model=NoteListOut)
async def get_notes(
    user: CurrentUser,
    category_id: int | None = None,
    include_done: bool = True,
    trash: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> NoteListOut:
    filters = ["user_id = $1"]
    params: list[object] = [user.id]

    filters.append("deleted_at IS NOT NULL" if trash else "deleted_at IS NULL")
    if category_id is not None:
        params.append(category_id)
        filters.append(f"category_id = ${len(params)}")
    if not include_done:
        filters.append("done = FALSE")

    params.extend([limit, offset])
    query = (
        "SELECT uuid, text, category_id, confidence, done, deleted_at, created_at, updated_at "
        f"FROM notes WHERE {' AND '.join(filters)} "
        f"ORDER BY created_at DESC LIMIT ${len(params) - 1} OFFSET ${len(params)}"
    )

    async with acquire() as connection:
        rows = await connection.fetch(query, *params)

    return NoteListOut(
        notes=[NoteOut(**dict(row)) for row in rows], limit=limit, offset=offset
    )
