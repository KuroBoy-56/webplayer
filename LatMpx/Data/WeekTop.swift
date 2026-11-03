import Foundation

/**
 * Top 10 de la semana, igual que Roku, Vega, Android y las TV: el panel (api/top10.php) manda lo más popular de la
 * semana en TMDB; aquí se cruza con el catálogo por título y año (±1) y lo que falte se completa con lo mejor
 * calificado, distinto cada semana (también sin clave de TMDB). Se guarda por distribuidor y se pide otra vez cada
 * 12 h; `rev` cambia cuando llega una lista nueva (Inicio, Películas y Series rehacen su fila).
 */
final class WeekTop: ObservableObject {
    static let shared = WeekTop()

    struct Entry: Equatable { let series: Bool?; let t: String; let o: String; let y: Int }

    @Published private(set) var rev = 0
    private var movies: [Entry] = [], series: [Entry] = [], all: [Entry] = []
    private var at: TimeInterval = 0
    private var loadedKey = ""
    private var asking = false
    /** resultado ya calculado (las vistas se redibujan seguido: el cruce con miles de títulos se hace una vez) */
    private var memo: [String: [Item]] = [:]
    private static let age: TimeInterval = 12 * 3600

    private var key: String { "week_top" + (Tenant.code.isEmpty ? "" : "_" + Tenant.code) }

    /** lo guardado para este distribuidor (al abrir la app la fila sale al instante) */
    private func restore() {
        if loadedKey == key { return }
        loadedKey = key
        movies = []; series = []; all = []; at = 0; memo = [:]
        let d = UserDefaults.standard
        if let raw = d.string(forKey: key), let j = Json.obj(raw) { parse(j) }
        at = d.double(forKey: key + "_at")
    }

    private func list(_ a: [Any]?) -> [Entry] {
        (a ?? []).prefix(80).compactMap { $0 as? JObj }.compactMap { o in
            let k = o.s("k")
            let e = Entry(series: k == "s" ? true : k == "m" ? false : nil, t: o.s("t"), o: o.s("o"), y: o.i("y"))
            return e.t.isEmpty && e.o.isEmpty ? nil : e
        }
    }

    private func parse(_ j: JObj) {
        movies = list(j.a("movies")); series = list(j.a("series")); all = list(j.a("all"))
    }

    /** pide la lista si la guardada tiene más de 12 h (no hace nada si es reciente) */
    @MainActor func load() async {
        restore()
        if asking || Date().timeIntervalSince1970 - at < Self.age { return }
        asking = true
        defer { asking = false }
        let url = PanelUrl.api("top10.php") + "?lang=\(L10n.current)" + Tenant.query()
        let r = await Net.get(url, timeout: 20)
        guard r.ok, let j = r.json(), j["movies"] != nil else { return }
        let before = (movies, series, all)
        parse(j)
        memo = [:]
        at = Date().timeIntervalSince1970
        let d = UserDefaults.standard
        d.set(r.text, forKey: key)
        d.set(at, forKey: key + "_at")
        if before != (movies, series, all) { rev += 1 }
    }

    // ---------- títulos comparables (como Roku / Android: sin "| LAT", (2019), [4K], acentos, signos ni etiquetas) ----------

    private static let tags: Set<String> = ["4k", "uhd", "fhd", "hd", "sd", "lat", "latino", "sub", "subt", "esp", "castellano", "dual",
        "spa", "eng", "1080p", "720p", "2160p", "hdr", "cam", "ts", "multi", "vose", "subtitulado", "hevc", "x264", "x265"]

