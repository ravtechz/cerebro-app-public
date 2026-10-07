"""Configuration, exclusively from the environment / .env.

Nothing here has a secret as its default: an unset DATABASE_URL points at a
local dev database, and the Anthropic key is simply absent unless provided.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://cerebro@localhost/cerebro"

    # Ollama is the default categorizer: it runs on the same VM, costs nothing
    # per note, and keeps note text off third-party infrastructure.
    llm_provider: Literal["ollama", "anthropic"] = "ollama"
    llm_model: str = "gemma3:4b"
    ollama_url: str = "http://localhost:11434"

    # 0.6, not 0.7: gemma3:4b's confidence is compressed, and 0.7 also cuts
    # correct categorisations.
    confidence_threshold: float = 0.6

    # Generous: CPU inference plus a possible cold model load.
    llm_timeout_seconds: float = 60.0
    # Keeps the model resident between sync cycles; without it the first call
    # after a pause pays 10-20s of load.
    ollama_keep_alive: str = "30m"

    anthropic_api_key: str | None = None

    db_pool_min_size: int = 1
    db_pool_max_size: int = 10

    # Must match TRASH_RETENTION_DAYS in the app (mobile/src/types.ts): the two
    # sides purge independently, so a mismatch makes them diverge.
    trash_retention_days: int = 30


@lru_cache
def get_settings() -> Settings:
    return Settings()
