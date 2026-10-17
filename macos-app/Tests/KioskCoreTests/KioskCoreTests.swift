import Foundation
import XCTest
import KioskNetworking
@testable import KioskCore

final class FaceMatcherTests: XCTestCase {
    private func unit(_ angle: Float) -> [Float] { [cos(angle), sin(angle), 0] }

    func testMatchesTheClosestPersonAboveThreshold() {
        let matcher = FaceMatcher(templates: ["A": unit(0), "B": unit(1.2)])
        let match = matcher.bestMatch(for: unit(0.1))
        XCTAssertEqual(match?.enrollmentNo, "A")
        XCTAssertEqual(match?.score ?? 0, cos(0.1), accuracy: 1e-5)
    }

    func testRejectsBelowThreshold() {
        let matcher = FaceMatcher(templates: ["A": unit(0)], threshold: 0.65)
        XCTAssertNil(matcher.bestMatch(for: unit(0.9)))   // cos(0.9) ≈ 0.62
        XCTAssertNotNil(matcher.bestMatch(for: unit(0.8))) // cos(0.8) ≈ 0.70
    }

    func testRejectsAmbiguousMatches() {
        let matcher = FaceMatcher(templates: ["A": unit(0), "B": unit(0.2)], threshold: 0.5, margin: 0.05)
        XCTAssertNil(matcher.bestMatch(for: unit(0.1)), "equally close to A and B")
        XCTAssertEqual(matcher.bestMatch(for: unit(-0.3))?.enrollmentNo, "A")
    }

    func testNormalisesInputsAndIgnoresBadVectors() {
        let matcher = FaceMatcher(templates: ["A": [10, 0, 0], "zero": [0, 0, 0], "short": [1, 0]])
        XCTAssertEqual(matcher.count, 2)
        XCTAssertEqual(matcher.bestMatch(for: [3, 0.1, 0])?.enrollmentNo, "A")
        XCTAssertNil(matcher.bestMatch(for: [0, 0, 0]))
    }

    func testEvaluateReportsTheClosestEvenBelowThreshold() {
        let matcher = FaceMatcher(templates: ["A": unit(0), "B": unit(1.2)], threshold: 0.65)
        let result = matcher.evaluate(unit(0.9))
        XCTAssertEqual(result.closest?.enrollmentNo, "A")
        XCTAssertEqual(result.closest?.score ?? 0, cos(0.9), accuracy: 1e-5)
        XCTAssertEqual(result.runnerUp, cos(0.3), accuracy: 1e-5)
        XCTAssertNil(matcher.bestMatch(for: unit(0.9)))
    }

    func testEmptyMatcher() {
        XCTAssertNil(FaceMatcher(templates: [:]).bestMatch(for: [1, 0, 0]))
    }

    func testMeanIsUnitLength() throws {
        let mean = try XCTUnwrap(Vector.mean([unit(0), unit(0.4)]))
        XCTAssertEqual(Vector.dot(mean, mean), 1, accuracy: 1e-5)
        XCTAssertEqual(mean[1] / mean[0], tan(0.2), accuracy: 1e-5)
        XCTAssertNil(Vector.mean([[1, 0], [1, 0, 0]]))
    }
}

final class EmbeddingStoreTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func file(version: Int, generatedAt: String, ids: [String]) -> EmbeddingsFile {
        EmbeddingsFile(version: version, generatedAt: generatedAt, modelVersion: "m",
                       entries: ids.map { EmbeddingEntry(enrollmentNo: $0, embeddingVector: [1, 0]) })
    }

    func testPersistsAcrossInstances() throws {
        let store = try EmbeddingStore(directory: directory)
        XCTAssertEqual(store.publishedVersion, 0)
        try store.replacePublished(file(version: 3, generatedAt: "2026-10-05T03:00:00+00:00", ids: ["A"]))
        try store.addLocal(LocalEnrollment(enrollmentNo: "B", vector: [0, 1], createdAt: Date()))

        let reloaded = try EmbeddingStore(directory: directory)
        XCTAssertEqual(reloaded.publishedVersion, 3)
        XCTAssertEqual(Set(reloaded.templates.keys), ["A", "B"])
    }

    func testLocalEnrollmentOverridesPublishedVector() throws {
        let store = try EmbeddingStore(directory: directory)
        try store.replacePublished(file(version: 1, generatedAt: "2026-10-01T00:00:00Z", ids: ["A"]))
        try store.addLocal(LocalEnrollment(enrollmentNo: "A", vector: [0, 1], createdAt: Date(timeIntervalSince1970: 1_791_500_000)))
        XCTAssertEqual(store.templates["A"], [0, 1])
    }

    func testLocalTemplateIsDroppedOnlyWhenANewerFileIncludesThePerson() throws {
        let store = try EmbeddingStore(directory: directory)
        let enrolledAt = ISO8601DateFormatter().date(from: "2026-10-05T10:00:00Z")!
        try store.addLocal(LocalEnrollment(enrollmentNo: "B", vector: [0, 1], createdAt: enrolledAt))

        try store.replacePublished(file(version: 2, generatedAt: "2026-10-04T00:00:00Z", ids: ["B"]))
        XCTAssertNotNil(store.local["B"], "file is older than the enrollment")

        try store.replacePublished(file(version: 3, generatedAt: "2026-10-12T00:00:00Z", ids: ["A"]))
        XCTAssertNotNil(store.local["B"], "newer file does not include B (e.g. photo upload never arrived)")

        try store.replacePublished(file(version: 4, generatedAt: "2026-10-12T00:00:00Z", ids: ["A", "B"]))
        XCTAssertNil(store.local["B"])
        XCTAssertNil(try EmbeddingStore(directory: directory).local["B"], "pruning is persisted")
    }
}

