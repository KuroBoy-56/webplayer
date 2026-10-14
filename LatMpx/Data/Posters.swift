import Foundation

/**
 * Carátula garantizada: si el servidor IPTV no trae póster, se busca en TMDB con la llave del panel
 * y se recuerda en el equipo.
 */
enum Posters {
    private static let lock = NSLock()
    private static var mem: [String: String] = [:]
    private static let prefs = UserDefaults(suiteName: "posters") ?? .standard

    /** por idioma: TMDB devuelve la carátula del idioma de la app */
    private static func keyOf(_ i: Item) -> String { "\(Tmdb.lang)|\(i.kind.rawValue)|\(i.name.lowercased())" }

    static func cached(_ i: Item) -> String? {
        let k = keyOf(i)
        lock.lock(); defer { lock.unlock() }
        if let v = mem[k] { return v }
        if let v = prefs.string(forKey: k) { mem[k] = v; return v }
        return nil
    }

    static func resolve(_ i: Item) async -> String {
        if i.kind == .live { return "" }
        if let c = cached(i) { return c }
        guard let url = await Tmdb.findPoster(i.kind == .series ? "tv" : "movie", i.name, i.year) else { return "" }
        let k = keyOf(i)
        lock.locked { mem[k] = url }
        if !url.isEmpty { prefs.set(url, forKey: k) }
        return url
    }

    /**
     * Enlace de imagen tal como lo usa la web (wp_img): vacío si no es http(s) o es el marcador de TMDB
     * sin archivo; espacios y acentos codificados.
     */
    static func clean(_ raw: String) -> String {
        let u = raw.trimmed
        let l = u.lowercased()
        guard !u.isEmpty, l.hasPrefix("http://") || l.hasPrefix("https://") else { return "" }
        if let r = u.range(of: "image.tmdb.org/t/p/") {
            let tail = String(u[r.upperBound...])
            if !tail.contains("/") || tail.hasSuffix("/") { return "" }
        }
        if u.unicodeScalars.allSatisfy({ $0.value >= 0x21 && $0.value <= 0x7e }) { return u }
        var allowed = CharacterSet(charactersIn: UnicodeScalar(0x21)!...UnicodeScalar(0x7e)!)
        allowed.remove(charactersIn: " ")
        return u.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }
}
