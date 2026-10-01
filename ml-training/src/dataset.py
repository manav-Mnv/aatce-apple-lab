"""
dataset.py — Face image dataset loader.

Loads face images from a folder structure organized by enrollment number:
    /Face-Dataset/
        2021001/
            img1.jpg
            img2.png
        2021002/
            img1.jpg
            ...

Returns a dict mapping enrollment_no -> list of image paths.
"""

import os
import logging
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Supported image extensions
SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'}

# Minimum image file size (bytes) — skip clearly corrupt/empty files
MIN_IMAGE_SIZE = 1024  # 1 KB


def load_dataset(
    dataset_dir: str,
    min_images_per_person: int = 1,
    validate: bool = True
) -> Dict[str, List[str]]:
    """
    Load face image paths from the dataset directory.

    Args:
        dataset_dir: Path to the Face-Dataset directory.
        min_images_per_person: Minimum images required per enrollment (default: 1).
        validate: Whether to validate image files (size, readability).

    Returns:
        Dict mapping enrollment_no (str) -> list of absolute image paths.

    Raises:
        FileNotFoundError: If dataset_dir doesn't exist.
        ValueError: If dataset_dir is empty or has no valid entries.
    """
    dataset_path = Path(dataset_dir)

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

    if not dataset_path.is_dir():
        raise ValueError(f"Not a directory: {dataset_dir}")

    dataset: Dict[str, List[str]] = {}
    skipped_dirs = []
    skipped_files = 0

    for entry in sorted(dataset_path.iterdir()):
        if not entry.is_dir():
            continue

        enrollment_no = entry.name
        images = _collect_images(entry, validate)

        if len(images) < min_images_per_person:
            logger.warning(
                f"Skipping {enrollment_no}: only {len(images)} images "
                f"(minimum {min_images_per_person} required)"
            )
            skipped_dirs.append(enrollment_no)
            continue

        dataset[enrollment_no] = images

    if not dataset:
        raise ValueError(
            f"No valid entries found in {dataset_dir}. "
            f"Skipped dirs: {skipped_dirs}"
        )

    logger.info(
        f"Loaded dataset: {len(dataset)} people, "
        f"{sum(len(v) for v in dataset.values())} total images"
    )

    return dataset


def _collect_images(
    person_dir: Path,
    validate: bool = True
) -> List[str]:
    """
    Collect valid image file paths from a person's directory.

    Args:
        person_dir: Path to the enrollment directory.
        validate: Whether to validate each image.

    Returns:
        List of absolute image file paths.
    """
    images = []

    for f in sorted(person_dir.iterdir()):
        if not f.is_file():
            continue

        if f.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        if validate and not _validate_image(f):
            logger.debug(f"Skipping invalid image: {f}")
            continue

        images.append(str(f.resolve()))

    return images


def _validate_image(image_path: Path) -> bool:
    """
    Validate that an image file is readable and meets minimum size.

    Args:
        image_path: Path to the image file.

    Returns:
        True if valid, False otherwise.
    """
    try:
        # Check file size
        if image_path.stat().st_size < MIN_IMAGE_SIZE:
            logger.debug(f"Image too small ({image_path.stat().st_size} bytes): {image_path}")
            return False

        # Try to open with Pillow to verify it's a valid image
        from PIL import Image
        with Image.open(str(image_path)) as img:
            img.verify()  # Verify without fully decoding
        return True

    except Exception as e:
        logger.debug(f"Image validation failed for {image_path}: {e}")
        return False


def get_dataset_stats(dataset: Dict[str, List[str]]) -> dict:
    """
    Get summary statistics for a loaded dataset.

    Args:
        dataset: Output of load_dataset().

    Returns:
        Dict with stats: total_people, total_images, avg_images_per_person, etc.
    """
    if not dataset:
        return {
            'total_people': 0,
            'total_images': 0,
            'avg_images_per_person': 0,
            'min_images': 0,
            'max_images': 0
        }

    image_counts = [len(imgs) for imgs in dataset.values()]

    return {
        'total_people': len(dataset),
        'total_images': sum(image_counts),
        'avg_images_per_person': round(sum(image_counts) / len(image_counts), 1),
        'min_images': min(image_counts),
        'max_images': max(image_counts)
    }
