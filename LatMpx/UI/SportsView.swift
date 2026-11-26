import SwiftUI
import Combine

/** canales del cliente para Deportes: todos (para abrir cada uno con su carpeta), el índice de los de las carpetas que
 *  ve y las carpetas */
struct SpChans {
    let all: [Item]
    let ix: Sports.Index
    let cats: [Category]
    let byId: [Int: Item]
}

/** opción del menú del partido; green = es un canal que el cliente tiene */
struct SpOpt: Identifiable {
    let id = UUID()
    let title: String
    var sub = ""
    var green = false
    let action: () -> Void
}

struct SpMenu: Identifiable {
    let id = UUID()
    let title: String
    let sub: String
    let opts: [SpOpt]
}

/** los partidos de Equipos / Selecciones buscan su canal al mostrarse (una vez cada uno) */
final class SpMemo { var m: [String: SportMatch] = [:] }

/**
 * Deportes igual que Android TV (como Roku y Vega OS), en vertical: Hoy / Mañana con el canal encontrado automáticamente
 * en cada partido y, si el panel los ofrece, Tablas, Selecciones y Equipos. Orden: en vivo, después por hora y al final
 * los terminados. El canal de cada partido: el que lo transmite si el cliente lo tiene, el de la guía del panel
 * (api/sports_epg.php) o el de los equipos; con «Solo los canales del servidor IPTV» (panel) solo se nombran los que el
 * cliente tiene. Solo cuentan los canales de las carpetas que el cliente ve (control parental).
 */
struct SportsView: View {
    @EnvironmentObject var state: AppState
    @State private var data: SportsData?
    @State private var loaded = false
    @State private var sport = ""
    @State private var now = Date().timeIntervalSince1970
    @State private var tab: SpTab = .today
    @State private var chans: SpChans?
    @State private var found: [String: SportMatch]?
    @State private var epg: [String: [String]] = [:]
    @State private var memo = SpMemo()
    @State private var menu: SpMenu?
    @State private var typing = false
    @State private var typed = ""