    static func titleKey(_ name: String) -> String {
        var t = name.trimmed
        if let r = t.range(of: #"^[A-Z]{2,3}\s*[-|:]\s+"#, options: .regularExpression) { t.removeSubrange(r) }
        for sep in ["|", " - ", " – "] {
            if let r = t.range(of: sep), r.lowerBound > t.startIndex { t = String(t[..<r.lowerBound]) }
        }
        t = t.replacingOccurrences(of: #"\([^)]*\)|\[[^\]]*\]|\{[^}]*\}"#, with: " ", options: .regularExpression)
        t = t.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).lowercased()
        let words = t.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { w in
            !w.isEmpty && w.allSatisfy({ $0.isASCII }) && !tags.contains(w)
                && !(w.count == 4 && (w.hasPrefix("19") || w.hasPrefix("20")) && w.allSatisfy { $0.isNumber })
        }
        return words.joined(separator: " ")
    }

    private static func year(_ it: Item) -> Int {
        if let y = Int(it.year.prefix(4)), y > 1900 { return y }
        if let r = it.name.range(of: #"[(\[]((19|20)[0-9]{2})[)\]]"#, options: .regularExpression) {
            return Int(it.name[r].filter { $0.isNumber }) ?? 0
        }
        return 0
    }

    private func matches(_ list: [Entry], _ items: [Item], _ n: Int) -> [Item] {
        if list.isEmpty || items.isEmpty { return [] }
        var idx: [String: [Item]] = [:]
        for it in items {
            let k = Self.titleKey(it.name)
            if !k.isEmpty { idx[k, default: []].append(it) }
        }
        var out: [Item] = []
        for e in list {
            for name in [e.t, e.o] where !name.isEmpty {
                let hit = idx[Self.titleKey(name)]?.first { c in
                    let cy = Self.year(c)
                    return !out.contains(c) && (e.y == 0 || cy == 0 || abs(e.y - cy) <= 1)
                }
                if let h = hit { out.append(h); break }
            }
            if out.count >= n { break }
        }
        return out
    }

    /** número de semana (año * 100 + semana ISO): el relleno cambia cada semana */
    private static func week() -> Int {
        var c = Calendar(identifier: .iso8601)
        c.timeZone = TimeZone.current
        let d = c.dateComponents([.yearForWeekOfYear, .weekOfYear], from: Date())
        return (d.yearForWeekOfYear ?? 0) * 100 + (d.weekOfYear ?? 0)
    }

    /** orden al azar fijo por semana (el mismo toda la semana, otro la siguiente) */
    private static func shuffled<T>(_ a: [T], _ salt: Int) -> [T] {
        var s = UInt32(truncatingIfNeeded: week() &* 2654435761 &+ salt)
        var out = a
        if out.count < 2 { return out }
        for i in stride(from: out.count - 1, to: 0, by: -1) {
            s = s &* 1664525 &+ 1013904223
            let j = Int(Double(s) / 4294967296.0 * Double(i + 1))
            out.swapAt(i, j)
        }
        return out
    }

    /** relleno: de los 40 mejor calificados, unos distintos cada semana (ordenados por calificación) */
    private func fill(_ items: [Item], skip: [Item], _ n: Int, salt: Int) -> [Item] {
        if n <= 0 { return [] }
        let pool = Array(items.sorted { $0.rating > $1.rating }.filter { !skip.contains($0) }.prefix(40))
        let pick = Set(Self.shuffled(pool, salt).prefix(n))
        return pool.filter { pick.contains($0) }
    }

    /** Top 10 de Películas o de Series: lo de la semana que está en el catálogo y el relleno de la semana. */
    func top10(_ items: [Item], series isSeries: Bool) -> [Item] {
        restore()
        let mk = "\(isSeries ? "s" : "m")|\(items.count)|\(items.first?.id ?? 0)|\(items.last?.id ?? 0)"
        if let hit = memo[mk] { return hit }
        if memo.count > 20 { memo = [:] }
        let got = matches(isSeries ? series : movies, items, 10)
        let out = got + fill(items, skip: got, 10 - got.count, salt: isSeries ? 2 : 1)
        memo[mk] = out
        return out
    }

    /** Top 10 de Inicio: películas y series juntas, alternadas en el orden de la semana. */
    func top10Home(movies m: [Item], series s: [Item]) -> [Item] {
        restore()
        let mk = "h|\(m.count)|\(m.first?.id ?? 0)|\(s.count)|\(s.first?.id ?? 0)"
        if let hit = memo[mk] { return hit }
        if memo.count > 20 { memo = [:] }
        let mv = matches(all.filter { $0.series != true }, m, 10)
        let sv = matches(all.filter { $0.series == true }, s, 10)
        var out: [Item] = []
        var a = 0, b = 0
        while out.count < 10 && (a < mv.count || b < sv.count) {
            if a < mv.count { out.append(mv[a]); a += 1 }
            if out.count < 10 && b < sv.count { out.append(sv[b]); b += 1 }
        }
        let need = 10 - out.count
        if need > 0 {
            let f = fill(m, skip: mv, need, salt: 3) + fill(s, skip: sv, need, salt: 4)
            out += Self.shuffled(f, 5).prefix(need)
        }
        memo[mk] = out
        return out
    }
}
