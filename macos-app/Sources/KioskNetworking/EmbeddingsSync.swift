import Foundation

public struct EmbeddingEntry: Decodable, Equatable, Sendable {
    public let enrollmentNo: String
    public let embeddingVector: [Double]

    enum CodingKeys: String, CodingKey {
        case enrollmentNo = "enrollment_no"
        case embeddingVector = "embedding_vector"
    }
}

public struct EmbeddingsFile: Decodable, Equatable, Sendable {
    public let version: Int
    public let generatedAt: String
    public let modelVersion: String
    public let entries: [EmbeddingEntry]

    enum CodingKeys: String, CodingKey {
        case version
        case generatedAt = "generated_at"
        case modelVersion = "model_version"
        case entries
    }
}

public enum EmbeddingsSyncOutcome: Equatable, Sendable {
    case upToDate(currentVersion: Int)
    case updated(EmbeddingsFile)
}

public struct EmbeddingsSyncService: Sendable {
    private let client: BackendClient
    private let downloadSession: URLSession

    public init(client: BackendClient, downloadSession: URLSession = .shared) {
        self.client = client
        self.downloadSession = downloadSession
    }

    public func currentVersion() async throws -> EmbeddingsVersionInfo {
        try await client.embeddingsVersion()
    }

    public func sync(localVersion: Int) async throws -> EmbeddingsSyncOutcome {
        let info = try await client.embeddingsVersion()

        guard info.version > localVersion else {
            return .upToDate(currentVersion: info.version)
        }

        let file = try await download(from: info)

        guard file.version == info.version else {
            throw BackendError.invalidEmbeddingsFile(
                "embeddings.json version \(file.version) does not match advertised version \(info.version)"
            )
        }

        return .updated(file)
    }

    public func download(from info: EmbeddingsVersionInfo) async throws -> EmbeddingsFile {
        guard !info.downloadUrl.isEmpty, let url = URL(string: info.downloadUrl) else {
            throw BackendError.invalidEmbeddingsFile(
                "No Drive download_url available for version \(info.version)"
            )
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await downloadSession.data(for: request)
        } catch {
            throw BackendError.transport(error.localizedDescription)
        }

        if let httpResponse = response as? HTTPURLResponse,
           !(200..<300).contains(httpResponse.statusCode) {
            throw BackendError.httpStatus(httpResponse.statusCode)
        }

        do {
            return try JSONDecoder().decode(EmbeddingsFile.self, from: data)
        } catch {
            throw BackendError.invalidEmbeddingsFile(
                "Failed to parse embeddings.json: \(error)"
            )
        }
    }
}
