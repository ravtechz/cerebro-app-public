"""LLM categorisation, behind one interface with two implementations.

Default is Ollama running locally on the same VM (`gemma3:4b`). Anthropic
(Haiku) is the fallback if the local model disappoints in production. Switching
provider is one env var, `LLM_PROVIDER` — no call site changes.

The contract every implementation obeys:

  * it picks a name from the caller's list and never invents one;
  * an invalid or unparseable answer gets exactly one retry, then gives up;
  * giving up returns None. It never raises, because a sync must not fail
    because the LLM did.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Protocol, Sequence

import httpx
from pydantic import BaseModel, Field, ValidationError

from ..config import Settings, get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a note categorizer. You are given a note and a list of categories.

Rules:
- Answer with STRICT JSON only: {"category": "<exact name from the list>", "confidence": <0.0-1.0>}
- The category MUST be copied exactly from the list. Never invent a category.
- If the note does not clearly belong to any category, answer "Inbox" with a low confidence.
- confidence is how certain you are, from 0.0 to 1.0."""


class Categorization(BaseModel):
    """What the model is allowed to say back."""

    category: str
    confidence: float = Field(ge=0.0, le=1.0)


@dataclass(frozen=True)
class CategoryChoice:
    id: int
    name: str


class Categorizer(Protocol):
    name: str

    async def categorize(
        self, text: str, choices: Sequence[CategoryChoice]
    ) -> Categorization | None: ...


def _build_prompt(text: str, choices: Sequence[CategoryChoice]) -> str:
    listing = "\n".join(f"- {choice.name}" for choice in choices)
    return f"Categories:\n{listing}\n\nNote:\n{text}"


def _validate(raw: str, choices: Sequence[CategoryChoice]) -> Categorization | None:
    """Parse the model's answer and hold it to the caller's category list.

    A name that is not in the list is treated as a failed answer rather than
    silently coerced — inventing a category is exactly what must not happen.
    """
    try:
        parsed = Categorization.model_validate_json(raw)
    except ValidationError:
        # Some models wrap JSON in prose or fences despite being told not to.
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            parsed = Categorization.model_validate_json(raw[start : end + 1])
        except ValidationError:
            return None

    by_name = {choice.name.casefold(): choice.name for choice in choices}
    canonical = by_name.get(parsed.category.strip().casefold())
    if canonical is None:
        logger.warning("categorizer returned unknown category %r", parsed.category)
        return None

    return Categorization(category=canonical, confidence=parsed.confidence)


class OllamaCategorizer:
    """Local gemma3:4b over Ollama's HTTP API.

    One call per note, sequentially: the model is small, long category lists in
    a shared prompt hurt its accuracy, and on CPU there is no useful parallelism
    to win anyway.
    """

    name = "ollama"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def categorize(
        self, text: str, choices: Sequence[CategoryChoice]
    ) -> Categorization | None:
        if not choices:
            return None

        payload = {
            "model": self._settings.llm_model,
            "system": SYSTEM_PROMPT,
            "prompt": _build_prompt(text, choices),
            # Forced, because gemma3:4b otherwise wraps the answer in ```json fences.
            "format": "json",
            "stream": False,
            "keep_alive": self._settings.ollama_keep_alive,
            "options": {"temperature": 0},
        }

        for attempt in (1, 2):
            try:
                async with httpx.AsyncClient(
                    timeout=self._settings.llm_timeout_seconds
                ) as client:
                    response = await client.post(
                        f"{self._settings.ollama_url.rstrip('/')}/api/generate",
                        json=payload,
                    )
                    response.raise_for_status()
                    body = response.json()
            except (httpx.HTTPError, json.JSONDecodeError) as exc:
                logger.warning("ollama call failed (attempt %d): %s", attempt, exc)
                continue

            result = _validate(body.get("response", ""), choices)
            if result is not None:
                return result
            logger.warning("ollama returned an invalid answer (attempt %d)", attempt)

        return None


class AnthropicCategorizer:
    """Hosted fallback on Claude Haiku.

    Uses structured outputs with the category names as a schema `enum`, so the
    "never invent a category" rule is enforced by the API rather than hoped for.
    """

    name = "anthropic"

    def __init__(self, settings: Settings) -> None:
        if not settings.anthropic_api_key:
            raise RuntimeError("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY")
        # Imported lazily so the package stays optional for Ollama-only installs.
        from anthropic import AsyncAnthropic

        self._settings = settings
        self._client = AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.llm_timeout_seconds,
        )

    async def categorize(
        self, text: str, choices: Sequence[CategoryChoice]
    ) -> Categorization | None:
        if not choices:
            return None

        schema = {
            "type": "object",
            "properties": {
                "category": {"type": "string", "enum": [c.name for c in choices]},
                "confidence": {"type": "number"},
            },
            "required": ["category", "confidence"],
            "additionalProperties": False,
        }

        for attempt in (1, 2):
            try:
                message = await self._client.messages.create(
                    model=self._settings.llm_model,
                    max_tokens=256,
                    system=SYSTEM_PROMPT,
                    output_config={"format": {"type": "json_schema", "schema": schema}},
                    messages=[
                        {"role": "user", "content": _build_prompt(text, choices)}
                    ],
                )
            except Exception as exc:  # noqa: BLE001 - sync must survive any LLM failure
                logger.warning("anthropic call failed (attempt %d): %s", attempt, exc)
                continue

            if message.stop_reason == "refusal":
                logger.warning("anthropic refused to categorize a note")
                return None

            raw = next(
                (block.text for block in message.content if block.type == "text"), ""
            )
            result = _validate(raw, choices)
            if result is not None:
                return result
            logger.warning("anthropic returned an invalid answer (attempt %d)", attempt)

        return None


def build_categorizer(settings: Settings | None = None) -> Categorizer:
    settings = settings or get_settings()
    if settings.llm_provider == "anthropic":
        return AnthropicCategorizer(settings)
    return OllamaCategorizer(settings)
