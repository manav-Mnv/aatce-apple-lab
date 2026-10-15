import Foundation

public struct StatusResponse: Decodable, Equatable, Sendable {
    public let status: String
    public let timestamp: String
    public let version: String
}

public struct LookupResponse: Decodable, Equatable, Sendable {
    public let enrollmentNo: String
    public let isMember: Bool
    public let isEnrolled: Bool
    public let name: String
    public let emailHint: String
    public let photoCount: Int

    enum CodingKeys: String, CodingKey {
        case enrollmentNo = "enrollment_no"
        case isMember = "is_member"
        case isEnrolled = "is_enrolled"
        case name
        case emailHint = "email_hint"
        case photoCount = "photo_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enrollmentNo = try c.lenientString(forKey: .enrollmentNo)
        isMember = try c.decode(Bool.self, forKey: .isMember)
        isEnrolled = try c.decode(Bool.self, forKey: .isEnrolled)
        name = try c.lenientString(forKey: .name)
        emailHint = try c.lenientString(forKey: .emailHint)
        photoCount = try c.lenientInt(forKey: .photoCount) ?? 0
    }
}

public struct EnrollResponse: Decodable, Equatable, Sendable {
    public let enrollmentNo: String
    public let name: String
    public let emailHint: String
    public let isMember: Bool
    public let isNew: Bool
    public let photoCount: Int

    enum CodingKeys: String, CodingKey {
        case enrollmentNo = "enrollment_no"
        case name
        case emailHint = "email_hint"
        case isMember = "is_member"
        case isNew = "is_new"
        case photoCount = "photo_count"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enrollmentNo = try c.lenientString(forKey: .enrollmentNo)
        name = try c.lenientString(forKey: .name)
        emailHint = try c.lenientString(forKey: .emailHint)
        isMember = try c.decode(Bool.self, forKey: .isMember)
        isNew = try c.decode(Bool.self, forKey: .isNew)
        photoCount = try c.lenientInt(forKey: .photoCount) ?? 0
    }
}

public struct UploadFacesResponse: Decodable, Equatable, Sendable {
    public let saved: Int
    public let photoCount: Int

    enum CodingKeys: String, CodingKey {
        case saved
        case photoCount = "photo_count"
    }
}

public enum ScanOutcome: String, Decodable, Equatable, Sendable {
    case entry
    case exit
    case workshopAttendee = "workshop_attendee"
}

public struct ScanResponse: Decodable, Equatable, Sendable {
    public let action: ScanOutcome
    public let enrollmentNo: String
    public let name: String
    public let sessionId: String?
    public let entryTime: String?
    public let exitTime: String?
    public let durationMins: Int?
    public let alreadyLogged: Bool

    enum CodingKeys: String, CodingKey {
        case action
        case enrollmentNo = "enrollment_no"
        case name
        case sessionId = "session_id"
        case entryTime = "entry_time"
        case exitTime = "exit_time"
        case durationMins = "duration_mins"
        case alreadyLogged = "already_logged"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        action = try c.decode(ScanOutcome.self, forKey: .action)
        enrollmentNo = try c.lenientString(forKey: .enrollmentNo)
        name = try c.lenientString(forKey: .name)
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
        entryTime = try c.decodeIfPresent(String.self, forKey: .entryTime)
        exitTime = try c.decodeIfPresent(String.self, forKey: .exitTime)
        durationMins = try c.lenientInt(forKey: .durationMins)
        alreadyLogged = try c.decodeIfPresent(Bool.self, forKey: .alreadyLogged) ?? false
    }
}

public struct EmbeddingsVersionInfo: Decodable, Equatable, Sendable {
    public let version: Int
    public let generatedAt: String
    public let modelVersion: String
    public let entryCount: Int

    enum CodingKeys: String, CodingKey {
        case version
        case generatedAt = "generated_at"
        case modelVersion = "model_version"
        case entryCount = "entry_count"
    }
}

public struct EmbeddingEntry: Codable, Equatable, Sendable {
    public let enrollmentNo: String
    public let embeddingVector: [Float]

    public init(enrollmentNo: String, embeddingVector: [Float]) {
        self.enrollmentNo = enrollmentNo
        self.embeddingVector = embeddingVector
    }

    enum CodingKeys: String, CodingKey {
        case enrollmentNo = "enrollment_no"
        case embeddingVector = "embedding_vector"
    }
}

/// The published embeddings.json (SRS §6).
public struct EmbeddingsFile: Codable, Equatable, Sendable {
    public let version: Int
    public let generatedAt: String
    public let modelVersion: String
    public let entries: [EmbeddingEntry]

    public init(version: Int, generatedAt: String, modelVersion: String, entries: [EmbeddingEntry]) {
        self.version = version
        self.generatedAt = generatedAt
        self.modelVersion = modelVersion
        self.entries = entries
    }

    enum CodingKeys: String, CodingKey {
        case version
        case generatedAt = "generated_at"
        case modelVersion = "model_version"
        case entries
    }
}

struct EmbeddingsDownloadResponse: Decodable {
    let embeddings: EmbeddingsFile
}
