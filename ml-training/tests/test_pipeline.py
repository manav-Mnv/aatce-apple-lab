"""
test_pipeline.py — Tests for the pipeline orchestrator.

Tests the pipeline's orchestration logic (dataset → embeddings → save)
using synthetic data. Does NOT test the full FaceNet model (see test_embeddings.py).
"""

import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from PIL import Image

from src.pipeline import run_pipeline
from src.embeddings import validate_schema


@pytest.fixture
def dataset_dir(tmp_path):
    """Create a minimal dataset directory."""
    for enrollment_no in ["2021001", "2021002"]:
        person_dir = tmp_path / "dataset" / enrollment_no
        person_dir.mkdir(parents=True)
        for i in range(2):
            img = Image.new("RGB", (200, 200), color=(100, 100, 100))
            img.save(str(person_dir / f"face_{i}.jpg"), "JPEG")
    return str(tmp_path / "dataset")


@pytest.fixture
def output_path(tmp_path):
    return str(tmp_path / "output" / "embeddings.json")


class TestPipelineDryRun:
    """Dry run tests don't need the ML model."""

    def test_dry_run_succeeds(self, dataset_dir, output_path):
        summary = run_pipeline(
            dataset_dir=dataset_dir,
            output_path=output_path,
            dry_run=True
        )
        assert summary["status"] == "dry_run_complete"
        assert summary["dataset_stats"]["total_people"] == 2
        assert summary["dataset_stats"]["total_images"] == 4

    def test_dry_run_bad_dataset(self, tmp_path, output_path):
        summary = run_pipeline(
            dataset_dir=str(tmp_path / "nonexistent"),
            output_path=output_path,
            dry_run=True
        )
        assert summary["status"] == "failed"
        assert len(summary["errors"]) > 0


class TestPipelineWithMockedModel:
    """Tests with a mocked embedding model (no actual FaceNet download)."""

    def _mock_generate_embeddings(self, dataset, **kwargs):
        """Mock that returns synthetic embeddings."""
        import numpy as np
        from datetime import datetime, timezone

        entries = []
        for enrollment_no in dataset:
            vec = np.random.randn(512).tolist()
            entries.append({
                "enrollment_no": enrollment_no,
                "embedding_vector": vec
            })

        return {
            "version": 0,  # Pipeline will set this
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model_version": "mock-model",
            "entries": entries
        }

    @patch("src.pipeline.generate_embeddings")
    def test_full_pipeline_mocked(self, mock_gen, dataset_dir, output_path):
        mock_gen.side_effect = self._mock_generate_embeddings

        summary = run_pipeline(
            dataset_dir=dataset_dir,
            output_path=output_path
        )

        assert summary["status"] == "success"
        assert summary["entries_generated"] == 2
        assert summary["embeddings_version"] == 1
        assert Path(summary["output_path"]).exists()

        # Verify the output file has valid schema
        with open(summary["output_path"], 'r') as f:
            data = json.load(f)
        errors = validate_schema(data)
        assert errors == [], f"Schema validation failed: {errors}"

    @patch("src.pipeline.generate_embeddings")
    def test_version_increment(self, mock_gen, dataset_dir, output_path):
        mock_gen.side_effect = self._mock_generate_embeddings

        # Run pipeline twice with same output as previous
        summary1 = run_pipeline(
            dataset_dir=dataset_dir,
            output_path=output_path
        )
        assert summary1["embeddings_version"] == 1

        summary2 = run_pipeline(
            dataset_dir=dataset_dir,
            output_path=output_path,
            previous_path=output_path
        )
        assert summary2["embeddings_version"] == 2

    @patch("src.pipeline.generate_embeddings")
    def test_schema_validated(self, mock_gen, dataset_dir, output_path):
        """Pipeline should fail if embeddings don't match schema."""
        # Return invalid schema — use bad entries type since pipeline
        # always overrides version with an int
        mock_gen.return_value = {
            "version": 1,
            "generated_at": "2026-10-01",
            "model_version": "test",
            "entries": "not a list"  # Wrong type
        }

        summary = run_pipeline(
            dataset_dir=dataset_dir,
            output_path=output_path
        )
        assert summary["status"] == "failed"
        assert any("list" in e for e in summary["errors"])

    @patch("src.pipeline.generate_embeddings")
    def test_output_file_created(self, mock_gen, dataset_dir, output_path):
        mock_gen.side_effect = self._mock_generate_embeddings

        summary = run_pipeline(
            dataset_dir=dataset_dir,
            output_path=output_path
        )

        output = Path(output_path)
        assert output.exists()
        assert output.stat().st_size > 0

    @patch("src.pipeline.generate_embeddings")
    def test_embedding_generation_error(self, mock_gen, dataset_dir, output_path):
        mock_gen.side_effect = RuntimeError("Model failed to load")

        summary = run_pipeline(
            dataset_dir=dataset_dir,
            output_path=output_path
        )
        assert summary["status"] == "failed"
        assert any("Embedding generation failed" in e for e in summary["errors"])
