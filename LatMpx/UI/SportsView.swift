import SwiftUI
import Combine

/** Deportes: misma agenda que la web y Android, con los datos de api/sports.php. */
struct SportsView: View {
    @EnvironmentObject var state: AppState
    @State private var data: SportsData?
    @State private var loaded = false
    @State private var day = -1
    @State private var sport = ""
    @State private var q = ""
    @State private var now = Date().timeIntervalSince1970
    @State private var pick: SportEvent?
    @State private var busy = false
    /** Agenda / Tablas / Selecciones / Equipos (las tres últimas si el panel las ofrece) */
    @State private var tab: SpTab = .agenda

    private let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { g in
            if let d = data, tab != .agenda, (tab == .tables && d.tablesOn) || (tab == .nations && d.nationsOn) || (tab == .teams && d.fixturesOn) {
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
        }
        .onReceive(timer) { _ in now = Date().timeIntervalSince1970 }
        .confirmationDialog(pick.map(title) ?? "", isPresented: Binding(get: { pick != nil }, set: { if !$0 { pick = nil } }), titleVisibility: .visible, presenting: pick) { e in
            Button("▶ " + tr("Ver el evento")) { watch(e, nil, false) }
            ForEach(e.tv, id: \.self) { c in
                Button(c.country.isEmpty ? c.name : "\(c.name) · \(c.country)") { watch(e, c, false) }
            }
            Button(tr("Buscar por equipos")) { watch(e, nil, true) }
            Button(tr("Cancelar"), role: .cancel) {}
        } message: { e in
            Text(e.tv.count == 1 ? tr("Se transmite por 1 canal. Elige uno o deja que lo busquemos.") : tr("Se transmite por %d canales. Elige uno o deja que lo busquemos.", e.tv.count))
        }
    }

