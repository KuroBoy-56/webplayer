import Foundation

/**
 * Dirección del panel. No va en texto plano: XOR con "KURO" -> base64 -> hex (igual que Android).
 */
enum PanelUrl {
    private static let enc =
        "4979456d507a6876665741734e4341715053773850796f374e794d34657a3475507a67694e32553250534a6b4f444d38507a41675944733050436f6e656a4d2f496e6f6949796f734e7a30554e43496d5a53553650773d3d"
    private static let xorKey = Array("KURO".utf8)

    private static let source: String = {
        var bytes = [UInt8]()
        var i = enc.startIndex
        while i < enc.endIndex {
            let j = enc.index(i, offsetBy: 2)
            bytes.append(UInt8(enc[i..<j], radix: 16) ?? 0)
            i = j
        }
        guard let b64 = String(bytes: bytes, encoding: .ascii),
              let raw = Data(base64Encoded: b64, options: [.ignoreUnknownCharacters]) else { return "" }
        let out = raw.enumerated().map { $0.element ^ xorKey[$0.offset % xorKey.count] }
        return String(decoding: out, as: UTF8.self)
    }()

    /** Carpeta api del panel, terminada en "/": …/master/panel/api/ */
    static let apiBase: String = {
        let u = source.trimmed
        if u.isEmpty { return "" }
        let last = u.split(separator: "/").last.map(String.init) ?? ""
        if last.lowercased().hasSuffix(".php") { return String(u[..<u.lastIndex(of: "/")!]) + "/" }
        var t = u
        while t.hasSuffix("/") { t.removeLast() }
        if t.lowercased().hasSuffix("/api") { return t + "/" }
        return t + "/api/"
    }()

    static func api(_ file: String) -> String { apiBase + file }
}
