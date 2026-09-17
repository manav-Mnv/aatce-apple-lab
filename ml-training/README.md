# ML Training Pipeline

Python pipeline for managing face data and model training.

## Responsibilities
- Ingest raw face images from /face-dataset (organized by enrollment number).
- Generate embeddings from face images.
- Retrain and fine-tune the CoreML face matching model used by the macOS app.
- Implement a human-in-the-loop step for correcting low-confidence or misidentified matches.
