# ML pipeline — face embeddings

Turns the enrollment photos stored in Supabase into `embeddings.json` (one 512-d FaceNet vector per person)
and publishes it through the backend; also exports the same model to Core ML for the kiosk.
Algorithms: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) §5.

## Modules (`src/`)
| File | Does |
|---|---|
| `backend_client.py` | POST client for the Supabase API (pipeline role); reads `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PIPELINE_SECRET` from the environment |
| `sync_faces.py` | Mirrors `Face-Dataset/<enrollment_no>/` locally via `face_manifest` + `face_images` (25 per call) |
| `dataset.py` | Loads and validates the local photo folders |
| `embeddings.py` | Preprocessing `(x − 127.5)/128`, FaceNet InceptionResnetV1 (VGGFace2), per-person mean + L2 normalisation, schema validation |
| `pipeline.py` | CLI: dataset → embeddings → validated `embeddings.json` (`version: 0`) |
| `publish.py` | Sets `version = current + 1` and calls `publish_embeddings` |
| `export_coreml.py` | Exports the model to `FaceNet.mlpackage`; `--check` (macOS) compares with PyTorch |

## Requirements files
| File | For |
|---|---|
| `requirements-dev.txt` | unit tests only (no torch — the model is injected as a function) |
| `requirements.txt` | running the pipeline (torch CPU, facenet-pytorch 2.5.3) |
| `requirements-export.txt` | Core ML export (pinned: torch 2.7.1, coremltools 9.0, numpy 2.2.6) |

## Run
```bash
pip install -r requirements-dev.txt && python -m pytest
```
```bash
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```
```bash
python -m src.sync_faces --dataset-dir ./Face-Dataset && python -m src.pipeline --dataset-dir ./Face-Dataset --output ./output/embeddings.json && python -m src.publish --input ./output/embeddings.json
```
(The last command needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `PIPELINE_SECRET` set.) In production this runs weekly
in `.github/workflows/retrain.yml`. `Face-Dataset/`, `output/` and `*.mlpackage` are git-ignored:
**never commit photos or embeddings.**
