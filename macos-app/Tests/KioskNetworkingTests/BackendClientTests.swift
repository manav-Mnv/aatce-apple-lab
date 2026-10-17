import Foundation
import XCTest
@testable import KioskNetworking

enum Fixture {
    static let status = #"{"success":true,"status":"online","timestamp":"2026-10-05T10:00:00+05:30","version":"2.0.0"}"#
    static let lookup = #"{"success":true,"enrollment_no":2021001,"is_member":true,"is_enrolled":false,"name":"Alice Student","email_hint":"al•••@paruluniversity.ac.in","photo_count":0}"#
    static let enroll = #"{"success":true,"enrollment_no":"W100","name":"Guest User","email_hint":"gu•••@gmail.com","is_member":false,"is_new":true,"photo_count":0}"#
    static let upload = #"{"success":true,"enrollment_no":"W100","saved":3,"photo_count":3}"#
    static let scanEntry = #"{"success":true,"action":"entry","session_id":"s-1","enrollment_no":"2021001","name":"Alice Student","entry_time":"2026-10-05T09:00:00+05:30"}"#
    static let scanExit = #"{"success":true,"action":"exit","session_id":"s-1","enrollment_no":"2021001","name":"Alice Student","entry_time":"2026-10-05T09:00:00+05:30","exit_time":"2026-10-05T11:30:00+05:30","duration_mins":"150","activity_email_sent":true}"#
    static let scanWorkshop = #"{"success":true,"action":"workshop_attendee","enrollment_no":"W100","name":"Guest User","already_logged":true}"#
    static let cooldown = #"{"success":false,"error":"Cooldown active. Please wait 85 seconds.","error_code":"cooldown","cooldown_remaining_seconds":85}"#
    static let version = #"{"success":true,"version":3,"generated_at":"2026-10-05T03:00:00+00:00","model_version":"facenet-inceptionresnetv1-vggface2","entry_count":1}"#
    static let download = #"{"success":true,"embeddings":{"version":3,"generated_at":"2026-10-05T03:00:00+00:00","model_version":"facenet-inceptionresnetv1-vggface2","entries":[{"enrollment_no":"2021001","embedding_vector":[0.6,0.8]}]}}"#
}

