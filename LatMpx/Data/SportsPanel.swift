import Foundation

/** fila de una tabla de posiciones (api/sports_tables.php) */
struct StandingRow: Hashable {
    let id: String, rank: Int, team: String, badge: String, played: Int, won: Int, drawn: Int, lost: Int
    let gf: Int, ga: Int, gd: Int, pts: Int, form: String, zone: String
}

struct StandingGroup: Hashable { let name: String; let rows: [StandingRow] }

/** liga o copa: region = rg, division = d (1.ª…), women = liga femenina */
struct League: Hashable, Identifiable {
    let id: String, name: String, country: String, badge: String, sportLabel: String, division: Int
    let region: String, season: String, women: Bool, groups: [StandingGroup]
}

struct FxLeague: Hashable { let name: String, badge: String, country: String, region: String, women: Bool }

/** partidos de los próximos 21 días para Equipos y Selecciones */
struct Fixtures { let events: [SportEvent]; let leagues: [String: FxLeague] }

/** ficha del equipo (api/sports_team.php, en el idioma de la app) */
struct TeamInfo {
    let name: String, badge: String, founded: String, place: String, stadium: String, capacity: Int, league: String
    let honours: [(String, Int)]
    let desc: String
}

/**
 * Deportes con el panel (igual que Roku, Vega y Android): Tablas (api/sports_tables.php), los partidos de Equipos /
 * Selecciones (api/sports_fixtures.php, 21 días) y la ficha del equipo (api/sports_team.php). Todo sale de los JSON que
 * prepara el panel (la app nunca consulta TheSportsDB) y se guarda en el equipo: las tablas 7 días, los partidos 12 h o
 * hasta que el panel anuncie otra versión. Si el panel todavía está armando ("p": 1) se devuelve lo que hay y se vuelve
 * a preguntar.
 */
enum SportsPanel {
    private static let d = UserDefaults(suiteName: "sports_panel") ?? .standard

    /** borrado de caché pedido por el panel */
    static func clear() { d.removePersistentDomain(forName: "sports_panel") }

    private static func scope() -> String { Tenant.code + "|" + (Store.session().map { "\($0.user)@\($0.base)" } ?? "") }
    private static func now() -> Int { Int(Date().timeIntervalSince1970) }

    private static func saved(_ key: String) -> JObj? {
        guard let raw = d.string(forKey: key) else { return nil }
        return Json.parse(Data(raw.utf8)) as? JObj
    }

    private static func save(_ key: String, _ o: JObj) {
        if let data = try? JSONSerialization.data(withJSONObject: o) { d.set(String(decoding: data, as: UTF8.self), forKey: key) }
    }

    private static func post(_ file: String, _ extra: String = "") async -> JObj? {
        await Cloud.shared.call({ t in await Net.get(PanelUrl.api(file) + "?token=" + urlEnc(t) + extra) })?.json()
    }

    /* ---------- tablas ---------- */

    struct TablesResult { let on: Bool; let ok: Bool; let leagues: [League]; var partial = false; var fresh = false }

    /** lo guardado (hasta 7 días); fresh = es la versión que anuncia el panel (y de menos de un día) */
    static func localTables(_ rev: Int) -> TablesResult? {
        guard let j = saved("tables|" + scope()) else { return nil }
        let age = now() - j.i("saved")
        if age < 0 || age > 7 * 86400 { return nil }
        let leagues = leaguesOf(j.objs("leagues"))
        if leagues.isEmpty { return nil }
        return TablesResult(on: true, ok: true, leagues: leagues, fresh: age < 86400 && rev > 0 && j.i("mt") == rev)
    }

    static func fetchTables() async -> TablesResult {
        guard let j = await post("sports_tables.php") else { return localTables(0) ?? TablesResult(on: true, ok: false, leagues: []) }
        if j["on"] != nil && !j.b("on", true) {
            d.removeObject(forKey: "tables|" + scope())
            return TablesResult(on: false, ok: true, leagues: [])
        }
        let partial = j.i("p") == 1
        let leagues = leaguesOf(j.objs("leagues"))
        if !leagues.isEmpty {
            // a medio armar sirve de respaldo, pero la próxima vez se vuelve a pedir
            save("tables|" + scope(), ["leagues": j["leagues"] ?? [], "mt": partial ? 0 : j.i("mt"), "saved": now()])
            return TablesResult(on: true, ok: true, leagues: leagues, partial: partial)
        }
        if var l = localTables(0) { l.partial = partial; return l }
        return TablesResult(on: true, ok: partial, leagues: [], partial: partial)
    }

    private static func leaguesOf(_ a: [JObj]) -> [League] {
        a.compactMap { l in
            let groups = l.objs("g").map { g in
                StandingGroup(name: g.s("n"), rows: g.objs("r").map { r in
                    StandingRow(id: r.s("id"), rank: r.i("r"), team: r.s("t"), badge: r.s("b"), played: r.i("p"), won: r.i("w"), drawn: r.i("d"),
                                lost: r.i("l"), gf: r.i("gf"), ga: r.i("ga"), gd: r.i("gd"), pts: r.i("pts"), form: r.s("f"), zone: r.s("z"))
                })
            }
            if l.s("id").isEmpty || groups.isEmpty { return nil }
            return League(id: l.s("id"), name: l.s("n"), country: l.s("c"), badge: l.s("b"), sportLabel: l.s("sl"), division: max(1, l.i("d")),
                          region: l.s("rg"), season: l.s("s"), women: l.i("w") == 1, groups: groups)
        }
    }

    /* ---------- ficha del equipo ---------- */

