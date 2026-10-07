"""Categorizer answer validation — no database required."""

from __future__ import annotations

from app.services.categorizer import CategoryChoice, _validate

CHOICES = [
    CategoryChoice(id=1, name="Inbox"),
    CategoryChoice(id=2, name="Idei YouTube"),
    CategoryChoice(id=3, name="Filme"),
]


def test_accepts_clean_json():
    result = _validate('{"category": "Filme", "confidence": 0.9}', CHOICES)
    assert result is not None
    assert result.category == "Filme"
    assert result.confidence == 0.9


def test_accepts_json_wrapped_in_fences():
    """gemma3:4b does this even when told not to."""
    raw = '```json\n{"category": "Idei YouTube", "confidence": 0.7}\n```'
    result = _validate(raw, CHOICES)
    assert result is not None
    assert result.category == "Idei YouTube"


def test_normalises_casing_to_the_real_name():
    result = _validate('{"category": "filme", "confidence": 0.8}', CHOICES)
    assert result is not None
    assert result.category == "Filme"


def test_rejects_an_invented_category():
    """The whole point: the model picks from the list or it has failed."""
    assert _validate('{"category": "Muzica", "confidence": 0.99}', CHOICES) is None


def test_rejects_malformed_output():
    assert _validate("nu stiu ce sa zic", CHOICES) is None
    assert _validate("", CHOICES) is None


def test_rejects_out_of_range_confidence():
    assert _validate('{"category": "Filme", "confidence": 4.2}', CHOICES) is None


def test_rejects_missing_field():
    assert _validate('{"category": "Filme"}', CHOICES) is None
