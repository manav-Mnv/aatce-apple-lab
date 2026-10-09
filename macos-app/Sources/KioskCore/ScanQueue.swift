import Foundation
import KioskNetworking

public struct QueuedScan: Codable, Equatable, Sendable {
    public let id: UUID
    public let enrollmentNo: String
    public let scannedAt: Date
    public let manual: Bool

    public init(id: UUID = UUID(), enrollmentNo: String, scannedAt: Date, manual: Bool) {
        self.id = id
        self.enrollmentNo = enrollmentNo
        self.scannedAt = scannedAt
        self.manual = manual
    }
}

public struct FlushResult: Equatable, Sendable {
    public var sent = 0
    public var dropped = 0
    public var remaining = 0
}

/// Durable offline queue for scans (NFR-2).
///
/// Every change is written to disk atomically before the call returns, so a scan
/// accepted while offline survives a crash or power cut. Items are replayed in
/// order with their original `scannedAt`; anything the backend rejects for good
/// (cooldown, not enrolled, too old) is dropped, and a retryable failure stops
/// the flush so order is preserved.
public actor ScanQueue {
    private let fileURL: URL
    public private(set) var pending: [QueuedScan]
    private var isFlushing = false

    public init(fileURL: URL) {
        self.fileURL = fileURL
        pending = (try? JSONDecoder.iso.decode([QueuedScan].self, from: Data(contentsOf: fileURL))) ?? []
    }

    public var isEmpty: Bool { pending.isEmpty }

    public func enqueue(_ scan: QueuedScan) throws {
        pending.append(scan)
        try save()
    }

    public func flush(using send: @Sendable (QueuedScan) async throws -> Void) async -> FlushResult {
        var result = FlushResult()
        // The actor is re-entrant across `await`; without this, two flushes could send the same scan.
        guard !isFlushing else {
            result.remaining = pending.count
            return result
        }
        isFlushing = true
        defer { isFlushing = false }

        while let next = pending.first {
            do {
                try await send(next)
                result.sent += 1
            } catch let error as BackendError where error.isRetryable {
                break
            } catch {
                result.dropped += 1
            }
            pending.removeFirst()
            try? save()
        }
        result.remaining = pending.count
        return result
    }

    private func save() throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder.iso.encode(pending).write(to: fileURL, options: .atomic)
    }
}
