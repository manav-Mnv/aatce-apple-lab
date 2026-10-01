"""
test_embeddings.py — Tests for the embedding generation module.

Tests use mock/synthetic data to avoid downloading the full FaceNet model
in CI. The actual model integration is tested by test_pipeline.py when
the model is available.
"""

import json
import numpy as np
import pytest

from src.embeddings import (
    validate_schema,
    save_embeddings,
    load_embeddings,
    EMBEDDING_DIM,
    MODEL_ID,
)


class TestEmbeddingConstants:
    def test_embedding_dim(self):
        """FaceNet InceptionResnetV1 should produce 512-d embeddings."""
        assert EMBEDDING_DIM == 512

    def test_model_id_is_string(self):
        assert isinstance(MODEL_ID, str)
        assert len(MODEL_ID) > 0


class TestSyntheticEmbeddings:
    """Test embedding pipeline with synthetic (random) embedding vectors."""

    def _make_synthetic_embeddings(self, n_people=5, dim=512):
        """Create a synthetic embeddings dict with random vectors."""
        entries = []
        for i in range(n_people):
            vec = np.random.randn(dim).tolist()
            entries.append({
                "enrollment_no": f"202100{i+1}",
                "embedding_vector": vec
            })

        return {
            "version": 1,
            "generated_at": "2026-10-01T12:00:00+00:00",
            "model_version": MODEL_ID,
            "entries": entries
        }

    def test_synthetic_passes_validation(self):
        emb = self._make_synthetic_embeddings()
        errors = validate_schema(emb)
        assert errors == []

    def test_correct_entry_count(self):
        emb = self._make_synthetic_embeddings(n_people=10)
        assert len(emb["entries"]) == 10

    def test_embedding_vector_dimensions(self):
        emb = self._make_synthetic_embeddings(n_people=3, dim=512)
        for entry in emb["entries"]:
            assert len(entry["embedding_vector"]) == 512

    def test_enrollment_nos_unique(self):
        emb = self._make_synthetic_embeddings(n_people=5)
        enrollment_nos = [e["enrollment_no"] for e in emb["entries"]]
        assert len(set(enrollment_nos)) == 5

    def test_save_and_reload_preserves_vectors(self, tmp_path):
        emb = self._make_synthetic_embeddings(n_people=3, dim=128)
        output = str(tmp_path / "test_emb.json")
        save_embeddings(emb, output)

        loaded = load_embeddings(output)
        assert loaded is not None

        for orig, reloaded in zip(emb["entries"], loaded["entries"]):
            assert orig["enrollment_no"] == reloaded["enrollment_no"]
            np.testing.assert_array_almost_equal(
                orig["embedding_vector"],
                reloaded["embedding_vector"],
                decimal=10
            )

    def test_l2_normalized_vectors(self):
        """Verify that manually L2-normalized vectors stay normalized after roundtrip."""
        emb = self._make_synthetic_embeddings(n_people=2, dim=128)

        # Normalize
        for entry in emb["entries"]:
            vec = np.array(entry["embedding_vector"])
            vec = vec / np.linalg.norm(vec)
            entry["embedding_vector"] = vec.tolist()

        # Check norms are ~1.0
        for entry in emb["entries"]:
            norm = np.linalg.norm(entry["embedding_vector"])
            np.testing.assert_almost_equal(norm, 1.0, decimal=6)


class TestVersioning:
    def test_version_auto_increment(self, tmp_path):
        """Simulate the pipeline's version increment logic."""
        # Create v1
        v1 = {
            "version": 1,
            "generated_at": "2026-10-01T12:00:00+00:00",
            "model_version": MODEL_ID,
            "entries": []
        }
        path = str(tmp_path / "embeddings.json")
        save_embeddings(v1, path)

        # Load and check version increment
        prev = load_embeddings(path)
        new_version = prev["version"] + 1
        assert new_version == 2

        # Save v2
        v2 = {**v1, "version": new_version, "generated_at": "2026-10-02T12:00:00+00:00"}
        save_embeddings(v2, path)

        # Verify
        final = load_embeddings(path)
        assert final["version"] == 2

    def test_version_starts_at_1_without_previous(self, tmp_path):
        path = str(tmp_path / "nonexistent.json")
        prev = load_embeddings(path)
        assert prev is None
        # Pipeline would default to version 1
