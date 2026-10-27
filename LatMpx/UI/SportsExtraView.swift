import SwiftUI

/** Pestañas de Deportes (como Roku, Vega y Android): la agenda y, si el panel las ofrece, Tablas, Selecciones y Equipos */
enum SpTab: String { case agenda, tables, nations, teams }

struct SportsTabs: View {
    let data: SportsData
    @Binding var tab: SpTab

    private var tabs: [(SpTab, String)] {
        var t: [(SpTab, String)] = [(.agenda, tr("Agenda"))]
        if data.tablesOn { t.append((.tables, tr("Tablas"))) }
        if data.nationsOn { t.append((.nations, tr("Selecciones"))) }
        if data.fixturesOn { t.append((.teams, tr("Equipos"))) }
        return t
    }

    var body: some View {
        if tabs.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) { ForEach(tabs, id: \.0) { t in Chip(text: t.1, selected: tab == t.0) { tab = t.0 } } }
            }
        }
    }
}

/* ---------- Tablas ---------- */

private let regionKeys = ["intl", "nat", "eu", "am", "world"]
private let womenDivision = 10

/** América junta Latinoamérica, Norteamérica y Suramérica (paneles anteriores las mandaban aparte) */
private func regionOf(_ l: League) -> String {
    switch l.region {
    case "latam", "na", "sa", "us", "am": return "am"
    case "intl", "nat", "eu": return l.region
    default: return "world"
    }
}

private func divisionOf(_ l: League) -> Int { l.women ? womenDivision : max(1, l.division) }

private func regionLabel(_ k: String) -> String {
    switch k {
    case "": return tr("Todas")
    case "intl": return tr("Copas")
    case "nat": return tr("Selecciones")
    case "eu": return tr("Europa")
    case "am": return tr("América")
    default: return tr("Resto del mundo")
    }
}

func tinyBadge(_ u: String) -> String { u.contains("thesportsdb.com/") && !u.hasSuffix("/tiny") ? u + "/tiny" : u }

private let zoneColor: [String: Color] = ["p": Color(hex: 0x2EB85C), "s": Color(hex: 0x2F80ED), "o": Color(hex: 0xF2994A), "r": Color(hex: 0xE53935)]
private let formColor: [Character: Color] = ["W": Color(hex: 0x2EB85C), "D": Color(hex: 0x808080), "L": Color(hex: 0xE53935)]

/** posiciones de las ligas del panel: región, división, liga y la tabla; tocar un equipo abre su ficha */
struct SportsTablesView: View {
    let data: SportsData
    /** iPad / horizontal: todas las columnas y la racha; teléfono: PJ, DG y PTS */
    let wide: Bool
    @State private var leagues: [League]?
    @State private var loading = true
    @State private var partial = false
    @State private var failed = false
    @State private var region = ""
    @State private var division = 1
    @State private var pick = ""
    @State private var card: StandingRow?

