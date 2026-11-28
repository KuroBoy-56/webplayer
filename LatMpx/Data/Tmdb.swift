import Foundation

/** TMDB con la llave que configura el panel (nunca una llave escrita en la app). */
enum Tmdb {
    /** la llave que TMDB rechazó (401); si el panel manda otra, se vuelve a usar */
    private static var badKey = ""
    private static let lock = NSLock()
    private static var detailCache: [String: Details] = [:]
    private static var photoCache: [String: String] = [:]

    /** borrado de caché del panel */
    static func clearCache() { lock.locked { detailCache = [:]; photoCache = [:]; badKey = "" } }

    /**
     * idioma de TMDB según el de la app: ficha (sinopsis) y carátulas de now_playing. Las búsquedas siguen en
     * es-MX porque comparan título y año con el catálogo del servidor, que está en español.
     */
    static var lang: String {
        switch L10n.current {
        case "en": return "en-US"
        case "pt": return "pt-BR"
        case "fr": return "fr-FR"
        default: return "es-MX"
        }
    }

    /** imágenes en alta calidad: fotos del elenco a 632 px de alto y fondos en su tamaño original (Full HD / 4K) */
    static let profileSize = "h632", backdropSize = "original", posterSize = "w780"

    /** la llave llega del panel junto al token al entrar: si una pantalla la pide antes, se espera unos segundos */
    private static func key() async -> String {
        var k = Store.tmdbKey
        var n = 0
        while k.isEmpty && n < 16 {
            try? await Task.sleep(nanoseconds: 500_000_000)
            k = Store.tmdbKey
            n += 1
        }
        return k
    }

    /**
     * TMDB por el panel (api/tmdb.php: la clave del distribuidor o del dueño y su caché de 24 h). Solo si el panel no
     * responde se pregunta a TMDB directo con la llave que mandó el panel.
     */
    private static func get(_ path: String) async -> JObj? {
        if let j = await viaPanel(path) { return j }
        let k = await key()
        if k.isEmpty || k == lock.locked({ badKey }) { return nil }
        let sep = path.contains("?") ? "&" : "?"
        let r = await Net.get("https://api.themoviedb.org/3/\(path)\(sep)api_key=\(urlEnc(k))", timeout: 15)
        if r.code == 401 { lock.locked { badKey = k }; return nil }
        return r.ok ? r.json() : nil
    }

    /** "search/movie?language=es-MX&query=…" por el panel; nil si el panel no la pudo dar */
    private static func viaPanel(_ path: String) async -> JObj? {
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        let q = parts.count > 1 ? "&" + parts[1] : ""
        let r = await Net.get(PanelUrl.api("tmdb.php") + "?path=" + parts[0] + q + Tenant.query(), timeout: 15)
        guard r.ok, let j = r.json() else { return nil }
        // {"error": "tmdb_key_not_set"} del panel o {"success": false} de TMDB
        if j["error"] != nil || (j["success"] as? Bool) == false { return nil }
        return j
    }

    static func image(_ path: String, _ size: String) -> String { path.isEmpty ? "" : "https://image.tmdb.org/t/p/\(size)\(path)" }

    /**
     * Foto de una persona por su nombre (respaldo cuando el servidor IPTV manda el elenco sin fotos).
     * Prefiere a quien actúa. "" = TMDB no la tiene o no respondió.
     */
    static func personPhoto(_ name: String) async -> String {
        let q = name.trimmed
        if q.count < 2 { return "" }
        let ck = q.folded
        if let c = lock.locked({ photoCache[ck] }) { return c }
        guard let res = await get("search/person?language=es-MX&include_adult=false&query=\(urlEnc(q))") else { return "" }
        let people = res.objs("results")
        let pick = people.first { $0.s("known_for_department") == "Acting" && !$0.s("profile_path").isEmpty }
            ?? people.first { !$0.s("profile_path").isEmpty }
        let url = image(pick?.s("profile_path") ?? "", profileSize)
        lock.locked { photoCache[ck] = url }
        return url
    }

    /**
     * id de TMDB de una persona por su nombre (prefiere a quien actúa).
     * 0 = TMDB no la conoce; nil = sin respuesta.
     */
    static func searchPersonId(_ name: String) async -> Int? {
        let q = name.trimmed
        if q.count < 2 { return 0 }
        guard let res = await get("search/person?language=es-MX&include_adult=false&query=\(urlEnc(q))") else { return nil }
        let people = res.objs("results").filter { $0.i("id") > 0 }
        return (people.first { $0.s("known_for_department") == "Acting" } ?? people.first)?.i("id") ?? 0
    }

