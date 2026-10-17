import CoreGraphics
import CoreML
import Foundation

enum FaceEmbedderError: LocalizedError {
    case modelMissing
    case badModel(String)

    var errorDescription: String? {
        switch self {
        case .modelMissing:
            return "Face model not found. Put FaceNet.mlpackage in \(KioskPaths.directory.path) (see macos-app/README.md)."
        case .badModel(let reason):
            return "Face model is not usable: \(reason)"
        }
    }
}

/// Runs the FaceNet Core ML model exported by ml-training/src/export_coreml.py.
/// Input: 160×160 face crop → output: 512-d embedding (comparable with embeddings.json).
final class FaceEmbedder: @unchecked Sendable {
    let modelVersion: String
    private let model: MLModel
    private let constraint: MLImageConstraint

    init(model: MLModel) throws {
        guard let constraint = model.modelDescription.inputDescriptionsByName["face"]?.imageConstraint else {
            throw FaceEmbedderError.badModel("no image input named 'face'")
        }
        guard model.modelDescription.outputDescriptionsByName["embedding"] != nil else {
            throw FaceEmbedderError.badModel("no output named 'embedding'")
        }
        self.model = model
        self.constraint = constraint
        self.modelVersion = model.modelDescription.metadata[.versionString] as? String ?? ""
    }

    /// Looks for a compiled model in the app bundle, then in Application Support
    /// (compiling FaceNet.mlpackage there on first launch).
    static func load() throws -> FaceEmbedder {
        let configuration = MLModelConfiguration()
        // Neural Engine when available: several times faster than CPU/GPU. It computes in
        // float16, which moves embeddings by ~0.001 cosine — negligible next to the 0.65 threshold.
        configuration.computeUnits = .all

        if let bundled = Bundle.main.url(forResource: "FaceNet", withExtension: "mlmodelc") {
            return try FaceEmbedder(model: MLModel(contentsOf: bundled, configuration: configuration))
        }

        let fm = FileManager.default
        let compiled = KioskPaths.directory.appendingPathComponent("FaceNet.mlmodelc")
        let package = KioskPaths.directory.appendingPathComponent("FaceNet.mlpackage")
        if !fm.fileExists(atPath: compiled.path) {
            guard fm.fileExists(atPath: package.path) else { throw FaceEmbedderError.modelMissing }
            let temporary = try MLModel.compileModel(at: package)
            try fm.moveItem(at: temporary, to: compiled)
        }
        return try FaceEmbedder(model: MLModel(contentsOf: compiled, configuration: configuration))
    }

    private let queue = DispatchQueue(label: "club.scc.aatce.embedder", qos: .userInitiated)

    /// Runs the model off the main thread (one prediction at a time), so the UI never stalls.
    func embeddings(for faces: [CGImage]) async throws -> [[Float]] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result { try faces.map(self.embedding(for:)) })
            }
        }
    }

    func embedding(for face: CGImage) throws -> [Float] {
        let input = try MLDictionaryFeatureProvider(dictionary: [
            "face": MLFeatureValue(cgImage: face, constraint: constraint, options: nil)
        ])
        guard let array = try model.prediction(from: input).featureValue(for: "embedding")?.multiArrayValue else {
            throw FaceEmbedderError.badModel("prediction returned no embedding")
        }
        if array.dataType == .float32 {
            let pointer = array.dataPointer.bindMemory(to: Float.self, capacity: array.count)
            return Array(UnsafeBufferPointer(start: pointer, count: array.count))
        }
        return (0..<array.count).map { array[$0].floatValue }
    }
}
