import Foundation

final class PostRedirectHandler: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        var redirected = request
        if let original = task.originalRequest {
            redirected.httpMethod = original.httpMethod
            redirected.httpBody = original.httpBody
            redirected.allHTTPHeaderFields = original.allHTTPHeaderFields
        } else {
            redirected.httpMethod = "POST"
        }
        completionHandler(redirected)
    }
}
