import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

/** Cifrados que usa el panel: AES-256-GCM con HKDF (login.php, report.php) y "mope" (auth.php). */
enum PanelCrypto {
    struct MissingKey: Error {}
    static let missingKeyMessage = "Falta la llave del panel (PANEL_MASTER_KEY). Pide al administrador una versión de la app configurada."

    private static let saltLen = 16
    private static let ivLen = 12
    private static let tagLen = 16

    /** Llave maestra (32 bytes) escrita al compilar (tools/write-panel-key.sh); nil si no se configuró. */
    private static let masterKey: Data? = {
        let m = PanelKey.masked, k = PanelKey.mask
        guard m.count == 32, !k.isEmpty else { return nil }
        return Data(m.enumerated().map { $0.element ^ k[$0.offset % k.count] })
    }()

    static var hasKey: Bool { masterKey != nil }

    private static func random(_ n: Int) -> Data {
        var g = SystemRandomNumberGenerator()
        return Data((0..<n).map { _ in UInt8.random(in: 0...255, using: &g) })
    }

    /** Igual que hkdf() de login.php: prk = HMAC(salt, ikm); okm = HMAC(prk, 0x01)[0..32] */
    private static func hkdf(_ ikm: Data, _ salt: Data) -> SymmetricKey {
        let prk = Data(HMAC<SHA256>.authenticationCode(for: ikm, using: SymmetricKey(data: salt)))
        let okm = Data(HMAC<SHA256>.authenticationCode(for: Data([1]), using: SymmetricKey(data: prk)))
        return SymmetricKey(data: okm.prefix(32))
    }

    /** base64(salt16 + iv12 + cifrado + tag16) */
    static func encrypt(_ plain: String) throws -> String {
        guard let mk = masterKey else { throw MissingKey() }
        let salt = random(saltLen), iv = random(ivLen)
        let box = try AES.GCM.seal(Data(plain.utf8), using: hkdf(mk, salt), nonce: AES.GCM.Nonce(data: iv))
        var out = Data()
        out.append(salt); out.append(iv); out.append(box.ciphertext); out.append(box.tag)
        return out.base64EncodedString()
    }

    static func decrypt(_ b64: String) throws -> String? {
        guard let mk = masterKey else { throw MissingKey() }
        guard let bin = Data(base64Encoded: b64.trimmed, options: [.ignoreUnknownCharacters]),
              bin.count >= saltLen + ivLen + tagLen else { return nil }
        let salt = bin.subdata(in: 0..<saltLen)
        let iv = bin.subdata(in: saltLen..<(saltLen + ivLen))
        let ct = bin.subdata(in: (saltLen + ivLen)..<(bin.count - tagLen))
        let tag = bin.subdata(in: (bin.count - tagLen)..<bin.count)
        guard let nonce = try? AES.GCM.Nonce(data: iv),
              let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: ct, tag: tag),
              let plain = try? AES.GCM.open(box, using: hkdf(mk, salt)) else { return nil }
        return String(data: plain, encoding: .utf8)
    }

    /* ---------- mope (auth.php) ---------- */
    private static let mope = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890")

    /** Port de mope_encrypt(): base64 con basura insertada y dos letras al final que dicen dónde. */
    static func mopeEncrypt(_ json: String) -> String {
        let b = Array(Data(json.utf8).base64EncodedString())
        let at = Int.random(in: 0...max(min(40, b.count - 1), 0))
        let n = 10 + Int.random(in: 0...20)
        let junk = String((0..<n).map { _ in mope[Int.random(in: 0..<62)] })
        let cut = min(at + 2, b.count)
        return String(b[0..<cut]) + junk + String(b[cut...]) + String(mope[at + 17]) + String(mope[n])
    }

    /** Port exacto de mope_decrypt(). */
    static func mopeDecrypt(_ input: String) -> String? {
        let c = Array(input)
        guard c.count >= 2, let i1 = mope.firstIndex(of: c[c.count - 2]), let p2 = mope.firstIndex(of: c[c.count - 1]) else { return nil }
        let p1 = i1 - 15
        guard p1 >= 0 else { return nil }
        let core = Array(c[0..<(c.count - 2)])
        let head = core.prefix(p1)
        let tail = core.count > p1 + p2 ? Array(core[(p1 + p2)...]) : []
        let clean = String(head) + String(tail)
        guard let d = Data(base64Encoded: clean, options: [.ignoreUnknownCharacters]) else { return nil }
        return String(data: d, encoding: .utf8)?.trimmed
    }
}
