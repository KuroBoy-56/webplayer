import Foundation

struct TvChannel: Hashable { let name: String; let country: String }

struct SportEvent: Hashable, Identifiable {
    let id: String
    let sport, league, leagueBadge, title, home, away, homeBadge, awayBadge, homeScore, awayScore: String
    let start: Double // segundos
    let venue, status: String
    let postponed: Bool
    /** canales donde se transmite (panel: "tv"), los de la región primero */
    let tv: [TvChannel]
    /** liga del JSON de partidos (api/sports_fixtures.php "l"): Equipos y Selecciones */
    var leagueId: String = ""
}

struct SportInfo: Hashable { let label: String; let icon: String; let minutes: Int }

/** Reglas para encontrar el canal de cada partido ("match" de api/sports.php). */
struct MatchRules {
    var stop: Set<String>
    var alias: [String: String]
    var eventCategory: String
    var fullName = 2, token = 1, teamWeight = 10, bothTeamsBonus = 15, leagueBonus = 3, eventCategoryBonus = 6, singleTokenWeight = 8
}

struct SportsData {
    let events: [SportEvent]
    let sports: [String: SportInfo]
    let rules: MatchRules
    /** pestaña Tablas (api/sports.php "tables": on y versión del JSON del panel) */
    var tablesOn = false
    var tablesRev = 0
    /** pestañas Equipos y Selecciones (api/sports.php "fixtures": on, versión y si hay selecciones elegidas) */
    var fixturesOn = false
    var nationsOn = false
    var fixturesRev = 0
}

enum SpStatus { case soon, live, fin, postponed }

/** Agenda deportiva del panel y búsqueda del canal en vivo (misma puntuación que la web y Android). */
enum Sports {
    private static let defaultStop: Set<String> = ["fc", "cf", "sc", "ac", "cd", "ca", "club", "de", "del", "la", "el", "los", "las", "the", "and", "vs", "v",
        "city", "united", "real", "sporting", "atletico", "deportivo", "union", "women", "femenil", "w", "u20", "u21", "u23", "sub"]
    private static let defaultEventCat = "event|ppv|pay per view|deportes? en vivo|live sport|partidos? (de )?hoy"

    /** Zona horaria del panel (la del distribuidor o del dueño, "tz" de api/sports.php): la hora de los partidos y
     *  Hoy / Mañana van en esa zona, no en la del equipo. Un panel viejo sin "tz": la del equipo. */
    static var zone = TimeZone.current

