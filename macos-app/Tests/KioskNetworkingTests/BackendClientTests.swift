import XCTest
import Foundation
@testable import KioskNetworking

enum Fixture {
    static let status = #"{"success":true,"status":"online","timestamp":"2026-10-01T14:00:00+05:30","version":"1.0.0"}"#

    static let enrollNew = #"{"success":true,"enrollment_no":"2025999","name":"New Person","email":"new@test.com","is_new":true,"face_dataset_path":"/Face-Dataset/2025999/","registered_at":"2026-10-01T14:30:00+05:30"}"#

    static let scanEntry = #"{"success":true,"action":"entry","session_id":"a1b2c3d4-uuid","enrollment_no":"2021001","entry_time":"2026-10-01T09:00:00+05:30"}"#

    static let scanExit = #"{"success":true,"action":"exit","session_id":"a1b2c3d4-uuid","enrollment_no":"2021001","entry_time":"2026-10-01T09:00:00+05:30","exit_time":"2026-10-01T11:30:00+05:30","duration_mins":150}"#

    static let scanWorkshop = #"{"success":true,"action":"workshop_attendee","enrollment_no":"9999999","message":"Logged as workshop attendee (not in Master_Students roster)"}"#

    static let cooldown = #"{"success":false,"error":"Cooldown active. Please wait 85 seconds.","error_code":"cooldown","cooldown_remaining_seconds":85}"#

    static let authInvalid = #"{"success":false,"error":"Invalid authentication secret","error_code":"auth_invalid"}"#

    static let embeddingsVersion = #"{"success":true,"version":3,"generated_at":"2026-10-01T12:00:00+05:30","model_version":"facenet-v1","drive_file_id":"1AbCdEfGhIjKlMnOpQrStUvWxYz","entry_count":152,"download_url":"https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz"}"#

    static let attendanceLog = """
    {"success":true,"count":3,"entries":[
      {"session_id":"s1","enrollment_no":"2021001","entry_time":"2026-10-01T09:00:00+05:30","exit_time":"2026-10-01T11:30:00+05:30","duration_mins":150,"activity_form_status":"completed","activity_description":"Worked on SwiftUI tutorial","email_sent":"yes","notes":""},
      {"session_id":"s2","enrollment_no":2021002,"entry_time":"2026-10-01T10:00:00+05:30","exit_time":"","duration_mins":"","activity_form_status":"pending","activity_description":"","email_sent":"no","notes":""},
      {"session_id":"s3","enrollment_no":"2021003","entry_time":"2026-10-01T08:00:00+05:30","exit_time":"2026-10-01T09:00:00+05:30","duration_mins":"60","activity_form_status":"completed","activity_description":"","email_sent":"yes","notes":""}
    ]}
    """

    static let students = #"{"success":true,"count":1,"students":[{"enrollment_no":"2021001","name":"Alice Student","email":"alice@paruluniversity.ac.in","batch_tags":"SCC/5-7","face_dataset_path":"/Face-Dataset/2021001/","registered_at":"2026-01-15T10:00:00+05:30"}]}"#
}

final class BackendClientTests: XCTestCase {
    private let baseURL = URL(string: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec")!
    private let secret = "test-secret-12345"

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
        StubURLProtocol.setHandler { request in
            (500, Data("unexpected".utf8))
        }
    }

    override func tearDown() {
        StubURLProtocol.reset()
        super.tearDown()
    }