    private let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { g in
            if let d = data, (tab == .tables && d.tablesOn) || (tab == .nations && d.nationsOn) || (tab == .teams && d.fixturesOn) {
                extra(d, g.size)
            } else if let d = data { content(d, g.size) }
            else if loaded { EmptyMessage(text: tr("La agenda deportiva no está disponible.\nVuelve a intentarlo en unos minutos.")) }
            else { LoadingView(text: tr("Cargando partidos…")) }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(tr("Deportes"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            data = await Sports.load()
            loaded = true
            if let d = data { await prepare(d) }
        }
        .onReceive(timer) { _ in now = Date().timeIntervalSince1970 }
        .sheet(item: $menu) { m in SportMenuSheet(menu: m) }
        .alert(tr("Buscar canal, equipo o evento…"), isPresented: $typing) {
            TextField(tr("Canal, equipo o evento"), text: $typed)
            Button(tr("Buscar")) { let q = typed.trimmed; if !q.isEmpty { findChans(q) } }
            Button(tr("Cancelar"), role: .cancel) {}
        }
    }

    /* ---------- canales del cliente y el canal de cada partido (en segundo plano, una vez) ---------- */

    private func prepare(_ d: SportsData) async {
        guard let s = state.session else { return }
        let all = state.live.isEmpty ? await Xtream.items(s, .live) : state.live
        let cats = state.liveCats.isEmpty ? await Xtream.categories(s, .live) : state.liveCats
        let hidden = state.hiddenIds()
        let usable = all.filter { !hidden.contains($0.categoryId) }
        let rules = d.rules
        let t = Date().timeIntervalSince1970
        let today = dayKey(t), tomorrow = dayKey(t + 86400)
        let wanted = d.events.filter { e in
            let k = dayKey(e.start)
            return k == today || k == tomorrow || Sports.status(e, d.sports[e.sport], t) == .live
        }
        let (ix, map) = await Task.detached { () -> (Sports.Index, [String: SportMatch]) in
            let ix = Sports.index(usable, cats, rules)
            var m: [String: SportMatch] = [:]
            for e in wanted { m[e.id] = Sports.match(e, ix, rules) }
            return (ix, m)
        }.value
        var byId: [Int: Item] = [:]
        for it in all { byId[it.id] = it }
        chans = SpChans(all: all, ix: ix, cats: cats, byId: byId)
        found = map
        // además, la guía del panel: el canal que tiene el partido en su programación a esa hora
        let evCats = Set(ix.chans.filter { $0.isEvent }.map { $0.item.categoryId })
        epg = await SportsPanel.epgMap(usable, cats, eventCats: evCats)
    }

    private func dayKey(_ t: Double) -> Int {
        var cal = Calendar.current
        cal.timeZone = Sports.zone
        let c = cal.dateComponents([.year, .day, .month], from: Date(timeIntervalSince1970: t))
        return (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
    }

    /** el canal de un partido: el que lo transmite (si el cliente lo tiene), el de la guía o el de los equipos */
    private func resolve(_ e: SportEvent, _ d: SportsData) -> SportMatch? {
        // mientras se buscan los canales de la agenda (en segundo plano) nada se busca aquí (esto corre al dibujar)
        guard let c = chans, let all = found else { return nil }
        var m: SportMatch
        if let f = all[e.id] { m = f }
        else {
            let k = e.id + "|\(e.start)"
            if let x = memo.m[k] { m = x } else { m = Sports.match(e, c.ix, d.rules); memo.m[k] = m }
        }
        let g = (epg[e.id] ?? []).compactMap { Int($0).flatMap { c.byId[$0] } }
        if g.isEmpty { return m }
        m.epg = g
        m.best = m.tv.first(where: { $0.1 != nil && !$0.0.usual })?.1 ?? g.first
        return m
    }

    private func chanOf(_ e: SportEvent, _ d: SportsData, withDate: Bool) -> (String, Bool) {
        if chans == nil || found == nil { return (tr("Buscando…"), false) }
        if let b = resolve(e, d)?.best { return (b.name, true) }
        return (withDate ? tr("Por confirmar") : tr("Sin canal"), false)
    }

    /** "En TV: ESPN 2 · TUDN · Fox Sports +3": los del partido o, en modo "iptv", solo los que tiene el cliente ("" = ninguno) */
    private func tvLine(_ e: SportEvent, _ d: SportsData) -> String? {
        let names = d.iptvOnly ? (resolve(e, d)?.owned().map { $0.name } ?? []) : e.tv.map { $0.name }
        if names.isEmpty { return d.iptvOnly ? "" : nil }
        return tr("En TV:") + " " + names.prefix(4).joined(separator: " · ") + (names.count > 4 ? "  +\(names.count - 4)" : "")
    }

    /* ---------- abrir ---------- */

    /** abre el canal con su carpeta como lista (para cambiar de canal); desde el menú, después de que se cierre */
    private func play(_ ch: Item) {
        let fromMenu = menu != nil
        menu = nil
        let all = chans?.all ?? state.live
        let list = all.filter { $0.categoryId == ch.categoryId }
        let l = list.isEmpty ? [ch] : list
        let i = l.firstIndex { $0.id == ch.id } ?? 0
        if fromMenu {
            // el menú termina de cerrarse antes de abrir el reproductor (si no, iOS puede no mostrarlo)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { state.playLive(l, i) }
        } else { state.playLive(l, i) }
    }

    /** sin canal exacto: la primera carpeta de eventos */
    private func folder() {
        guard let c = chans, let first = c.ix.chans.first(where: { $0.isEvent })?.item else {
            menu = nil
            state.toast = tr("No encontramos un canal para este evento")
            return
        }
        let name = c.cats.first { $0.id == first.categoryId }?.name ?? tr("eventos")
        state.toast = tr("Aún no aparece el canal exacto, te mostramos %@", name)
        play(first)
    }

    /** un menú nuevo o el teclado después de cerrar el que está a la vista */
    private func afterMenu(_ f: @escaping () -> Void) {
        if menu == nil { f(); return }
        menu = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: f)
    }

    /** buscar en la lista del cliente por un nombre (canal, equipo o evento): todos en verde, son del servidor */
    private func findChans(_ q: String) {
        guard let c = chans else { return }
        let list = Self.searchChannels(q, c)
        if list.isEmpty { state.toast = tr("No hay canales con «%@» en tu lista", q); return }
        let m = SpMenu(title: tr("Canales con «%@»", q), sub: "", opts: list.map { ch in SpOpt(title: ch.name, green: true) { play(ch) } })
        afterMenu { menu = m }
    }

    private func playable(_ e: SportEvent, _ d: SportsData) -> Bool {
        let st = Sports.status(e, d.sports[e.sport], now)
        let ending = e.start + Double(d.sports[e.sport]?.minutes ?? 120) * 60
        if st == .postponed { state.toast = tr("El evento está aplazado"); return false }
        if st == .fin || now >= ending { state.toast = tr("Este evento ya terminó"); return false }
        if dayKey(e.start) != dayKey(now) && st != .live { state.toast = tr("El evento no está en línea"); return false }
        return true
    }

    /** menú del partido: el automático, los canales que lo transmiten, los de la guía y los equipos (en verde los que tiene
     *  el cliente), buscar por el nombre de cada equipo y escribir otro nombre */
    private func open(_ e: SportEvent) {
        guard let d = data, playable(e, d) else { return }
        if chans == nil || found == nil { state.toast = tr("Buscando los canales, un momento…"); return }
        let m = resolve(e, d)
        let best = m?.best
        var opts: [SpOpt] = []
        opts.append(SpOpt(title: "▶  " + tr("Ver el evento (canal automático)"), sub: best?.name ?? tr("Busca el mejor canal automáticamente"), green: best != nil) {
            if let b = best { play(b) } else { folder() }
        })
        var seen = Set<Int>()
        for (t, ch) in m?.tv ?? [] {
            if let ch = ch, seen.contains(ch.id) { continue }
            if d.iptvOnly && ch == nil { continue }
            if let ch = ch { seen.insert(ch.id) }
            let title = d.iptvOnly && ch != nil ? ch!.name : t.name + (t.country.isEmpty ? "" : " (\(t.country))")
            let teams = m?.teams
            opts.append(SpOpt(title: title, sub: (t.usual ? tr("suele transmitirlo") + " · " : "") + (ch.map { tr("en tu lista: %@", $0.name) } ?? tr("no está en tu lista: se busca el evento")), green: ch != nil) {
                if let ch = ch { play(ch) }
                else if let tm = teams { state.toast = tr("No tienes %@; te mostramos %@", t.name, tm.name); play(tm) }
                else { folder() }
            })
        }
        let extra: [(Item, String)] = (m?.epg ?? []).map { ($0, tr("en la guía")) } + (m?.teams.map { [($0, tr("por equipos"))] } ?? [])
        for (c, why) in extra where !seen.contains(c.id) && opts.count <= 10 {
            seen.insert(c.id)
            opts.append(SpOpt(title: "\(c.name) · \(why)", green: true) { play(c) })
        }
        let names = [e.home, e.away].filter { !$0.trimmed.isEmpty }
        let search = names.isEmpty ? [e.title].filter { !$0.trimmed.isEmpty } : names
        for n in search { opts.append(SpOpt(title: tr("Buscar canales: «%@»", n)) { findChans(n) }) }
        opts.append(SpOpt(title: tr("Buscar canal, equipo o evento…")) {
            typed = search.first ?? ""
            afterMenu { typing = true }
        })
        menu = SpMenu(title: !e.home.isEmpty && !e.away.isEmpty ? "\(e.home) vs \(e.away)" : e.title.ifEmpty(tr("Evento")), sub: tr("¿Dónde quieres verlo?"), opts: opts)
    }

    /* ---------- pantallas ---------- */

    /** Tablas, Selecciones o Equipos (en el teléfono en vertical: una tarjeta por fila y la tabla corta) */
    private func extra(_ d: SportsData, _ size: CGSize) -> some View {
        let cols = size.width >= 700 ? [GridItem(.adaptive(minimum: 330), spacing: 10)] : [GridItem(.flexible())]
        return ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(tr("Deportes")).font(.system(size: 28, weight: .heavy)).foregroundColor(.white)
                SportsTabs(data: d, tab: Binding(get: { tab }, set: { tab = $0; sport = "" }))
                if tab == .tables { SportsTablesView(data: d, wide: size.width >= 700) }
                else {
                    SportsTeamsView(data: d, nationsMode: tab == .nations, now: now, columns: cols,
                                    chanOf: { e in chanOf(e, d, withDate: true) }) { e in open(e) }
                }
            }
            .padding(.horizontal, sidePad(size)).padding(.vertical, 16)
        }
    }

    private func content(_ d: SportsData, _ size: CGSize) -> some View {
        let pad = sidePad(size)
        let todayKey = dayKey(now), tomorrowKey = dayKey(now + 86400)
        let cur: SpTab = tab == .tomorrow ? .tomorrow : .today
        // Hoy: los de hoy y los que siguen en vivo; Mañana: los de mañana. En vivo, después por hora y al final los terminados
        var liveL: [SportEvent] = [], nextL: [SportEvent] = [], doneL: [SportEvent] = []
        for e in d.events.filter({ sport.isEmpty || $0.sport == sport }).sorted(by: { $0.start < $1.start }) {
            let st = Sports.status(e, d.sports[e.sport], now)
            let day = dayKey(e.start)
            if !((cur == .today && (day == todayKey || st == .live)) || (cur == .tomorrow && day == tomorrowKey)) { continue }
            switch st {
            case .live: liveL.append(e)
            case .soon: nextL.append(e)
            default: doneL.append(e)
            }
        }
        let rows = liveL + nextL + doneL
        var sportKeys: [String] = []
        for e in d.events where !e.sport.isEmpty && !sportKeys.contains(e.sport) { sportKeys.append(e.sport) }
        let liveCount = d.events.filter { Sports.status($0, d.sports[$0.sport], now) == .live }.count
        let cols = size.width >= 700 ? [GridItem(.adaptive(minimum: 330), spacing: 10)] : [GridItem(.flexible())]
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading) {
                        Text(tr("Deportes")).font(.system(size: 28, weight: .heavy)).foregroundColor(.white)
                        Text(tr("Partidos de hoy y mañana en tu hora local.")).font(.system(size: 13.5)).foregroundColor(Theme.muted)
                    }
                    Spacer()
                    if liveCount > 0 {
                        HStack(spacing: 6) { LiveDot(); Text(liveCount == 1 ? tr("1 en vivo") : tr("%d en vivo", liveCount)).font(.system(size: 13, weight: .bold)).foregroundColor(.white) }
                            .padding(.horizontal, 12).padding(.vertical, 7).background(Color(hex: 0xE50914, alpha: 0.15)).clipShape(Capsule())
                    }
                }
                SportsTabs(data: d, tab: Binding(get: { cur }, set: { tab = $0; sport = "" }))
                // disciplinas: Todos y las de la agenda
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(text: tr("Todos"), selected: sport.isEmpty) { sport = "" }
                        ForEach(sportKeys, id: \.self) { k in
                            let info = d.sports[k]
                            Chip(text: "\(info?.icon ?? "") \(info?.label ?? k)".trimmed, selected: sport == k) { sport = k }
                        }
                    }
                }
                .padding(.bottom, 4)
                LazyVGrid(columns: cols, spacing: 8) {
                    ForEach(rows) { e in
                        let c = chanOf(e, d, withDate: false)
                        SportCard(event: e, info: d.sports[e.sport], now: now, chan: c.0, chanFound: c.1, tvLine: tvLine(e, d)) { open(e) }
                    }
                }
                if rows.isEmpty {
                    Text(tr("No hay partidos para mostrar.")).font(.system(size: 20, weight: .bold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 60)
                }
            }
            .padding(.horizontal, pad).padding(.vertical, 16)
        }
    }

    /* ---------- búsqueda de canales por nombre ---------- */

    // palabras que no bastan solas para encontrar un canal (como Android TV y Vega)
    private static let searchNoise: Set<String> = ["club", "united", "city", "real", "deportivo", "atletico", "sporting", "vs"]

    /** Canales de la lista del cliente por nombre (canal, equipo o evento), sin acentos: primero los que tienen todas las
     *  palabras; si ninguno, los que tienen alguna palabra importante (4 letras o más). Dentro de cada grupo, las carpetas
     *  de deportes / eventos primero. Hasta 12 (como Android TV, Roku y Vega). */
    static func searchChannels(_ q: String, _ c: SpChans) -> [Item] {
        let words = Sports.norm(q).split(separator: " ").map(String.init).filter { $0.count >= 2 }
        if words.isEmpty { return [] }
        var catName: [String: String] = [:]
        for cat in c.cats { catName[cat.id] = cat.name.folded }
        var groups: [[Item]] = [[], [], [], []]
        for ch in c.ix.chans {
            let n = ch.norm
            var all = true, some = false
            for w in words {
                if n.contains(w) { if w.count >= 4 && !searchNoise.contains(w) { some = true } } else { all = false }
            }
            if !all && !some { continue }
            let sp = (catName[ch.item.categoryId] ?? "").range(of: "sport|deport|event|ppv|futbol", options: .regularExpression) != nil
            let g = all ? (sp ? 0 : 1) : (sp ? 2 : 3)
            if groups[g].count < 12 { groups[g].append(ch.item) }
        }
        let last = groups[0].count + groups[1].count > 0 ? 1 : 3
        return Array(groups.prefix(last + 1).joined().prefix(12))
    }
}

