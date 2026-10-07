#!/usr/bin/env python3
"""Provision a Cerebro user: API key + default categories (Faza 03, pas 2b).

Runs on the VM, against the local Postgres. Prints the plain API key exactly
once — it is never stored, only its sha256 hash lands in `users.api_key_hash`.

    python3 create_user.py --name alice
    python3 create_user.py --name bob --minimal

Connection string comes from --dsn, then $DATABASE_URL, then a `.env` sitting
next to this script (or in its parent), then the localhost default.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import secrets
import sys
from pathlib import Path

import asyncpg

DEFAULT_DSN = "postgresql://cerebro@localhost/cerebro"

# (name, icon, sort_order, is_inbox) — icons mirror the mobile seed in
# mobile/src/db/client.ts so a fresh phone and a fresh user agree.
INBOX_CATEGORY = ("Inbox", "inbox", 0, True)
DEFAULT_CATEGORIES = [
    ("Idei YouTube", "smart_display", 1, False),
    ("Filme", "movie", 2, False),
    ("Todos", "check_circle", 3, False),
]


def load_dsn(cli_dsn: str | None) -> str:
    if cli_dsn:
        return cli_dsn
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]

    here = Path(__file__).resolve().parent
    for env_file in (here / ".env", here.parent / ".env"):
        if not env_file.is_file():
            continue
        for raw in env_file.read_text().splitlines():
            line = raw.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return DEFAULT_DSN


async def create_user(dsn: str, name: str, minimal: bool) -> tuple[int, str, list[str]]:
    """Insert the user and their categories in one transaction.

    Returns (user_id, plain_api_key, category_names). Raises ValueError if the
    name is already taken — provisioning is meant to be an explicit one-shot.
    """
    api_key = secrets.token_urlsafe(32)
    api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()

    categories = [INBOX_CATEGORY] if minimal else [INBOX_CATEGORY, *DEFAULT_CATEGORIES]

    conn = await asyncpg.connect(dsn)
    try:
        async with conn.transaction():
            if await conn.fetchval("SELECT 1 FROM users WHERE name = $1", name):
                raise ValueError(f"user '{name}' already exists")

            user_id = await conn.fetchval(
                "INSERT INTO users (name, api_key_hash) VALUES ($1, $2) RETURNING id",
                name,
                api_key_hash,
            )
            await conn.executemany(
                """
                INSERT INTO categories (user_id, name, icon, sort_order, is_inbox)
                VALUES ($1, $2, $3, $4, $5)
                """,
                [(user_id, *category) for category in categories],
            )
    finally:
        await conn.close()

    return user_id, api_key, [category[0] for category in categories]


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a Cerebro user and their categories.")
    parser.add_argument("--name", required=True, help="user name, unique (e.g. alice)")
    parser.add_argument(
        "--minimal",
        action="store_true",
        help="create only the Inbox category instead of the default set",
    )
    parser.add_argument("--dsn", help="Postgres connection string (overrides $DATABASE_URL)")
    args = parser.parse_args()

    name = args.name.strip()
    if not name:
        print("error: --name cannot be empty", file=sys.stderr)
        return 2

    try:
        user_id, api_key, categories = asyncio.run(create_user(load_dsn(args.dsn), name, args.minimal))
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except (asyncpg.PostgresError, OSError) as exc:
        print(f"error: database: {exc}", file=sys.stderr)
        return 1

    print(f"user '{name}' created (id {user_id})")
    print(f"categories: {', '.join(categories)}")
    print()
    print("API KEY (shown once, paste it in Settings on the phone):")
    print(f"  {api_key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