final class BackendClientTests: XCTestCase {
    private let projectURL = URL(string: "https://abcd.supabase.co")!
    private let endpoint = URL(string: "https://abcd.supabase.co/rest/v1/rpc/api")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    private func client(responding body: String, status: Int = 200) -> BackendClient {
        StubURLProtocol.setHandler { _ in (status, Data(body.utf8)) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return BackendClient(configuration: BackendConfiguration(projectURL: projectURL, publishableKey: "sb_publishable_test",
                                                                 secret: "kiosk-secret"),
                             session: URLSession(configuration: config))
    }

    private var lastBody: [String: Any] { StubURLProtocol.requests.last?.jsonBody ?? [:] }

    func testEveryCallIsAPostWithSecretAndActionInTheBody() async throws {
        _ = try await client(responding: Fixture.status).status()
        let request = try XCTUnwrap(StubURLProtocol.requests.last).request
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url, endpoint)
        XCTAssertNil(request.url?.query, "the secret must never be in the URL")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "apikey"), "sb_publishable_test")
        XCTAssertEqual(lastBody["secret"] as? String, "kiosk-secret")
        XCTAssertEqual(lastBody["action"] as? String, "status")
    }

    func testHeartbeatSendsHealthAndEvents() async throws {
        let beat = KioskHeartbeat(appVersion: "2.1.0", queued: 1, faces: 6, embeddingsVersion: 0,
                                  workshopName: "", matchThreshold: 0.6, problem: "")
        _ = try await client(responding: Fixture.status).heartbeat(beat, events: [
            KioskEvent(kind: .recognized, enrollmentNo: "2021001", score: 0.8),
            KioskEvent(kind: .livenessFailed)
        ])
        XCTAssertEqual(lastBody["action"] as? String, "heartbeat")
        XCTAssertEqual(lastBody["faces"] as? Int, 6)
        let events = try XCTUnwrap(lastBody["events"] as? [[String: Any]])
        XCTAssertEqual(events.map { $0["kind"] as? String }, ["recognized", "liveness_failed"])
        XCTAssertEqual(events[0]["enrollment_no"] as? String, "2021001")
        XCTAssertEqual(events[0]["score"] as? Double ?? 0, 0.8, accuracy: 1e-6)
        XCTAssertNil(events[1]["enrollment_no"])
    }

    func testLookupDecodesNumericEnrollmentNumbers() async throws {
        let response = try await client(responding: Fixture.lookup).lookup(enrollmentNo: "2021001")
        XCTAssertEqual(lastBody["enrollment_no"] as? String, "2021001")
        XCTAssertEqual(response.enrollmentNo, "2021001")
        XCTAssertTrue(response.isMember)
        XCTAssertEqual(response.name, "Alice Student")
    }

    func testEnrollAlwaysSendsConsentAndOmitsNilFields() async throws {
        _ = try await client(responding: Fixture.enroll).enroll(enrollmentNo: "2021001")
        XCTAssertEqual(lastBody["consent"] as? Bool, true)
        XCTAssertNil(lastBody["name"])
        XCTAssertNil(lastBody["email"])

        let response = try await client(responding: Fixture.enroll)
            .enroll(enrollmentNo: "W100", name: "Guest User", email: "guest@gmail.com")
        XCTAssertEqual(lastBody["name"] as? String, "Guest User")
        XCTAssertFalse(response.isMember)
        XCTAssertTrue(response.isNew)
    }

    func testUploadFacesSendsBase64Images() async throws {
        let jpeg = Data([0xFF, 0xD8, 0x01, 0xFF, 0xD9])
        let response = try await client(responding: Fixture.upload).uploadFaces(enrollmentNo: "W100", jpegImages: [jpeg])
        XCTAssertEqual(lastBody["images"] as? [String], [jpeg.base64EncodedString()])
        XCTAssertEqual(response.photoCount, 3)
    }

    func testScanOutcomes() async throws {
        let entry = try await client(responding: Fixture.scanEntry).scan(enrollmentNo: "2021001")
        XCTAssertEqual(entry.action, .entry)
        XCTAssertNil(lastBody["scanned_at"])
        XCTAssertEqual(lastBody["method"] as? String, "face")

        _ = try await client(responding: Fixture.scanEntry).scan(enrollmentNo: "2021001", manual: true)
        XCTAssertEqual(lastBody["method"] as? String, "manual")

        let exit = try await client(responding: Fixture.scanExit).scan(enrollmentNo: "2021001")
        XCTAssertEqual(exit.action, .exit)
        XCTAssertEqual(exit.durationMins, 150)

        let workshop = try await client(responding: Fixture.scanWorkshop).scan(enrollmentNo: "W100", workshopName: "Swift Basics")
        XCTAssertEqual(workshop.action, .workshopAttendee)
        XCTAssertTrue(workshop.alreadyLogged)
        XCTAssertEqual(lastBody["workshop_name"] as? String, "Swift Basics")
    }

    func testQueuedScanSendsOriginalTime() async throws {
        let scannedAt = Date(timeIntervalSince1970: 1_791_000_000)
        _ = try await client(responding: Fixture.scanEntry).scan(enrollmentNo: "2021001", scannedAt: scannedAt)
        let sent = try XCTUnwrap(lastBody["scanned_at"] as? String)
        XCTAssertEqual(ISO8601DateFormatter().date(from: sent), scannedAt)
    }

    func testCooldownIsATypedError() async {
        do {
            _ = try await client(responding: Fixture.cooldown).scan(enrollmentNo: "2021001")
            XCTFail("expected cooldown")
        } catch let error as BackendError {
            XCTAssertEqual(error.code, .cooldown)
            XCTAssertFalse(error.isRetryable)
            guard case .api(let api) = error else { return XCTFail("expected .api") }
            XCTAssertEqual(api.cooldownRemainingSeconds, 85)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testRetryableClassification() {
        XCTAssertTrue(BackendError.transport("offline").isRetryable)
        XCTAssertTrue(BackendError.httpStatus(503).isRetryable)
        XCTAssertFalse(BackendError.httpStatus(404).isRetryable)
        XCTAssertTrue(BackendError.api(APIError(errorCode: "server_error", message: "")).isRetryable)
        XCTAssertFalse(BackendError.api(APIError(errorCode: "not_enrolled", message: "")).isRetryable)
    }

    func testHTTPErrorAndNonJSONBodies() async {
        do {
            _ = try await client(responding: "oops", status: 500).status()
            XCTFail("expected error")
        } catch {
            XCTAssertEqual(error as? BackendError, .httpStatus(500))
        }
        do {
            _ = try await client(responding: "<html>Sign in</html>").status()
            XCTFail("expected error")
        } catch {
            guard case .decoding = error as? BackendError else { return XCTFail("expected .decoding, got \(error)") }
        }
    }

    func testEmbeddingsVersionAndDownload() async throws {
        let info = try await client(responding: Fixture.version).embeddingsVersion()
        XCTAssertEqual(info.version, 3)
        XCTAssertEqual(lastBody["action"] as? String, "embeddings_version")

        let file = try await client(responding: Fixture.download).downloadEmbeddings()
        XCTAssertEqual(lastBody["action"] as? String, "embeddings_download")
        XCTAssertEqual(file.version, 3)
        XCTAssertEqual(file.entries.first?.embeddingVector, [0.6, 0.8])
    }
}
