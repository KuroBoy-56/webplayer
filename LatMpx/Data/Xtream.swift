import Foundation

/** Cliente del API de Xtream Codes (player_api.php), igual que Android y la web. */
enum Xtream {
    private static func api(_ s: Session, _ action: String = "", _ extra: String = "") -> String {
        "\(s.base)/player_api.php?username=\(urlEnc(s.user))&password=\(urlEnc(s.pass))" + (action.isEmpty ? "" : "&action=\(action)") + extra
    }

    enum LoginResult { case ok(Session), fail(String) }

    private static func date(_ raw: String) -> String? {
        guard let t = Double(raw), t > 0 else { return nil }
        let f = DateFormatter()
        f.dateFormat = "dd/MM/yyyy"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date(timeIntervalSince1970: t))
    }

    /** Prueba el usuario en cada DNS (en orden) y se queda con el primero que lo acepta. */
    static func login(_ dns: [(String, String)], user: String, pass: String) async -> LoginResult {
        var last = "No se pudo conectar con el servidor"
        for (name, raw) in dns {
            // el panel (https) cambia http:// por https:// en las direcciones de los servidores IPTV; muchos
            // solo responden en http (p. ej. el puerto 8080). Si no contesta, se prueba el otro protocolo.
            var probe = Session(dnsName: name, base: normalize(raw), user: user, pass: pass, expires: "")
            var r = await Net.get(api(probe))
            var found = r.json()
            logLogin(probe.base, r, found)
            if found == nil {
                var alt = probe
                alt.base = otherScheme(probe.base)
                let r2 = await Net.get(api(alt))
                let f2 = r2.json()
                logLogin(alt.base, r2, f2)
                if f2 != nil || (r.code == 0 && r2.code > 0) { probe = alt; r = r2; found = f2 }
            }
            guard let j = found else {
                // el servidor respondió pero no con la cuenta (línea bloqueada, vencida o servidor caído)
                if r.code > 0 && last == "No se pudo conectar con el servidor" { last = "El servidor no aceptó la conexión (código \(r.code))" }
                continue
            }
            guard let ui = j.o("user_info"), ui.i("auth") == 1 else { last = "Usuario o contraseña incorrectos"; continue }
            let st = ui.s("status")
            if !st.isEmpty && st.lowercased() != "active" { last = st.lowercased() == "expired" ? "Tu cuenta está vencida" : "Tu cuenta está \(st)"; continue }
            if let e = Double(ui.s("exp_date")), e > 0, e < Date().timeIntervalSince1970 { last = "Tu cuenta está vencida"; continue }
            var s = probe
            s.expires = date(ui.s("exp_date")) ?? "Ilimitado"
            s.createdAt = date(ui.s("created_at")) ?? ui.s("created_at").ifEmpty("Desconocido")
            s.activeCons = ui.s("active_cons").ifEmpty("0")
            s.maxCons = ui.s("max_connections").ifEmpty("0")
            return .ok(s)
        }
        return .fail(last)
    }

    /** registro del inicio de sesión (consola de Xcode, «[LatMpx] login»): servidor y código, nunca usuario ni contraseña */
    private static func logLogin(_ base: String, _ r: Resp, _ j: JObj?) {
        let host = base.components(separatedBy: "://").last ?? base
        let ui = j?.o("user_info")
        print("[LatMpx] login \(host) -> http \(r.code)" + (ui.map { " auth=\($0.s("auth")) status=\($0.s("status"))" } ?? " sin JSON"))
    }

    /** http://… <-> https://… */
    static func otherScheme(_ base: String) -> String {
        if base.lowercased().hasPrefix("https://") { return "http://" + base.dropFirst(8) }
        if let r = base.range(of: "://") { return "https://" + base[r.upperBound...] }
        return "https://" + base
    }

    static func normalize(_ u: String) -> String {
        var x = u.trimmed
        while x.hasSuffix("/") { x.removeLast() }
        let l = x.lowercased()
        if !l.hasPrefix("http://") && !l.hasPrefix("https://") { x = "http://" + x }
        return x
    }

    /* ---------- catálogo (memoria → equipo → servidor) ---------- */
    private static let lock = NSLock()
    private static var mem: [String: Any] = [:]

    private static func getMem<T>(_ k: String) -> T? { lock.locked { mem[k] as? T } }
    private static func setMem(_ k: String, _ v: Any) { lock.locked { mem[k] = v } }
    static func clearCache() { lock.lock(); mem.removeAll(); lock.unlock() }

    static func cached(_ s: Session, _ kind: Kind) -> ([Category], [Item])? {
        guard let c = CatalogCache.load(s, kind) else { return nil }
        setMem("all|\(kind.rawValue)", c.1)
        if !c.0.isEmpty { setMem("cat|\(kind.rawValue)", c.0) }
        return c
    }

    static func categories(_ s: Session, _ kind: Kind) async -> [Category] {
        if let c: [Category] = getMem("cat|\(kind.rawValue)") { return c }
        let c = await fetchCategories(s, kind)
        if !c.isEmpty { setMem("cat|\(kind.rawValue)", c) }
        return c
    }

    static func items(_ s: Session, _ kind: Kind) async -> [Item] {
        if let c: [Item] = getMem("all|\(kind.rawValue)") { return c }
        if let c = cached(s, kind) { return c.1 }
        let i = await fetchItems(s, kind)
        if !i.isEmpty {
            setMem("all|\(kind.rawValue)", i)
            CatalogCache.save(s, kind, getMem("cat|\(kind.rawValue)") ?? [], i)
        }
        return i
    }

    /** Vuelve a pedir el catálogo; si el servidor no responde se conserva lo anterior (nil). */
    static func refresh(_ s: Session, _ kind: Kind) async -> ([Category], [Item])? {
        async let c = fetchCategories(s, kind)
        async let i = fetchItems(s, kind)
        let (cats, items) = await (c, i)
        if items.isEmpty { return nil }
        setMem("all|\(kind.rawValue)", items)
        if !cats.isEmpty { setMem("cat|\(kind.rawValue)", cats) }
        let known: [Category] = getMem("cat|\(kind.rawValue)") ?? []
        CatalogCache.save(s, kind, known, items)
        return (known, items)
    }

    private static func fetchCategories(_ s: Session, _ kind: Kind) async -> [Category] {
        let action = kind == .movie ? "get_vod_categories" : kind == .series ? "get_series_categories" : "get_live_categories"
        return (await Net.arr(api(s, action)) ?? []).compactMap { $0 as? JObj }.map { Category(id: $0.s("category_id"), name: $0.s("category_name"), kind: kind) }
    }

    private static func fetchItems(_ s: Session, _ kind: Kind) async -> [Item] {
        let action = kind == .movie ? "get_vod_streams" : kind == .series ? "get_series" : "get_live_streams"
        let arr = await Net.arr(api(s, action)) ?? []
        var seen = Set<Int>()
        var out = [Item]()
        out.reserveCapacity(arr.count)
        for case let o as JObj in arr {
            if let it = parseItem(o, kind), seen.insert(it.id).inserted { out.append(it) }
        }
        return out
    }

    private static func parseItem(_ o: JObj, _ kind: Kind) -> Item? {
        let id = kind == .series ? o.i("series_id") : o.i("stream_id")
        if id <= 0 { return nil }
        let poster = Posters.clean(kind == .series ? o.s("cover") : o.s("stream_icon"))
        var year = o.s("year")
        if year.isEmpty { year = String(o.s("releaseDate").prefix(4)) }
        if year.isEmpty { year = String(o.s("release_date").prefix(4)) }
        let r = o.d("rating")
        let bd = (o.a("backdrop_path")?.first as? String) ?? ""
        return Item(
            id: id, name: o.s("name"), poster: poster, kind: kind, categoryId: o.s("category_id"),
            ext: o.s("container_extension"), rating: r > 10 ? r / 10 : r, year: year,
            added: Int64(kind == .series ? o.s("last_modified") : o.s("added")) ?? 0,
            plot: o.s("plot"), epgId: o.s("epg_channel_id"), backdrop: Posters.clean(bd),
            cast: kind == .live ? "" : o.s("cast").ifEmpty(o.s("actors"))
        )
    }

    /* ---------- detalles ---------- */
    private static var details: [String: Details] = [:]

    static func movieDetails(_ s: Session, _ item: Item) async -> Details {
        if let d = lock.locked({ details["vod|\(item.id)"] }) { return d }
        let j = await Net.obj(api(s, "get_vod_info", "&vod_id=\(item.id)"))
        let info = j?.o("info")
        let md = j?.o("movie_data")
        var it = item
        if let e = md?.s("container_extension"), !e.isEmpty { it.ext = e }
        if it.poster.isEmpty { it.poster = Posters.clean(info?.s("movie_image") ?? "") }
        let bd = Posters.clean((info?.a("backdrop_path")?.first as? String) ?? "")
        let d = Details(
            item: it, plot: info.map { $0.s("plot").ifEmpty($0.s("description")) } ?? item.plot,
            cast: info.map { $0.s("cast").ifEmpty($0.s("actors")) } ?? "", director: info?.s("director") ?? "",
            genre: info?.s("genre") ?? "", duration: info?.s("duration") ?? "", backdrop: bd.ifEmpty(item.backdrop),
            trailer: info?.s("youtube_trailer") ?? "", tmdbId: info?.s("tmdb_id") ?? "")
        if j != nil { lock.locked { details["vod|\(item.id)"] = d } }
        return d
    }

    static func seriesDetails(_ s: Session, _ item: Item) async -> Details {
        if let d = lock.locked({ details["ser|\(item.id)"] }) { return d }
        let j = await Net.obj(api(s, "get_series_info", "&series_id=\(item.id)"))
        let info = j?.o("info")
        var seasons: [Int: [Episode]] = [:]
        func ep(_ e: JObj, _ fallbackSeason: Int) -> Episode {
            let ei = e.o("info")
            return Episode(id: e.i("id"), num: e.i("episode_num"), season: e.i("season") > 0 ? e.i("season") : fallbackSeason,
                           title: e.s("title"), ext: e.s("container_extension").ifEmpty("mp4"), plot: ei?.s("plot") ?? "",
                           image: Posters.clean(ei?.s("movie_image") ?? ""), duration: ei?.s("duration") ?? "")
        }
        if let eps = j?["episodes"] as? JObj {
            for (k, v) in eps {
                let list = ((v as? [Any]) ?? []).compactMap { $0 as? JObj }.map { ep($0, Int(k) ?? 1) }.sorted { $0.num < $1.num }
                if let f = list.first { seasons[Int(k) ?? f.season] = list }
            }
        } else if let eps = j?["episodes"] as? [Any] {
            for (n, v) in eps.enumerated() {
                let list = ((v as? [Any]) ?? []).compactMap { $0 as? JObj }.map { ep($0, n + 1) }.sorted { $0.num < $1.num }
                if let f = list.first { seasons[f.season > 0 ? f.season : n + 1] = list }
            }
        }
        let bd = Posters.clean((info?.a("backdrop_path")?.first as? String) ?? "")
        let d = Details(
            item: item, plot: info?.s("plot").ifEmpty(item.plot) ?? item.plot, cast: info?.s("cast") ?? "",
            director: info?.s("director") ?? "", genre: info?.s("genre") ?? "", duration: info?.s("episode_run_time") ?? "",
            backdrop: bd.ifEmpty(item.backdrop), trailer: info?.s("youtube_trailer") ?? "", tmdbId: info?.s("tmdb_id") ?? "",
            seasons: seasons.keys.sorted().map { ($0, seasons[$0]!) })
        if j != nil { lock.locked { details["ser|\(item.id)"] = d } }
        return d
    }

    /* ---------- guía ---------- */
    static func shortEpg(_ s: Session, _ streamId: Int, limit: Int = 6) async -> [EpgEntry] {
        guard let j = await Net.obj(api(s, "get_short_epg", "&stream_id=\(streamId)&limit=\(limit)")) else { return [] }
        let now = Date().timeIntervalSince1970
        return listings(j).filter { $0.end > now }
    }

    private static func listings(_ j: JObj) -> [EpgEntry] {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        var seen = Set<Double>()
        return j.objs("epg_listings").compactMap { e -> EpgEntry? in
            guard let st = Double(e.s("start_timestamp")) ?? f.date(from: e.s("start"))?.timeIntervalSince1970 else { return nil }
            let en = Double(e.s("stop_timestamp")) ?? f.date(from: e.s("end"))?.timeIntervalSince1970 ?? st
            return en > st ? EpgEntry(title: b64(e.s("title")), desc: b64(e.s("description")), start: st, end: en) : nil
        }.sorted { $0.start < $1.start }.filter { seen.insert($0.start).inserted }
    }

    private static func b64(_ x: String) -> String {
        if x.isEmpty { return "" }
        guard let d = Data(base64Encoded: x.filter { !$0.isWhitespace }, options: [.ignoreUnknownCharacters]),
              let t = String(data: d, encoding: .utf8), !t.unicodeScalars.contains(where: { $0.value < 9 }) else { return x }
        return t
    }

    /* ---------- direcciones de reproducción ---------- */
    static func movieUrl(_ s: Session, _ id: Int, _ ext: String) -> String { "\(s.base)/movie/\(urlEnc(s.user))/\(urlEnc(s.pass))/\(id).\(ext.ifEmpty("mp4"))" }
    static func episodeUrl(_ s: Session, _ id: Int, _ ext: String) -> String { "\(s.base)/series/\(urlEnc(s.user))/\(urlEnc(s.pass))/\(id).\(ext.ifEmpty("mp4"))" }

    /** canales: primero HLS (m3u8) y si el servidor no lo ofrece, MPEG-TS (o al revés según el ajuste) */
    static func liveUrls(_ s: Session, _ id: Int) -> [String] {
        let b = "\(s.base)/live/\(urlEnc(s.user))/\(urlEnc(s.pass))/\(id)"
        return Store.streamFormat == "ts" ? ["\(b).ts", "\(b).m3u8", b] : ["\(b).m3u8", "\(b).ts", b]
    }
}
