"""
publish.py — Upload a generated embeddings.json through the backend.

    python -m src.publish --input ./output/embeddings.json

Assigns version = (current published version + 1), validates, and sends it with
`publish_embeddings`. The backend stores it privately in Drive; kiosks fetch it
with `embeddings_download`. Nothing is committed to git or shared by link.
"""

import argparse
import logging
import sys

from .backend_client import BackendClient
from .embeddings import load_embeddings, validate_schema

logger = logging.getLogger(__name__)


def publish(client: BackendClient, input_path: str) -> int:
    embeddings = load_embeddings(input_path)
    if embeddings is None:
        raise FileNotFoundError(input_path)
    if not embeddings.get("entries"):
        raise ValueError("Refusing to publish an embeddings file with no entries")

    embeddings["version"] = client.call("embeddings_version")["version"] + 1
    errors = validate_schema(embeddings)
    if errors:
        raise ValueError(f"Schema errors: {errors}")

    result = client.call("publish_embeddings", embeddings=embeddings)
    logger.info(f"Published embeddings v{result['version']} ({result['entry_count']} people)")
    return result["version"]


def main():
    parser = argparse.ArgumentParser(description="Publish embeddings.json to the backend")
    parser.add_argument("--input", default="output/embeddings.json")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    try:
        publish(BackendClient.from_env(), args.input)
    except Exception as e:
        logger.error(f"Publish failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
