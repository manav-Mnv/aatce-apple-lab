import Foundation

public enum BackendErrorCode: String, Equatable, Sendable {
    case authMissing = "auth_missing"
    case authInvalid = "auth_invalid"
    case authMisconfigured = "auth_misconfigured"
    case validationError = "validation_error"
    case cooldown
    case unknownAction = "unknown_action"
    case invalidJSON = "invalid_json"
    case serverError = "server_error"
    case methodNotAllowed = "method_not_allowed"
}

public struct APIError: Error, Equatable, Sendable {
    public let errorCode: String
    public let message: String
    public let cooldownRemainingSeconds: Int?

    public init(errorCode: String, message: String, cooldownRemainingSeconds: Int?) {
        self.errorCode = errorCode
        self.message = message
        self.cooldownRemainingSeconds = cooldownRemainingSeconds
    }

    public var code: BackendErrorCode? {
        BackendErrorCode(rawValue: errorCode)
    }

    public var isAuthenticationFailure: Bool {
        code == .authMissing || code == .authInvalid || code == .authMisconfigured
    }

    public var isCooldown: Bool {
        code == .cooldown
    }
}

public enum BackendError: Error, Equatable, Sendable {
    case transport(String)
    case httpStatus(Int)
    case decoding(String)
    case api(APIError)
    case invalidEmbeddingsFile(String)
}

extension BackendError {
    public var apiError: APIError? {
        if case .api(let error) = self { return error }
        return nil
    }

    public var isAuthenticationFailure: Bool {
        apiError?.isAuthenticationFailure ?? false
    }

    public var isCooldown: Bool {
        apiError?.isCooldown ?? false
    }
}