    /**
     * persona con su filmografía completa (películas y series) en un solo pedido; nil = sin respuesta.
     * En es-MX como Android: los títulos se comparan con el catálogo del servidor, que está en español.
     */
    static func person(_ id: Int) async -> JObj? { await get("person/\(id)?language=es-MX&append_to_response=combined_credits") }

    /** biografía en inglés cuando no hay traducción */
    static func personBioEn(_ id: Int) async -> String { await get("person/\(id)?language=en-US")?.s("biography") ?? "" }

    /** fotos de varios nombres a la vez (hasta 15), nombre → dirección */
    static func personPhotos(_ names: [String]) async -> [String: String] {
        await withTaskGroup(of: (String, String).self) { g in
            for n in names.prefix(15) { g.addTask { (n, await personPhoto(n)) } }
            var out: [String: String] = [:]
            for await (n, u) in g where !u.isEmpty { out[n] = u }
            return out
        }
    }

    /**
     * Carátulas del fondo del inicio de sesión y del número de distribuidor: solo con la clave TMDB del
     * panel (la del distribuidor o la del dueño), pedidas por api/tmdb.php. Sin clave el panel responde
     * tmdb_key_not_set y no hay carrusel. Se pregunta cada vez (sin copia guardada): si el panel deja de
     * entregar la clave, no quedan carátulas viejas.
     */
    static func nowPlaying() async -> [String] {
        var out = [String]()
        for p in 1...3 {
            // ?path= (no tmdb.php/movie/now_playing): muchos hostings no pasan PATH_INFO
            let url = PanelUrl.api("tmdb.php") + "?path=movie/now_playing&language=\(lang)&page=\(p)" + Tenant.query()
            let r = await Net.get(url, timeout: 15)
            guard r.ok, let j = r.json(), j["error"] == nil else { break }
            for o in j.objs("results") {
                let pp = o.s("poster_path")
                if !pp.isEmpty { out.append("https://image.tmdb.org/t/p/w342\(pp)") }
            }
        }
        var seen = Set<String>()
        return Array(out.filter { seen.insert($0).inserted }.prefix(48))
    }

    // ---------- título para TMDB: la misma regla que el panel (includes/title_clean.php), Roku y Android ----------
    private static let tcTag = "^(4k|8k|uhd|fhd|hd|sd|hq|lat|latino|latam|sub|subs|subt|subtitulad[oa]|esp|es|en|eng|spa|mx|us|ar|co|cl|pe|br|pt|fr|de|it|uk|ve|ec|uy|py|bo|cr|pa|gt|hn|sv|do|pr|dual|multi|multi ?audio|dub|dublad[oa]|legendad[oa]|castellano|espa[nñ]ol|ingl[eé]s|vose|vos|vo|cam|ts|hdr|hdr10|dv|hevc|[xh]26[45]|web|web-?dl|webrip|bluray|brrip|dvdrip|hdtv|remux|imax|vip|new|nuevo|nueva|estreno|premiere|netflix|amazon|prime|prime video|disney|disney\\+|hbo|hbo max|max|apple|apple tv\\+?|paramount\\+?|star\\+|\\d{3,4}p|(19|20)\\d\\d|[st]\\d{1,2})$"
    private static let tcJunk = "(?<![\\p{L}\\p{N}])(4k|8k|uhd|fhd|hd|sd|hdr10|hdr|1080p|720p|2160p|480p|hevc|[xh]26[45]|10bit|web-?dl|webrip|bluray|brrip|dvdrip|hdtv|hdcam|remux|lat|latino|castellano|subtitulad[oa]|sub|esp|dual|multi|dublad[oa]|legendad[oa]|vose)(?![\\p{L}\\p{N}])"
    private static let tcSeason = "(?<![\\p{L}\\p{N}])s\\d{1,2}\\s*e\\d{1,3}(?![\\p{L}\\p{N}])|\\s+(s\\d{1,2}|t\\d{1,2}|(temporada|season|saison)\\s*\\d{1,2})\\s*$"

