import AppKit
import SwiftUI

@main
struct AATCEKioskApp: App {
    @StateObject private var model = KioskModel()

    init() {
        // Needed when launched with `swift run` (no app bundle).
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("AATCE Kiosk") {
            KioskView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .frame(minWidth: 1100, minHeight: 760)
                .onAppear {
                    model.start()
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    // Full screen when running as the installed app; windowed during development.
                    if Bundle.main.bundleURL.pathExtension == "app",
                       let window = NSApplication.shared.windows.first,
                       !window.styleMask.contains(.fullScreen) {
                        window.toggleFullScreen(nil)
                    }
                }
        }
        .windowStyle(.hiddenTitleBar)
        .commands { CommandGroup(replacing: .newItem) {} }

        Settings {
            SettingsView().environmentObject(model)
        }
    }
}