    private func makeClient() -> BackendClient {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: sessionConfiguration)
        return BackendClient(
            configuration: BackendConfiguration(baseURL: baseURL, sharedSecret: secret),
            session: session
        )
    }

    private func handler(
        status: String = Fixture.status,
        enroll: String = Fixture.enrollNew,
        scan: String = Fixture.scanEntry,
        embeddings: String = Fixture.embeddingsVersion,
        attendance: String = Fixture.attendanceLog,
        students: String = Fixture.students
    ) -> StubURLProtocol.Handler {
        return { request in
            let body = StubURLProtocol.requests.last?.jsonBody
            let action = body?["action"] as? String ?? ""
            switch action {
            case "status": return (200, Data(status.utf8))
            case "enroll": return (200, Data(enroll.utf8))
            case "scan": return (200, Data(scan.utf8))
            case "embeddings_version": return (200, Data(embeddings.utf8))
            case "attendance_log": return (200, Data(attendance.utf8))
            case "students": return (200, Data(students.utf8))
            default: return (200, Data(Fixture.authInvalid.utf8))
            }
        }
    }

    func testEveryBackendCallIsPostWithSecretInJSONBody() async throws {
        StubURLProtocol.setHandler(handler())

        let client = makeClient()
        _ = try await client.status()
        _ = try await client.enroll(enrollmentNo: "2025999", name: "New Person", email: "new@test.com")
        _ = try await client.scan(enrollmentNo: "2021001")
        _ = try await client.embeddingsVersion()
        _ = try await client.attendanceLog(date: "2026-10-01")
        _ = try await client.students(batch: "SCC/5-7")

        let recorded = StubURLProtocol.requests
        XCTAssertEqual(recorded.count, 6)

        let expectedActions = [
            "status",
            "enroll",
            "scan",
            "embeddings_version",
            "attendance_log",
            "students"
        ]

        for (index, recordedRequest) in recorded.enumerated() {
            let request = recordedRequest.request
            XCTAssertEqual(request.httpMethod, "POST", "Request \(index) must be POST")
            XCTAssertEqual(request.url, baseURL, "Request \(index) must hit the base URL")
            XCTAssertNil(request.url?.query, "Request \(index) must not use query parameters")
            XCTAssertNil(
                request.value(forHTTPHeaderField: "X-Shared-Secret"),
                "Request \(index) must not send an auth header"
            )
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Content-Type"),
                "application/json"
            )

            guard let body = recordedRequest.jsonBody else {
                XCTFail("Request \(index) has no JSON body")
                continue
            }
            XCTAssertEqual(body["secret"] as? String, secret, "Request \(index) missing secret")
            XCTAssertEqual(
                body["action"] as? String,
                expectedActions[index],
                "Request \(index) has wrong action"
            )
        }
    }

    func testEnrollBodyMatchesContractFieldNames() async throws {
        StubURLProtocol.setHandler(handler())

        let client = makeClient()
        _ = try await client.enroll(
            enrollmentNo: "2025999",
            name: "New Person",
            email: "new@test.com"
        )

        guard let body = StubURLProtocol.requests.last?.jsonBody else {
            return XCTFail("No request recorded")
        }
        XCTAssertEqual(
            Set(body.keys),
            Set(["secret", "action", "enrollment_no", "name", "email"])
        )
        XCTAssertEqual(body["enrollment_no"] as? String, "2025999")
    }

    func testEnrollOmitsOptionalFieldsWhenNotProvided() async throws {
        StubURLProtocol.setHandler(handler())

        let client = makeClient()
        _ = try await client.enroll(enrollmentNo: "2021001")

        guard let body = StubURLProtocol.requests.last?.jsonBody else {
            return XCTFail("No request recorded")
        }
        XCTAssertEqual(Set(body.keys), Set(["secret", "action", "enrollment_no"]))
    }

    func testOptionalFiltersAreOmittedWhenNil() async throws {
        StubURLProtocol.setHandler(handler())

        let client = makeClient()
        _ = try await client.attendanceLog()
        _ = try await client.students()

        let recorded = StubURLProtocol.requests
        XCTAssertEqual(recorded.count, 2)
        XCTAssertEqual(Set((recorded[0].jsonBody ?? [:]).keys), Set(["secret", "action"]))
        XCTAssertEqual(Set((recorded[1].jsonBody ?? [:]).keys), Set(["secret", "action"]))
    }

    func testOptionalFiltersAreIncludedWhenProvided() async throws {
        StubURLProtocol.setHandler(handler())

        let client = makeClient()
        _ = try await client.attendanceLog(date: "2026-10-01", enrollmentNo: "2021001")
        _ = try await client.students(batch: "SCC/5-7", enrollmentNo: "2021001")

        let recorded = StubURLProtocol.requests
        XCTAssertEqual(recorded[0].jsonBody?["date"] as? String, "2026-10-01")
        XCTAssertEqual(recorded[0].jsonBody?["enrollment_no"] as? String, "2021001")
        XCTAssertEqual(recorded[1].jsonBody?["batch"] as? String, "SCC/5-7")
        XCTAssertEqual(recorded[1].jsonBody?["enrollment_no"] as? String, "2021001")
    }

    func testScanEntryResponseDecoding() async throws {
        StubURLProtocol.setHandler(handler(scan: Fixture.scanEntry))

        let response = try await makeClient().scan(enrollmentNo: "2021001")

        XCTAssertEqual(response.action, .entry)
        XCTAssertEqual(response.sessionId, "a1b2c3d4-uuid")
        XCTAssertEqual(response.enrollmentNo, "2021001")
        XCTAssertEqual(response.entryTime, "2026-10-01T09:00:00+05:30")
        XCTAssertNil(response.exitTime)
        XCTAssertNil(response.durationMins)
    }

    func testScanExitResponseDecoding() async throws {
        StubURLProtocol.setHandler(handler(scan: Fixture.scanExit))

        let response = try await makeClient().scan(enrollmentNo: "2021001")

        XCTAssertEqual(response.action, .exit)
        XCTAssertEqual(response.exitTime, "2026-10-01T11:30:00+05:30")
        XCTAssertEqual(response.durationMins, 150)
    }

    func testScanWorkshopAttendeeResponseDecoding() async throws {
        StubURLProtocol.setHandler(handler(scan: Fixture.scanWorkshop))

        let response = try await makeClient().scan(enrollmentNo: "9999999")

        XCTAssertEqual(response.action, .workshopAttendee)
        XCTAssertEqual(response.enrollmentNo, "9999999")
        XCTAssertNotNil(response.message)
        XCTAssertNil(response.sessionId)
    }

    func testCooldownThrowsTypedErrorWithRemainingSeconds() async throws {
        StubURLProtocol.setHandler(handler(scan: Fixture.cooldown))

        do {
            _ = try await makeClient().scan(enrollmentNo: "2021001")
            XCTFail("Expected cooldown error")
        } catch let error as BackendError {
            XCTAssertTrue(error.isCooldown)
            XCTAssertEqual(error.apiError?.code, .cooldown)
            XCTAssertEqual(error.apiError?.cooldownRemainingSeconds, 85)
        }
    }

    func testAuthInvalidThrowsAuthenticationFailure() async throws {
        StubURLProtocol.setHandler { _ in (200, Data(Fixture.authInvalid.utf8)) }

        do {
            _ = try await makeClient().status()
            XCTFail("Expected auth error")
        } catch let error as BackendError {
            XCTAssertTrue(error.isAuthenticationFailure)
            XCTAssertEqual(error.apiError?.code, .authInvalid)
            XCTAssertEqual(error.apiError?.message, "Invalid authentication secret")
        }
    }

    func testUnknownErrorCodePreservesRawValue() async throws {
        let body = #"{"success":false,"error":"Something new","error_code":"brand_new_code"}"#
        StubURLProtocol.setHandler { _ in (200, Data(body.utf8)) }

        do {
            _ = try await makeClient().status()
            XCTFail("Expected API error")
        } catch let error as BackendError {
            XCTAssertEqual(error.apiError?.errorCode, "brand_new_code")
            XCTAssertNil(error.apiError?.code)
            XCTAssertFalse(error.isAuthenticationFailure)
        }
    }

    func testNonJSONResponseThrowsDecodingError() async throws {
        StubURLProtocol.setHandler { _ in (200, Data("<html>Gateway error</html>".utf8)) }

        do {
            _ = try await makeClient().status()
            XCTFail("Expected decoding error")
        } catch let error as BackendError {
            guard case .decoding = error else {
                return XCTFail("Expected .decoding, got \(error)")
            }
        }
    }

    func testNonSuccessHTTPStatusThrowsHTTPStatusError() async throws {
        StubURLProtocol.setHandler { _ in (503, Data("Service Unavailable".utf8)) }

        do {
            _ = try await makeClient().status()
            XCTFail("Expected HTTP status error")
        } catch let error as BackendError {
            XCTAssertEqual(error, .httpStatus(503))
        }
    }

    func testAttendanceLogResponseDecodingWithMixedSheetTypes() async throws {
        StubURLProtocol.setHandler(handler())

        let response = try await makeClient().attendanceLog()

        XCTAssertEqual(response.count, 3)
        XCTAssertEqual(response.entries.count, 3)
        XCTAssertEqual(response.entries[0].durationMins, 150)
        XCTAssertEqual(response.entries[0].enrollmentNo, "2021001")
        XCTAssertEqual(response.entries[0].activityDescription, "Worked on SwiftUI tutorial")
        XCTAssertEqual(response.entries[1].enrollmentNo, "2021002")
        XCTAssertNil(response.entries[1].durationMins)
        XCTAssertEqual(response.entries[1].exitTime, "")
        XCTAssertEqual(response.entries[2].durationMins, 60)
    }

    func testStudentsResponseDecoding() async throws {
        StubURLProtocol.setHandler(handler())

        let response = try await makeClient().students()

        XCTAssertEqual(response.count, 1)
        XCTAssertEqual(response.students[0].enrollmentNo, "2021001")
        XCTAssertEqual(response.students[0].batchTags, "SCC/5-7")
        XCTAssertEqual(response.students[0].faceDatasetPath, "/Face-Dataset/2021001/")
    }

    func testEnrollResponseDecoding() async throws {
        StubURLProtocol.setHandler(handler())

        let response = try await makeClient().enroll(enrollmentNo: "2025999")

        XCTAssertTrue(response.isNew)
        XCTAssertEqual(response.name, "New Person")
        XCTAssertEqual(response.email, "new@test.com")
        XCTAssertEqual(response.faceDatasetPath, "/Face-Dataset/2025999/")
    }

    func testStatusResponseDecoding() async throws {
        StubURLProtocol.setHandler(handler())

        let response = try await makeClient().status()

        XCTAssertEqual(response.status, "online")
        XCTAssertEqual(response.version, "1.0.0")
    }

    func testEmbeddingsVersionReturnsMetadataNotVectors() async throws {
        StubURLProtocol.setHandler(handler())

        let response = try await makeClient().embeddingsVersion()

        XCTAssertEqual(response.version, 3)
        XCTAssertEqual(response.entryCount, 152)
        XCTAssertEqual(response.driveFileId, "1AbCdEfGhIjKlMnOpQrStUvWxYz")
        XCTAssertEqual(
            response.downloadUrl,
            "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz"
        )

        let body = StubURLProtocol.requests.last?.jsonBody ?? [:]
        XCTAssertEqual(Set(body.keys), Set(["secret", "action"]))
    }
}
