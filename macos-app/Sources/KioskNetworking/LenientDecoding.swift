import Foundation

/// Google Sheets cells can come back as strings or numbers (e.g. an enrollment
/// number typed as 2021001), so a few fields accept either.
extension KeyedDecodingContainer {
    func lenientString(forKey key: Key) throws -> String {
        if let string = try? decode(String.self, forKey: key) { return string }
        if let integer = try? decode(Int.self, forKey: key) { return String(integer) }
        if let double = try? decode(Double.self, forKey: key) { return String(double) }
        return ""
    }

    func lenientInt(forKey key: Key) throws -> Int? {
        if let integer = try? decode(Int.self, forKey: key) { return integer }
        if let double = try? decode(Double.self, forKey: key) { return Int(double) }
        if let string = try? decode(String.self, forKey: key) {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return Int(trimmed) ?? Double(trimmed).map { Int($0) }
        }
        return nil
    }
}
