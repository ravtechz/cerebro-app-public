"""Trash retention job: `python -m app.purge`.

Run by cerebro-purge.timer once a day, not by the API process. The phone runs
the identical purge locally at startup (mobile/src/db/client.ts), which is why
deletions never travel over /sync — both sides expire the same rows on their own.

Deliberately a separate entrypoint rather than a hook on /sync: tying cleanup to
traffic means a month without syncing is a month without cleanup.
"""

from __future__ import annotations

import asyncio
import logging

from . import db
from .config import get_settings
from .services.sync import purge_expired

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("cerebro-purge")


async def main() -> None:
    settings = get_settings()
    await db.connect()
    try:
        async with db.acquire() as connection:
            removed = await purge_expired(connection, settings.trash_retention_days)
        logger.info(
            "purged %d note(s) trashed more than %d days ago",
            removed, settings.trash_retention_days,
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
