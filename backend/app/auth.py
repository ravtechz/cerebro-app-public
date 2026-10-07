"""X-Api-Key authentication.

No accounts, passwords or OAuth: each user has one static key. The server never
stores the key itself — only sha256(key), which is what `users.api_key_hash`
holds. An unknown key is a 401.

Every authenticated handler receives the resolved `User` and MUST scope its
queries by `user.id`. That is the single invariant the Faza 04 tests exist to
protect.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from .db import acquire

API_KEY_HEADER = "X-Api-Key"


@dataclass(frozen=True)
class User:
    id: int
    name: str


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


async def get_current_user(
    x_api_key: Annotated[str | None, Header(alias=API_KEY_HEADER)] = None,
) -> User:
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"missing {API_KEY_HEADER} header",
        )

    async with acquire() as connection:
        row = await connection.fetchrow(
            "SELECT id, name FROM users WHERE api_key_hash = $1",
            hash_api_key(x_api_key),
        )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="unknown api key"
        )

    return User(id=row["id"], name=row["name"])


CurrentUser = Annotated[User, Depends(get_current_user)]
