import Foundation

/**
 * Nombres de pistas como en las otras apps: solo el idioma ("Español latino", "Inglés"). VLC los da con todo
 * lo técnico ("Unique Latino 2.0 AAC - [Spanish]", "Track 2 - [English]"); se deja el idioma y nada más.
 */
enum TrackNames {
    private static let words: [(String, String)] = [
        ("spanish", "es"), ("español", "es"), ("espanol", "es"), ("castellano", "es"), ("latino", "es"),
        ("english", "en"), ("inglés", "en"), ("ingles", "en"),
        ("portuguese", "pt"), ("português", "pt"), ("portugues", "pt"),
        ("french", "fr"), ("français", "fr"), ("francés", "fr"),
        ("german", "de"), ("deutsch", "de"), ("italian", "it"), ("japanese", "ja"), ("korean", "ko"),
    ]
    /** códigos solo si son todo el texto entre corchetes ("por" suelto es español) */
    private static let codes = ["spa": "es", "es": "es", "eng": "en", "en": "en", "por": "pt", "pt": "pt", "fre": "fr", "fra": "fr", "fr": "fr",
                                "ger": "de", "deu": "de", "ita": "it", "jpn": "ja", "kor": "ko"]

    /** "" si no se sabe el idioma (el que llama pone "Audio 2") */
    static func clean(_ raw: String) -> String {
        let n = raw.lowercased()
        // lo que va entre corchetes es el idioma que reconoció VLC
        var lang = ""
        if let o = n.lastIndex(of: "["), let c = n.lastIndex(of: "]"), o < c { lang = String(n[n.index(after: o)..<c]).trimmingCharacters(in: .whitespaces) }
        let code = codes[lang] ?? (codeOf(lang).isEmpty ? codeOf(n) : codeOf(lang))
        if code.isEmpty {
            // sin idioma: el nombre solo si es una palabra corta, si no nada
            let t = raw.trimmingCharacters(in: .whitespaces)
            return t.count <= 16 && t.rangeOfCharacter(from: CharacterSet(charactersIn: "0123456789.,:;()[]/\\#_+=|-")) == nil ? t : ""
        }
        if code == "es" && (n.contains("lat") || n.range(of: "\\bmx\\b", options: .regularExpression) != nil) { return tr("Español latino") }
        let loc = L10n.locale
        return loc.localizedString(forLanguageCode: code)?.capitalized(with: loc) ?? code.uppercased()
    }

    private static func codeOf(_ s: String) -> String {
        if s.isEmpty { return "" }
        for (w, c) in words where s.range(of: "\\b" + w + "\\b", options: .regularExpression) != nil { return c }
        return ""
    }

    /** dos pistas con el mismo nombre: "Inglés", "Inglés 2" */
    static func numbered(_ list: [Track]) -> [Track] {
        var seen: [String: Int] = [:]
        return list.map { t in
            let k = (seen[t.name] ?? 0) + 1
            seen[t.name] = k
            return k > 1 ? Track(id: t.id, name: "\(t.name) \(k)") : t
        }
    }
}
