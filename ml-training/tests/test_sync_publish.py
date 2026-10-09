"""sync_faces and publish against a fake backend (same contract as backend/API_CONTRACT.md)."""

import base64
import json

import pytest

from src.backend_client import BackendClient, BackendError
from src.publish import publish
from src.sync_faces import sync

JPEG = b"\xff\xd8\xff\xe0fakejpeg\xff\xd9"


class FakeBackend:
    def __init__(self, people=None, version=0):
        self.people = people or {}
        self.version = version
        self.calls = []
        self.published = None

    def call(self, action, **params):
        self.calls.append((action, params))
        if action == "face_manifest":
            return {"success": True, "people": [
                {"enrollment_no": e, "files": [{"id": f, "name": f + ".jpg", "size": 10} for f in files]}
                for e, files in self.people.items()]}
        if action == "face_images":
            assert len(params["file_ids"]) <= 25
            return {"success": True, "images": [
                {"file_id": i, "data": base64.b64encode(JPEG).decode()} for i in params["file_ids"]]}
        if action == "embeddings_version":
            return {"success": True, "version": self.version}
        if action == "publish_embeddings":
            self.published = params["embeddings"]
            self.version = self.published["version"]
            return {"success": True, "version": self.version, "entry_count": len(self.published["entries"])}
        raise AssertionError(action)


def downloads(backend):
    return [i for a, p in backend.calls if a == "face_images" for i in p["file_ids"]]


class TestSync:
    def test_downloads_new_files_only(self, tmp_path):
        backend = FakeBackend({"2021001": ["f1", "f2"], "W100": ["f3"]})
        assert sync(backend, str(tmp_path)) == (3, 0)
        assert (tmp_path / "2021001" / "f1.jpg").read_bytes() == JPEG

        backend.people["2021001"].append("f4")
        backend.calls.clear()
        assert sync(backend, str(tmp_path)) == (1, 0)
        assert downloads(backend) == ["f4"]

    def test_removes_photos_deleted_from_drive(self, tmp_path):
        backend = FakeBackend({"2021001": ["f1"], "2021002": ["f2"]})
        sync(backend, str(tmp_path))
        del backend.people["2021002"]
        assert sync(backend, str(tmp_path)) == (0, 1)
        assert not (tmp_path / "2021002").exists()

    def test_downloads_in_batches_of_25(self, tmp_path):
        backend = FakeBackend({"2021001": [f"f{i}" for i in range(60)]})
        assert sync(backend, str(tmp_path)) == (60, 0)
        assert sum(1 for a, _ in backend.calls if a == "face_images") == 3

    def test_unsafe_names_are_ignored(self, tmp_path):
        backend = FakeBackend({"../evil": ["f1"], "ok": ["../../x", "f2"]})
        assert sync(backend, str(tmp_path)) == (1, 0)
        assert downloads(backend) == ["f2"]


def embeddings_file(tmp_path, entries=1):
    path = tmp_path / "embeddings.json"
    path.write_text(json.dumps({
        "version": 0, "generated_at": "2026-10-05T00:00:00+00:00", "model_version": "m",
        "entries": [{"enrollment_no": f"S{i}", "embedding_vector": [0.01] * 512} for i in range(entries)],
    }))
    return str(path)


class TestPublish:
    def test_assigns_next_version(self, tmp_path):
        backend = FakeBackend(version=4)
        assert publish(backend, embeddings_file(tmp_path, 2)) == 5
        assert backend.published["version"] == 5

    def test_refuses_empty_file(self, tmp_path):
        with pytest.raises(ValueError, match="no entries"):
            publish(FakeBackend(), embeddings_file(tmp_path, 0))

    def test_refuses_invalid_file(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps({"version": 0, "generated_at": "x", "model_version": "m",
                                    "entries": [{"enrollment_no": "S1", "embedding_vector": [1]}]}))
        with pytest.raises(ValueError, match="512"):
            publish(FakeBackend(), str(path))

    def test_missing_file(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            publish(FakeBackend(), str(tmp_path / "none.json"))


class TestClientConfig:
    def test_from_env_requires_both_values(self, monkeypatch):
        monkeypatch.delenv("APPS_SCRIPT_URL", raising=False)
        monkeypatch.setenv("PIPELINE_SECRET", "s")
        with pytest.raises(BackendError, match="not_configured"):
            BackendClient.from_env()
