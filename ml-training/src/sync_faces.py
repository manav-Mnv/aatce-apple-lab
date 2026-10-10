"""
sync_faces.py — Mirror the enrollment photos from the backend into a local folder.

    python -m src.sync_faces --dataset-dir ./Face-Dataset

Photos are stored as <dataset-dir>/<enrollment_no>/<photo_id>.jpg. Photos are
never edited after upload, so a file that already exists locally is not
downloaded again, and local files whose photo was deleted are removed.

The workflow deliberately does not cache this folder: in a public repo, pull
requests from forks can restore caches, which would expose the photos.
"""

import argparse
import base64
import logging
import re
from pathlib import Path
from typing import Tuple

from .backend_client import BackendClient

logger = logging.getLogger(__name__)

SAFE_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
BATCH_SIZE = 25  # backend MAX_FACE_IMAGES_PER_CALL


def sync(client: BackendClient, dataset_dir: str) -> Tuple[int, int]:
    """Returns (downloaded, removed)."""
    root = Path(dataset_dir)
    root.mkdir(parents=True, exist_ok=True)

    wanted = set()
    missing = {}
    for person in client.call("face_manifest")["people"]:
        enrollment_no = person["enrollment_no"]
        if not SAFE_NAME.match(enrollment_no):
            logger.warning(f"Skipping unsafe folder name {enrollment_no!r}")
            continue
        for file in person["files"]:
            if not SAFE_NAME.match(file["id"]):
                continue
            path = root / enrollment_no / f"{file['id']}.jpg"
            wanted.add(path)
            if not path.exists():
                missing[file["id"]] = path

    ids = list(missing)
    for start in range(0, len(ids), BATCH_SIZE):
        for image in client.call("face_images", file_ids=ids[start:start + BATCH_SIZE])["images"]:
            path = missing[image["file_id"]]
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(base64.b64decode(image["data"]))

    removed = 0
    for path in root.glob("*/*.jpg"):
        if path not in wanted:
            path.unlink()
            removed += 1
    for folder in root.iterdir():
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()

    logger.info(f"Face-Dataset synced: {len(ids)} downloaded, {removed} removed, {len(wanted)} total")
    return len(ids), removed


def main():
    parser = argparse.ArgumentParser(description="Mirror enrollment photos from the backend")
    parser.add_argument("--dataset-dir", required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    sync(BackendClient.from_env(), args.dataset_dir)


if __name__ == "__main__":
    main()
