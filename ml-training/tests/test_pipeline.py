"""Pipeline orchestration: dataset → embeddings → validated embeddings.json."""

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from src.embeddings import validate_schema
from src.pipeline import run_pipeline
from tests.test_embeddings import fake_embed


@pytest.fixture
def dataset_dir(tmp_path):
    for n, enrollment_no in enumerate(["2021001", "2021002"]):
        person = tmp_path / "dataset" / enrollment_no
        person.mkdir(parents=True)
        for i in range(2):
            img = Image.new("RGB", (160, 160), color=(n * 120, i * 60, 90))
            img.save(person / f"face_{i}.jpg", "JPEG")
    return str(tmp_path / "dataset")


@pytest.fixture
def output_path(tmp_path):
    return str(tmp_path / "output" / "embeddings.json")


def test_dry_run_validates_dataset_only(dataset_dir, output_path):
    summary = run_pipeline(dataset_dir, output_path, dry_run=True)
    assert summary["status"] == "dry_run_complete"
    assert summary["dataset_stats"]["total_people"] == 2
    assert summary["dataset_stats"]["total_images"] == 4
    assert not Path(output_path).exists()


def test_missing_dataset_fails(tmp_path, output_path):
    summary = run_pipeline(str(tmp_path / "nope"), output_path, dry_run=True)
    assert summary["status"] == "failed"
    assert "Dataset loading failed" in summary["errors"][0]


def test_full_run_writes_valid_file(dataset_dir, output_path):
    summary = run_pipeline(dataset_dir, output_path, embed=fake_embed)
    assert summary["status"] == "success"
    assert summary["entries_generated"] == 2
    data = json.loads(Path(output_path).read_text())
    assert validate_schema(data) == []
    assert data["version"] == 0, "publish.py assigns the version"
    assert all(np.isclose(np.linalg.norm(e["embedding_vector"]), 1.0, atol=1e-5) for e in data["entries"])


def test_model_failure_is_reported(dataset_dir, output_path):
    def broken(_):
        raise RuntimeError("Model failed to load")

    summary = run_pipeline(dataset_dir, output_path, embed=broken)
    assert summary["status"] == "failed"
    assert "Model failed to load" in summary["errors"][0]


def test_min_images_filter(dataset_dir, output_path):
    summary = run_pipeline(dataset_dir, output_path, min_images=3, dry_run=True)
    assert summary["status"] == "failed"