    /** ficha del equipo en el idioma de la app (el panel la guarda 30 días); nil si no hay */
    static func team(_ id: String) async -> TeamInfo? {
        guard let j = await post("sports_team.php", "&id=" + urlEnc(id) + "&lang=" + L10n.current), j.b("ok") else { return nil }
        let place = [j.s("loc"), j.s("c")].filter { !$0.isEmpty }.joined(separator: ", ")
        return TeamInfo(name: j.s("n"), badge: j.s("b"), founded: j.s("y"), place: place, stadium: j.s("st"), capacity: j.i("cap"), league: j.s("lg"),
                        honours: j.objs("hon").map { ($0.s("t"), $0.i("n")) }, desc: j.s("d"))
    }

    /* ---------- partidos de Equipos y Selecciones ---------- */

    struct FixturesResult { let on: Bool; let ok: Bool; let fx: Fixtures?; var partial = false }

    private static func fxKey() -> String { "fixtures|" + scope() + "|" + L10n.current }

    private static func parseFx(_ j: JObj) -> Fixtures {
        var lg = [String: FxLeague]()
        for (k, v) in j.o("leagues") ?? [:] {
            if let x = v as? JObj { lg[k] = FxLeague(name: x.s("n"), badge: x.s("b"), country: x.s("c"), region: x.s("rg"), women: x.i("w") == 1) }
        }
        return Fixtures(events: j.objs("events").compactMap(Sports.event).sorted { $0.start < $1.start }, leagues: lg)
    }

    /** el JSON de 21 días: el guardado (misma versión y menos de 12 h) o el del panel */
    static func fixtures(_ rev: Int) async -> FixturesResult {
        let old = saved(fxKey())
        if let s = old, rev > 0, s.i("mt") == rev, now() - s.i("saved") < 43200 { return FixturesResult(on: true, ok: true, fx: parseFx(s)) }
        if let j = await post("sports_fixtures.php") {
            if j["on"] != nil && !j.b("on", true) {
                d.removeObject(forKey: fxKey())
                return FixturesResult(on: false, ok: true, fx: nil)
            }
            let partial = j.i("p") == 1
            if !j.objs("events").isEmpty {
                save(fxKey(), ["events": j["events"] ?? [], "leagues": j["leagues"] ?? [:], "mt": partial ? 0 : j.i("t"), "saved": now()])
                return FixturesResult(on: true, ok: true, fx: parseFx(j), partial: partial)
            }
            if partial && old == nil { return FixturesResult(on: true, ok: true, fx: nil, partial: true) }
        }
        if let s = old { return FixturesResult(on: true, ok: true, fx: parseFx(s)) }
        return FixturesResult(on: true, ok: false, fx: nil)
    }

    private static func ended(_ e: SportEvent, _ minutes: (String) -> Int, _ t: Double) -> Bool { t >= e.start + Double(minutes(e.sport) * 60) }

    /** nombre comparable con el alias del panel (también en español: «Alemania» = «Germany») */
    private static func teamText(_ name: String, _ alias: [String: String]) -> String {
        let n = Sports.norm(name)
        if n.isEmpty { return "" }
        if let a = alias[n], a != n { return "\(n) \(a)" }
        return n
    }

    /**
     * Por equipo (cada palabra en el local o en el visitante, también en español) o por país (el país completo: la
     * selección y los partidos de las ligas de ese país). Solo los que no terminaron, hasta 80.
     */
    static func searchTeam(_ fx: Fixtures, _ q: String, _ alias: [String: String], _ minutes: (String) -> Int) -> [SportEvent] {
        let qn = Sports.norm(q)
        let words = qn.split(separator: " ").map(String.init)
        if words.isEmpty { return [] }
        let countryLg = Set(fx.leagues.filter { (_, l) in
            let c = teamText(l.country, alias)
            return !c.isEmpty && " \(c) ".contains(" \(qn) ")
        }.keys)
        let t = Date().timeIntervalSince1970
        var out = [SportEvent]()
        for e in fx.events {
            let teams = e.home.isEmpty && e.away.isEmpty ? [Sports.norm(e.title)] : [teamText(e.home, alias), teamText(e.away, alias)]
            let ok = countryLg.contains(e.leagueId) || teams.contains { tm in !tm.isEmpty && words.allSatisfy { tm.contains($0) } }
            if ok && !ended(e, minutes, t) { out.append(e); if out.count >= 80 { break } }
        }
        return out
    }

    /**
     * Selecciones (ligas "nat") por empezar o en vivo, en vivo primero; chips = competiciones masculinas y al final
     * «Selección femenina» (comp "w": todas las femeninas juntas)
     */
    static func nations(_ fx: Fixtures, _ comp: String, _ minutes: (String) -> Int) -> (events: [SportEvent], chips: [(String, String)], women: Bool) {
        let t = Date().timeIntervalSince1970
        var live = [SportEvent](), next = [SportEvent](), chips = [(String, String)]()
        var have = Set<String>()
        var women = false
        for e in fx.events {
            guard let info = fx.leagues[e.leagueId], info.region == "nat", !ended(e, minutes, t) else { continue }
            if info.women { women = true } else if have.insert(e.leagueId).inserted { chips.append((e.leagueId, info.name)) }
            if comp.isEmpty || comp == e.leagueId || (comp == "w" && info.women) {
                if e.start <= t { live.append(e) } else if next.count < 150 { next.append(e) }
            }
        }
        return (live + next, chips, women)
    }

    /* ---------- equipos buscados ---------- */

    static func recentTeams() -> [String] { (d.stringArray(forKey: "team_recent") ?? []).filter { !$0.trimmed.isEmpty } }

    static func rememberTeam(_ q: String) -> [String] {
        let out = Array(([q] + recentTeams().filter { $0.lowercased() != q.lowercased() }).prefix(5))
        d.set(out, forKey: "team_recent")
        return out
    }
}
