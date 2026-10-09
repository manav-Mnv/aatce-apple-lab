import Foundation

enum BackendAction: String {
    case enroll
    case scan
    case embeddingsVersion = "embeddings_version"
    case status
    case attendanceLog = "attendance_log"
    case students
}
