import KioskCore
import SwiftUI

/// ⌘, — for lab admins. The secret is write-only: it is never shown once saved.
struct SettingsView: View {
    @EnvironmentObject private var model: KioskModel
    @State private var settings = KioskSettings.load()
    @State private var secret = ""
    @State private var message: String?

    var body: some View {
        Form {
            Section("Backend") {
                TextField("Web app URL", text: $settings.backendURL, prompt: Text("https://script.google.com/macros/s/…/exec"))
                SecureField("Kiosk secret", text: $secret,
                            prompt: Text(SecretStore.read() == nil ? "Paste KIOSK_SECRET" : "Saved in Keychain — paste to replace"))
                TextField("Workshop name (optional)", text: $settings.workshopName,
                          prompt: Text("Used for non-member check-ins"))
            }
            Section("Recognition") {
                HStack {
                    Slider(value: $settings.matchThreshold, in: 0.5...0.9, step: 0.01) { Text("Match threshold") }
                    Text(settings.matchThreshold.formatted(.number.precision(.fractionLength(2))))
                        .monospacedDigit().frame(width: 44)
                }
                Text("Higher is stricter. 0.65 is the default (SRS FR-7).").font(.caption).foregroundStyle(.secondary)
            }
            Section("Status") {
                LabeledContent("Embeddings version", value: "\(model.status.embeddingsVersion)")
                LabeledContent("Faces on this kiosk", value: "\(model.status.faces)")
                LabeledContent("Scans waiting to sync", value: "\(model.status.queued)")
                LabeledContent("Face model", value: model.embedder?.modelVersion ?? "not loaded")
                if let problem = model.status.problem {
                    Text(problem).foregroundStyle(.orange)
                }
            }
            HStack {
                if let message { Text(message).foregroundStyle(.secondary) }
                Spacer()
                Button("Sync now") { Task { await model.syncEmbeddings() } }
                Button("Save") { save() }.keyboardShortcut(.defaultAction)
            }
        }
        .formStyle(.grouped)
        .frame(width: 560)
        .padding(.vertical, 8)
    }

    private func save() {
        settings.save()
        if !secret.isEmpty {
            guard SecretStore.save(secret.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                message = "Couldn't save the secret to the Keychain."
                return
            }
            secret = ""
        }
        model.reload()
        message = "Saved."
    }
}