    /**
     * "ES - Avengers: Endgame (2019) [4K] | LAT" → ("Avengers: Endgame", "2019"): lo que TMDB entiende. Quita etiquetas de
     * idioma, país, calidad y plataforma («NETFLIX - …», «|LAT| …»), temporadas («S01», «T2»), estrellas y emojis; deja un
     * número que es el título («1917», «2012»). Casos en tools/title_clean_vectors.json del panel.
     */
    static func clean(_ raw: String) -> (String, String) {
        var s = raw.trimmed
        var year = Rx.groups(s, "[\\(\\[]\\s*((?:19|20)\\d\\d)\\s*[\\)\\]]")?[1] ?? ""
        if year.isEmpty, let r = Rx.get("(?<![\\p{L}\\p{N}])((?:19|20)\\d\\d)(?![\\p{L}\\p{N}])"),
           let m = r.matches(in: s, range: NSRange(s.startIndex..., in: s)).last, let rg = Range(m.range(at: 1), in: s) {
            year = String(s[rg])
        }
        // "The.Matrix.1999.1080p" (sin espacios): los puntos y guiones bajos separan palabras
        if !s.contains(" ") && (s.contains(".") || s.contains("_")) { s = Rx.replace(s, "[._]+", " ") }
        var t = Rx.replace(s, "\\([^)]*\\)|\\[[^\\]]*\\]|\\{[^}]*\\}", " ")
        t = Rx.replace(t, "[^\\p{L}\\p{M}\\p{N}\\s'’&:!?¿¡.,+#\\-–—|/]", " ")
        t = Rx.replace(t, "^\\s*\\|?\\s*[\\p{Lu}0-9+]{2,5}\\s*\\|\\s*", "")
        t = Rx.replace(t, "^\\s*\\p{Lu}{2,4}\\s*:\\s+", "")
        for sep in ["|", " - ", " – ", " — "] where t.contains(sep) {
            let keep = t.components(separatedBy: sep).map { $0.trimmed }.filter { !$0.isEmpty && !Rx.has($0, tcTag, ci: true) }
            if !keep.isEmpty { t = keep.joined(separator: sep == "|" ? " " : " - ") }
        }
        t = t.replacingOccurrences(of: "|", with: " ")
        t = Rx.replace(t, tcSeason, " ", ci: true)
        t = Rx.replace(t, tcJunk, " ", ci: true)
        if !year.isEmpty {
            let no = Rx.replace(t, "(?<![\\p{L}\\p{N}])\(year)(?![\\p{L}\\p{N}])", " ").trimmed
            if Rx.has(no, "[\\p{L}\\p{N}]") { t = no }
        }
        t = Rx.replace(Rx.replace(t, "\\s+", " "), "^[\\s\\-–—:·,./]+|[\\s\\-–—:·,/]+$", "")
        if t.isEmpty { t = Rx.replace(Rx.replace(raw, "\\([^)]*\\)|\\[[^\\]]*\\]", " "), "\\s+", " ").trimmed }
        return (t, year)
    }

    /** la primera parte de «Título - Subtítulo» (o "") */
    static func firstPart(_ q: String) -> String {
        let p = q.components(separatedBy: " - ")
        return p.count > 1 && p[0].trimmed.count >= 3 ? p[0].trimmed : ""
    }

    /** título para comparar con TMDB: minúsculas, sin acentos ni signos, «&» = «y», sin artículo al principio (como el panel) */
    private static func cmp(_ s: String) -> String {
        let n = Rx.replace(s.replacingOccurrences(of: "&", with: " y ").folded, "[^\\p{L}\\p{N}]+", " ").trimmed
        return Rx.replace(n, "^(the|el|la|los|las|le|les|o|os|as) ", "")
    }

    /** ¿el resultado es ese título? mismo nombre (traducido u original) y, si se sabe, el año ±1 */
    private static func same(_ r: JObj, _ q: String, _ y: String) -> Bool {
        let want = cmp(q)
        if want.isEmpty { return false }
        let hit = ["title", "original_title", "name", "original_name"].contains { f in
            let v = r.s(f)
            return !v.isEmpty && cmp(v) == want
        }
        if !hit { return false }
        if y.count != 4 { return true }
        let d = r.s("release_date").ifEmpty(r.s("first_air_date"))
        guard let ry = Int(d.prefix(4)), let yy = Int(y) else { return true }
        return abs(ry - yy) <= 1
    }

