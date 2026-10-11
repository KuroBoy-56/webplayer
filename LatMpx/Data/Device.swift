import Foundation
#if canImport(Security)
import Security
#endif

/**
 * Identificador del equipo en el formato MAC del panel (8 pares hex, "A1:B2:C3:D4:E5:F6:07:18").
 * iOS no da un identificador fijo del equipo: se crea uno al azar la primera vez y se guarda en el
 * llavero (Keychain), que se conserva aunque se borre y se vuelva a instalar la app.
 */
enum Device {
    private static let service = "com.latmpx.player"
    private static let account = "device_id"

    static let id: String = {
        if let v = keychainRead(), !v.isEmpty { return v }
        if let v = UserDefaults.standard.string(forKey: "device_id"), !v.isEmpty { keychainWrite(v); return v }
        var b = (0..<8).map { _ in UInt8.random(in: 0...255) }
        b[0] |= 0x10 // nunca empieza en "00": siempre 8 pares
        let v = normalize(b.map { String(format: "%02x", $0) }.joined())
        keychainWrite(v)
        UserDefaults.standard.set(v, forKey: "device_id")
        return v
    }()

    /** igual que Device.normalize de Android y normalise_mac() del panel */
    static func normalize(_ raw: String) -> String {
        var hex = raw.trimmed.uppercased().filter { ("0"..."9").contains($0) || ("A"..."F").contains($0) }
        if hex.count > 16 { hex = String(hex.suffix(16)) }
        while hex.count < 16 { hex = "0" + hex }
        var pairs = stride(from: 0, to: 16, by: 2).map { i -> String in
            let s = hex.index(hex.startIndex, offsetBy: i)
            return String(hex[s..<hex.index(s, offsetBy: 2)])
        }
        while pairs.count > 6 && pairs.first == "00" { pairs.removeFirst() }
        return pairs.joined(separator: ":")
    }

    private static func keychainRead() -> String? {
        #if canImport(Security)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
        #else
        return nil
        #endif
    }

    private static func keychainWrite(_ v: String) {
        #if canImport(Security)
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(v.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
        #endif
    }

    static var model: String {
        var sys = utsname()
        uname(&sys)
        let m = withUnsafePointer(to: &sys.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
        return "Apple " + m
    }
}