    /** Tablas, Selecciones o Equipos (Deportes en el teléfono en vertical: una tarjeta por fila y la tabla corta) */
    private func extra(_ d: SportsData, _ size: CGSize) -> some View {
        let cols = size.width >= 700 ? [GridItem(.adaptive(minimum: 330), spacing: 10)] : [GridItem(.flexible())]
        return ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(tr("Deportes")).font(.system(size: 28, weight: .heavy)).foregroundColor(.white)
                SportsTabs(data: d, tab: $tab)
                if tab == .tables { SportsTablesView(data: d, wide: size.width >= 700) }
                else { SportsTeamsView(data: d, nationsMode: tab == .nations, now: now, columns: cols) { e in openEvent(e) } }
            }
            .padding(.horizontal, sidePad(size)).padding(.vertical, 16)
        }
        .overlay { if busy { ProgressView().tint(Theme.accent).scaleEffect(1.4).padding(30).background(Color.black.opacity(0.7)).clipShape(RoundedRectangle(cornerRadius: 12)) } }
    }

    private func openEvent(_ e: SportEvent) { e.tv.isEmpty ? watch(e, nil, false, fromMenu: false) : (pick = e) }

    private func title(_ e: SportEvent) -> String { !e.home.isEmpty && !e.away.isEmpty ? "\(e.home) vs \(e.away)" : e.title.ifEmpty(tr("Evento")) }

    private func dayKey(_ t: Double) -> Int {
        var cal = Calendar.current
        cal.timeZone = Sports.zone
        let c = cal.dateComponents([.year, .day, .month], from: Date(timeIntervalSince1970: t))
        return (c.year ?? 0) * 10000 + (c.month ?? 0) * 100 + (c.day ?? 0)
    }

    private func content(_ d: SportsData, _ size: CGSize) -> some View {
        let pad = sidePad(size)
        let keys = [dayKey(now), dayKey(now + 86400)]
        let cur = day >= 0 ? day : (d.events.contains { dayKey($0.start) == keys[0] } ? 0 : 1)
        let ofDay = d.events.filter { dayKey($0.start) == keys[cur] }
        var counts: [String: Int] = [:]
        ofDay.forEach { counts[$0.sport, default: 0] += 1 }
        let ql = q.trimmed.lowercased()
        let visible = ofDay.filter { (sport.isEmpty || $0.sport == sport) && (ql.isEmpty || Sports.matches($0, d.sports[$0.sport]?.label ?? "", ql)) }
        let live = d.events.filter { Sports.status($0, d.sports[$0.sport], now) == .live && (sport.isEmpty || $0.sport == sport) }
        let showLive = !live.isEmpty && cur == 0 && ql.isEmpty
        var order: [String] = []
        var groups: [String: [SportEvent]] = [:]
        for e in visible where !(showLive && Sports.status(e, d.sports[e.sport], now) == .live) {
            let gk = e.league.ifEmpty(d.sports[e.sport]?.label ?? e.sport)
            if groups[gk] == nil { order.append(gk) }
            groups[gk, default: []].append(e)
        }
        let cols = size.width >= 700 ? [GridItem(.adaptive(minimum: 330), spacing: 10)] : [GridItem(.flexible())]
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading) {
                        Text(tr("Deportes")).font(.system(size: 28, weight: .heavy)).foregroundColor(.white)
                        Text(tr("Partidos de hoy y mañana en tu hora local.")).font(.system(size: 13.5)).foregroundColor(Theme.muted)
                    }
                    Spacer()
                    if !live.isEmpty {
                        HStack(spacing: 6) { LiveDot(); Text(live.count == 1 ? tr("1 en vivo") : tr("%d en vivo", live.count)).font(.system(size: 13, weight: .bold)).foregroundColor(.white) }
                            .padding(.horizontal, 12).padding(.vertical, 7).background(Color(hex: 0xE50914, alpha: 0.15)).clipShape(Capsule())
                    }
                }
                SportsTabs(data: d, tab: $tab)
                HStack(spacing: 8) {
                    Chip(text: tr("Hoy"), selected: cur == 0) { day = 0; sport = "" }
                    Chip(text: tr("Mañana"), selected: cur == 1) { day = 1; sport = "" }
                }
                TextField("", text: $q, prompt: Text(tr("Buscar equipo o liga")).foregroundColor(Theme.muted))
                    .foregroundColor(.white).padding(.horizontal, 12).frame(height: 40).background(Color(hex: 0x262626)).clipShape(RoundedRectangle(cornerRadius: 6))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(text: tr("Todos") + " \(ofDay.count)", selected: sport.isEmpty) { sport = "" }
                        ForEach(d.sports.keys.sorted(), id: \.self) { k in
                            if let n = counts[k], let info = d.sports[k] { Chip(text: "\(info.icon) \(info.label) \(n)", selected: sport == k) { sport = k } }
                        }
                    }
                }
                if showLive {
                    HStack(spacing: 8) { LiveDot(); Text(tr("En vivo ahora")).font(.system(size: 20, weight: .bold)).foregroundColor(.white) }.padding(.top, 8)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) { ForEach(live) { e in card(e, d).frame(width: 300) } }
                    }
                }
                ForEach(order, id: \.self) { league in
                    let list = groups[league] ?? []
                    HStack(spacing: 8) {
                        if let lb = list.first(where: { !$0.leagueBadge.isEmpty })?.leagueBadge { RemoteImage(url: lb + "/tiny", mode: .fit, maxPixel: 80).frame(width: 26, height: 26) }
                        Text(league).font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                        Text("\(list.count)").font(.system(size: 13)).foregroundColor(Theme.muted)
                    }.padding(.top, 10)
                    LazyVGrid(columns: cols, spacing: 8) { ForEach(list) { e in card(e, d) } }
                }
                if order.isEmpty && !showLive {
                    VStack(spacing: 4) {
                        Text(tr("No hay partidos con estos filtros")).font(.system(size: 20, weight: .bold)).foregroundColor(.white)
                        Text(tr("Prueba con otro día o deporte.")).foregroundColor(Theme.muted)
                    }.frame(maxWidth: .infinity).padding(.vertical, 60)
                }
            }
            .padding(.horizontal, pad).padding(.vertical, 16)
        }
        .overlay { if busy { ProgressView().tint(Theme.accent).scaleEffect(1.4).padding(30).background(Color.black.opacity(0.7)).clipShape(RoundedRectangle(cornerRadius: 12)) } }
    }

    private func card(_ e: SportEvent, _ d: SportsData) -> some View {
        SportCard(event: e, info: d.sports[e.sport], now: now) { openEvent(e) }
    }

    /** channel = canal elegido del menú; byEvent = buscar solo por equipos / nombre del evento */
    private func watch(_ e: SportEvent, _ channel: TvChannel?, _ byEvent: Bool, fromMenu: Bool = true) {
        guard let d = data, let s = state.session else { return }
        let st = Sports.status(e, d.sports[e.sport], now)
        let today = dayKey(e.start) == dayKey(now)
        if !today || st == .fin || st == .postponed {
            state.toast = tr(st == .fin && today ? "Este evento ya terminó" : "El evento no está en línea")
            return
        }
        busy = true
        pick = nil
        Task { @MainActor in
            defer { busy = false }
            // el menú termina de cerrarse antes de abrir el reproductor (si no, iOS puede no mostrarlo)
            if fromMenu { try? await Task.sleep(nanoseconds: 450_000_000) }
            let channels = state.live.isEmpty ? await Xtream.items(s, .live) : state.live
            let cats = state.liveCats.isEmpty ? await Xtream.categories(s, .live) : state.liveCats
            let blocked = Store.blockedCats
            let usable = channels.filter { !blocked.contains($0.categoryId) }
            let rules = d.rules
            let (match, viaTv, firstEvent) = await Task.detached { () -> (Item?, Bool, Item?) in
                let prepared = Sports.prepare(usable, cats, rules)
                if let c = channel {
                    if let m = Sports.findByChannel(c.name, prepared).first { return (m, true, nil) }
                    // el canal elegido no está en la lista del cliente: el evento (equipos / nombre) en las carpetas de eventos
                    if let m = Sports.find(e, prepared, rules) { return (m, false, nil) }
                } else if byEvent {
                    if let m = Sports.find(e, prepared, rules) { return (m, false, nil) }
                } else if let m = Sports.best(e, prepared, rules) {
                    return (m, true, nil)
                }
                return (nil, false, prepared.first { $0.isEvent }?.item)
            }.value
            if let m = match {
                if let c = channel, !viaTv { state.toast = tr("No tienes %@; te mostramos %@", c.name, m.name) }
                state.playChannel(m)
            } else if let f = firstEvent {
                let name = cats.first { $0.id == f.categoryId }?.name ?? tr("eventos")
                state.toast = (channel.map { tr("No tienes %@.", $0.name) + " " } ?? "") + tr("Aún no aparece el canal exacto, te mostramos %@", name)
                state.playChannel(f)
            } else {
                state.toast = channel.map { tr("No encontramos %@ en tu lista", $0.name) } ?? tr("No encontramos un canal para este evento")
            }
        }
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
                    Text(hasScore ? "\(event.homeScore) - \(event.awayScore)" : "VS").font(.system(size: hasScore ? 22 : 14, weight: .heavy)).foregroundColor(hasScore ? .white : Theme.muted).frame(width: 70)
                    team(event.away, event.awayBadge)
                }
            } else {
                Text(event.title).font(.system(size: 16, weight: .bold)).foregroundColor(.white).lineLimit(2)
            }
            if !event.tv.isEmpty {
                Text("📺 " + event.tv.prefix(3).map { $0.name }.joined(separator: " · ") + (event.tv.count > 3 ? " +\(event.tv.count - 3)" : ""))
                    .font(.system(size: 12)).foregroundColor(Color(hex: 0xDDDDDD)).lineLimit(1)
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
