import Foundation
import KioskCore
import KioskNetworking
import Security

enum KioskPaths {
    /// ~/Library/Application Support/AATCEKiosk — embeddings, local enrollments, scan queue, model.
    static let directory: URL = FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("AATCEKiosk", isDirectory: true)
}

/// Non-secret settings live in UserDefaults; the kiosk secret lives in the Keychain (NFR-8).
struct KioskSettings: Equatable {
    var backendURL: String
    var workshopName: String
    var matchThreshold: Double

    private static let store = UserDefaults.standard

    static func load() -> KioskSettings {
        KioskSettings(
            backendURL: store.string(forKey: "backendURL") ?? "",
            workshopName: store.string(forKey: "workshopName") ?? "",
            matchThreshold: store.object(forKey: "matchThreshold") as? Double ?? Double(FaceMatcher.defaultThreshold)
        )
    }

    func save() {
        Self.store.set(backendURL.trimmingCharacters(in: .whitespaces), forKey: "backendURL")
        Self.store.set(workshopName.trimmingCharacters(in: .whitespaces), forKey: "workshopName")
        Self.store.set(matchThreshold, forKey: "matchThreshold")
    }

    /// HTTPS only, except a localhost dev server (backend/dev/server.js).
    var backendConfiguration: BackendConfiguration? {
        guard let url = URL(string: backendURL.trimmingCharacters(in: .whitespaces)),
              url.scheme == "https" || (url.scheme == "http" && url.host == "localhost"),
              let secret = SecretStore.read(), !secret.isEmpty else { return nil }
        return BackendConfiguration(baseURL: url, secret: secret)
    }
}

enum SecretStore {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "club.scc.aatce.kiosk",
        kSecAttrAccount as String: "kiosk-secret"
    ]

    static func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func save(_ secret: String) -> Bool {
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = Data(secret.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }
}
