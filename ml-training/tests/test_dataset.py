"""
test_dataset.py — Tests for the face image dataset loader.

Uses temporary directories with synthetic image files to test
dataset loading, validation, and error handling.
"""

import os
import tempfile
import pytest
from pathlib import Path
from PIL import Image

from src.dataset import load_dataset, get_dataset_stats, _validate_image


@pytest.fixture
def sample_dataset(tmp_path):
    """Create a temporary dataset directory with synthetic face images."""
    # Create enrollment directories with images
    for enrollment_no in ["2021001", "2021002", "2021003"]:
        person_dir = tmp_path / enrollment_no
        person_dir.mkdir()

        # Create synthetic images (valid JPEGs)
        for i in range(3):
            img = Image.new("RGB", (200, 200), color=(i * 50, i * 80, i * 30))
            img_path = person_dir / f"face_{i}.jpg"
            img.save(str(img_path), "JPEG")

    return str(tmp_path)


@pytest.fixture
def partial_dataset(tmp_path):
    """Dataset with some dirs having too few images."""
    # Good: 3 images
    good_dir = tmp_path / "2021001"
    good_dir.mkdir()
    for i in range(3):
        img = Image.new("RGB", (200, 200), color=(100, 100, 100))
        img.save(str(good_dir / f"face_{i}.jpg"), "JPEG")

    # Bad: 0 valid images (only a text file)
    bad_dir = tmp_path / "2021002"
    bad_dir.mkdir()
    (bad_dir / "readme.txt").write_text("not an image")

    return str(tmp_path)


class TestLoadDataset:
    def test_loads_all_people(self, sample_dataset):
        dataset = load_dataset(sample_dataset)
        assert len(dataset) == 3
        assert "2021001" in dataset
        assert "2021002" in dataset
        assert "2021003" in dataset

    def test_correct_image_count(self, sample_dataset):
        dataset = load_dataset(sample_dataset)
        for enrollment_no, images in dataset.items():
            assert len(images) == 3

    def test_image_paths_are_absolute(self, sample_dataset):
        dataset = load_dataset(sample_dataset)
        for images in dataset.values():
            for path in images:
                assert os.path.isabs(path)

    def test_min_images_filter(self, partial_dataset):
        # With min_images=2, the dir with 0 valid images should be skipped
        dataset = load_dataset(partial_dataset, min_images_per_person=2)
        assert len(dataset) == 1
        assert "2021001" in dataset

    def test_nonexistent_dir_raises(self):
        with pytest.raises(FileNotFoundError):
            load_dataset("/nonexistent/path")

    def test_empty_dir_raises(self, tmp_path):
        with pytest.raises(ValueError, match="No valid entries"):
            load_dataset(str(tmp_path))

    def test_skips_non_image_files(self, tmp_path):
        person_dir = tmp_path / "2021001"
        person_dir.mkdir()
        # Create a valid image
        img = Image.new("RGB", (200, 200), color=(100, 100, 100))
        img.save(str(person_dir / "face.jpg"), "JPEG")
        # Create non-image files
        (person_dir / "notes.txt").write_text("not an image")
        (person_dir / "data.csv").write_text("a,b,c")

        dataset = load_dataset(str(tmp_path), validate=False)
        assert len(dataset["2021001"]) == 1

    def test_sorted_enrollment_numbers(self, sample_dataset):
        dataset = load_dataset(sample_dataset)
        keys = list(dataset.keys())
        assert keys == sorted(keys)


class TestValidateImage:
    def test_valid_image(self, tmp_path):
        img = Image.new("RGB", (200, 200), color=(100, 100, 100))
        path = tmp_path / "test.jpg"
        img.save(str(path), "JPEG")
        assert _validate_image(path) is True

    def test_too_small_file(self, tmp_path):
        path = tmp_path / "tiny.jpg"
        path.write_bytes(b"tiny")
        assert _validate_image(path) is False

    def test_corrupt_image(self, tmp_path):
        path = tmp_path / "corrupt.jpg"
        path.write_bytes(b"x" * 2048)  # Large enough but not a valid image
        assert _validate_image(path) is False


class TestGetDatasetStats:
    def test_stats_correct(self, sample_dataset):
        dataset = load_dataset(sample_dataset)
        stats = get_dataset_stats(dataset)
        assert stats["total_people"] == 3
        assert stats["total_images"] == 9
        assert stats["avg_images_per_person"] == 3.0
        assert stats["min_images"] == 3
        assert stats["max_images"] == 3

    def test_empty_dataset_stats(self):
        stats = get_dataset_stats({})
        assert stats["total_people"] == 0
        assert stats["total_images"] == 0
