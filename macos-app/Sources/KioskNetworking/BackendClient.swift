import Foundation

struct ResponseEnvelope: Decodable {
    let success: Bool
    let error: String?
    let errorCode: String?
    let cooldownRemainingSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case success
        case error
        case errorCode = "error_code"
        case cooldownRemainingSeconds = "cooldown_remaining_seconds"
    }
}

public struct BackendClient: Sendable {
    public let configuration: BackendConfiguration

    private let session: URLSession
    private let retainedDelegate: PostRedirectHandler?

    public init(configuration: BackendConfiguration) {
        let redirectHandler = PostRedirectHandler()
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.urlCache = nil
        sessionConfiguration.timeoutIntervalForRequest = 30
        sessionConfiguration.timeoutIntervalForResource = 60
        self.session = URLSession(
            configuration: sessionConfiguration,
            delegate: redirectHandler,
            delegateQueue: nil
        )
        self.retainedDelegate = redirectHandler
        self.configuration = configuration
    }

    public init(configuration: BackendConfiguration, session: URLSession) {
        self.configuration = configuration
        self.session = session
        self.retainedDelegate = nil
    }

    public func status() async throws -> StatusResponse {
        try await post(.status, payload: EmptyPayload())
    }

    public func enroll(
        enrollmentNo: String,
        name: String? = nil,
        email: String? = nil
    ) async throws -> EnrollResponse {
        try await post(
            .enroll,
            payload: EnrollPayload(enrollmentNo: enrollmentNo, name: name, email: email)
        )
    }

    public func scan(enrollmentNo: String) async throws -> ScanResponse {
        try await post(.scan, payload: ScanPayload(enrollmentNo: enrollmentNo))
    }

    public func embeddingsVersion() async throws -> EmbeddingsVersionInfo {
        try await post(.embeddingsVersion, payload: EmptyPayload())
    }

    public func attendanceLog(
        date: String? = nil,
        enrollmentNo: String? = nil
    ) async throws -> AttendanceLogResponse {
        try await post(
            .attendanceLog,
            payload: AttendanceLogPayload(date: date, enrollmentNo: enrollmentNo)
        )
    }

    public func students(
        batch: String? = nil,
        enrollmentNo: String? = nil
    ) async throws -> StudentsResponse {
        try await post(
            .students,
            payload: StudentsPayload(batch: batch, enrollmentNo: enrollmentNo)
        )
    }

    private func post<P: Encodable, R: Decodable>(
        _ action: BackendAction,
        payload: P
    ) async throws -> R {
        var request = URLRequest(url: configuration.baseURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        var body = try Self.encodeObject(payload)
        body["secret"] = configuration.sharedSecret
        body["action"] = action.rawValue
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BackendError.transport(error.localizedDescription)
        }

        if let httpResponse = response as? HTTPURLResponse,
           !(200..<300).contains(httpResponse.statusCode) {
            throw BackendError.httpStatus(httpResponse.statusCode)
        }

        return try Self.decodeResponse(R.self, from: data)
    }

    private static func encodeObject<P: Encodable>(_ payload: P) throws -> [String: Any] {
        let encoded = try JSONEncoder().encode(payload)
        let object = try JSONSerialization.jsonObject(with: encoded, options: [])
        guard let dictionary = object as? [String: Any] else {
            throw BackendError.decoding("Request payload did not encode to a JSON object")
        }
        return dictionary
    }

    static func decodeResponse<R: Decodable>(_ type: R.Type, from data: Data) throws -> R {
        let decoder = JSONDecoder()

        guard let envelope = try? decoder.decode(ResponseEnvelope.self, from: data) else {
            throw BackendError.decoding("Response is not a JSON object: \(bodySnippet(data))")
        }

        if !envelope.success {
            guard let errorCode = envelope.errorCode else {
                throw BackendError.decoding(
                    "Error response is missing error_code: \(bodySnippet(data))"
                )
            }
            throw BackendError.api(APIError(
                errorCode: errorCode,
                message: envelope.error ?? "",
                cooldownRemainingSeconds: envelope.cooldownRemainingSeconds
            ))
        }

        do {
            return try decoder.decode(R.self, from: data)
        } catch {
            throw BackendError.decoding(
                "Failed to decode \(R.self): \(error). Body: \(bodySnippet(data))"
            )
        }
    }

    private static func bodySnippet(_ data: Data) -> String {
        String(data: data.prefix(300), encoding: .utf8) ?? "<non-UTF8 response body>"
    }
}
