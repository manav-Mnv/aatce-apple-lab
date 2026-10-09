import Foundation

public struct BackendConfiguration: Sendable, Equatable {
    public let baseURL: URL
    public let secret: String

    public init(baseURL: URL, secret: String) {
        self.baseURL = baseURL
        self.secret = secret
    }
}

/// Kiosk-role client for the Apps Script backend (`backend/API_CONTRACT.md` v2).
///
/// Every call is a POST to `/exec` with `{ secret, action, ...params }` in the JSON body.
/// Apps Script replies with a 302 to a googleusercontent.com URL that must be fetched
/// with GET; URLSession's default redirect handling does exactly that (and drops the
/// body, so the secret is not re-sent).
public struct BackendClient: Sendable {
    public let configuration: BackendConfiguration
    private let session: URLSession

    public init(configuration: BackendConfiguration, session: URLSession? = nil) {
        self.configuration = configuration
        self.session = session ?? {
            let config = URLSessionConfiguration.ephemeral
            config.urlCache = nil
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 120
            return URLSession(configuration: config)
        }()
    }

    public func status() async throws -> StatusResponse {
        try await post("status")
    }

    public func lookup(enrollmentNo: String) async throws -> LookupResponse {
        try await post("lookup", ["enrollment_no": enrollmentNo])
    }

    /// `name`/`email` are only used for non-members; members' details come from the roster.
    public func enroll(enrollmentNo: String, name: String? = nil, email: String? = nil) async throws -> EnrollResponse {
        var params: [String: Any] = ["enrollment_no": enrollmentNo, "consent": true]
        params["name"] = name
        params["email"] = email
        return try await post("enroll", params)
    }

    /// `jpegImages` are the 160×160 face crops the kiosk matches with (max 5, < 200 KB each).
    public func uploadFaces(enrollmentNo: String, jpegImages: [Data]) async throws -> UploadFacesResponse {
        try await post("upload_faces", [
            "enrollment_no": enrollmentNo,
            "images": jpegImages.map { $0.base64EncodedString() }
        ])
    }

    /// `scannedAt` is set when replaying a scan that was queued offline.
    /// `manual` marks a typed enrollment number (FR-8) so admins can audit it.
    public func scan(enrollmentNo: String, scannedAt: Date? = nil, manual: Bool = false,
                     workshopName: String? = nil) async throws -> ScanResponse {
        var params: [String: Any] = ["enrollment_no": enrollmentNo, "method": manual ? "manual" : "face"]
        params["scanned_at"] = scannedAt.map(Self.isoFormatter.string(from:))
        params["workshop_name"] = workshopName
        return try await post("scan", params)
    }

    public func embeddingsVersion() async throws -> EmbeddingsVersionInfo {
        try await post("embeddings_version")
    }

    public func downloadEmbeddings() async throws -> EmbeddingsFile {
        let response: EmbeddingsDownloadResponse = try await post("embeddings_download")
        return response.embeddings
    }

    private func post<R: Decodable>(_ action: String, _ params: [String: Any] = [:]) async throws -> R {
        var body = params
        body["secret"] = configuration.secret
        body["action"] = action

        var request = URLRequest(url: configuration.baseURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BackendError.transport(error.localizedDescription)
        }

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw BackendError.httpStatus(http.statusCode)
        }
        return try Self.decode(R.self, from: data)
    }

    static func decode<R: Decodable>(_ type: R.Type, from data: Data) throws -> R {
        let decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else {
            throw BackendError.decoding("Response is not a JSON object: \(snippet(data))")
        }
        guard envelope.success else {
            throw BackendError.api(APIError(
                errorCode: envelope.errorCode ?? "unknown",
                message: envelope.error ?? "",
                cooldownRemainingSeconds: envelope.cooldownRemainingSeconds
            ))
        }
        do {
            return try decoder.decode(R.self, from: data)
        } catch {
            throw BackendError.decoding("Failed to decode \(R.self): \(error). Body: \(snippet(data))")
        }
    }

    private static func snippet(_ data: Data) -> String {
        String(data: data.prefix(300), encoding: .utf8) ?? "<non-UTF8 body>"
    }

    static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

private struct Envelope: Decodable {
    let success: Bool
    let error: String?
    let errorCode: String?
    let cooldownRemainingSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case success, error
        case errorCode = "error_code"
        case cooldownRemainingSeconds = "cooldown_remaining_seconds"
    }
}
