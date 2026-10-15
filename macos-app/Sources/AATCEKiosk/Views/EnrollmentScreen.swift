import SwiftUI

struct EnrollmentScreen: View {
    @EnvironmentObject private var kiosk: KioskModel
    @ObservedObject var model: EnrollmentModel

    var body: some View {
        VStack(spacing: 36) {
            content
            if let error = model.error {
                Text(error).font(Theme.caption).foregroundStyle(Theme.failure)
            }
        }
        .frame(maxWidth: 860)
        .animation(.easeInOut(duration: 0.25), value: model.step)
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .number:
            Header(symbol: "person.crop.circle.badge.plus", title: "Enroll your face",
                   detail: "Enter your enrollment number to get started.")
            KioskTextField(placeholder: "Enrollment number", text: $model.enrollmentNo, monospaced: true) {
                Task { await model.lookup() }
            }
            Actions(primary: "Continue", primaryDisabled: model.trimmedNumber.isEmpty || model.busy,
                    secondary: "Cancel", onSecondary: model.cancel) {
                Task { await model.lookup() }
            }

        case .confirm(let name, let emailHint):
            Header(symbol: "person.crop.circle", title: "Is this you?", detail: nil)
            VStack(spacing: 8) {
                Text(name).font(Theme.display(44))
                Text(emailHint).font(Theme.body).foregroundStyle(Theme.secondary)
            }
            Actions(primary: "That's me", secondary: "Not me", onSecondary: model.cancel, onPrimary: model.confirmIdentity)

        case .details:
            Header(symbol: "person.crop.circle.badge.questionmark", title: "Welcome to the Apple Lab",
                   detail: "You're not on the Swift Coding Club roster — that's fine. Workshop attendees can enroll too.")
            VStack(spacing: 14) {
                KioskTextField(placeholder: "Full name", text: $model.name)
                KioskTextField(placeholder: "Email", text: $model.email, onSubmit: model.submitDetails)
            }
            Actions(primary: "Continue", secondary: "Cancel", onSecondary: model.cancel, onPrimary: model.submitDetails)

        case .consent:
            Header(symbol: "hand.raised.fill", title: "Your face, your choice.", detail: nil)
            ConsentText()
            Actions(primary: model.busy ? "Saving…" : "I agree", primaryDisabled: model.busy,
                    secondary: "Cancel", onSecondary: model.cancel) {
                Task { await model.agree() }
            }

        case .capture(let count, let turnHead):
            FaceRing(session: kiosk.camera.session,
                     progress: Double(count) / Double(EnrollmentModel.totalCount),
                     color: Theme.accent, size: 360)
            Header(symbol: nil,
                   title: turnHead ? "Now turn your head slightly" : "Look straight at the camera",
                   detail: turnHead ? "To either side, slowly." : "Hold still for a moment.")
            Button("Cancel", action: model.cancel).buttonStyle(PillButtonStyle())

        case .saving:
            FaceRing(session: kiosk.camera.session, progress: 0, color: Theme.accent, spinning: true, size: 360)
            Header(symbol: nil, title: "Saving…", detail: "Securing your face signature.")

        case .done(let name):
            FaceRing(session: kiosk.camera.session, progress: 1, color: Theme.success, symbol: "checkmark", size: 360)
            Header(symbol: nil, title: "You're all set, \(name.split(separator: " ").first.map(String.init) ?? name).",
                   detail: "Next time, just look at the camera.")
            Button("Done", action: model.cancel).buttonStyle(PillButtonStyle(prominent: true))

        case .failed(let message):
            Header(symbol: "exclamationmark.triangle.fill", title: "That didn't work", detail: message)
            Actions(primary: "Try again", secondary: "Cancel", onSecondary: model.cancel, onPrimary: model.retryCapture)
        }
    }
}

private struct Header: View {
    let symbol: String?
    let title: String
    let detail: String?

    var body: some View {
        VStack(spacing: 14) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.bottom, 8)
            }
            Text(title).font(Theme.display(48)).multilineTextAlignment(.center)
            if let detail {
                Text(detail).font(Theme.body).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
            }
        }
    }
}

private struct Actions: View {
    let primary: String
    var primaryDisabled = false
    let secondary: String
    let onSecondary: @MainActor () -> Void
    let onPrimary: @MainActor () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(secondary, action: onSecondary).buttonStyle(PillButtonStyle())
            Button(primary, action: onPrimary)
                .buttonStyle(PillButtonStyle(prominent: true))
                .disabled(primaryDisabled)
                .keyboardShortcut(.defaultAction)
        }
    }
}

private struct ConsentText: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            point("camera.fill", "We take five photos of your face and turn them into a face signature (a list of numbers).")
            point("lock.fill", "They're stored in the Swift Coding Club's private Google Drive. Only lab maintainers can see them.")
            point("checkmark.seal.fill", "They're used only to record Apple Lab attendance — never shared or used for anything else.")
            point("trash.fill", "Ask a lab admin at any time to delete your photos and signature.")
        }
        .font(.system(size: 19))
        .padding(28)
        .frame(maxWidth: 680, alignment: .leading)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func point(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Image(systemName: symbol).foregroundStyle(Theme.accent).frame(width: 24)
            Text(text).foregroundStyle(.white.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
        }
    }
}
