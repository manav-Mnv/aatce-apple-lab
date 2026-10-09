import Foundation

public struct BackendConfiguration: Sendable {
    public let baseURL: URL
    public let sharedSecret: String

    public init(baseURL: URL, sharedSecret: String) {
        self.baseURL = baseURL
        self.sharedSecret = sharedSecret
    }
}
