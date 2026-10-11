import Foundation

/** TMDB con la llave que configura el panel (nunca una llave escrita en la app). */
enum Tmdb {
    private static var nowPlayingCache: [String]?
    private static var keyBad = false
    private static let lock = NSLock()
    private static var detailCache: [String: Details] = [:]

    private static func get(_ path: String) async -> JObj? {
        let k = Store.tmdbKey
        if k.isEmpty || keyBad { return nil }
        let sep = path.contains("?") ? "&" : "?"
        let r = await Net.get("https://api.themoviedb.org/3/\(path)\(sep)api_key=\(urlEnc(k))", timeout: 15)
        if r.code == 401 { keyBad = true; return nil }
        return r.ok ? r.json() : nil
    }

    static func nowPlaying() async -> [String] {
        if let c = nowPlayingCache { return c }
        var out = [String]()
        for p in 1...3 {
            guard let j = await get("movie/now_playing?language=es-MX&page=\(p)") else { break }
            for o in j.objs("results") {
                let pp = o.s("poster_path")
                if !pp.isEmpty { out.append("https://image.tmdb.org/t/p/w342\(pp)") }
            }
        }
        var seen = Set<String>()
        let list = Array(out.filter { seen.insert($0).inserted }.prefix(48))
        if !list.isEmpty { nowPlayingCache = list }
        return list
    }

    /** "ES - Avengers: Endgame (2019) [4K] LAT" → ("Avengers: Endgame", "2019") */
    static func clean(_ raw: String) -> (String, String) {
        var t = raw.trimmed
        let year = Rx.groups(t, "[\\(\\[]((19|20)\\d{2})[\\)\\]]")?[1] ?? Rx.groups(t, "\\b((19|20)\\d{2})\\s*$")?[1] ?? ""
        t = Rx.replace(t, "^\\s*[A-Z]{2,4}\\s*[-|:]\\s+", "")
        t = Rx.replace(t, "[\\(\\[][^\\)\\]]*[\\)\\]]", " ")
        t = Rx.replace(t, "\\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|hdr|dual|latino|lat|castellano|subtitulad[oa]|sub|esp|eng|vose|cam|ts|hevc|x265|x264)\\b", " ", ci: true)
        if !year.isEmpty { t = Rx.replace(t, "\\b\(year)\\s*$", " ") }
        t = Rx.replace(Rx.replace(Rx.replace(t, "[_.]+", " "), "\\s*[-|]\\s*$", ""), "\\s+", " ").trimmed
        return (t, year)
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
        let ck = "\(type)|\(cleanTitle)|\(yr)|\(tmdbId)"
        if let d = lock.locked({ detailCache[ck] }) { return d }
        var id = tmdbId.filter { $0.isNumber }
        if id.isEmpty {
            let q = urlEnc(cleanTitle)
            let y = String(yr.filter { $0.isNumber }.prefix(4))
            var res: JObj?
            if !y.isEmpty { res = await get("search/\(type)?language=es-MX&query=\(q)" + (type == "tv" ? "&first_air_date_year=\(y)" : "&primary_release_year=\(y)")) }
            if res == nil || res!.objs("results").isEmpty { res = await get("search/\(type)?language=es-MX&query=\(q)") }
            if let f = res?.objs("results").first { id = f.s("id") }
        }
        if id.isEmpty { return nil }
        guard let d = await get("\(type)/\(id)?language=es-MX&append_to_response=credits,aggregate_credits,videos") else { return nil }
        let pp = d.s("poster_path"), bp = d.s("backdrop_path")
        let credits = d.o("credits") ?? d.o("aggregate_credits")
        let cast = (credits?.objs("cast") ?? []).prefix(15).map { c -> CastMember in
            let pr = c.s("profile_path")
            return CastMember(name: c.s("name"), character: c.s("character"), profile: pr.isEmpty ? "" : "https://image.tmdb.org/t/p/w185\(pr)", id: c.i("id"))
        }
        let trailer = (d.o("videos")?.objs("results") ?? []).first { $0.s("site") == "YouTube" && $0.s("type") == "Trailer" }?.s("key") ?? ""
        let out = Details(id: Int(id) ?? 0, poster: pp.isEmpty ? "" : "https://image.tmdb.org/t/p/w500\(pp)",
                          backdrop: bp.isEmpty ? "" : "https://image.tmdb.org/t/p/w1280\(bp)", overview: d.s("overview"), cast: Array(cast), trailer: trailer)
        lock.locked { detailCache[ck] = out }
        return out
    }
}
