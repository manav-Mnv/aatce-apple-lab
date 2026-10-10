# Kiosk app — AATCE Kiosk (macOS)

SwiftUI app for the lab iMac: recognises enrolled students on-device, checks for a head turn, and
records check-in/out through the backend; also runs self-serve enrollment.

- **Install and configure on a Mac:** [../docs/MAC_SETUP.md](../docs/MAC_SETUP.md)
- **How matching, liveness and the offline queue work:** [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) §5

## Package layout (Swift Package, macOS 13+)

| Target | Contents |
|---|---|
| `KioskNetworking` | `BackendClient` (kiosk role of API v2), models, typed `BackendError` with `isRetryable` |
| `KioskCore` | `FaceMatcher` (cosine + margin), `Vector`, `EmbeddingStore` (published file + local templates), `ScanQueue` (durable offline queue) |
| `AATCEKiosk` (app) | `KioskModel` (scan state machine), `EnrollmentModel`, `CameraService` (AVFoundation + Vision + crop), `FaceEmbedder` (Core ML), `KioskSettings` (UserDefaults + Keychain), SwiftUI views |
| `AppBundle/Info.plist` | Bundle id `club.scc.aatce.kiosk`, camera usage text |
| `scripts/build-app.sh` | Builds `build/AATCE Kiosk.app` (+ zip), optionally compiling `FaceNet.mlpackage` into it, ad-hoc signed |

## Commands (on a Mac)
```bash
swift test
```
```bash
swift run AATCEKiosk
```
```bash
./scripts/build-app.sh ../ml-training/FaceNet.mlpackage
```
CI (`.github/workflows/ci.yml`) builds and tests on every push; `kiosk-release.yml` exports the model,
checks it against PyTorch and uploads the finished app as the `AATCE-Kiosk` artifact.
