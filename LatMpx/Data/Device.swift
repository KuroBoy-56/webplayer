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

    /** identificador interno del modelo ("iPhone16,1"); en el simulador, el que simula */
    static var machine: String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !sim.isEmpty { return sim }
        var sys = utsname()
        uname(&sys)
        return withUnsafePointer(to: &sys.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
    }

    /** modelo para el panel, con el nombre comercial: "iPhone 15 Pro (iPhone16,1)" */
    static var model: String {
        let m = machine
        if let n = names[m] { return "\(n) (\(m))" }
        if m.hasPrefix("iPhone") { return "iPhone (\(m))" }
        if m.hasPrefix("iPad") { return "iPad (\(m))" }
        return "Apple \(m)"
    }

    private static let names: [String: String] = [
        "iPhone10,1": "iPhone 8", "iPhone10,4": "iPhone 8", "iPhone10,2": "iPhone 8 Plus", "iPhone10,5": "iPhone 8 Plus",
        "iPhone10,3": "iPhone X", "iPhone10,6": "iPhone X",
        "iPhone11,2": "iPhone XS", "iPhone11,4": "iPhone XS Max", "iPhone11,6": "iPhone XS Max", "iPhone11,8": "iPhone XR",
        "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro", "iPhone12,5": "iPhone 11 Pro Max", "iPhone12,8": "iPhone SE (2.ª gen.)",
        "iPhone13,1": "iPhone 12 mini", "iPhone13,2": "iPhone 12", "iPhone13,3": "iPhone 12 Pro", "iPhone13,4": "iPhone 12 Pro Max",
        "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13", "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max",
        "iPhone14,6": "iPhone SE (3.ª gen.)", "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus",
        "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max",
        "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus", "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
        "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max",
        "iPhone17,5": "iPhone 16e",
    ]
}