final class ScanQueueTests: XCTestCase {
    private var fileURL: URL!

    override func setUpWithError() throws {
        fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString).appendingPathComponent("queue.json")
    }

    private func scan(_ id: String) -> QueuedScan {
        QueuedScan(enrollmentNo: id, scannedAt: Date(timeIntervalSince1970: 1_791_000_000), manual: false)
    }

    func testQueuedScansSurviveARestart() async throws {
        let queue = ScanQueue(fileURL: fileURL)
        try await queue.enqueue(scan("A"))
        try await queue.enqueue(scan("B"))

        // Simulates the kiosk crashing and relaunching: a fresh instance reads the file.
        let relaunched = ScanQueue(fileURL: fileURL)
        let pending = await relaunched.pending
        XCTAssertEqual(pending.map(\.enrollmentNo), ["A", "B"])
        XCTAssertEqual(pending.first?.scannedAt, Date(timeIntervalSince1970: 1_791_000_000))
    }

    func testFlushSendsInOrderAndEmptiesTheQueue() async throws {
        let queue = ScanQueue(fileURL: fileURL)
        for id in ["A", "B", "C"] { try await queue.enqueue(scan(id)) }

        let sent = Recorder()
        let result = await queue.flush { await sent.add($0.enrollmentNo) }
        XCTAssertEqual(result, FlushResult(sent: 3, dropped: 0, remaining: 0))
        let order = await sent.items
        XCTAssertEqual(order, ["A", "B", "C"])
        let reloaded = await ScanQueue(fileURL: fileURL).pending
        XCTAssertTrue(reloaded.isEmpty)
    }

    func testRetryableErrorStopsTheFlushAndKeepsTheScan() async throws {
        let queue = ScanQueue(fileURL: fileURL)
        for id in ["A", "B"] { try await queue.enqueue(scan(id)) }

        let result = await queue.flush { _ in throw BackendError.transport("offline") }
        XCTAssertEqual(result, FlushResult(sent: 0, dropped: 0, remaining: 2))
        let pending = await queue.pending
        XCTAssertEqual(pending.map(\.enrollmentNo), ["A", "B"])
    }

    func testPermanentRejectionIsDropped() async throws {
        let queue = ScanQueue(fileURL: fileURL)
        for id in ["A", "B"] { try await queue.enqueue(scan(id)) }

        let result = await queue.flush { scan in
            if scan.enrollmentNo == "A" {
                throw BackendError.api(APIError(errorCode: "cooldown", message: "wait"))
            }
        }
        XCTAssertEqual(result, FlushResult(sent: 1, dropped: 1, remaining: 0))
    }

    func testConcurrentFlushesNeverSendTwice() async throws {
        let queue = ScanQueue(fileURL: fileURL)
        try await queue.enqueue(scan("A"))
        let sent = Recorder()
        async let first = queue.flush { scan in
            try await Task.sleep(nanoseconds: 50_000_000)
            await sent.add(scan.enrollmentNo)
        }
        async let second = queue.flush { await sent.add($0.enrollmentNo) }
        _ = await (first, second)
        let items = await sent.items
        XCTAssertEqual(items, ["A"])
    }
}

private actor Recorder {
    var items: [String] = []
    func add(_ item: String) { items.append(item) }
}