    /** "HH:mm" en la zona del panel */
    static func time(_ t: Double) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = zone
        return f.string(from: Date(timeIntervalSince1970: t))
    }

    /** "sáb 2 nov · 20:00" en la zona del panel; hoy, solo la hora (Equipos / Selecciones: 21 días) */
    static func dayTime(_ t: Double, _ now: Double) -> String {
        var cal = Calendar.current
        cal.timeZone = zone
        if cal.isDate(Date(timeIntervalSince1970: t), inSameDayAs: Date(timeIntervalSince1970: now)) { return time(t) }
        let f = DateFormatter()
        f.locale = L10n.locale
        f.timeZone = zone
        f.setLocalizedDateFormatFromTemplate("EEEdMMM")
        return f.string(from: Date(timeIntervalSince1970: t)) + " · " + time(t)
    }

    static func load() async -> SportsData? {
        guard let r = await Cloud.shared.call({ t in await Net.get(PanelUrl.api("sports.php") + "?token=" + urlEnc(t)) }), let j = r.json() else { return nil }
        return parse(j)
    }

    static func parse(_ j: JObj) -> SportsData {
        // un nombre de zona que el iPhone no conoce: el desfase del panel ("tzo", segundos sobre UTC, como Vega) y solo si
        // tampoco viene, la del iPhone (uno mal configurado mostraba otra hora)
        zone = TimeZone(identifier: j.s("tz")) ?? (j["tzo"] != nil ? TimeZone(secondsFromGMT: j.i("tzo")) : nil) ?? .current
        let events = j.objs("events").compactMap(event).sorted { $0.start < $1.start }
        var sports: [String: SportInfo] = [:]
        if let so = j.o("sports") {
            for (k, v) in so { if let o = v as? JObj { sports[k] = SportInfo(label: o.s("label").ifEmpty(k), icon: o.s("icon"), minutes: o.i("minutes") > 0 ? o.i("minutes") : 120) } }
        }
        let m = j.o("match")
        let stopArr = (m?.a("stop") ?? []).compactMap { $0 as? String }
        var alias: [String: String] = [:]
        for (k, v) in m?.o("alias") ?? [:] { alias[norm(k)] = norm((v as? String) ?? "") }
        var ev = m?.s("eventCategory") ?? ""
        if ev.isEmpty || Rx.get(ev, true) == nil { ev = defaultEventCat }
        let sc = m?.o("scoring")
        func w(_ k: String, _ d: Int) -> Int { sc?[k] == nil ? d : sc!.i(k) }
        let rules = MatchRules(stop: stopArr.isEmpty ? defaultStop : Set(stopArr), alias: alias, eventCategory: ev,
                               fullName: w("fullName", 2), token: w("token", 1), teamWeight: w("teamWeight", 10), bothTeamsBonus: w("bothTeamsBonus", 15),
                               leagueBonus: w("leagueBonus", 3), eventCategoryBonus: w("eventCategoryBonus", 6), singleTokenWeight: w("singleTokenWeight", 8))
        let tb = j.o("tables"), fx = j.o("fixtures")
        return SportsData(events: events, sports: sports, rules: rules,
                          tablesOn: tb?.b("on") ?? false, tablesRev: tb?.i("t") ?? 0,
                          fixturesOn: fx?.b("on") ?? false, nationsOn: (fx?.b("on") ?? false) && (fx?.b("nat") ?? false), fixturesRev: fx?.i("t") ?? 0)
    }

    /** un partido de la agenda o del JSON de 21 días (mismos campos; "l" = liga de Equipos / Selecciones) */
    static func event(_ e: JObj) -> SportEvent? {
        let st = parseTs(e.s("ts"))
        if st <= 0 { return nil }
        let tv = e.objs("tv").compactMap { t -> TvChannel? in t.s("n").isEmpty ? nil : TvChannel(name: t.s("n"), country: t.s("c")) }
        return SportEvent(id: e.s("id"), sport: e.s("sp"), league: e.s("lg"), leagueBadge: e.s("lb"), title: e.s("ev"), home: e.s("h"), away: e.s("a"),
                          homeBadge: e.s("hb"), awayBadge: e.s("ab"), homeScore: e.s("hs"), awayScore: e.s("as"), start: st, venue: e.s("v"),
                          status: e.s("st"), postponed: e.b("pp"), tv: tv, leagueId: e.s("l"))
    }

    /** "2026-10-03T15:00:00Z" / "+00:00" / sin segundos / sin zona -> segundos (UTC si no trae zona) */
    static func parseTs(_ raw: String) -> Double {
        var t = raw.trimmed.replacingOccurrences(of: " ", with: "T")
        if t.isEmpty { return 0 }
        if t.hasSuffix("Z") || t.hasSuffix("z") { t = String(t.dropLast()) + "+0000" }
        else if Rx.has(t, "[+-]\\d\\d:\\d\\d$") { t = String(t.dropLast(3)) + String(t.suffix(2)) }
        else if !Rx.has(t, "[+-]\\d{4}$") { t += "+0000" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        for p in ["yyyy-MM-dd'T'HH:mm:ssZ", "yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mmZ"] {
            f.dateFormat = p
            if let d = f.date(from: t) { return d.timeIntervalSince1970 }
        }
        return 0
    }

    static func status(_ e: SportEvent, _ info: SportInfo?, _ now: Double) -> SpStatus {
        let dur = Double(info?.minutes ?? 120) * 60
        if e.postponed { return .postponed }
        if Rx.has(e.status.trimmed, "^(FT|AET|AOT|PEN|Match Finished|Finished|After Over Time|Final)$", ci: true) { return .fin }
        if now >= e.start && now < e.start + dur { return .live }
        if now >= e.start + dur { return .fin }
        return .soon
    }

    /* ---------- búsqueda del canal ---------- */

    /** Buscador de la agenda: equipos, evento, liga, deporte y canales que lo transmiten; sin acentos y con todas
     *  las palabras ("america espn"). */
    static func matches(_ e: SportEvent, _ sportLabel: String, _ q: String) -> Bool {
        let words = norm(q).split(separator: " ").map(String.init)
        if words.isEmpty { return true }
        let hay = norm("\(e.home) \(e.away) \(e.title) \(e.league) \(e.sport) \(sportLabel) " + e.tv.map { $0.name }.joined(separator: " "))
        return words.allSatisfy { hay.contains($0) }
    }

    /** minúsculas, sin acentos, todo lo que no sea [a-z0-9] -> espacio */
    static func norm(_ s: String) -> String { Rx.replace(s.folded, "[^a-z0-9]+", " ").trimmed }

    private static func hasWord(_ chan: String, _ w: String) -> Bool { !w.isEmpty && " \(chan) ".contains(" \(w) ") }

    private static func tokens(_ s: String, _ r: MatchRules) -> [String] {
        norm(s).split(separator: " ").map(String.init).filter { $0.count >= 3 && !r.stop.contains($0) }
    }

    /** un equipo ya normalizado (con su alias) y sus palabras distintivas: se arma una vez por partido, no por canal */
    private struct Team { let names: [String]; let toks: [[String]] }

    private static func team(_ name: String, _ r: MatchRules) -> Team? {
        if name.trimmed.isEmpty { return nil }
        let n = norm(name)
        let names = [n] + (r.alias[n].map { [$0] } ?? [])
        return Team(names: names, toks: names.map { a in tokens(a, r).filter { $0.count >= 4 } })
    }

    private static func teamScore(_ chan: String, _ t: Team?, _ r: MatchRules) -> Int {
        guard let t = t else { return 0 }
        var best = 0
        for (i, a) in t.names.enumerated() {
            if a.count >= 3 && hasWord(chan, a) { return r.fullName }
            if t.toks[i].contains(where: { hasWord(chan, $0) }) { best = r.token }
        }
        return best
    }

    /**
     * Índice de los canales (como Android, Vega y Roku): se arma una sola vez por catálogo y cada partido compara solo
     * los canales que comparten alguna palabra con sus equipos o con su canal de TV (no todos contra todos). Antes cada
     * toque normalizaba de nuevo todos los canales y los comparaba uno por uno: con catálogos grandes tardaba mucho.
     */
    final class Index {
        let chans: [Chan]
        private(set) var words: [String: [Int]] = [:]
        private(set) var keys: [String: [Int]] = [:]
        private var memo: [String: [Item]] = [:]
        private let lock = NSLock()

        init(_ chans: [Chan]) {
            self.chans = chans
            func add(_ m: inout [String: [Int]], _ k: String, _ i: Int) {
                if m[k]?.last != i { m[k, default: []].append(i) }
            }
            for (i, c) in chans.enumerated() {
                for w in c.norm.split(separator: " ") where w.count >= 3 { add(&words, String(w), i) }
                for w in c.key where w.count >= 2 && !w.isDigits { add(&words, w, i) }
                let compact = c.key.joined()
                if !compact.isEmpty { add(&keys, compact, i) }
            }
        }

        func remembered(_ k: String) -> [Item]? { lock.lock(); defer { lock.unlock() }; return memo[k] }
        func remember(_ k: String, _ v: [Item]) { lock.lock(); memo[k] = v; lock.unlock() }
    }

    private static var ixCache: (sig: String, ix: Index)?
    private static let ixLock = NSLock()

    /** el índice de esta lista de canales (el mismo mientras no cambien los canales, las carpetas ni las reglas) */
    static func index(_ channels: [Item], _ cats: [Category], _ r: MatchRules) -> Index {
        let sig = "\(channels.count)|\(channels.first?.id ?? 0)|\(channels.last?.id ?? 0)|\(cats.count)|\(r.eventCategory)"
        ixLock.lock()
        if let c = ixCache, c.sig == sig { ixLock.unlock(); return c.ix }
        ixLock.unlock()
        let ix = Index(prepare(channels, cats, r))
        ixLock.lock(); ixCache = (sig, ix); ixLock.unlock()
        return ix
    }

    /** Canal ya normalizado con su categoría, para no repetir el trabajo en cada partido. */
    struct Chan { let item: Item; let norm: String; let isEvent: Bool; let key: [String] }

    // lo que no distingue un canal de otro: calidad y país/región
    private static let noise: Set<String> = ["hd", "fhd", "uhd", "sd", "4k", "8k", "hq", "hevc", "h264", "h265", "1080", "1080p", "720", "720p", "50fps", "60fps", "fps",
        "backup", "bk", "alt", "vip", "op1", "op2", "tv", "channel", "canal",
        "mx", "mex", "mexico", "us", "usa", "eeuu", "ar", "arg", "argentina", "co", "col", "colombia", "cl", "chile", "pe", "peru", "ec", "ecuador",
        "ve", "venezuela", "uy", "uruguay", "py", "paraguay", "bo", "bolivia", "cr", "pa", "panama", "gt", "hn", "sv", "ni", "do", "pr",
        "latam", "latin", "latino", "latina", "lat", "america", "es", "esp", "spain", "espana", "uk", "gb", "int", "intl", "international",
        "br", "bra", "brasil", "brazil", "pt", "portugal", "ca", "can", "canada", "fr", "france", "it", "italy", "de", "germany",
        "nl", "netherlands", "au", "australia", "nz", "zealand", "new", "ie", "ireland"]

    /** palabras que identifican el canal; un número va pegado a la palabra anterior ("espn 2" -> "espn2") */
    static func channelKey(normalized: String) -> [String] {
        var out = [String]()
        for t in normalized.split(separator: " ").map(String.init) where !t.isEmpty && !noise.contains(t) {
            if t.isDigits, let last = out.last, !last.isDigits { out[out.count - 1] = last + t } else { out.append(t) }
        }
        return out
    }

    static func channelKey(_ name: String) -> [String] { channelKey(normalized: norm(name)) }

    static func prepare(_ channels: [Item], _ cats: [Category], _ r: MatchRules) -> [Chan] {
        let eventCats = Set(cats.filter { Rx.has($0.name.folded, r.eventCategory, ci: true) }.map { $0.id })
        return channels.map { it in
            let n = norm(it.name)
            return Chan(item: it, norm: n, isEvent: eventCats.contains(it.categoryId), key: channelKey(normalized: n))
        }
    }

    /**
     * Canales del cliente que son el canal que transmite: primero los que se llaman igual (sin calidad
     * ni país), después los que contienen todas sus palabras. "ESPN 2" nunca da "ESPN" ni "ESPN 3".
     */
    static func findByChannel(_ tvName: String, _ ix: Index) -> [Item] {
        if let hit = ix.remembered(tvName) { return hit }
        let out = findByChannelOnce(tvName, ix)
        ix.remember(tvName, out)
        return out
    }

    private static func findByChannelOnce(_ tvName: String, _ ix: Index) -> [Item] {
        let q = channelKey(tvName)
        let qc = q.joined()
        if q.isEmpty || qc.count < 2 { return [] }
        let qs = Set(q)
        // solo los canales que tienen la primera palabra (o el nombre pegado) del canal buscado
        let cand = Set((ix.keys[qc] ?? []) + (ix.words[q[0]] ?? [])).sorted()
        var scored = [(Int, Chan)]()
        for c in cand.map({ ix.chans[$0] }) where !c.key.isEmpty {
            let score: Int
            if c.key == q { score = 1000 - c.key.count }
            else if c.key.joined() == qc { score = 900 - c.key.count }
            else if qs.isSubset(of: Set(c.key)) { score = 500 - 10 * (c.key.count - q.count) }
            else { continue }
            scored.append((score, c))
        }
        return scored.sorted { $0.0 != $1.0 ? $0.0 > $1.0 : $0.1.item.name.count < $1.1.item.name.count }.map { $0.1.item }
    }

    /** El canal del partido: el primero de sus canales de TV que tiene el cliente; si no, por equipos o nombre del evento. */
    static func best(_ ev: SportEvent, _ ix: Index, _ r: MatchRules) -> Item? {
        for t in ev.tv { if let f = findByChannel(t.name, ix).first { return f } }
        return find(ev, ix, r)
    }

    static func find(_ ev: SportEvent, _ ix: Index, _ r: MatchRules) -> Item? {
        let h = ev.home.trimmed, a = ev.away.trimmed
        let leagueToks = tokens(ev.league, r)
        let single = h.isEmpty && a.isEmpty ? tokens(ev.title, r) : []
        let ht = team(h, r), at = team(a, r)
        // canales candidatos: los que tienen alguna palabra de los equipos (o del evento), como Vega
        var want = Set(single)
        for t in [ht, at].compactMap({ $0 }) {
            for n in t.names {
                let tk = tokens(n, r)
                if tk.isEmpty { n.split(separator: " ").filter { $0.count >= 3 }.forEach { want.insert(String($0)) } } else { tk.forEach { want.insert($0) } }
            }
        }
        var cand = Set<Int>()
        for w in want { ix.words[w]?.forEach { cand.insert($0) } }
        var best: Chan?
        var bestScore = Int.min
        for c in cand.sorted().map({ ix.chans[$0] }) {
            let chan = c.norm
            var score: Int
            if !h.isEmpty || !a.isEmpty {
                let hs = teamScore(chan, ht, r), aw = teamScore(chan, at, r)
                if hs == 0 && aw == 0 { continue }
                let both = hs > 0 && aw > 0
                // fuera de las carpetas de eventos solo cuenta si aparecen los dos equipos
                if !c.isEvent && !both { continue }
                // "Real Madrid vs Barcelona" no sirve para "Real Madrid vs Getafe"
                if !both && Rx.has(" \(chan) ", " (vs|v|x) ") { continue }
                score = hs * r.teamWeight + aw * r.teamWeight + (both ? r.bothTeamsBonus : 0)
            } else {
                let hit = single.filter { $0.count >= 3 && hasWord(chan, $0) }.count
                if hit == 0 || (!c.isEvent && hit < 2) { continue }
                score = hit * r.singleTokenWeight
            }
            if leagueToks.contains(where: { hasWord(chan, $0) }) { score += r.leagueBonus }
            if c.isEvent { score += r.eventCategoryBonus }
            if best == nil || score > bestScore { best = c; bestScore = score }
        }
        return best?.item
    }
}
