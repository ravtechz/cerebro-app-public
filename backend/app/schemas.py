"""Wire types for the JSON API.

Field names are snake_case and mirror `mobile/src/api/types.ts` exactly — that
file is the client half of the same contract.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SyncNoteIn(BaseModel):
    uuid: UUID
    text: str
    category_id: int | None = None
    done: bool = False
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    needs_categorization: bool = False


class SyncCategoryIn(BaseModel):
    local_ref: str
    name: str
    icon: str = "category"


class SyncPayload(BaseModel):
    notes: list[SyncNoteIn] = Field(default_factory=list)
    new_categories: list[SyncCategoryIn] = Field(default_factory=list)
    # Categories deleted on the phone. Ids this user does not own are ignored
    # rather than refused, so an old client and a retried batch both stay
    # harmless. Absence from SyncResponse.categories is the acknowledgement.
    deleted_categories: list[int] = Field(default_factory=list)


class SyncNoteOut(BaseModel):
    uuid: UUID
    category_id: int
    confidence: float | None = None
    status: Literal["synced", "error"] = "synced"


class CategoryOut(BaseModel):
    id: int
    name: str
    icon: str
    sort_order: int
    is_inbox: bool = False


class SyncResponse(BaseModel):
    notes: list[SyncNoteOut]
    # Always the user's full current list, so the phone's sidebar converges even
    # for categories created on another device.
    categories: list[CategoryOut]
    category_refs: dict[str, int] = Field(default_factory=dict)


class NoteOut(BaseModel):
    uuid: UUID
    text: str
    category_id: int
    confidence: float | None
    done: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class NoteListOut(BaseModel):
    notes: list[NoteOut]
    limit: int
    offset: int


class HealthOut(BaseModel):
    status: str
    db: bool