    var body: some View {
        Group {
            if let all = leagues, !all.isEmpty { content(all) }
            else if loading || partial { LoadingView(text: partial ? tr("Preparando las tablas… aparecen en unos segundos.") : tr("Cargando las tablas…")) }
            else { EmptyMessage(text: failed ? tr("No se pudieron cargar las tablas. Inténtalo más tarde.") : tr("No hay tablas para mostrar.")) }
        }
        .task(id: data.tablesRev) {
            if leagues == nil { leagues = SportsPanel.localTables(data.tablesRev)?.leagues }
            if SportsPanel.localTables(data.tablesRev)?.fresh == true { loading = false; return }
            // si el panel todavía está armando se ve lo que hay y se vuelve a preguntar cada 20 s
            for _ in 0..<12 {
                let r = await SportsPanel.fetchTables()
                if Task.isCancelled { return }
                if !r.leagues.isEmpty { leagues = r.leagues }
                partial = r.partial; failed = !r.ok; loading = false
                if !r.partial { break }
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
        .sheet(item: Binding(get: { card.map { TeamPick(row: $0) } }, set: { if $0 == nil { card = nil } })) { p in
            TeamCardSheet(row: p.row)
        }
    }

    private func content(_ all: [League]) -> some View {
        let regions = regionKeys.filter { k in all.contains { regionOf($0) == k } }
        let regionChips = regions.count > 1 ? [""] + regions : [""]
        let divisions = (1...womenDivision).filter { dv in all.contains { divisionOf($0) == dv } }
        let div = divisions.count < 2 ? 0 : (divisions.contains(division) ? division : divisions[0])
        let list = all.filter { (region.isEmpty || regionOf($0) == region) && (div == 0 || divisionOf($0) == div) }
        let league = list.first { $0.id == pick } ?? list.first
        return VStack(alignment: .leading, spacing: 8) {
            if regionChips.count > 1 {
                chips(regionChips.map { ($0, regionLabel($0)) }, region) { region = $0; pick = "" }
            }
            if divisions.count > 1 {
                chips(divisions.map { (String($0), $0 == womenDivision ? tr("Liga femenina") : tr("%d.ª División", $0)) }, String(div)) {
                    division = Int($0) ?? 1; pick = ""
                }
            }
            chips(list.map { ($0.id, $0.name) }, league?.id ?? "") { pick = $0 }
            if let lg = league { table(lg) } else { EmptyMessage(text: tr("No hay tablas para mostrar.")) }
        }
    }

    private func chips(_ items: [(String, String)], _ on: String, _ tap: @escaping (String) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { ForEach(items, id: \.0) { k in Chip(text: k.1, selected: on == k.0) { tap(k.0) } } }
        }
    }

    private var cols: [String] { wide ? ["PJ", "G", "E", "P", "GF", "GC", "DG", "PTS"] : ["PJ", "DG", "PTS"] }

    private func nums(_ r: StandingRow) -> [Int] { wide ? [r.played, r.won, r.drawn, r.lost, r.gf, r.ga, r.gd, r.pts] : [r.played, r.gd, r.pts] }

    private func table(_ lg: League) -> some View {
        let used = Set(lg.groups.flatMap { $0.rows.map { $0.zone } })
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                if !lg.badge.isEmpty { RemoteImage(url: tinyBadge(lg.badge), mode: .fit, maxPixel: 90).frame(width: 30, height: 30) }
                Text(lg.name + (lg.season.isEmpty ? "" : " · " + lg.season)).font(.system(size: 18, weight: .bold)).foregroundColor(.white).lineLimit(2)
            }.padding(.top, 6).padding(.bottom, 4)
            ForEach(Array(lg.groups.enumerated()), id: \.offset) { _, g in
                if lg.groups.count > 1 || !g.name.isEmpty {
                    Text(g.name).font(.system(size: 14, weight: .bold)).foregroundColor(Theme.muted).padding(.top, 10)
                }
                header
                ForEach(g.rows, id: \.self) { r in line(r) }
            }
            // en un teléfono en vertical las zonas no entran en una línea: una debajo de otra
            VStack(alignment: .leading, spacing: 6) {
                ForEach(["p", "s", "o", "r"].filter { used.contains($0) }, id: \.self) { z in
                    HStack(spacing: 6) {
                        Circle().fill(zoneColor[z] ?? .gray).frame(width: 10, height: 10)
                        Text(zoneName(z)).font(.system(size: 12)).foregroundColor(Theme.muted)
                    }
                }
            }.padding(.top, 12)
        }
    }

    private func zoneName(_ z: String) -> String {
        switch z {
        case "p": return tr("Clasificación")
        case "s": return tr("Otra copa o ascenso")
        case "o": return tr("Repechaje")
        default: return tr("Descenso")
        }
    }

    private var header: some View {
        HStack(spacing: 0) {
            Text("#").frame(width: 32, alignment: .leading)
            Spacer()
            ForEach(cols, id: \.self) { c in Text(tr(c)).frame(width: 32) }
            if wide { Spacer().frame(width: 84) }
        }
        .font(.system(size: 12)).foregroundColor(Theme.muted).padding(.horizontal, 8).padding(.vertical, 4)
    }

    private func line(_ r: StandingRow) -> some View {
        Button { if !r.id.isEmpty { card = r } } label: {
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2).fill(zoneColor[r.zone] ?? .clear).frame(width: 4, height: 22)
                Text("\(r.rank)").font(.system(size: 13)).foregroundColor(.white).frame(width: 26)
                if !r.badge.isEmpty { RemoteImage(url: tinyBadge(r.badge), mode: .fit, maxPixel: 70).frame(width: 22, height: 22) }
                Text(r.team).font(.system(size: 14)).foregroundColor(.white).lineLimit(1).padding(.leading, 8)
                Spacer(minLength: 4)
                ForEach(Array(nums(r).enumerated()), id: \.offset) { i, n in
                    Text("\(n)").font(.system(size: 13, weight: i == nums(r).count - 1 ? .bold : .regular)).foregroundColor(.white).frame(width: 32)
                }
                if wide {
                    HStack(spacing: 3) { ForEach(Array(r.form.enumerated()), id: \.offset) { _, c in Circle().fill(formColor[c] ?? .gray).frame(width: 12, height: 12) } }
                        .frame(width: 84, alignment: .leading).padding(.leading, 6)
                }
            }
            .padding(.vertical, 6).padding(.horizontal, 8)
            .background(Color.white.opacity(0.06)).clipShape(RoundedRectangle(cornerRadius: 6))
        }.buttonStyle(.plain)
    }
}

