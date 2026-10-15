import SwiftUI

struct KioskView: View {
    @EnvironmentObject private var model: KioskModel

    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(white: 0.11), .black], center: .center, startRadius: 50, endRadius: 900)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                TopBar()
                Spacer(minLength: 24)
                switch model.route {
                case .scan: ScanScreen()
                case .manualEntry: ManualEntryScreen()
                case .enrollment:
                    if let enrollment = model.enrollment { EnrollmentScreen(model: enrollment) }
                }
                Spacer(minLength: 24)
                BottomBar()
            }
            .padding(.horizontal, 48)
            .padding(.vertical, 36)
        }
        .foregroundStyle(.white)
        .animation(.easeInOut(duration: 0.3), value: model.route)
    }
}

private struct TopBar: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Apple Lab").font(Theme.display(30))
                Text("Swift Coding Club · Parul University").font(Theme.caption).foregroundStyle(Theme.secondary)
            }
            Spacer()
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .trailing, spacing: 2) {
                    Text(context.date.formatted(date: .omitted, time: .shortened))
                        .font(Theme.display(30)).monospacedDigit()
                    Text(context.date.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                        .font(Theme.caption).foregroundStyle(Theme.secondary)
                }
            }
        }
    }
}

private struct BottomBar: View {
    @EnvironmentObject private var model: KioskModel

    var body: some View {
        HStack {
            if model.route == .scan, showsActions {
                HStack(spacing: 14) {
                    Button("Enter enrollment number") { model.route = .manualEntry }
                        .buttonStyle(PillButtonStyle())
                    Button("Enroll your face") { model.beginEnrollment() }
                        .buttonStyle(PillButtonStyle(prominent: true))
                        .disabled(!model.canEnroll)
                }
                .transition(.opacity)
            }
            Spacer()
            StatusPill(status: model.status)
        }
        .frame(height: 54)
    }

    private var showsActions: Bool {
        switch model.phase {
        case .idle, .unrecognized, .result: return true
        default: return false
        }
    }
}

private struct StatusPill: View {
    let status: KioskModel.Status

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text).font(Theme.caption).foregroundStyle(Theme.secondary)
        }
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(.ultraThinMaterial, in: Capsule())
        .help(status.problem ?? "")
    }

    private var color: Color {
        if status.problem != nil { return Theme.checkout }
        switch status.online {
        case true?: return Theme.success
        case false?: return Theme.failure
        case nil: return Theme.tertiary
        }
    }

    private var text: String {
        var parts = [status.online == false ? "Offline" : "Online"]
        if status.queued > 0 { parts.append("\(status.queued) waiting to sync") }
        parts.append("\(status.faces) faces")
        if status.problem != nil { parts.append("needs attention") }
        return parts.joined(separator: " · ")
    }
}

private struct ScanScreen: View {
    @EnvironmentObject private var model: KioskModel

    var body: some View {
        VStack(spacing: 44) {
            FaceRing(session: model.camera.session, progress: ring.progress, color: ring.color,
                     spinning: ring.spinning, symbol: ring.symbol)

            VStack(spacing: 12) {
                Text(copy.title)
                    .font(Theme.display(54))
                    .multilineTextAlignment(.center)
                Text(copy.detail)
                    .font(Theme.body)
                    .foregroundStyle(Theme.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 720)
            }
            .id(copy.title)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
            .animation(.easeOut(duration: 0.25), value: copy.title)
        }
    }

    private var ring: (progress: Double, color: Color, spinning: Bool, symbol: String?) {
        switch model.phase {
        case .idle(.ready): return (1, .white.opacity(0.5), false, nil)
        case .idle, .starting, .needsSetup: return (0, .white, false, nil)
        case .identifying, .submitting: return (0, Theme.accent, true, nil)
        case .liveness(let progress): return (progress, Theme.accent, false, nil)
        case .recognized: return (1, Theme.success, false, "checkmark")
        case .unrecognized: return (1, Theme.checkout, false, "questionmark")
        case .result(let result):
            switch result.kind {
            case .checkIn, .workshop: return (1, Theme.success, false, "checkmark")
            case .checkOut: return (1, Theme.checkout, false, "hand.wave.fill")
            case .queued: return (1, Theme.accent, false, "icloud.and.arrow.up")
            case .notice: return (1, Theme.checkout, false, "clock")
            case .failure: return (1, Theme.failure, false, "exclamationmark")
            }
        }
    }

    private var copy: (title: String, detail: String) {
        switch model.phase {
        case .starting:
            return ("Starting…", "")
        case .needsSetup(let problems):
            return ("Kiosk setup needed", problems.joined(separator: "\n"))
        case .idle(.searching), .idle(.ready):
            return ("Look at the camera", "Check in or out just by looking here.")
        case .idle(.tooFar):
            return ("Come a little closer", "Stand about an arm's length from the screen.")
        case .idle(.offCenter):
            return ("Center your face", "Move so your face is inside the circle.")
        case .idle(.multiple):
            return ("One at a time", "Only one person in front of the camera, please.")
        case .identifying:
            return ("Hold still", "Recognizing you…")
        case .liveness:
            return ("Turn your head slightly", "To either side — it makes sure it's really you.")
        case .recognized(let firstName):
            return (firstName.map { "Hi, \($0)" } ?? "Got it", "Recording your scan…")
        case .submitting:
            return ("One moment…", "")
        case .unrecognized:
            return ("We don't recognize you yet", "Enroll your face, or check in with your enrollment number.")
        case .result(let result):
            return (result.title, result.detail)
        }
    }
}

private struct ManualEntryScreen: View {
    @EnvironmentObject private var model: KioskModel
    @State private var number = ""

    var body: some View {
        VStack(spacing: 36) {
            Image(systemName: "number")
                .font(.system(size: 64, weight: .semibold))
                .foregroundStyle(Theme.accent)
            VStack(spacing: 12) {
                Text("Enter your enrollment number").font(Theme.display(48))
                Text("Use this if the camera doesn't recognize you. Manual check-ins are noted for lab admins.")
                    .font(Theme.body).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
            }
            KioskTextField(placeholder: "e.g. 2203051050123", text: $number, monospaced: true, onSubmit: submit)
            HStack(spacing: 14) {
                Button("Cancel") { model.route = .scan }.buttonStyle(PillButtonStyle())
                Button("Check in or out", action: submit)
                    .buttonStyle(PillButtonStyle(prominent: true))
                    .disabled(trimmed.isEmpty)
            }
        }
        .frame(maxWidth: 820)
    }

    private var trimmed: String { number.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func submit() {
        guard !trimmed.isEmpty else { return }
        model.submitManual(trimmed)
    }
}
