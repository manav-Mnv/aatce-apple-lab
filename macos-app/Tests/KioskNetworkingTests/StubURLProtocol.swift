import Foundation
import XCTest

struct RecordedRequest {
    let request: URLRequest
    let body: Data?

    var jsonBody: [String: Any]? {
        guard let body else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: body, options: []) else {
            return nil
        }
        return object as? [String: Any]
    }
}

final class StubURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> (statusCode: Int, body: Data)

    private static let lock = NSLock()
    private static var recorded: [RecordedRequest] = []
    private static var handler: Handler?

    static func setHandler(_ handler: @escaping Handler) {
        lock.lock()
        defer { lock.unlock() }
        Self.handler = handler
    }

    static func reset() {
        lock.lock()
        defer { lock.unlock() }
        recorded = []
        handler = nil
    }

    static var requests: [RecordedRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.record(request: request)

        guard let handler = Self.currentHandler() else {
            client?.urlProtocol(
                self,
                didFailWithError: NSError(domain: "StubURLProtocol", code: -1)
            )
            return
        }

        do {
            let (statusCode, body) = try handler(request)
            guard let url = request.url,
                  let response = HTTPURLResponse(
                      url: url,
                      statusCode: statusCode,
                      httpVersion: "HTTP/1.1",
                      headerFields: ["Content-Type": "application/json"]
                  ) else {
                client?.urlProtocol(
                    self,
                    didFailWithError: NSError(domain: "StubURLProtocol", code: -2)
                )
                return
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func record(request: URLRequest) {
        let body = bodyData(of: request)
        lock.lock()
        defer { lock.unlock() }
        recorded.append(RecordedRequest(request: request, body: body))
    }

    private static func currentHandler() -> Handler? {
        lock.lock()
        defer { lock.unlock() }
        return handler
    }

    private static func bodyData(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }

        stream.open()
        defer { stream.close() }

        var data = Data()
        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