private struct TeamPick: Identifiable { let row: StandingRow; var id: String { row.id } }

/** ficha del equipo (api/sports_team.php): fundación, estadio, liga, títulos y descripción; «Más detalles» = todo */
private struct TeamCardSheet: View {
    let row: StandingRow
    @Environment(\.dismiss) private var dismiss
    @State private var info: TeamInfo?
    @State private var done = false
    @State private var full = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        let b = (info?.badge).flatMap { $0.isEmpty ? nil : $0 } ?? row.badge
                        if !b.isEmpty { RemoteImage(url: tinyBadge(b), mode: .fit, maxPixel: 120).frame(width: 48, height: 48) }
                        Text((info?.name).flatMap { $0.isEmpty ? nil : $0 } ?? row.team).font(.system(size: 22, weight: .bold)).foregroundColor(.white).lineLimit(2)
                    }.padding(.bottom, 6)
                    if let t = info {
                        if !t.founded.isEmpty { Text(tr("Fundado en %@", t.founded) + (t.place.isEmpty ? "" : " · " + t.place)) }
                        else if !t.place.isEmpty { Text(t.place) }
                        if !t.stadium.isEmpty { Text(tr("Estadio: %@", t.stadium) + (t.capacity > 0 ? " (\(t.capacity))" : "")) }
                        if !t.league.isEmpty { Text(tr("Liga: %@", t.league)) }
                        let total = t.honours.reduce(0) { $0 + $1.1 }
                        if total > 0 {
                            if full {
                                Text(tr("Títulos (%d):", total)).fontWeight(.bold).padding(.top, 6)
                                ForEach(Array(t.honours.enumerated()), id: \.offset) { _, h in Text("  • \(h.0) ×\(h.1)").foregroundColor(Theme.muted) }
                            } else {
                                Text(tr("Títulos (%d): %@", total, t.honours.prefix(5).map { "\($0.0) ×\($0.1)" }.joined(separator: " · "))).foregroundColor(Theme.muted).padding(.top, 6)
                            }
                        }
                        if !t.desc.isEmpty { Text(t.desc).foregroundColor(Theme.muted).lineLimit(full ? nil : 6).padding(.top, 6) }
                    } else {
                        Text(done ? tr("No hay información de este equipo") : tr("Cargando…")).foregroundColor(Theme.muted)
                    }
                }
                .font(.system(size: 14)).foregroundColor(.white)
                .frame(maxWidth: .infinity, alignment: .leading).padding(20)
            }
            .background(Color(hex: 0x1F1F1F).ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if info != nil && !full { Button(tr("Más detalles")) { full = true } }
                }
                ToolbarItem(placement: .confirmationAction) { Button(tr("Entendido")) { dismiss() } }
            }
        }
        .task { info = await SportsPanel.team(row.id); done = true }
    }
}

