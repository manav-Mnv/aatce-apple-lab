"""
embeddings.py — Face embedding generator.

Uses a pre-trained face recognition model (FaceNet via facenet-pytorch)
to generate embedding vectors from face images.

Output schema matches SRS §6 / backend API_CONTRACT.md exactly:
{
    "version": <int>,
    "generated_at": "<ISO 8601>",
    "model_version": "<string>",
    "entries": [
        {
            "enrollment_no": "<string>",
            "embedding_vector": [<float>, ...]
        }
    ]
}
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

import numpy as np

logger = logging.getLogger(__name__)

# Default embedding dimension for FaceNet (InceptionResnetV1)
EMBEDDING_DIM = 512

# Model identifier for versioning
MODEL_ID = "facenet-inceptionresnetv1-vggface2"


def generate_embeddings(
    dataset: Dict[str, List[str]],
    model=None,
    mtcnn=None,
    device: str = "cpu"
) -> Dict[str, Any]:
    """
    Generate face embeddings for all people in the dataset.

    Args:
        dataset: Dict mapping enrollment_no -> list of image paths
                 (output of dataset.load_dataset()).
        model: Pre-loaded InceptionResnetV1 model. If None, loads default.
        mtcnn: Pre-loaded MTCNN face detector. If None, loads default.
        device: PyTorch device string ('cpu' or 'cuda').

    Returns:
        Embeddings dict matching the canonical schema.
    """
    if model is None or mtcnn is None:
        model, mtcnn = _load_models(device)

    entries = []
    failed = []

    for enrollment_no, image_paths in sorted(dataset.items()):
        logger.info(f"Processing {enrollment_no} ({len(image_paths)} images)...")

        try:
            embedding = _compute_person_embedding(
                image_paths, model, mtcnn, device
            )

            if embedding is not None:
                entries.append({
                    "enrollment_no": enrollment_no,
                    "embedding_vector": embedding.tolist()
                })
                logger.info(
                    f"  ✓ {enrollment_no}: embedding generated "
                    f"(dim={len(embedding)})"
                )
            else:
                failed.append(enrollment_no)
                logger.warning(
                    f"  ✗ {enrollment_no}: no faces detected in any image"
                )

        except Exception as e:
            failed.append(enrollment_no)
            logger.error(f"  ✗ {enrollment_no}: error — {e}")

    if failed:
        logger.warning(
            f"Failed to generate embeddings for {len(failed)} people: {failed}"
        )

    result = {
        "version": 0,  # Will be set by pipeline.py
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": MODEL_ID,
        "entries": entries
    }

    logger.info(
        f"Generated {len(entries)} embeddings, {len(failed)} failures"
    )

    return result


def _load_models(device: str = "cpu"):
    """
    Load the FaceNet model and MTCNN face detector.

    Returns:
        Tuple of (model, mtcnn).
    """
    import torch
    from facenet_pytorch import MTCNN, InceptionResnetV1

    logger.info("Loading MTCNN face detector...")
    mtcnn = MTCNN(
        image_size=160,
        margin=20,
        min_face_size=40,
        thresholds=[0.6, 0.7, 0.7],
        factor=0.709,
        post_process=True,
        device=device,
        keep_all=False  # Return only the most prominent face
    )

    logger.info("Loading InceptionResnetV1 (pretrained='vggface2')...")
    model = InceptionResnetV1(pretrained='vggface2').eval().to(device)

    logger.info("Models loaded successfully.")
    return model, mtcnn


def _compute_person_embedding(
    image_paths: List[str],
    model,
    mtcnn,
    device: str = "cpu"
) -> Optional[np.ndarray]:
    """
    Compute a single representative embedding for a person by averaging
    embeddings from multiple face images.

    Args:
        image_paths: List of paths to face images.
        model: InceptionResnetV1 model.
        mtcnn: MTCNN face detector.
        device: PyTorch device.

    Returns:
        Numpy array of shape (EMBEDDING_DIM,) or None if no faces detected.
    """
    import torch
    from PIL import Image

    embeddings = []

    for img_path in image_paths:
        try:
            img = Image.open(img_path).convert('RGB')

            # Detect and align face
            face_tensor = mtcnn(img)

            if face_tensor is None:
                logger.debug(f"  No face detected in {img_path}")
                continue

            # face_tensor shape: (3, 160, 160)
            # Model expects batch: (N, 3, 160, 160)
            face_batch = face_tensor.unsqueeze(0).to(device)

            with torch.no_grad():
                emb = model(face_batch)

            embeddings.append(emb.cpu().numpy().flatten())

        except Exception as e:
            logger.debug(f"  Error processing {img_path}: {e}")

    if not embeddings:
        return None

    # Average all embeddings for this person (more stable than single image)
    avg_embedding = np.mean(embeddings, axis=0)

    # L2 normalize for cosine similarity compatibility
    norm = np.linalg.norm(avg_embedding)
    if norm > 0:
        avg_embedding = avg_embedding / norm

    return avg_embedding


def save_embeddings(
    embeddings: Dict[str, Any],
    output_path: str,
    pretty: bool = True
) -> str:
    """
    Save embeddings dict to a JSON file.

    Args:
        embeddings: The embeddings dict (canonical schema).
        output_path: Path to write the JSON file.
        pretty: Whether to pretty-print the JSON.

    Returns:
        The absolute path of the written file.
    """
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    with open(output, 'w', encoding='utf-8') as f:
        json.dump(embeddings, f, indent=2 if pretty else None, ensure_ascii=False)

    logger.info(f"Embeddings saved to {output.resolve()}")
    return str(output.resolve())


def load_embeddings(input_path: str) -> Optional[Dict[str, Any]]:
    """
    Load embeddings from a JSON file.

    Args:
        input_path: Path to the embeddings JSON file.

    Returns:
        Embeddings dict, or None if file doesn't exist.
    """
    path = Path(input_path)
    if not path.exists():
        return None

    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def validate_schema(embeddings: Dict[str, Any]) -> List[str]:
    """
    Validate that an embeddings dict conforms to the canonical schema.

    Returns:
        List of validation error strings (empty if valid).
    """
    errors = []

    if not isinstance(embeddings, dict):
        return ["Root must be a dict"]

    required_keys = ["version", "generated_at", "model_version", "entries"]
    for key in required_keys:
        if key not in embeddings:
            errors.append(f"Missing required key: {key}")

    if "version" in embeddings:
        if not isinstance(embeddings["version"], int):
            errors.append(f"'version' must be an integer, got {type(embeddings['version']).__name__}")

    if "generated_at" in embeddings:
        if not isinstance(embeddings["generated_at"], str):
            errors.append("'generated_at' must be a string (ISO 8601)")

    if "model_version" in embeddings:
        if not isinstance(embeddings["model_version"], str):
            errors.append("'model_version' must be a string")

    if "entries" in embeddings:
        if not isinstance(embeddings["entries"], list):
            errors.append("'entries' must be a list")
        else:
            for i, entry in enumerate(embeddings["entries"]):
                if not isinstance(entry, dict):
                    errors.append(f"entries[{i}] must be a dict")
                    continue
                if "enrollment_no" not in entry:
                    errors.append(f"entries[{i}] missing 'enrollment_no'")
                if "embedding_vector" not in entry:
                    errors.append(f"entries[{i}] missing 'embedding_vector'")
                elif not isinstance(entry["embedding_vector"], list):
                    errors.append(f"entries[{i}]['embedding_vector'] must be a list of floats")
                elif entry["embedding_vector"]:
                    if not all(isinstance(v, (int, float)) for v in entry["embedding_vector"]):
                        errors.append(f"entries[{i}]['embedding_vector'] contains non-numeric values")

    return errors
