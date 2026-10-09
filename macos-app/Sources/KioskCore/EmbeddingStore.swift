import Foundation
import KioskNetworking

/// A face template created on this kiosk at enrollment, used until the weekly
/// pipeline publishes an embeddings file that includes the person.
public struct LocalEnrollment: Codable, Equatable, Sendable {
    public let enrollmentNo: String
    public let vector: [Float]
    public let createdAt: Date

    public init(enrollmentNo: String, vector: [Float], createdAt: Date) {
        self.enrollmentNo = enrollmentNo
        self.vector = vector
        self.createdAt = createdAt
    }
}

/// Persists the published embeddings.json and local enrollments in one directory
/// (Application Support/AATCEKiosk). Writes are atomic, so a crash never leaves
/// a half-written file.
public final class EmbeddingStore {
    public private(set) var published: EmbeddingsFile?
    public private(set) var local: [String: LocalEnrollment]

    private let publishedURL: URL
    private let localURL: URL

    public init(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        publishedURL = directory.appendingPathComponent("embeddings.json")
        localURL = directory.appendingPathComponent("local-enrollments.json")
        published = try? JSONDecoder().decode(EmbeddingsFile.self, from: Data(contentsOf: publishedURL))
        local = (try? JSONDecoder.iso.decode([String: LocalEnrollment].self, from: Data(contentsOf: localURL))) ?? [:]
    }

    public var publishedVersion: Int { published?.version ?? 0 }

    /// Published templates, overridden by newer local enrollments (e.g. a re-enrollment).
    public var templates: [String: [Float]] {
        var result: [String: [Float]] = [:]
        for entry in published?.entries ?? [] { result[entry.enrollmentNo] = entry.embeddingVector }
        for (enrollmentNo, enrollment) in local { result[enrollmentNo] = enrollment.vector }
        return result
    }

    public func replacePublished(_ file: EmbeddingsFile) throws {
        try JSONEncoder().encode(file).write(to: publishedURL, options: .atomic)
        published = file

        // A local template is no longer needed once a file generated after it includes the person.
        guard let generatedAt = ISO8601DateFormatter().date(from: file.generatedAt) else { return }
        let included = Set(file.entries.map(\.enrollmentNo))
        let before = local.count
        local = local.filter { !(included.contains($0.key) && $0.value.createdAt < generatedAt) }
        if local.count != before { try saveLocal() }
    }

    public func addLocal(_ enrollment: LocalEnrollment) throws {
        local[enrollment.enrollmentNo] = enrollment
        try saveLocal()
    }

    private func saveLocal() throws {
        try JSONEncoder.iso.encode(local).write(to: localURL, options: .atomic)
    }
}

extension JSONEncoder {
    static let iso: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}

extension JSONDecoder {
    static let iso: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
