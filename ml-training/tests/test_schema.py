"""
test_schema.py — Tests that embeddings output matches the canonical schema.

This is the critical contract test — the kiosk app, backend, and ML pipeline
all depend on this exact schema (SRS §6, backend/API_CONTRACT.md).
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.embeddings import validate_schema, save_embeddings, load_embeddings


# ─── Canonical Schema Examples ────────────────────────────────────────────────

VALID_EMBEDDINGS = {
    "version": 1,
    "generated_at": "2026-10-01T12:00:00+00:00",
    "model_version": "facenet-inceptionresnetv1-vggface2",
    "entries": [
        {
            "enrollment_no": "2021001",
            "embedding_vector": [0.1, -0.2, 0.3, 0.4, -0.5]
        },
        {
            "enrollment_no": "2021002",
            "embedding_vector": [0.6, 0.7, -0.8, 0.9, -0.1]
        }
    ]
}

EMPTY_EMBEDDINGS = {
    "version": 0,
    "generated_at": "",
    "model_version": "",
    "entries": []
}


class TestValidateSchema:
    def test_valid_schema(self):
        errors = validate_schema(VALID_EMBEDDINGS)
        assert errors == [], f"Expected no errors, got: {errors}"

    def test_empty_but_valid(self):
        errors = validate_schema(EMPTY_EMBEDDINGS)
        assert errors == []

    def test_missing_version(self):
        bad = {k: v for k, v in VALID_EMBEDDINGS.items() if k != "version"}
        errors = validate_schema(bad)
        assert any("version" in e for e in errors)

    def test_missing_generated_at(self):
        bad = {k: v for k, v in VALID_EMBEDDINGS.items() if k != "generated_at"}
        errors = validate_schema(bad)
        assert any("generated_at" in e for e in errors)

    def test_missing_model_version(self):
        bad = {k: v for k, v in VALID_EMBEDDINGS.items() if k != "model_version"}
        errors = validate_schema(bad)
        assert any("model_version" in e for e in errors)

    def test_missing_entries(self):
        bad = {k: v for k, v in VALID_EMBEDDINGS.items() if k != "entries"}
        errors = validate_schema(bad)
        assert any("entries" in e for e in errors)

    def test_version_must_be_int(self):
        bad = {**VALID_EMBEDDINGS, "version": "1"}
        errors = validate_schema(bad)
        assert any("integer" in e for e in errors)

    def test_entries_must_be_list(self):
        bad = {**VALID_EMBEDDINGS, "entries": "not a list"}
        errors = validate_schema(bad)
        assert any("list" in e for e in errors)

    def test_entry_missing_enrollment_no(self):
        bad = {
            **VALID_EMBEDDINGS,
            "entries": [{"embedding_vector": [0.1, 0.2]}]
        }
        errors = validate_schema(bad)
        assert any("enrollment_no" in e for e in errors)

    def test_entry_missing_embedding_vector(self):
        bad = {
            **VALID_EMBEDDINGS,
            "entries": [{"enrollment_no": "2021001"}]
        }
        errors = validate_schema(bad)
        assert any("embedding_vector" in e for e in errors)

    def test_embedding_vector_must_be_list(self):
        bad = {
            **VALID_EMBEDDINGS,
            "entries": [{"enrollment_no": "2021001", "embedding_vector": "not a list"}]
        }
        errors = validate_schema(bad)
        assert any("list of floats" in e for e in errors)

    def test_embedding_vector_must_contain_numbers(self):
        bad = {
            **VALID_EMBEDDINGS,
            "entries": [{"enrollment_no": "2021001", "embedding_vector": ["a", "b"]}]
        }
        errors = validate_schema(bad)
        assert any("non-numeric" in e for e in errors)

    def test_not_a_dict(self):
        errors = validate_schema("not a dict")
        assert errors == ["Root must be a dict"]


class TestSaveAndLoad:
    def test_roundtrip(self, tmp_path):
        output_path = str(tmp_path / "embeddings.json")
        save_embeddings(VALID_EMBEDDINGS, output_path)

        loaded = load_embeddings(output_path)
        assert loaded is not None
        assert loaded["version"] == VALID_EMBEDDINGS["version"]
        assert loaded["model_version"] == VALID_EMBEDDINGS["model_version"]
        assert len(loaded["entries"]) == len(VALID_EMBEDDINGS["entries"])

        # Verify exact schema compliance after roundtrip
        errors = validate_schema(loaded)
        assert errors == []

    def test_load_nonexistent(self):
        result = load_embeddings("/nonexistent/embeddings.json")
        assert result is None

    def test_creates_parent_dirs(self, tmp_path):
        output_path = str(tmp_path / "deep" / "nested" / "dir" / "embeddings.json")
        save_embeddings(VALID_EMBEDDINGS, output_path)
        assert Path(output_path).exists()

    def test_json_is_valid(self, tmp_path):
        output_path = str(tmp_path / "embeddings.json")
        save_embeddings(VALID_EMBEDDINGS, output_path)

        with open(output_path, 'r') as f:
            data = json.load(f)

        assert isinstance(data, dict)
        assert data["version"] == 1
        assert len(data["entries"]) == 2

    def test_version_increment_roundtrip(self, tmp_path):
        """Simulate what the pipeline does: load previous, increment version."""
        # Save v1
        output_path = str(tmp_path / "embeddings.json")
        save_embeddings(VALID_EMBEDDINGS, output_path)

        # Load and increment
        prev = load_embeddings(output_path)
        new_version = prev["version"] + 1
        assert new_version == 2

        # Save v2
        v2 = {**VALID_EMBEDDINGS, "version": new_version}
        save_embeddings(v2, output_path)

        # Verify
        loaded = load_embeddings(output_path)
        assert loaded["version"] == 2
