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
}

struct SportInfo: Hashable { let label: String; let icon: String; let minutes: Int }

/** Reglas para encontrar el canal de cada partido ("match" de api/sports.php). */
struct MatchRules {
    var stop: Set<String>
    var alias: [String: String]
    var eventCategory: String
    var fullName = 2, token = 1, teamWeight = 10, bothTeamsBonus = 15, leagueBonus = 3, eventCategoryBonus = 6, singleTokenWeight = 8
}

struct SportsData { let events: [SportEvent]; let sports: [String: SportInfo]; let rules: MatchRules }

enum SpStatus { case soon, live, fin, postponed }

/** Agenda deportiva del panel y búsqueda del canal en vivo (misma puntuación que la web y Android). */
enum Sports {
    private static let defaultStop: Set<String> = ["fc", "cf", "sc", "ac", "cd", "ca", "club", "de", "del", "la", "el", "los", "las", "the", "and", "vs", "v",
        "city", "united", "real", "sporting", "atletico", "deportivo", "union", "women", "femenil", "w", "u20", "u21", "u23", "sub"]
    private static let defaultEventCat = "event|ppv|pay per view|deportes? en vivo|live sport|partidos? (de )?hoy"

    static func load() async -> SportsData? {
        guard let r = await Cloud.shared.call({ t in await Net.get(PanelUrl.api("sports.php") + "?token=" + urlEnc(t)) }), let j = r.json() else { return nil }
        return parse(j)
    }

    static func parse(_ j: JObj) -> SportsData {
        let events = j.objs("events").compactMap { e -> SportEvent? in
            let st = parseTs(e.s("ts"))
            if st <= 0 { return nil }
            let tv = e.objs("tv").compactMap { t -> TvChannel? in t.s("n").isEmpty ? nil : TvChannel(name: t.s("n"), country: t.s("c")) }
            return SportEvent(id: e.s("id"), sport: e.s("sp"), league: e.s("lg"), leagueBadge: e.s("lb"), title: e.s("ev"), home: e.s("h"), away: e.s("a"),
                              homeBadge: e.s("hb"), awayBadge: e.s("ab"), homeScore: e.s("hs"), awayScore: e.s("as"), start: st, venue: e.s("v"),
                              status: e.s("st"), postponed: e.b("pp"), tv: tv)
        }.sorted { $0.start < $1.start }
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
        return SportsData(events: events, sports: sports, rules: rules)
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

    /** minúsculas, sin acentos, todo lo que no sea [a-z0-9] -> espacio */
    static func norm(_ s: String) -> String { Rx.replace(s.folded, "[^a-z0-9]+", " ").trimmed }

    private static func hasWord(_ chan: String, _ w: String) -> Bool { !w.isEmpty && " \(chan) ".contains(" \(w) ") }

    private static func tokens(_ s: String, _ r: MatchRules) -> [String] {
        norm(s).split(separator: " ").map(String.init).filter { $0.count >= 3 && !r.stop.contains($0) }
    }

    private static func teamScore(_ chan: String, _ team: String, _ r: MatchRules) -> Int {
        if team.trimmed.isEmpty { return 0 }
        let n = norm(team)
        var best = 0
        for a in [n] + (r.alias[n].map { [$0] } ?? []) {
            if a.count >= 3 && hasWord(chan, a) { return r.fullName }
            if tokens(a, r).contains(where: { $0.count >= 4 && hasWord(chan, $0) }) { best = r.token }
        }
        return best
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
    static func findByChannel(_ tvName: String, _ chans: [Chan]) -> [Item] {
        let q = channelKey(tvName)
        let qc = q.joined()
        if q.isEmpty || qc.count < 2 { return [] }
        let qs = Set(q)
        var scored = [(Int, Chan)]()
        for c in chans where !c.key.isEmpty {
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
    static func best(_ ev: SportEvent, _ chans: [Chan], _ r: MatchRules) -> Item? {
        for t in ev.tv { if let f = findByChannel(t.name, chans).first { return f } }
        return find(ev, chans, r)
    }

    static func find(_ ev: SportEvent, _ chans: [Chan], _ r: MatchRules) -> Item? {
        let h = ev.home.trimmed, a = ev.away.trimmed
        let leagueToks = tokens(ev.league, r)
        let single = h.isEmpty && a.isEmpty ? tokens(ev.title, r) : []
        var best: Chan?
        var bestScore = Int.min
        for c in chans {
            let chan = c.norm
            var score: Int
            if !h.isEmpty || !a.isEmpty {
                let hs = teamScore(chan, h, r), aw = teamScore(chan, a, r)
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
