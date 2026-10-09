import XCTest
import Foundation
@testable import KioskNetworking

final class EmbeddingsSyncTests: XCTestCase {
    private let baseURL = URL(string: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec")!
    private let secret = "test-secret-12345"

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    override func tearDown() {
        StubURLProtocol.reset()
        super.tearDown()
    }

    private func makeSession() -> URLSession {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: sessionConfiguration)
    }

    private func makeService() -> EmbeddingsSyncService {
        let session = makeSession()
        let client = BackendClient(
            configuration: BackendConfiguration(baseURL: baseURL, sharedSecret: secret),
            session: session
        )
        return EmbeddingsSyncService(client: client, downloadSession: session)
    }

    private func metadataFixture(version: Int, downloadURL: String) -> String {
        #"{"success":true,"version":\#(version),"generated_at":"2026-10-01T12:00:00+05:30","model_version":"facenet-v1","drive_file_id":"1AbCdEfGhIjKlMnOpQrStUvWxYz","entry_count":152,"download_url":"\#(downloadURL)"}"#
    }

    private let driveFileFixture = #"{"version":4,"generated_at":"2026-10-02T12:00:00+05:30","model_version":"facenet-v2","entries":[{"enrollment_no":"2021001","embedding_vector":[0.1,0.2,0.3]},{"enrollment_no":"2021002","embedding_vector":[0.4,0.5,0.6]}]}"#

    private func setRoutingHandler(metadata: String) {
        StubURLProtocol.setHandler { request in
            guard let url = request.url, url.host == "drive.google.com" else {
                return (200, Data(metadata.utf8))
            }
            return (200, Data(self.driveFileFixture.utf8))
        }
    }

    func testSyncSkipsDownloadWhenVersionIsCurrent() async throws {
        let metadata = metadataFixture(
            version: 3,
            downloadURL: "https://drive.google.com/uc?export=download&id=FILE"
        )
        setRoutingHandler(metadata: metadata)

        let outcome = try await makeService().sync(localVersion: 3)

        XCTAssertEqual(outcome, .upToDate(currentVersion: 3))

        let recorded = StubURLProtocol.requests
        XCTAssertEqual(recorded.count, 1)
        XCTAssertEqual(recorded[0].request.httpMethod, "POST")
        XCTAssertEqual(recorded[0].request.url, baseURL)
    }

    func testSyncDownloadsNewerVersionDirectlyFromDrive() async throws {
        let metadata = metadataFixture(
            version: 4,
            downloadURL: "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz"
        )
        setRoutingHandler(metadata: metadata)

        let outcome = try await makeService().sync(localVersion: 3)

        guard case .updated(let file) = outcome else {
            return XCTFail("Expected .updated, got \(outcome)")
        }
        XCTAssertEqual(file.version, 4)
        XCTAssertEqual(file.modelVersion, "facenet-v2")
        XCTAssertEqual(file.entries.count, 2)
        XCTAssertEqual(file.entries[0].enrollmentNo, "2021001")
        XCTAssertEqual(file.entries[0].embeddingVector, [0.1, 0.2, 0.3])

        let recorded = StubURLProtocol.requests
        XCTAssertEqual(recorded.count, 2)

        XCTAssertEqual(recorded[0].request.httpMethod, "POST")
        XCTAssertEqual(recorded[0].request.url, baseURL)
        XCTAssertEqual(recorded[0].jsonBody?["action"] as? String, "embeddings_version")
        XCTAssertEqual(recorded[0].jsonBody?["secret"] as? String, secret)

        XCTAssertEqual(recorded[1].request.httpMethod, "GET")
        XCTAssertEqual(recorded[1].request.url?.host, "drive.google.com")
        XCTAssertTrue(
            recorded[1].request.url?.absoluteString.contains("1AbCdEfGhIjKlMnOpQrStUvWxYz") ?? false
        )
    }

    func testNoGetRequestsAreEverSentToTheBackend() async throws {
        let metadata = metadataFixture(
            version: 4,
            downloadURL: "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz"
        )
        setRoutingHandler(metadata: metadata)

        _ = try await makeService().sync(localVersion: 0)

        let backendRequests = StubURLProtocol.requests.filter {
            $0.request.url?.host == baseURL.host
        }
        XCTAssertFalse(backendRequests.isEmpty)
        for recorded in backendRequests {
            XCTAssertEqual(recorded.request.httpMethod, "POST")
            XCTAssertNil(recorded.request.url?.query)
            XCTAssertNil(recorded.request.value(forHTTPHeaderField: "X-Shared-Secret"))
        }
    }

    func testSyncThrowsWhenDownloadURLIsMissing() async throws {
        let metadata = metadataFixture(version: 5, downloadURL: "")
        setRoutingHandler(metadata: metadata)

        do {
            _ = try await makeService().sync(localVersion: 3)
            XCTFail("Expected invalid embeddings error")
        } catch let error as BackendError {
            guard case .invalidEmbeddingsFile = error else {
                return XCTFail("Expected .invalidEmbeddingsFile, got \(error)")
            }
        }
    }

    func testSyncThrowsWhenDownloadedFileVersionDoesNotMatchMetadata() async throws {
        let metadata = metadataFixture(
            version: 4,
            downloadURL: "https://drive.google.com/uc?export=download&id=FILE"
        )
        StubURLProtocol.setHandler { request in
            if request.url?.host == "drive.google.com" {
                let newer = #"{"version":99,"generated_at":"2026-10-02T12:00:00+05:30","model_version":"facenet-v2","entries":[]}"#
                return (200, Data(newer.utf8))
            }
            return (200, Data(metadata.utf8))
        }

        do {
            _ = try await makeService().sync(localVersion: 3)
            XCTFail("Expected version mismatch error")
        } catch let error as BackendError {
            guard case .invalidEmbeddingsFile = error else {
                return XCTFail("Expected .invalidEmbeddingsFile, got \(error)")
            }
        }
    }

    func testSyncThrowsWhenDownloadedFileIsNotValidJSON() async throws {
        let metadata = metadataFixture(
            version: 4,
            downloadURL: "https://drive.google.com/uc?export=download&id=FILE"
        )
        StubURLProtocol.setHandler { request in
            if request.url?.host == "drive.google.com" {
                return (200, Data("<html>Google Drive virus scan confirm</html>".utf8))
            }
            return (200, Data(metadata.utf8))
        }

        do {
            _ = try await makeService().sync(localVersion: 3)
            XCTFail("Expected invalid file error")
        } catch let error as BackendError {
            guard case .invalidEmbeddingsFile = error else {
                return XCTFail("Expected .invalidEmbeddingsFile, got \(error)")
            }
        }
    }

    func testCurrentVersionChecksBackendWithoutDriveTraffic() async throws {
        let metadata = metadataFixture(
            version: 4,
            downloadURL: "https://drive.google.com/uc?export=download&id=FILE"
        )
        setRoutingHandler(metadata: metadata)

        let info = try await makeService().currentVersion()

        XCTAssertEqual(info.version, 4)
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
        XCTAssertEqual(StubURLProtocol.requests[0].request.httpMethod, "POST")
    }
}