/* ---------- Equipos y Selecciones ---------- */

private var lastQuery = ""
private var lastComp = ""

/**
 * Equipos: buscar un equipo o un país y los últimos 5 buscados; los próximos partidos de un equipo (también en español).
 * Selecciones: «Todas», cada competición y «Selección femenina». Del JSON de 21 días del panel guardado en el equipo.
 */
struct SportsTeamsView: View {
    let data: SportsData
    let nationsMode: Bool
    let now: Double
    let columns: [GridItem]
    let onOpen: (SportEvent) -> Void
    @State private var fx: Fixtures?
    @State private var loading = true
    @State private var query = lastQuery
    @State private var typed = lastQuery
    @State private var comp = lastComp
    @State private var recents = SportsPanel.recentTeams()

    var body: some View {
        let minutes: (String) -> Int = { data.sports[$0]?.minutes ?? 120 }
        let list: [SportEvent] = {
            guard let f = fx else { return [] }
            if !nationsMode { return query.isEmpty ? [] : SportsPanel.searchTeam(f, query, data.rules.alias, minutes) }
            return SportsPanel.nations(f, comp, minutes).events
        }()
        VStack(alignment: .leading, spacing: 10) {
            if nationsMode {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(nationChips(minutes), id: \.0) { c in Chip(text: c.1, selected: comp == c.0) { comp = c.0; lastComp = c.0 } } }
                }
            } else {
                HStack(spacing: 8) {
                    TextField("", text: $typed, prompt: Text(tr("Buscar equipo o país")).foregroundColor(Theme.muted))
                        .foregroundColor(.white).submitLabel(.search).disableAutocorrection(true)
                        .onSubmit { search(typed) }
                        .padding(.horizontal, 12).frame(height: 40).background(Color(hex: 0x262626)).clipShape(RoundedRectangle(cornerRadius: 6))
                    Button(tr("Buscar")) { search(typed) }.font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                }
                if !recents.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) { ForEach(recents, id: \.self) { r in Chip(text: "🔎 " + r, selected: query == r) { typed = r; search(r) } } }
                    }
                }
            }
            if fx == nil && loading { LoadingView(text: tr("Cargando partidos…")).frame(height: 240) }
            else if !list.isEmpty {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(list) { e in SportCard(event: e, info: data.sports[e.sport], now: now, withDate: true) { onOpen(e) } }
                }
            }
            else if fx == nil { EmptyMessage(text: tr("No se pudieron cargar los partidos.")) }
            else if nationsMode { EmptyMessage(text: tr("No hay partidos de selecciones en los próximos días.")) }
            else if query.isEmpty { EmptyMessage(text: tr("Escribe el nombre de un equipo o un país para ver sus próximos partidos.")) }
            else { EmptyMessage(text: tr("No hay partidos de «%@» en los próximos días.", query)) }
        }
        .task(id: data.fixturesRev) {
            for _ in 0..<12 {
                let r = await SportsPanel.fixtures(data.fixturesRev)
                if Task.isCancelled { return }
                if let f = r.fx { fx = f }
                loading = false
                if !r.partial { break }
                try? await Task.sleep(nanoseconds: 25_000_000_000)
            }
        }
    }

    /** «Todas», cada competición y al final «Selección femenina» */
    private func nationChips(_ minutes: (String) -> Int) -> [(String, String)] {
        var out: [(String, String)] = [("", tr("Todas"))]
        guard let f = fx else { return out }
        let nat = SportsPanel.nations(f, "", minutes)
        out.append(contentsOf: nat.chips)
        if nat.women { out.append(("w", tr("Selección femenina"))) }
        return out
    }

    private func search(_ q: String) {
        let t = q.trimmed
        query = t
        lastQuery = t
        if !t.isEmpty { recents = SportsPanel.rememberTeam(t) }
    }
}