/** Menú del partido (o de una búsqueda): las opciones en una lista; en verde los canales que tiene el cliente. */
private struct SportMenuSheet: View {
    let menu: SpMenu
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text(menu.title).font(.system(size: 18, weight: .bold)).foregroundColor(.white).lineLimit(2)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundColor(.white).padding(8)
                        .background(Color.white.opacity(0.1)).clipShape(Circle())
                }.buttonStyle(.plain)
            }
            if !menu.sub.isEmpty { Text(menu.sub).font(.system(size: 13)).foregroundColor(Theme.muted) }
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(menu.opts) { o in
                        Button(action: o.action) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(o.title).font(.system(size: 15, weight: .semibold)).foregroundColor(o.green ? Color(hex: 0x46D369) : .white).lineLimit(1)
                                if !o.sub.isEmpty { Text(o.sub).font(.system(size: 12)).foregroundColor(Theme.muted).lineLimit(1) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .background(Color.white.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 8))
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(hex: 0x1C1C1C).ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct LiveDot: View {
    @State private var on = false
    var body: some View {
        Circle().fill(Color(hex: 0xE50914)).frame(width: 8, height: 8).opacity(on ? 1 : 0.35)
            .onAppear { withAnimation(.easeInOut(duration: 0.8).repeatForever()) { on = true } }
    }
}

struct SportCard: View {
    let event: SportEvent
    let info: SportInfo?
    let now: Double
    /** Equipos / Selecciones (21 días): también el día del partido */
    var withDate = false
    /** el canal que se abre (el de la lista del cliente, en verde) o «Sin canal» / «Buscando…» (como Android TV) */
    var chan: String? = nil
    var chanFound = false
    /** «En TV: …» (nil = los canales del partido como antes; "" = ninguno) */
    var tvLine: String? = nil
    let onWatch: () -> Void

    var body: some View {
        let st = Sports.status(event, info, now)
        let hasScore = !event.homeScore.isEmpty && !event.awayScore.isEmpty && st != .soon
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(info?.icon ?? "") \(event.league.ifEmpty(info?.label ?? event.sport))").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.muted).lineLimit(1)
                Spacer()
                pill(st)
            }
            if !event.home.isEmpty && !event.away.isEmpty {
                HStack {
                    team(event.home, event.homeBadge)
                    // el marcador siempre en una línea entre los dos equipos («10 - 12» ya no se parte en dos renglones)
                    Text(hasScore ? "\(event.homeScore) - \(event.awayScore)" : "VS").font(.system(size: hasScore ? 22 : 14, weight: .heavy)).foregroundColor(hasScore ? .white : Theme.muted)
                        .lineLimit(1).fixedSize().frame(minWidth: 70)
                    team(event.away, event.awayBadge)
                }
            } else {
                Text(event.title).font(.system(size: 16, weight: .bold)).foregroundColor(.white).lineLimit(2)
            }
            let line = tvLine ?? (event.tv.isEmpty ? "" : "📺 " + event.tv.prefix(3).map { $0.name }.joined(separator: " · ") + (event.tv.count > 3 ? " +\(event.tv.count - 3)" : ""))
            if !line.isEmpty {
                Text(line).font(.system(size: 12)).foregroundColor(Color(hex: 0xDDDDDD)).lineLimit(1)
            }
            if let c = chan {
                Text("▶ " + c).font(.system(size: 13, weight: .bold)).foregroundColor(chanFound ? Color(hex: 0x46D369) : Theme.muted).lineLimit(1)
            }
            HStack {
                Text(event.venue.ifEmpty(st == .soon ? Sports.time(event.start) : "")).font(.system(size: 12.5)).foregroundColor(Theme.muted).lineLimit(1)
                Spacer()
                Button(action: onWatch) {
                    Text(tr(event.tv.isEmpty ? "TV en vivo" : "Ver canales")).font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 6).background(Color.white.opacity(0.1)).clipShape(RoundedRectangle(cornerRadius: 4))
                }.buttonStyle(.plain)
            }
        }
        .padding(14)
        .background(Color(hex: 0x1C1C1C))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(st == .live ? Color(hex: 0xE50914, alpha: 0.6) : Color.white.opacity(0.08)))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        // toda la tarjeta abre el menú del partido (como Android TV), no solo el botón
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture(perform: onWatch)
    }

    private func team(_ name: String, _ badge: String) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Color(hex: 0x2A2A2A)
                if badge.isEmpty { Text(String(name.prefix(1))).font(.system(size: 16, weight: .bold)).foregroundColor(.white) }
                else { RemoteImage(url: badge + "/small", mode: .fit, maxPixel: 120) }
            }.frame(width: 40, height: 40).clipShape(Circle())
            Text(name).font(.system(size: 13, weight: .semibold)).foregroundColor(.white).lineLimit(2).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity)
    }

    @ViewBuilder private func pill(_ st: SpStatus) -> some View {
        switch st {
        case .live: HStack(spacing: 4) { LiveDot(); Text(tr("En vivo")) }.font(.system(size: 11, weight: .bold)).foregroundColor(.white).padding(.horizontal, 8).padding(.vertical, 3).background(Color(hex: 0xE50914)).clipShape(Capsule())
        case .fin: Text(tr("Final")).font(.system(size: 11, weight: .bold)).foregroundColor(Theme.muted)
        case .postponed: Text(tr("Aplazado")).font(.system(size: 11, weight: .bold)).foregroundColor(Theme.muted)
        case .soon: Text(withDate ? Sports.dayTime(event.start, now) : Sports.time(event.start)).font(.system(size: 12, weight: .bold)).foregroundColor(.white).padding(.horizontal, 8).padding(.vertical, 3).background(Color.white.opacity(0.12)).clipShape(Capsule())
        }
    }
}
