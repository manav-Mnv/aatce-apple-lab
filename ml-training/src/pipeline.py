"""
pipeline.py — Face-Dataset → embeddings.json.

    python -m src.pipeline --dataset-dir ./Face-Dataset --output ./output/embeddings.json
    python -m src.pipeline --dataset-dir ./Face-Dataset --dry-run     # validate photos only

The weekly workflow runs:  sync_faces → pipeline → publish  (see retrain.yml).
"""

import argparse
import json
import logging
import sys
from typing import Optional

from .dataset import get_dataset_stats, load_dataset
from .embeddings import Embedder, generate_embeddings, load_embedder, save_embeddings, validate_schema

logger = logging.getLogger(__name__)


def run_pipeline(
    dataset_dir: str,
    output_path: str,
    min_images: int = 1,
    device: str = "cpu",
    dry_run: bool = False,
    embed: Optional[Embedder] = None,
) -> dict:
    summary = {"status": "failed", "dataset_stats": {}, "entries_generated": 0, "output_path": "", "errors": []}

    try:
        dataset = load_dataset(dataset_dir, min_images_per_person=min_images)
    except (FileNotFoundError, ValueError) as e:
        summary["errors"].append(f"Dataset loading failed: {e}")
        return summary

    summary["dataset_stats"] = get_dataset_stats(dataset)
    logger.info(f"Dataset: {json.dumps(summary['dataset_stats'])}")
    if dry_run:
        summary["status"] = "dry_run_complete"
        return summary

    try:
        embeddings = generate_embeddings(dataset, embed or load_embedder(device))
    except Exception as e:
        summary["errors"].append(f"Embedding generation failed: {e}")
        return summary

    schema_errors = validate_schema(embeddings)
    if schema_errors:
        summary["errors"].extend(schema_errors)
        return summary

    summary["entries_generated"] = len(embeddings["entries"])
    summary["output_path"] = save_embeddings(embeddings, output_path)
    summary["status"] = "success"
    return summary


def main():
    parser = argparse.ArgumentParser(description="AATCE face embedding pipeline")
    parser.add_argument("--dataset-dir", required=True, help="Face-Dataset directory (<enrollment_no>/<photo>.jpg)")
    parser.add_argument("--output", default="output/embeddings.json")
    parser.add_argument("--min-images", type=int, default=1, help="Minimum photos per person")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    parser.add_argument("--dry-run", action="store_true", help="Validate the dataset without loading the model")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    summary = run_pipeline(args.dataset_dir, args.output, args.min_images, args.device, args.dry_run)
    if summary["status"] == "failed":
        logger.error(f"Pipeline failed: {summary['errors']}")
        sys.exit(1)
    logger.info(f"Pipeline finished: {summary['status']}, {summary['entries_generated']} entries")


if __name__ == "__main__":
    main()
