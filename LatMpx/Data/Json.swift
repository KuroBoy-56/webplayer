import Foundation

/** JSON tolerante: los paneles Xtream mezclan números, textos y null. */
typealias JObj = [String: Any]

extension Dictionary where Key == String, Value == Any {
    func s(_ k: String) -> String {
        guard let v = self[k], !(v is NSNull) else { return "" }
        let t: String
        switch v {
        case let x as String: t = x
        case let x as NSNumber: t = x.stringValue
        default: t = "\(v)"
        }
        let r = t.trimmingCharacters(in: .whitespacesAndNewlines)
        return r == "null" ? "" : r
    }
    func i(_ k: String) -> Int { Int(Double(s(k)) ?? 0) }
    func d(_ k: String) -> Double { Double(s(k).replacingOccurrences(of: ",", with: ".")) ?? 0 }
    func b(_ k: String, _ def: Bool = false) -> Bool {
        guard let v = self[k] else { return def }
        if let x = v as? Bool { return x }
        if let x = v as? NSNumber { return x.intValue != 0 }
        if let x = v as? String { return x == "1" || x.lowercased() == "true" }
        return def
    }
    func o(_ k: String) -> JObj? { self[k] as? JObj }
    func a(_ k: String) -> [Any]? { self[k] as? [Any] }
    func objs(_ k: String) -> [JObj] { (self[k] as? [Any])?.compactMap { $0 as? JObj } ?? [] }
}

enum Json {
    static func parse(_ data: Data) -> Any? { try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
    static func obj(_ text: String) -> JObj? { parse(Data(text.utf8)) as? JObj }
    static func string(_ o: Any) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: []) else { return "{}" }
        return String(decoding: d, as: UTF8.self)
    }
}

/* ---------- expresiones regulares con caché ---------- */
enum Rx {
    private static var cache: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    static func get(_ p: String, _ ci: Bool = false) -> NSRegularExpression? {
        let key = (ci ? "i|" : "c|") + p
        lock.lock(); defer { lock.unlock() }
        if let r = cache[key] { return r }
        let r = try? NSRegularExpression(pattern: p, options: ci ? [.caseInsensitive] : [])
        if let r = r { cache[key] = r }
        return r
    }

    static func has(_ s: String, _ p: String, ci: Bool = false) -> Bool {
        guard let r = get(p, ci) else { return false }
        return r.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    static func replace(_ s: String, _ p: String, _ with: String, ci: Bool = false) -> String {
        guard let r = get(p, ci) else { return s }
        return r.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: with)
    }

    /** grupos de la primera coincidencia (0 = todo) */
    static func groups(_ s: String, _ p: String, ci: Bool = false) -> [String]? {
        guard let r = get(p, ci), let m = r.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var isDigits: Bool { !isEmpty && allSatisfy { $0.isASCII && $0.isNumber } }
    /** minúsculas y sin acentos */
    var folded: String { lowercased().folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX")) }
    func ifEmpty(_ other: @autoclosure () -> String) -> String { isEmpty ? other() : self }
}

/** codificación de formularios y consultas (las claves base64 llevan + / =) */
func urlEnc(_ s: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
}

extension NSLock {
    /** sección protegida (se puede usar desde funciones async) */
    func locked<T>(_ f: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try f()
    }
}
