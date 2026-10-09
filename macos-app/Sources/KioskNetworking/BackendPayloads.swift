import Foundation

struct EmptyPayload: Encodable {}

struct EnrollPayload: Encodable {
    let enrollmentNo: String
    let name: String?
    let email: String?

    enum CodingKeys: String, CodingKey {
        case enrollmentNo = "enrollment_no"
        case name
        case email
    }
}

struct ScanPayload: Encodable {
    let enrollmentNo: String

    enum CodingKeys: String, CodingKey {
        case enrollmentNo = "enrollment_no"
    }
}

struct AttendanceLogPayload: Encodable {
    let date: String?
    let enrollmentNo: String?

    enum CodingKeys: String, CodingKey {
        case date
        case enrollmentNo = "enrollment_no"
    }
}

struct StudentsPayload: Encodable {
    let batch: String?
    let enrollmentNo: String?

    enum CodingKeys: String, CodingKey {
        case batch
        case enrollmentNo = "enrollment_no"
    }
}
