import Foundation

public struct StatusResponse: Decodable, Equatable, Sendable {
    public let success: Bool
    public let status: String
    public let timestamp: String
    public let version: String
}

public struct EnrollResponse: Decodable, Equatable, Sendable {
    public let success: Bool
    public let enrollmentNo: String
    public let name: String
    public let email: String
    public let isNew: Bool
    public let faceDatasetPath: String
    public let registeredAt: String

    enum CodingKeys: String, CodingKey {
        case success
        case enrollmentNo = "enrollment_no"
        case name
        case email
        case isNew = "is_new"
        case faceDatasetPath = "face_dataset_path"
        case registeredAt = "registered_at"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decode(Bool.self, forKey: .success)
        enrollmentNo = try container.lenientString(forKey: .enrollmentNo)
        name = try container.lenientString(forKey: .name)
        email = try container.lenientString(forKey: .email)
        isNew = try container.decode(Bool.self, forKey: .isNew)
        faceDatasetPath = try container.lenientString(forKey: .faceDatasetPath)
        registeredAt = try container.lenientString(forKey: .registeredAt)
    }
}

public enum ScanOutcome: String, Decodable, Equatable, Sendable {
    case entry
    case exit
    case workshopAttendee = "workshop_attendee"
}

public struct ScanResponse: Decodable, Equatable, Sendable {
    public let success: Bool
    public let action: ScanOutcome
    public let sessionId: String?
    public let enrollmentNo: String
    public let entryTime: String?
    public let exitTime: String?
    public let durationMins: Int?
    public let message: String?

    enum CodingKeys: String, CodingKey {
        case success
        case action
        case sessionId = "session_id"
        case enrollmentNo = "enrollment_no"
        case entryTime = "entry_time"
        case exitTime = "exit_time"
        case durationMins = "duration_mins"
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decode(Bool.self, forKey: .success)
        action = try container.decode(ScanOutcome.self, forKey: .action)
        sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId)
        enrollmentNo = try container.lenientString(forKey: .enrollmentNo)
        entryTime = try container.decodeIfPresent(String.self, forKey: .entryTime)
        exitTime = try container.decodeIfPresent(String.self, forKey: .exitTime)
        durationMins = try container.lenientInt(forKey: .durationMins)
        message = try container.decodeIfPresent(String.self, forKey: .message)
    }
}

public struct AttendanceEntry: Decodable, Equatable, Sendable {
    public let sessionId: String
    public let enrollmentNo: String
    public let entryTime: String
    public let exitTime: String
    public let durationMins: Int?
    public let activityFormStatus: String
    public let activityDescription: String
    public let emailSent: String
    public let notes: String

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case enrollmentNo = "enrollment_no"
        case entryTime = "entry_time"
        case exitTime = "exit_time"
        case durationMins = "duration_mins"
        case activityFormStatus = "activity_form_status"
        case activityDescription = "activity_description"
        case emailSent = "email_sent"
        case notes
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.lenientString(forKey: .sessionId)
        enrollmentNo = try container.lenientString(forKey: .enrollmentNo)
        entryTime = try container.lenientString(forKey: .entryTime)
        exitTime = try container.lenientString(forKey: .exitTime)
        durationMins = try container.lenientInt(forKey: .durationMins)
        activityFormStatus = try container.lenientString(forKey: .activityFormStatus)
        activityDescription = try container.lenientString(forKey: .activityDescription)
        emailSent = try container.lenientString(forKey: .emailSent)
        notes = try container.lenientString(forKey: .notes)
    }
}

public struct AttendanceLogResponse: Decodable, Equatable, Sendable {
    public let success: Bool
    public let count: Int
    public let entries: [AttendanceEntry]
}

public struct Student: Decodable, Equatable, Sendable {
    public let enrollmentNo: String
    public let name: String
    public let email: String
    public let batchTags: String
    public let faceDatasetPath: String
    public let registeredAt: String

    enum CodingKeys: String, CodingKey {
        case enrollmentNo = "enrollment_no"
        case name
        case email
        case batchTags = "batch_tags"
        case faceDatasetPath = "face_dataset_path"
        case registeredAt = "registered_at"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enrollmentNo = try container.lenientString(forKey: .enrollmentNo)
        name = try container.lenientString(forKey: .name)
        email = try container.lenientString(forKey: .email)
        batchTags = try container.lenientString(forKey: .batchTags)
        faceDatasetPath = try container.lenientString(forKey: .faceDatasetPath)
        registeredAt = try container.lenientString(forKey: .registeredAt)
    }
}

public struct StudentsResponse: Decodable, Equatable, Sendable {
    public let success: Bool
    public let count: Int
    public let students: [Student]
}

public struct EmbeddingsVersionInfo: Decodable, Equatable, Sendable {
    public let success: Bool
    public let version: Int
    public let generatedAt: String
    public let modelVersion: String
    public let driveFileId: String
    public let entryCount: Int
    public let downloadUrl: String

    enum CodingKeys: String, CodingKey {
        case success
        case version
        case generatedAt = "generated_at"
        case modelVersion = "model_version"
        case driveFileId = "drive_file_id"
        case entryCount = "entry_count"
        case downloadUrl = "download_url"
    }
}
