"""
embeddings.py — Face embedding generation.

Input images are the 160×160 face crops the kiosk uploads at enrollment
(Vision face box + margin, squared, resized). The kiosk computes live
embeddings from crops made the same way, with the same model exported to
Core ML (export_coreml.py), so both sides see identical preprocessing:

    pixels (RGB, 0–255) → (x − 127.5) / 128 → InceptionResnetV1 (VGGFace2) → 512-d, L2-normalised

Output schema (SRS §6, backend/API_CONTRACT.md):
    { "version": int, "generated_at": ISO 8601, "model_version": str,
      "entries": [ { "enrollment_no": str, "embedding_vector": [512 floats] } ] }
"""

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 512
FACE_SIZE = 160
MODEL_ID = "facenet-inceptionresnetv1-vggface2"
ENROLLMENT_NO_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")

# Takes a float32 batch shaped (N, 3, 160, 160), returns (N, 512).
Embedder = Callable[[np.ndarray], np.ndarray]


def load_embedder(device: str = "cpu") -> Embedder:
    """Loads FaceNet. Imported lazily so tests and tooling don't need torch."""
    import torch
    from facenet_pytorch import InceptionResnetV1

    model = InceptionResnetV1(pretrained="vggface2").eval().to(device)

    def embed(batch: np.ndarray) -> np.ndarray:
        with torch.no_grad():
            return model(torch.from_numpy(batch).to(device)).cpu().numpy()

    return embed


def preprocess(image_path: str) -> np.ndarray:
    """Face crop → (3, 160, 160) float32, standardised as FaceNet expects."""
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        if img.size != (FACE_SIZE, FACE_SIZE):
            img = img.resize((FACE_SIZE, FACE_SIZE), Image.BILINEAR)
        pixels = np.asarray(img, dtype=np.float32)
    return ((pixels - 127.5) / 128.0).transpose(2, 0, 1)


def person_embedding(image_paths: List[str], embed: Embedder) -> Optional[np.ndarray]:
    """Mean of the per-photo embeddings, re-normalised to unit length."""
    batch = []
    for path in image_paths:
        try:
            batch.append(preprocess(path))
        except OSError as e:
            logger.warning(f"Skipping unreadable image {path}: {e}")
    if not batch:
        return None

    mean = embed(np.stack(batch)).mean(axis=0)
    norm = np.linalg.norm(mean)
    return mean / norm if norm > 0 else None


def generate_embeddings(dataset: Dict[str, List[str]], embed: Embedder) -> Dict[str, Any]:
    """
    Builds the embeddings document for every person in the dataset.
    `version` is 0 here; publish.py assigns the real version at upload time.
    """
    entries = []
    failed = []
    for enrollment_no, image_paths in sorted(dataset.items()):
        vector = person_embedding(image_paths, embed)
        if vector is None:
            failed.append(enrollment_no)
            continue
        entries.append({
            "enrollment_no": enrollment_no,
            "embedding_vector": [round(float(v), 6) for v in vector],
        })

    if failed:
        logger.warning(f"No usable images for {len(failed)} people: {failed}")
    logger.info(f"Generated {len(entries)} embeddings")

    return {
        "version": 0,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_version": MODEL_ID,
        "entries": entries,
    }


def save_embeddings(embeddings: Dict[str, Any], output_path: str) -> str:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(embeddings), encoding="utf-8")
    logger.info(f"Embeddings saved to {output.resolve()}")
    return str(output.resolve())


def load_embeddings(input_path: str) -> Optional[Dict[str, Any]]:
    path = Path(input_path)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def validate_schema(embeddings: Any) -> List[str]:
    """Returns a list of schema problems (empty if valid). Mirrors the backend's checks."""
    if not isinstance(embeddings, dict):
        return ["Root must be a dict"]

    errors = []
    for key in ("version", "generated_at", "model_version", "entries"):
        if key not in embeddings:
            errors.append(f"Missing required key: {key}")

    version = embeddings.get("version")
    if "version" in embeddings and (not isinstance(version, int) or isinstance(version, bool) or version < 0):
        errors.append("'version' must be a non-negative integer")
    if "generated_at" in embeddings and not isinstance(embeddings["generated_at"], str):
        errors.append("'generated_at' must be a string (ISO 8601)")
    if "model_version" in embeddings and not isinstance(embeddings["model_version"], str):
        errors.append("'model_version' must be a string")

    entries = embeddings.get("entries")
    if "entries" in embeddings and not isinstance(entries, list):
        errors.append("'entries' must be a list")
        return errors

    seen = set()
    for i, entry in enumerate(entries or []):
        if not isinstance(entry, dict):
            errors.append(f"entries[{i}] must be a dict")
            continue
        enrollment_no = entry.get("enrollment_no")
        if not isinstance(enrollment_no, str) or not ENROLLMENT_NO_PATTERN.match(enrollment_no):
            errors.append(f"entries[{i}] has an invalid 'enrollment_no'")
        elif enrollment_no in seen:
            errors.append(f"entries[{i}] duplicates enrollment_no {enrollment_no}")
        else:
            seen.add(enrollment_no)

        vector = entry.get("embedding_vector")
        if not isinstance(vector, list):
            errors.append(f"entries[{i}]['embedding_vector'] must be a list of floats")
        elif len(vector) != EMBEDDING_DIM:
            errors.append(f"entries[{i}]['embedding_vector'] must have {EMBEDDING_DIM} values")
        elif not all(isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v) for v in vector):
            errors.append(f"entries[{i}]['embedding_vector'] contains non-numeric values")

    return errors
