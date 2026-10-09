"""
Embedding generation with an injected fake model, so no torch download is needed.
The real model is exercised by export_coreml.py --check and the retrain workflow.
"""

import numpy as np
import pytest
from PIL import Image

from src.embeddings import (
    EMBEDDING_DIM,
    FACE_SIZE,
    MODEL_ID,
    generate_embeddings,
    person_embedding,
    preprocess,
    validate_schema,
)


PROJECTION = np.random.default_rng(42).standard_normal((3 * FACE_SIZE * FACE_SIZE, EMBEDDING_DIM)).astype(np.float32)


def fake_embed(batch: np.ndarray) -> np.ndarray:
    """Deterministic stand-in for FaceNet: projects each image to 512 dims and normalises."""
    out = batch.reshape(len(batch), -1) @ PROJECTION
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def write_face(path, color, size=(FACE_SIZE, FACE_SIZE)):
    img = Image.new("RGB", size, color=color)
    img.putpixel((0, 0), (255, 255, 255))
    img.save(path, "JPEG", quality=95)
    return str(path)


class TestPreprocess:
    def test_shape_and_standardisation(self, tmp_path):
        path = write_face(tmp_path / "a.jpg", (127, 127, 127))
        x = preprocess(path)
        assert x.shape == (3, FACE_SIZE, FACE_SIZE)
        assert x.dtype == np.float32
        # 127 → (127 − 127.5) / 128 ≈ −0.0039 (JPEG may shift a level)
        assert abs(float(np.median(x)) + 0.0039) < 0.02

    def test_extremes_map_to_facenet_range(self, tmp_path):
        black = preprocess(write_face(tmp_path / "b.jpg", (0, 0, 0)))
        assert np.isclose(np.median(black), -127.5 / 128, atol=0.02)
        assert black.max() <= 1.0 and black.min() >= -1.0

    def test_non_160_images_are_resized(self, tmp_path):
        path = write_face(tmp_path / "c.jpg", (10, 200, 30), size=(320, 320))
        assert preprocess(path).shape == (3, FACE_SIZE, FACE_SIZE)

    def test_channel_order_is_rgb(self, tmp_path):
        x = preprocess(write_face(tmp_path / "r.jpg", (255, 0, 0)))
        assert np.median(x[0]) > 0.9 and np.median(x[1]) < -0.9 and np.median(x[2]) < -0.9


class TestPersonEmbedding:
    def test_unit_length_mean(self, tmp_path):
        paths = [write_face(tmp_path / f"{i}.jpg", (i * 40, 100, 200 - i * 40)) for i in range(3)]
        v = person_embedding(paths, fake_embed)
        assert v.shape == (EMBEDDING_DIM,)
        assert np.isclose(np.linalg.norm(v), 1.0)

    def test_unreadable_images_are_skipped(self, tmp_path):
        good = write_face(tmp_path / "good.jpg", (50, 60, 70))
        bad = tmp_path / "bad.jpg"
        bad.write_bytes(b"not a jpeg")
        assert person_embedding([str(bad), good], fake_embed) is not None
        assert person_embedding([str(bad)], fake_embed) is None


class TestGenerateEmbeddings:
    def test_schema_valid_and_sorted(self, tmp_path):
        dataset = {
            "2021002": [write_face(tmp_path / "b1.jpg", (200, 10, 10))],
            "2021001": [write_face(tmp_path / "a1.jpg", (10, 10, 200)), write_face(tmp_path / "a2.jpg", (20, 20, 180))],
        }
        result = generate_embeddings(dataset, fake_embed)
        assert validate_schema(result) == []
        assert result["version"] == 0
        assert result["model_version"] == MODEL_ID
        assert [e["enrollment_no"] for e in result["entries"]] == ["2021001", "2021002"]

    def test_people_without_usable_images_are_left_out(self, tmp_path):
        bad = tmp_path / "bad.jpg"
        bad.write_bytes(b"xx")
        dataset = {"ok": [write_face(tmp_path / "ok.jpg", (1, 2, 3))], "broken": [str(bad)]}
        result = generate_embeddings(dataset, fake_embed)
        assert [e["enrollment_no"] for e in result["entries"]] == ["ok"]

    def test_same_person_scores_higher_than_others(self, tmp_path):
        """Sanity check of the matching math the kiosk uses (cosine of unit vectors)."""
        a = [write_face(tmp_path / f"a{i}.jpg", (200, 30 + i, 30)) for i in range(3)]
        b = [write_face(tmp_path / f"b{i}.jpg", (30, 30 + i, 200)) for i in range(3)]
        result = generate_embeddings({"A": a, "B": b}, fake_embed)
        vectors = {e["enrollment_no"]: np.array(e["embedding_vector"]) for e in result["entries"]}
        probe = fake_embed(np.stack([preprocess(write_face(tmp_path / "probe.jpg", (201, 31, 30)))]))[0]
        assert probe @ vectors["A"] > probe @ vectors["B"]


def test_constants():
    assert EMBEDDING_DIM == 512
    assert FACE_SIZE == 160
    assert MODEL_ID == "facenet-inceptionresnetv1-vggface2"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True])
def test_vectors_must_be_finite_numbers(value):
    doc = {"version": 1, "generated_at": "x", "model_version": "m",
           "entries": [{"enrollment_no": "1", "embedding_vector": [value] + [0.0] * 511}]}
    assert validate_schema(doc)
