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
    var projectURL: String
    var publishableKey: String
    var workshopName: String
    var matchThreshold: Double

    private static let store = UserDefaults.standard

    static func load() -> KioskSettings {
        KioskSettings(
            projectURL: store.string(forKey: "projectURL") ?? "",
            publishableKey: store.string(forKey: "publishableKey") ?? "",
            workshopName: store.string(forKey: "workshopName") ?? "",
            matchThreshold: store.object(forKey: "matchThreshold") as? Double ?? Double(FaceMatcher.defaultThreshold)
        )
    }

    func save() {
        Self.store.set(projectURL.trimmingCharacters(in: .whitespaces), forKey: "projectURL")
        Self.store.set(publishableKey.trimmingCharacters(in: .whitespaces), forKey: "publishableKey")
        Self.store.set(workshopName.trimmingCharacters(in: .whitespaces), forKey: "workshopName")
        Self.store.set(matchThreshold, forKey: "matchThreshold")
    }

    /// HTTPS only (http allowed for a localhost Supabase during development).
    var backendConfiguration: BackendConfiguration? {
        let key = publishableKey.trimmingCharacters(in: .whitespaces)
        guard let url = URL(string: projectURL.trimmingCharacters(in: .whitespaces)),
              url.scheme == "https" || (url.scheme == "http" && url.host == "localhost"),
              !key.isEmpty,
              let secret = SecretStore.read(), !secret.isEmpty else { return nil }
        return BackendConfiguration(projectURL: url, publishableKey: key, secret: secret)
    }
}

/// First names seen in scan replies, so the kiosk can greet a recognised student
/// instantly while the backend records the scan.
enum KnownNames {
    private static let key = "knownFirstNames"

    static func firstName(for enrollmentNo: String) -> String? {
        (UserDefaults.standard.dictionary(forKey: key) as? [String: String])?[enrollmentNo]
    }

    static func remember(fullName: String, for enrollmentNo: String) {
        guard let first = fullName.split(separator: " ").first.map(String.init), !first.isEmpty else { return }
        var names = UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]
        names[enrollmentNo] = first
        UserDefaults.standard.set(names, forKey: key)
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
