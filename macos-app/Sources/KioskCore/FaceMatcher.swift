import Foundation

public struct FaceMatch: Equatable, Sendable {
    public let enrollmentNo: String
    public let score: Float
}

/// On-device matching (FR-7): cosine similarity of unit vectors against every template.
///
/// A match needs `score ≥ threshold` *and* a clear lead over the next-best person,
/// so two similar-looking students never get confused with each other.
public struct FaceMatcher: Sendable {
    public static let defaultThreshold: Float = 0.65
    public static let defaultMargin: Float = 0.05

    public let threshold: Float
    public let margin: Float
    private let templates: [(enrollmentNo: String, vector: [Float])]

    public init(templates: [String: [Float]],
                threshold: Float = FaceMatcher.defaultThreshold,
                margin: Float = FaceMatcher.defaultMargin) {
        self.threshold = threshold
        self.margin = margin
        self.templates = templates.compactMap { key, vector in
            Vector.normalized(vector).map { (key, $0) }
        }
    }

    public var count: Int { templates.count }

    public func bestMatch(for probe: [Float]) -> FaceMatch? {
        let result = evaluate(probe)
        guard let match = result.closest, match.score >= threshold, match.score - result.runnerUp >= margin else { return nil }
        return match
    }

    /// The closest person and the next-best score, whether or not it counts as a match
    /// (reported to the portal so the threshold can be tuned).
    public func evaluate(_ probe: [Float]) -> (closest: FaceMatch?, runnerUp: Float) {
        guard let probe = Vector.normalized(probe) else { return (nil, -1) }
        var best: FaceMatch?
        var runnerUp: Float = -1
        for template in templates where template.vector.count == probe.count {
            let score = Vector.dot(probe, template.vector)
            if let current = best, score <= current.score {
                runnerUp = max(runnerUp, score)
            } else {
                if let current = best { runnerUp = max(runnerUp, current.score) }
                best = FaceMatch(enrollmentNo: template.enrollmentNo, score: score)
            }
        }
        return (best, runnerUp)
    }
}

public enum Vector {
    public static func dot(_ a: [Float], _ b: [Float]) -> Float {
        var sum: Float = 0
        for i in 0..<min(a.count, b.count) { sum += a[i] * b[i] }
        return sum
    }

    public static func normalized(_ v: [Float]) -> [Float]? {
        let norm = dot(v, v).squareRoot()
        guard norm > 0, norm.isFinite else { return nil }
        return v.map { $0 / norm }
    }

    /// Mean of several embeddings, re-normalised (same as the pipeline's person_embedding).
    public static func mean(_ vectors: [[Float]]) -> [Float]? {
        guard let first = vectors.first, vectors.allSatisfy({ $0.count == first.count }) else { return nil }
        var sum = [Float](repeating: 0, count: first.count)
        for v in vectors {
            for i in 0..<v.count { sum[i] += v[i] }
        }
        return normalized(sum)
    }
}
