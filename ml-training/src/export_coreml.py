"""
export_coreml.py — Export the pipeline's FaceNet model to Core ML for the kiosk.

    python -m src.export_coreml --output FaceNet.mlpackage [--check]

The Core ML model takes a 160×160 RGB image named `face` and returns the
512-d `embedding`. Its input scale/bias reproduce embeddings.preprocess()
((x − 127.5) / 128) and it runs in float32, so kiosk embeddings are directly
comparable with the published embeddings.json.

--check (macOS only) compares Core ML and PyTorch outputs on random crops.
Requires: pip install -r requirements-export.txt
"""

import argparse
import logging
import platform
import sys

import numpy as np

from .embeddings import FACE_SIZE, MODEL_ID

logger = logging.getLogger(__name__)


def export(output_path: str):
    import coremltools as ct
    import torch
    from facenet_pytorch import InceptionResnetV1

    model = InceptionResnetV1(pretrained="vggface2").eval()
    traced = torch.jit.trace(model, torch.rand(1, 3, FACE_SIZE, FACE_SIZE))

    mlmodel = ct.convert(
        traced,
        inputs=[ct.ImageType(name="face", shape=(1, 3, FACE_SIZE, FACE_SIZE),
                             scale=1 / 128.0, bias=[-127.5 / 128.0] * 3,
                             color_layout=ct.colorlayout.RGB)],
        outputs=[ct.TensorType(name="embedding")],
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT32,
        minimum_deployment_target=ct.target.macOS13,
    )
    mlmodel.short_description = "FaceNet InceptionResnetV1 (VGGFace2) face embedding, L2-normalised"
    mlmodel.version = MODEL_ID
    mlmodel.save(output_path)
    logger.info(f"Saved {output_path}")
    return model, mlmodel


def check(model, mlmodel, samples: int = 5) -> float:
    """Returns the lowest cosine similarity between Core ML and PyTorch outputs."""
    import torch
    from PIL import Image

    rng = np.random.default_rng(0)
    worst = 1.0
    for _ in range(samples):
        pixels = rng.integers(0, 256, size=(FACE_SIZE, FACE_SIZE, 3), dtype=np.uint8)
        standardised = ((pixels.astype(np.float32) - 127.5) / 128.0).transpose(2, 0, 1)[None]
        with torch.no_grad():
            expected = model(torch.from_numpy(standardised)).numpy()[0]
        actual = np.asarray(mlmodel.predict({"face": Image.fromarray(pixels)})["embedding"]).reshape(-1)
        cosine = float(np.dot(expected, actual) / (np.linalg.norm(expected) * np.linalg.norm(actual)))
        worst = min(worst, cosine)
    return worst


def main():
    parser = argparse.ArgumentParser(description="Export FaceNet to Core ML")
    parser.add_argument("--output", default="FaceNet.mlpackage")
    parser.add_argument("--check", action="store_true", help="Compare against PyTorch (macOS only)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    model, mlmodel = export(args.output)
    if args.check:
        if platform.system() != "Darwin":
            logger.error("--check needs macOS (Core ML prediction)")
            sys.exit(1)
        worst = check(model, mlmodel)
        logger.info(f"Lowest Core ML vs PyTorch cosine similarity: {worst:.6f}")
        if worst < 0.999:
            sys.exit(1)


if __name__ == "__main__":
    main()
