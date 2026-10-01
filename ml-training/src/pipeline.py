"""
pipeline.py — Main orchestrator for the ML training pipeline.

Runs the full pipeline:
1. Load face image dataset from /Face-Dataset/<enrollment_no>/
2. Generate embeddings using FaceNet
3. Auto-increment version from previous embeddings.json
4. Write embeddings.json to output directory
5. (Optional) Upload to Google Drive / Sheets

Usage:
    python -m src.pipeline --dataset-dir /path/to/Face-Dataset --output embeddings.json

For GitHub Actions:
    python -m src.pipeline \
        --dataset-dir ./Face-Dataset \
        --output ./output/embeddings.json \
        --previous ./output/embeddings.json
"""

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Optional

from .dataset import load_dataset, get_dataset_stats
from .embeddings import (
    generate_embeddings,
    save_embeddings,
    load_embeddings,
    validate_schema,
)

logger = logging.getLogger(__name__)


def run_pipeline(
    dataset_dir: str,
    output_path: str,
    previous_path: Optional[str] = None,
    min_images: int = 1,
    device: str = "cpu",
    dry_run: bool = False,
) -> dict:
    """
    Run the full embedding generation pipeline.

    Args:
        dataset_dir: Path to the Face-Dataset directory.
        output_path: Path to write the embeddings.json file.
        previous_path: Path to the previous embeddings.json (for version increment).
        min_images: Minimum images required per person.
        device: PyTorch device ('cpu' or 'cuda').
        dry_run: If True, load dataset and validate but don't generate embeddings.

    Returns:
        Summary dict with pipeline results.
    """
    summary = {
        "status": "unknown",
        "dataset_stats": {},
        "embeddings_version": 0,
        "entries_generated": 0,
        "output_path": "",
        "errors": [],
    }

    # Step 1: Load dataset
    logger.info("=" * 60)
    logger.info("STEP 1: Loading face image dataset...")
    logger.info("=" * 60)

    try:
        dataset = load_dataset(
            dataset_dir,
            min_images_per_person=min_images,
            validate=True,
        )
        stats = get_dataset_stats(dataset)
        summary["dataset_stats"] = stats
        logger.info(f"Dataset loaded: {json.dumps(stats, indent=2)}")
    except (FileNotFoundError, ValueError) as e:
        summary["status"] = "failed"
        summary["errors"].append(f"Dataset loading failed: {e}")
        logger.error(f"Dataset loading failed: {e}")
        return summary

    if dry_run:
        summary["status"] = "dry_run_complete"
        logger.info("Dry run — skipping embedding generation.")
        return summary

    # Step 2: Determine version
    logger.info("=" * 60)
    logger.info("STEP 2: Determining version...")
    logger.info("=" * 60)

    version = 1
    if previous_path:
        prev = load_embeddings(previous_path)
        if prev and "version" in prev:
            version = prev["version"] + 1
            logger.info(f"Previous version: {prev['version']} → new version: {version}")
        else:
            logger.info("No previous embeddings found, starting at version 1")
    else:
        logger.info("No previous path specified, starting at version 1")

    # Step 3: Generate embeddings
    logger.info("=" * 60)
    logger.info("STEP 3: Generating embeddings...")
    logger.info("=" * 60)

    try:
        embeddings = generate_embeddings(
            dataset,
            device=device,
        )
        embeddings["version"] = version
        summary["embeddings_version"] = version
        summary["entries_generated"] = len(embeddings["entries"])
    except Exception as e:
        summary["status"] = "failed"
        summary["errors"].append(f"Embedding generation failed: {e}")
        logger.error(f"Embedding generation failed: {e}")
        return summary

    # Step 4: Validate schema
    logger.info("=" * 60)
    logger.info("STEP 4: Validating output schema...")
    logger.info("=" * 60)

    schema_errors = validate_schema(embeddings)
    if schema_errors:
        summary["status"] = "failed"
        summary["errors"].extend(schema_errors)
        logger.error(f"Schema validation failed: {schema_errors}")
        return summary

    logger.info("Schema validation passed ✓")

    # Step 5: Save output
    logger.info("=" * 60)
    logger.info("STEP 5: Saving embeddings.json...")
    logger.info("=" * 60)

    try:
        abs_path = save_embeddings(embeddings, output_path)
        summary["output_path"] = abs_path
        logger.info(f"Saved to: {abs_path}")
    except Exception as e:
        summary["status"] = "failed"
        summary["errors"].append(f"Save failed: {e}")
        logger.error(f"Save failed: {e}")
        return summary

    summary["status"] = "success"

    # Final summary
    logger.info("=" * 60)
    logger.info("PIPELINE COMPLETE")
    logger.info(f"  Version: {version}")
    logger.info(f"  Entries: {len(embeddings['entries'])}")
    logger.info(f"  Model:   {embeddings['model_version']}")
    logger.info(f"  Output:  {abs_path}")
    logger.info("=" * 60)

    return summary


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="AATCE Face Embedding Generation Pipeline"
    )
    parser.add_argument(
        "--dataset-dir",
        required=True,
        help="Path to the Face-Dataset directory",
    )
    parser.add_argument(
        "--output",
        default="embeddings.json",
        help="Output path for embeddings.json (default: embeddings.json)",
    )
    parser.add_argument(
        "--previous",
        default=None,
        help="Path to previous embeddings.json for version increment",
    )
    parser.add_argument(
        "--min-images",
        type=int,
        default=1,
        help="Minimum images per person (default: 1)",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=["cpu", "cuda"],
        help="PyTorch device (default: cpu)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Load dataset and validate without generating embeddings",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args()

    # Configure logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    summary = run_pipeline(
        dataset_dir=args.dataset_dir,
        output_path=args.output,
        previous_path=args.previous,
        min_images=args.min_images,
        device=args.device,
        dry_run=args.dry_run,
    )

    # Exit with appropriate code
    if summary["status"] == "success":
        logger.info("Pipeline completed successfully.")
        sys.exit(0)
    elif summary["status"] == "dry_run_complete":
        logger.info("Dry run completed.")
        sys.exit(0)
    else:
        logger.error(f"Pipeline failed: {summary['errors']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
