import Foundation

/**
 * Página de actor, igual que Android y la app de Windows: la persona de TMDB (foto y biografía) y su
 * filmografía (combined_credits) cruzada con el catálogo del servidor por título normalizado y año (±1);
 * solo se muestran los títulos que el servidor tiene. Sin TMDB (o como complemento) se usa el elenco que
 * manda el servidor en la lista.
 */
enum Actor {
    struct Person { let id: Int; let name, photo, bio, birthday, place: String }

    /** person = nil: TMDB no respondió o no conoce a la persona */
    struct Page { let person: Person?; let items: [Item] }

    private static var memo: [String: Page] = [:]
    private static let lock = NSLock()

    static func load(name: String, tmdbId: Int, movies: [Item], series: [Item]) async -> Page {
        let memoKey = "\(tmdbId)|\(name.folded)|\(movies.count)|\(series.count)"
        if let p = lock.locked({ memo[memoKey] }) { return p }

        var id = tmdbId
        if id <= 0 { id = await Tmdb.searchPersonId(name) ?? 0 }
        var json: JObj?
        if id > 0 { json = await Tmdb.person(id) }
        var person: Person?
        var credits: [Credit] = []
        if let j = json {
            var bio = j.s("biography").trimmed
            if bio.isEmpty { bio = await Tmdb.personBioEn(id).trimmed }
            let pp = j.s("profile_path")
            person = Person(id: id, name: j.s("name").trimmed.ifEmpty(name), photo: Tmdb.image(pp, "w342"), bio: bio,
                            birthday: j.s("birthday").trimmed, place: j.s("place_of_birth").trimmed)
            credits = parseCredits(j)
        }

        var out: [Item] = []
        var seen = Set<String>()
        if !credits.isEmpty {
            let mi = Index(movies), si = Index(series)
            for c in credits {
                for it in (c.tv ? si : mi).match(c) where seen.insert(it.key).inserted { out.append(it) }
            }
        }
        // respaldo (y complemento): títulos cuyo elenco del servidor incluye el nombre
        let needle = (person?.name ?? name).folded.trimmed
        if needle.count >= 3 {
            for it in movies + series where !it.cast.isEmpty && it.cast.folded.contains(needle) && seen.insert(it.key).inserted {
                out.append(it)
            }
        }
        let page = Page(person: person, items: out)
        // solo se recuerda cuando TMDB respondió (si no, se vuelve a intentar la próxima vez)
        if json != nil { lock.locked { memo[memoKey] = page } }
        return page
    }

    /* ---------- filmografía ---------- */

    struct Credit { let tv: Bool; let titles: [String]; let year: Int? }

    static func parseCredits(_ j: JObj) -> [Credit] {
        var out: [Credit] = []
        var seen = Set<String>()
        for o in j.o("combined_credits")?.objs("cast") ?? [] {
            let type = o.s("media_type")
            guard type == "movie" || type == "tv", seen.insert("\(type):\(o.i("id"))").inserted else { continue }
            let tv = type == "tv"
            var titles: [String] = []
            for t in [o.s(tv ? "name" : "title").trimmed, o.s(tv ? "original_name" : "original_title").trimmed] where !t.isEmpty && !titles.contains(t) {
                titles.append(t)
            }
            if titles.isEmpty { continue }
            let date = o.s(tv ? "first_air_date" : "release_date")
            out.append(Credit(tv: tv, titles: titles, year: (Rx.groups(date, "\\b(19\\d{2}|20\\d{2})\\b")?[1]).flatMap { Int($0) }))
        }
        // primero lo más reciente (sin fecha al final)
        return out.enumerated().sorted { ($0.element.year ?? -1, -$0.offset) > ($1.element.year ?? -1, -$1.offset) }.map(\.element)
    }

    /* ---------- títulos normalizados (mismo criterio que Android y title-normalization.util.ts de Windows) ---------- */

    /** exact: con el año final; base: sin él; year: el año quitado (o el que venía entre paréntesis) */
    struct Keys: Equatable { let exact, base: String; let year: Int? }

    private static let quality: Set<String> = [
        "4k", "uhd", "fhd", "hd", "sd", "hdr", "hevc", "h264", "h265", "x264", "x265", "480p", "720p", "1080p", "2160p",
        "multi", "multisub", "dual", "latino", "lat", "castellano", "subtitulado", "subtitulada", "sub", "esp", "vose", "cam",
    ]

    static func keys(_ raw: String) -> Keys {
        if raw.trimmed.isEmpty { return Keys(exact: "", base: "", year: nil) }
        let bracketYear = (Rx.groups(raw, "[\\(\\[]\\s*(19\\d{2}|20\\d{2})\\s*[\\)\\]]")?[1]).flatMap { Int($0) }
        var t = Rx.replace(raw, "\\[[^\\]\\[]*\\]|\\([^()]*\\)|\\{[^{}]*\\}", " ").trimmed
        t = Rx.replace(t, "^[A-Z]{2,4}\\s*[-|:]\\s+", "").folded
        t = Rx.replace(t, "[^\\p{L}\\p{N}]+", " ")
        let cleaned = t.split(separator: " ").map(String.init).filter { !quality.contains($0) }.joined(separator: " ").trimmed
        func stripSeason(_ v: String) -> String {
            Rx.replace(v, "(?:^|\\s)(?:s\\d{1,2}|season\\s*\\d{1,2}|temporada\\s*\\d{1,2}|t\\d{1,2})$", "").trimmed.ifEmpty(v)
        }
        let exact = stripSeason(cleaned)
        guard let ym = Rx.groups(cleaned, "(?:^|\\s)(19\\d{2}|20\\d{2})$") else { return Keys(exact: exact, base: exact, year: bracketYear) }
        let without = Rx.replace(Rx.replace(cleaned, "(?:^|\\s)(19\\d{2}|20\\d{2})$", ""), "\\s+", " ").trimmed
        if without.isEmpty { return Keys(exact: exact, base: exact, year: bracketYear) }
        return Keys(exact: exact, base: stripSeason(without), year: Int(ym[1]) ?? bracketYear)
    }

    private static func yearsOk(_ a: Int?, _ b: Int?) -> Bool { a == nil || b == nil || abs(a! - b!) <= 1 }

    /** catálogo indexado por título normalizado (exacto y sin año final) */
    final class Index {
        private var exact: [String: [(Item, Int?)]] = [:]
        private var base: [String: [(Item, Int?)]] = [:]

        init(_ items: [Item]) {
            for it in items {
                let k = Actor.keys(it.name)
                if k.exact.count < 2 { continue }
                let y = Int(it.year.prefix(4)).flatMap { (1900...2100).contains($0) ? $0 : nil } ?? k.year
                exact[k.exact, default: []].append((it, y))
                base[k.base, default: []].append((it, y))
            }
        }

        func match(_ c: Credit) -> [Item] {
            for t in c.titles {
                let k = Actor.keys(t)
                if k.exact.count < 2 { continue }
                let e = (exact[k.exact] ?? []).filter { Actor.yearsOk(c.year, $0.1) }
                if !e.isEmpty { return e.map(\.0) }
            }
            for t in c.titles {
                let k = Actor.keys(t)
                if k.base.count < 2 { continue }
                let b = (base[k.base] ?? []).filter { Actor.yearsOk(c.year, $0.1) }
                if !b.isEmpty { return b.map(\.0) }
            }
            return []
        }
    }
}
