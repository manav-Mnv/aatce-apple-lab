# ML Training Pipeline — AATCE Apple Lab Attendance System

Python pipeline for generating face embeddings from the Face-Dataset, used by the kiosk app for on-device matching (per [SRS v2.0 §6, Phase 4](../docs/SRS.md)).

## Architecture

- **Model:** FaceNet (InceptionResnetV1, pretrained on VGGFace2) via `facenet-pytorch`
- **Face detection:** MTCNN (Multi-Task Cascaded Convolutional Networks)
- **Output:** `embeddings.json` — canonical schema consumed by the backend and kiosk app
- **Scheduling:** Weekly via GitHub Actions ([`.github/workflows/retrain.yml`](../.github/workflows/retrain.yml))
- **Secrets:** Google service account key stored as GitHub encrypted secret (NFR-8)

## Project Structure

```
ml-training/
├── src/
│   ├── __init__.py
│   ├── dataset.py          # Face image dataset loader
│   ├── embeddings.py       # Embedding generation (FaceNet + MTCNN)
│   └── pipeline.py         # Main orchestrator (CLI entry point)
├── tests/
│   ├── __init__.py
│   ├── test_dataset.py     # Dataset loader tests (13 tests)
│   ├── test_embeddings.py  # Embedding generation tests (10 tests)
│   ├── test_schema.py      # Schema contract tests (17 tests)
│   └── test_pipeline.py    # Pipeline orchestrator tests (7 tests)
├── output/                  # Generated embeddings (gitignored except embeddings.json)
├── pyproject.toml
├── requirements.txt
└── README.md
```

## Setup

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt
```

## Usage

```bash
# Full pipeline (requires face images in Face-Dataset/)
python -m src.pipeline \
    --dataset-dir ./Face-Dataset \
    --output ./output/embeddings.json \
    --previous ./output/embeddings.json \
    --verbose

# Dry run (validates dataset only, no model download)
python -m src.pipeline \
    --dataset-dir ./Face-Dataset \
    --dry-run

# With GPU
python -m src.pipeline \
    --dataset-dir ./Face-Dataset \
    --output ./output/embeddings.json \
    --device cuda
```

## Testing

```bash
# Run all tests (no GPU or model download required)
python -m pytest tests/ -v

# With coverage
python -m pytest tests/ -v --cov=src --cov-report=term-missing
```

## embeddings.json Schema

See [`backend/API_CONTRACT.md`](../backend/API_CONTRACT.md) for the canonical schema documentation. The pipeline validates output against this schema before writing.

```json
{
  "version": 1,
  "generated_at": "2026-10-01T12:00:00+00:00",
  "model_version": "facenet-inceptionresnetv1-vggface2",
  "entries": [
    {
      "enrollment_no": "2021001",
      "embedding_vector": [0.123, -0.456, ...]
    }
  ]
}
```

## Face-Dataset Structure

```
Face-Dataset/
├── 2021001/
│   ├── face_1.jpg
│   ├── face_2.jpg
│   └── face_3.jpg
├── 2021002/
│   └── face_1.png
└── ...
```

Each subdirectory is named by enrollment number. Contains 1–5 face images per person (SRS FR-3).