    /** "" = TMDB no lo tiene; nil = no hubo respuesta */
    static func findPoster(_ type: String, _ rawTitle: String, _ rawYear: String) async -> String? {
        let (title, y0) = clean(rawTitle)
        if title.count < 2 { return "" }
        var y = String(rawYear.filter { $0.isNumber }.prefix(4))
        if y.isEmpty { y = y0 }
        var tries: [(String, String, String)] = []
        if y.count == 4 { tries.append((type, title, y)) }
        tries.append((type, title, ""))
        for sep in [":", " - ", " – "] {
            if let r = title.range(of: sep) {
                let head = String(title[..<r.lowerBound]).trimmed
                if head.count >= 3 { tries.append((type, head, y)) }
            }
        }
        tries.append((type == "tv" ? "movie" : "tv", title, ""))
        var answered = false
        for (t, q, yr) in tries {
            let yp = yr.count == 4 ? (t == "tv" ? "&first_air_date_year=\(yr)" : "&year=\(yr)") : ""
            guard let res = await get("search/\(t)?language=es-MX&include_adult=false&query=\(urlEnc(q))\(yp)") else { continue }
            answered = true
            for o in res.objs("results") {
                let pp = o.s("poster_path")
                if !pp.isEmpty { return "https://image.tmdb.org/t/p/w342\(pp)" }
            }
        }
        return answered ? "" : nil
    }

    struct CastMember: Hashable { let name, character, profile: String; let id: Int }
    struct Details { let id: Int; let poster, backdrop, overview: String; let cast: [CastMember]; let trailer: String }

    static func details(type: String, title: String, year: String, tmdbId: String) async -> Details? {
        let (ct, cy) = clean(title)
        let cleanTitle = ct.isEmpty ? title.trimmed : ct
        let yr = year.isEmpty ? cy : year
        let ck = "\(lang)|\(type)|\(cleanTitle)|\(yr)|\(tmdbId)"
        if let d = lock.locked({ detailCache[ck] }) { return d }
        var id = tmdbId.filter { $0.isNumber }
        var fetchedType = type
        if id.isEmpty {
            // como Roku y el panel: con año, sin año, como el otro tipo (película / serie) y sin el subtítulo; primero un
            // resultado con el mismo título (y el año ±1). Si ninguno coincide, el primero de la búsqueda (como antes)
            let y = String(yr.filter { $0.isNumber }.prefix(4))
            let other = type == "tv" ? "movie" : "tv"
            var tries: [(String, String, String)] = []
            if y.count == 4 { tries.append((type, cleanTitle, y)) }
            tries.append((type, cleanTitle, ""))
            tries.append((other, cleanTitle, ""))
            if y.count == 4 {
                if let r = cleanTitle.range(of: ":") {
                    let head = String(cleanTitle[..<r.lowerBound]).trimmed
                    if head.count >= 3 { tries.append((type, head, "")) }
                }
                let fp = firstPart(cleanTitle)
                if !fp.isEmpty { tries.append((type, fp, y)) }
            }
            var firstAny = ""
            for (t, q, ty) in tries {
                let yp = ty.count == 4 ? (t == "tv" ? "&first_air_date_year=\(ty)" : "&primary_release_year=\(ty)") : ""
                guard let res = await get("search/\(t)?language=es-MX&query=\(urlEnc(q))\(yp)") else { continue }
                var hit = ""
                for r in res.objs("results") {
                    if firstAny.isEmpty && t == type { firstAny = r.s("id") }
                    if same(r, q, y) { hit = r.s("id"); break }
                }
                if !hit.isEmpty { id = hit; fetchedType = t; break }
            }
            if id.isEmpty { id = firstAny }
        }
        if id.isEmpty { return nil }
        guard let d = await get("\(fetchedType)/\(id)?language=\(lang)&append_to_response=credits,aggregate_credits,videos") else { return nil }
        let pp = d.s("poster_path"), bp = d.s("backdrop_path")
        let credits = d.o("credits") ?? d.o("aggregate_credits")
        let cast = (credits?.objs("cast") ?? []).prefix(15).map { c -> CastMember in
            let pr = c.s("profile_path")
            return CastMember(name: c.s("name"), character: c.s("character"), profile: image(pr, profileSize), id: c.i("id"))
        }
        let trailer = (d.o("videos")?.objs("results") ?? []).first { $0.s("site") == "YouTube" && $0.s("type") == "Trailer" }?.s("key") ?? ""
        let out = Details(id: Int(id) ?? 0, poster: image(pp, posterSize),
                          backdrop: image(bp, backdropSize), overview: d.s("overview"), cast: Array(cast), trailer: trailer)
        lock.locked { detailCache[ck] = out }
        return out
    }
}
