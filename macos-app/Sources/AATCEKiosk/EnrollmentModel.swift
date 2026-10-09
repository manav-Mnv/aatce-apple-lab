import CoreGraphics
import Foundation
import ImageIO
import KioskCore
import KioskNetworking

/// Self-serve enrollment (FR-1 to FR-6, NFR-3):
///
///   number → confirm (member) / details (non-member) → consent → capture → saving → done
///
/// Capture takes 3 frontal crops, then 2 with the head turned (which is also the
/// liveness check). The 5 crops are uploaded for the weekly pipeline and their
/// averaged embedding is stored locally, so the student is recognised right away.
@MainActor
final class EnrollmentModel: ObservableObject {
    enum Step: Equatable {
        case number
        case confirm(name: String, emailHint: String)
        case details
        case consent
        case capture(count: Int, turnHead: Bool)
        case saving
        case done(name: String)
        case failed(String)
    }

    @Published private(set) var step: Step
    @Published var enrollmentNo: String
    @Published var name = ""
    @Published var email = ""
    @Published private(set) var busy = false
    @Published private(set) var error: String?

    static let frontalCount = 3
    static let totalCount = 5
    static let captureInterval: TimeInterval = 0.4
    static let turnYaw = 0.26
    static let captureTimeout: TimeInterval = 25

    private let client: BackendClient
    private let embedder: FaceEmbedder
    private let store: EmbeddingStore
    private let onFinish: @MainActor () -> Void

    private var isMember = false
    private var confirmedName = ""
    private var crops: [CGImage] = []
    private var baselineYaw: Double?
    private var lastCaptureAt = Date.distantPast
    private var captureStartedAt = Date()

    init(client: BackendClient, embedder: FaceEmbedder, store: EmbeddingStore, prefill: String,
         onFinish: @escaping @MainActor () -> Void) {
        self.client = client
        self.embedder = embedder
        self.store = store
        self.enrollmentNo = prefill
        self.onFinish = onFinish
        self.step = .number
    }

    var trimmedNumber: String { enrollmentNo.trimmingCharacters(in: .whitespacesAndNewlines) }

    func cancel() { onFinish() }

    // MARK: - Identity

    func lookup() async {
        guard !trimmedNumber.isEmpty else { return }
        await run {
            let result = try await self.client.lookup(enrollmentNo: self.trimmedNumber)
            self.isMember = result.isMember
            if result.isMember {
                self.confirmedName = result.name
                self.step = .confirm(name: result.name, emailHint: result.emailHint)
            } else {
                self.name = result.name
                self.step = .details
            }
        }
    }

    func confirmIdentity() { step = .consent }

    func submitDetails() {
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty, trimmedEmail.contains("@"), trimmedEmail.contains(".") else {
            error = "Enter your name and a valid email address."
            return
        }
        error = nil
        confirmedName = trimmedName
        step = .consent
    }

    func agree() async {
        await run {
            let response = try await self.client.enroll(
                enrollmentNo: self.trimmedNumber,
                name: self.isMember ? nil : self.name.trimmingCharacters(in: .whitespaces),
                email: self.isMember ? nil : self.email.trimmingCharacters(in: .whitespaces)
            )
            self.confirmedName = response.name
            self.startCapture()
        }
    }

    // MARK: - Capture

    private func startCapture() {
        crops = []
        baselineYaw = nil
        captureStartedAt = Date()
        step = .capture(count: 0, turnHead: false)
    }

    func handle(_ reading: FaceReading) {
        guard case .capture = step else { return }
        if Date().timeIntervalSince(captureStartedAt) > Self.captureTimeout {
            step = .failed("We couldn't get a clear view of your face. Check the lighting and try again.")
            return
        }
        guard case .face(let sample) = reading,
              Date().timeIntervalSince(lastCaptureAt) >= Self.captureInterval else { return }

        let baseline = baselineYaw ?? sample.yaw
        baselineYaw = baseline
        let delta = abs(sample.yaw - baseline)
        let wanted = crops.count < Self.frontalCount ? delta < Self.turnYaw / 2 : delta >= Self.turnYaw
        guard wanted else { return }

        crops.append(sample.crop)
        lastCaptureAt = Date()
        if crops.count < Self.totalCount {
            step = .capture(count: crops.count, turnHead: crops.count >= Self.frontalCount)
        } else {
            Task { await save() }
        }
    }

    func retryCapture() { startCapture() }

    private func save() async {
        step = .saving
        do {
            let vectors = try crops.map { try embedder.embedding(for: $0) }
            guard let template = Vector.mean(vectors) else { throw EnrollmentError.embedding }
            let jpegs = try crops.map(Self.jpeg)
            _ = try await client.uploadFaces(enrollmentNo: trimmedNumber, jpegImages: jpegs)
            try store.addLocal(LocalEnrollment(enrollmentNo: trimmedNumber, vector: template, createdAt: Date()))
            step = .done(name: confirmedName)
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if case .done = step { onFinish() }
        } catch {
            step = .failed(Self.message(for: error))
        }
    }

    // MARK: - Helpers

    private func run(_ work: @escaping () async throws -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await work()
        } catch {
            self.error = Self.message(for: error)
        }
    }

    private static func message(for error: Error) -> String {
        guard let backend = error as? BackendError else { return error.localizedDescription }
        switch backend.code {
        case .validationError: return "That doesn't look right. Check your details and try again."
        case .consentRequired: return "Consent is required to enroll."
        case .notEnrolled: return "Enrollment didn't finish. Please start again."
        case .authMissing, .authInvalid, .authMisconfigured, .forbidden:
            return "This kiosk isn't authorised. Ask a lab admin."
        default:
            return backend.isRetryable ? "The lab is offline. Enrollment needs a connection — try again shortly." : "Something went wrong. Please try again."
        }
    }

    nonisolated static func jpeg(_ image: CGImage) throws -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else {
            throw EnrollmentError.encoding
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw EnrollmentError.encoding }
        return data as Data
    }
}

enum EnrollmentError: LocalizedError {
    case embedding
    case encoding

    var errorDescription: String? {
        switch self {
        case .embedding: return "Couldn't compute your face signature. Please try again."
        case .encoding: return "Couldn't save the photos. Please try again."
        }
    }
}
