import Foundation
import CryptoKit

/**
 * Carátulas y fondos por la caché del panel (igual que Roku, Vega, Android y la web): una sola copia de cada imagen en
 * el panel. Orden de una carátula: la copia pública (api/imgc/<sha1>.jpg, la sirve el servidor web sin PHP) →
 * api/img.php (la achica la primera vez y, con el título, busca el póster en TMDB si el servidor IPTV no tiene) → la
 * dirección original. Fondos de TMDB en Full HD hechos por el panel (img.php w=1920). Si el dueño apaga la caché
 * ("img": false de progress.php ?v=2) todo va directo al servidor IPTV y a TMDB, sin pasar por el panel.
 */
enum PanelImg {
    private static let key = "panel_img_on"

    /** el dueño tiene la caché de imágenes encendida (vale desde las próximas carátulas) */
    static var on: Bool {
        get { UserDefaults.standard.object(forKey: key) as? Bool ?? true }
        set { if newValue != on { UserDefaults.standard.set(newValue, forKey: key) } }
    }

    /** base64url sin "=" de los bytes UTF-8 (lo mismo que decodifica api/img.php) */
    static func b64u(_ s: String) -> String {
        Data(s.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func sha1(_ s: String) -> String {
        Insecure.SHA1.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /** "https://panel/api/" o "" (caché apagada o sin token del panel) */
    private static func base() -> String {
        guard on, let t = Store.cloudToken, !t.isEmpty else { return "" }
        return PanelUrl.apiBase
    }

    private static func token() -> String { urlEnc(Store.cloudToken ?? "") }

    private static func isTmdb(_ u: String) -> Bool { u.contains("image.tmdb.org/") }

    /**
     * Nombre de la copia del panel (igual que img_key / img_idkey de api/img.php): con el id de TMDB
     * "500|tmdbid:<tipo>:<id>"; si no, la imagen sin http/https y con el servidor en minúsculas, y las de TMDB por su archivo.
     */
    static func canonKey(_ poster: String, _ kind: String, _ tm: String) -> String {
        if !tm.isEmpty { return "500|tmdbid:\(kind):\(tm)" }
        if let m = poster.range(of: "image\\.tmdb\\.org/t/p/[^/]+/[A-Za-z0-9_\\-]+\\.(jpe?g|png|webp)", options: [.regularExpression, .caseInsensitive]) {
            let file = poster[m].split(separator: "/").last.map(String.init) ?? ""
            return "500|tmdb:" + file
        }
        var u = poster
        if let r = u.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) { u.removeSubrange(r) }
        guard let slash = u.firstIndex(of: "/") else { return "500|" + u.lowercased() }
        return "500|" + u[..<slash].lowercased() + String(u[slash...])
    }

    /** direcciones de la carátula de un título, en orden (la tarjeta pasa a la siguiente si una no carga) */
    static func posterSources(_ item: Item) -> [String] {
        var out = [String]()
        let poster = item.poster.trimmed
        let b = base()
        let name = item.name.trimmed
        let tm = item.tmdb ?? ""
        let http = poster.lowercased().hasPrefix("http://") || poster.lowercased().hasPrefix("https://")
        if !b.isEmpty && item.kind != .live && !isTmdb(poster) && (http || !name.isEmpty) {
            let kind = item.kind == .series ? "series" : "vod"
            let src = http ? poster : ""
            let y = Rx.has(item.year, "^(19|20)\\d\\d$") ? item.year : ""
            let key = !src.isEmpty || !tm.isEmpty ? canonKey(src, kind, tm) : "500|n|\(kind)|\(name)|\(y)"
            // ?v=2: el panel vació la caché (los pósteres de TMDB de antes podían ser de otra película)
            out.append(b + "imgc/" + sha1(key) + ".jpg?v=2")
            var u = b + "img.php?w=500&v=2&token=" + token()
            if !src.isEmpty { u += "&u=" + b64u(src) }
            if !name.isEmpty || !tm.isEmpty { u += "&k=" + kind }
            if !name.isEmpty { u += "&n=" + b64u(name) + (y.isEmpty ? "" : "&y=" + y) }
            if !tm.isEmpty { u += "&t=" + tm }
            out.append(u)
        }
        if !poster.isEmpty && !out.contains(poster) { out.append(poster) }
        return out
    }

    /** fondo: el de TMDB en Full HD hecho por el panel y, si falla, el de siempre */
    static func backdropSources(_ url: String) -> [String] {
        if url.isEmpty { return [] }
        let b = base()
        if b.isEmpty || !isTmdb(url) { return [url] }
        let orig = url.replacingOccurrences(of: "(image\\.tmdb\\.org/t/p/)[^/]+/", with: "$1original/", options: .regularExpression)
        return [b + "img.php?w=1920&token=" + token() + "&u=" + b64u(orig), url]
    }

    #if DEBUG
    /** autocomprobación (la compilación Debug de la prueba del simulador la corre al abrir): mismos nombres que el panel */
    static func selfCheck() {
        assert(sha1("abc") == "a9993e364706816aba3e25717850c26c9cd0d89d")
        assert(sha1(canonKey("", "vod", "603")) == "db8d2b095ba8b629a3a1e88835d5e303c328d072")
        assert(canonKey("http://Srv.Example.com:8080/images/a b/ñ.jpg", "vod", "") == "500|srv.example.com:8080/images/a b/ñ.jpg")
        assert(b64u("http://Srv.Example.com:8080/images/a b/ñ.jpg") == "aHR0cDovL1Nydi5FeGFtcGxlLmNvbTo4MDgwL2ltYWdlcy9hIGIvw7EuanBn")
    }
    #endif
}
