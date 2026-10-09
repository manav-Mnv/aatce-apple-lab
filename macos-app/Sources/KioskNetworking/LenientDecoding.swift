import Foundation

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
            if trimmed.isEmpty { return nil }
            if let value = Int(trimmed) { return value }
            if let value = Double(trimmed) { return Int(value) }
            return nil
        }
        return nil
    }
}
