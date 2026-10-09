import AVFoundation
import CoreImage
import Vision

struct FaceSample {
    /// 160×160 crop: exactly what is embedded on the kiosk and uploaded for the pipeline.
    let crop: CGImage
    /// Head rotation left/right, in radians.
    let yaw: Double
}

enum FaceReading {
    case noFace
    case tooFar
    case offCenter
    case multipleFaces
    case face(FaceSample)
}

/// Camera capture + Vision face detection (~10 analysed frames per second).
final class CameraService: NSObject, ObservableObject {
    let session = AVCaptureSession()
    @Published private(set) var permissionDenied = false
    @Published private(set) var cameraMissing = false

    /// Delivered on the main actor.
    var onReading: (@MainActor (FaceReading) -> Void)?

    private let queue = DispatchQueue(label: "club.scc.aatce.camera")
    private let context = CIContext()
    private var lastAnalysis = Date.distantPast
    private var configured = false

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            run()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor in
                    if granted { self.run() } else { self.permissionDenied = true }
                }
            }
        default:
            permissionDenied = true
        }
    }

    private func run() {
        queue.async { [self] in
            if !configured {
                configured = true
                let ok = configure()
                if !ok { Task { @MainActor in self.cameraMissing = true } }
            }
            if !session.isRunning { session.startRunning() }
        }
    }

    private func configure() -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return false }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else { return false }
        session.addOutput(output)
        return true
    }
}

extension CameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = Date()
        guard now.timeIntervalSince(lastAnalysis) >= 0.1,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastAnalysis = now

        let reading = analyze(pixels)
        Task { @MainActor in self.onReading?(reading) }
    }

    private func analyze(_ pixels: CVPixelBuffer) -> FaceReading {
        let request = VNDetectFaceRectanglesRequest()
        request.revision = VNDetectFaceRectanglesRequestRevision3  // continuous yaw
        try? VNImageRequestHandler(cvPixelBuffer: pixels, options: [:]).perform([request])

        let faces = (request.results ?? []).sorted { $0.boundingBox.area > $1.boundingBox.area }
        guard let face = faces.first else { return .noFace }
        if faces.count > 1, faces[1].boundingBox.area > face.boundingBox.area * 0.5 { return .multipleFaces }
        guard face.boundingBox.width >= FaceGeometry.minimumWidth else { return .tooFar }
        guard let crop = FaceGeometry.crop(CIImage(cvPixelBuffer: pixels), box: face.boundingBox, context: context) else {
            return .offCenter
        }
        return .face(FaceSample(crop: crop, yaw: face.yaw?.doubleValue ?? 0))
    }
}

enum FaceGeometry {
    /// Face must be at least this fraction of the frame width (roughly arm's length).
    static let minimumWidth: CGFloat = 0.16
    /// Square crop side = largest box side × this, centred on the face.
    static let margin: CGFloat = 1.3
    static let outputSize: CGFloat = 160

    /// `box` is Vision's normalised rect (origin bottom-left, like Core Image).
    static func crop(_ image: CIImage, box: CGRect, context: CIContext) -> CGImage? {
        let extent = image.extent
        let side = max(box.width * extent.width, box.height * extent.height) * margin
        let square = CGRect(x: extent.minX + box.midX * extent.width - side / 2,
                            y: extent.minY + box.midY * extent.height - side / 2,
                            width: side, height: side)
        guard extent.contains(square) else { return nil }

        let scaled = image.cropped(to: square)
            .transformed(by: CGAffineTransform(translationX: -square.minX, y: -square.minY))
            .applyingFilter("CILanczosScaleTransform", parameters: [
                kCIInputScaleKey: outputSize / side,
                kCIInputAspectRatioKey: 1.0
            ])
        return context.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: outputSize, height: outputSize),
                                     format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    }
}

private extension CGRect {
    var area: CGFloat { width * height }
}
