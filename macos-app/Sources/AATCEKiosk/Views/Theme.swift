import AVFoundation
import SwiftUI

enum Theme {
    static let accent = Color(red: 0.16, green: 0.59, blue: 1.0)      // #2997FF
    static let success = Color(red: 0.19, green: 0.82, blue: 0.35)    // #30D158
    static let checkout = Color(red: 1.0, green: 0.62, blue: 0.04)    // #FF9F0A
    static let failure = Color(red: 1.0, green: 0.27, blue: 0.23)     // #FF453A
    static let secondary = Color.white.opacity(0.6)
    static let tertiary = Color.white.opacity(0.35)
    static let fill = Color.white.opacity(0.1)

    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
    static let body = Font.system(size: 22)
    static let caption = Font.system(size: 15)
}

/// Capsule button in the style of apple.com: filled blue for the main action, glass otherwise.
struct PillButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 19, weight: .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 28)
            .frame(height: 54)
            .background(prominent ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(.ultraThinMaterial), in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(prominent ? 0 : 0.12)))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

/// Large rounded text field used for enrollment numbers, names and emails.
struct KioskTextField: View {
    let placeholder: String
    @Binding var text: String
    var monospaced = false
    var onSubmit: @MainActor () -> Void = {}

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(monospaced ? .system(size: 40, weight: .medium, design: .rounded).monospacedDigit() : .system(size: 26))
            .multilineTextAlignment(.center)
            .foregroundStyle(.white)
            .padding(.vertical, 18)
            .padding(.horizontal, 24)
            .frame(maxWidth: 520)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.12)))
            .onSubmit(onSubmit)
    }
}

/// Mirrored live camera feed.
struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession

    func makeNSView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        return view
    }

    func updateNSView(_ nsView: PreviewView, context: Context) {}

    final class PreviewView: NSView {
        let previewLayer = AVCaptureVideoPreviewLayer()

        override init(frame: NSRect) {
            super.init(frame: frame)
            wantsLayer = true
            previewLayer.videoGravity = .resizeAspectFill
            layer?.addSublayer(previewLayer)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func layout() {
            super.layout()
            previewLayer.frame = bounds
        }
    }
}

/// The camera in a circle with a progress ring — the kiosk's centrepiece.
struct FaceRing: View {
    let session: AVCaptureSession
    var progress: Double
    var color: Color
    var spinning = false
    var symbol: String?
    var size: CGFloat = 400

    @State private var rotation = 0.0

    var body: some View {
        ZStack {
            CameraPreview(session: session)
                .scaleEffect(x: -1, y: 1)
                .clipShape(Circle())
                .overlay(Circle().fill(symbol == nil ? .clear : color.opacity(0.35)))

            Circle().stroke(.white.opacity(0.12), lineWidth: 6)

            Circle()
                .trim(from: 0, to: spinning ? 0.18 : progress)
                .stroke(color, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90 + (spinning ? rotation : 0)))
                .animation(.spring(response: 0.45, dampingFraction: 0.8), value: progress)

            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 120, weight: .semibold))
                    .foregroundStyle(.white)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .frame(width: size, height: size)
        .animation(.spring(response: 0.4, dampingFraction: 0.75), value: symbol)
        .onAppear {
            withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { rotation = 360 }
        }
    }
}
