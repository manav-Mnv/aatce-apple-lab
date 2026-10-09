# macOS App

Swift/SwiftUI application designed to run on the lab's front desk iMac.

## Responsibilities
- **Enrollment Mode**: Link a new face to an existing enrollment number.
- **Scan Mode**: Normal entry/exit logging mode using the iMac's camera.
- **Face Detection**: Uses Apple's Vision framework to detect faces in the video feed.
- **Face Matching**: Uses a custom CoreML embedding model to identify the student.

## Networking layer (`KioskNetworking`)

Swift package implementing `backend/API_CONTRACT.md` **v1.2.0**.

- **POST-only**: every backend call is a `POST` to `/exec` with a JSON body; the client never
  sends GET requests to the backend (Apps Script cannot read custom headers, and query-param
  secrets would leak into logs).
- **Auth**: the shared secret is injected into every JSON body as `secret` alongside `action`
  by `BackendClient` — callers never handle it per-request.
- **Endpoints**: `enroll`, `scan`, `embeddings_version`, `status`, `attendance_log`, `students`.
  (`update_embeddings_meta` is ML-pipeline-only and intentionally not exposed here.)
- **Errors**: `{ success: false, error, error_code }` envelopes are decoded into typed
  `BackendError.api(APIError)` values (`cooldown` carries `cooldown_remaining_seconds`).
- **Embeddings sync**: `EmbeddingsSyncService` POSTs `embeddings_version`, and only when the
  remote `version` is newer does it download `embeddings.json` from the Drive `download_url`
  — full vectors never pass through Apps Script (NFR-7).

```swift
import KioskNetworking

let client = BackendClient(configuration: BackendConfiguration(
    baseURL: URL(string: "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec")!,
    sharedSecret: secret
))
let status = try await client.status()
let outcome = try await EmbeddingsSyncService(client: client).sync(localVersion: localVersion)
```

Run the tests (macOS): `swift test` from this directory. CI runs the same.
