import Foundation

public enum BackendErrorCode: String, Sendable {
    case authMissing = "auth_missing"
    case authInvalid = "auth_invalid"
    case authMisconfigured = "auth_misconfigured"
    case forbidden
    case validationError = "validation_error"
    case consentRequired = "consent_required"
    case notEnrolled = "not_enrolled"
    case notFound = "not_found"
    case cooldown
    case versionConflict = "version_conflict"
    case unknownAction = "unknown_action"
    case invalidJSON = "invalid_json"
    case serverError = "server_error"
    case methodNotAllowed = "method_not_allowed"
}

public struct APIError: Error, Equatable, Sendable {
    public let errorCode: String
    public let message: String
    public let cooldownRemainingSeconds: Int?

    public init(errorCode: String, message: String, cooldownRemainingSeconds: Int? = nil) {
        self.errorCode = errorCode
        self.message = message
        self.cooldownRemainingSeconds = cooldownRemainingSeconds
    }

    public var code: BackendErrorCode? { BackendErrorCode(rawValue: errorCode) }
}

public enum BackendError: Error, Equatable, Sendable {
    /// No response (offline, DNS, timeout). Scans hitting this are queued.
    case transport(String)
    case httpStatus(Int)
    case decoding(String)
    case api(APIError)

    public var code: BackendErrorCode? {
        if case .api(let error) = self { return error.code }
        return nil
    }

    /// True when retrying later could succeed, so a queued scan should be kept.
    public var isRetryable: Bool {
        switch self {
        case .transport: return true
        case .httpStatus(let status): return status >= 500 || status == 429
        case .decoding: return true  // e.g. an HTML error page from Google during an outage
        case .api(let error): return error.code == .serverError
        }
    }
}
