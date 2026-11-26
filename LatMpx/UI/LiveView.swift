import SwiftUI
import Combine
import UIKit

/**
 * TV en vivo igual que la app de Android en celular (y tvguide.php de la web): arriba (fijo) la miniatura
 * del canal elegido y el canal con su favorito; abajo, una sola lista que se desplaza con el dedo: la guía de
 * programas (el de ahora y los 2 siguientes) y, debajo, la categoría (fija arriba al bajar), el buscador y los
 * canales con lo que se emite ahora. Al bajar por los canales la guía se va hacia arriba con la lista y bajo el
 * nombre del canal aparece, en una línea, lo que se transmite ahora; al volver al principio la guía baja otra vez.
 * Tocar un canal lo reproduce en la miniatura; la pantalla completa se abre con su botón o al girar el teléfono.
 */
struct LiveView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    @Environment(\.scenePhase) private var phase
    @StateObject private var preview = LivePreview()
    @State private var cat: String?
    @State private var q = ""
    @State private var selId = Store.lastChannel()
    @State private var active = false
    @State private var visible = false
    @State private var armed = true
    @State private var openedFull = false
    @State private var resumeTick = 0
    @State private var guide: [EpgEntry]?
    @State private var now = Date().timeIntervalSince1970
    /// el programa de ahora ya subió fuera de la vista (va bajo el nombre del canal)
    @State private var compact = false
    /// la guía entera está arriba, fuera de la vista
    @State private var guideAway = false
    @State private var scrollTarget: String?

    static let favs = "__favs", all = "__all"
    private var phone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    private struct Cat: Hashable { let id: String; let name: String }

    private var cats: [Cat] {
        [Cat(id: LiveView.favs, name: "★ " + tr("Favoritos")), Cat(id: LiveView.all, name: tr("Todos"))] + state.visible(state.liveCats).map { Cat(id: $0.id, name: $0.name) }
    }

    private var currentCat: String { cat ?? (cloud.favList(.live).isEmpty ? LiveView.all : LiveView.favs) }

    private var shown: [Item] {
        let _ = cloud.rev
        let blocked = state.hiddenIds()
        let base: [Item]
        switch currentCat {
        case LiveView.favs:
            // una pasada por los canales (no una búsqueda por cada favorito)
            let favs = cloud.favList(.live), ids = Set(favs.map { $0.id })
            var byId: [Int: Item] = [:]
            for c in state.live where ids.contains(c.id) && byId[c.id] == nil { byId[c.id] = c }
            base = favs.map { byId[$0.id] ?? $0 }
        case LiveView.all: base = blocked.isEmpty ? state.live : state.live.filter { !blocked.contains($0.categoryId) }
        default: base = state.live.filter { $0.categoryId == currentCat }
        }
        let ql = q.trimmed.folded
        return ql.isEmpty ? base : base.filter { $0.name.folded.contains(ql) }
    }

    private var sel: Item? { selId == 0 ? nil : state.live.first { $0.id == selId } }

    /** la miniatura solo se conecta con la pestaña a la vista y sin el reproductor completo abierto */
    private var previewKey: String {
        let on = active && visible && state.play == nil && phase == .active && state.tab == .live
        return "\(on ? (sel?.id ?? 0) : 0)|\(resumeTick)"
    }

    var body: some View {
        GeometryReader { g in
            let list = shown
            let ch = sel
            let nowProg = guide?.first { $0.start <= now && $0.end > now }
            if !phone && g.size.width > g.size.height {
                // iPad girado: reproductor, canal elegido y guía a la izquierda; categorías y canales a la derecha
                let lw = g.size.width * 0.6
                HStack(spacing: 0) {
                    VStack(spacing: 0) {
                        playerBox(ch, nowProg, list).frame(width: lw, height: lw * 9 / 16).background(Color.black)
                        if let ch = ch {
                            selectedRow(ch, nowProg: nowProg)
                            sideGuide(Array((guide ?? []).filter { $0.end > now }.prefix(10)))
                        }
                        Spacer(minLength: 0)
                    }.frame(width: lw)
                    channelList(list, progs: [])
                }
            } else {
                VStack(spacing: 0) {
                    playerBox(ch, nowProg, list)
                        .frame(width: boxWidth(g.size), height: boxWidth(g.size) * 9 / 16)
                        .frame(maxWidth: .infinity)
                        .background(Color.black)
                    if let ch = ch { selectedRow(ch, nowProg: nowProg) }
                    channelList(list, progs: ch == nil ? [] : Array((guide ?? []).filter { $0.end > now }.prefix(3)))
                }
            }
        }
        .background(LiveColors.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { visible = true; UIDevice.current.beginGeneratingDeviceOrientationNotifications() }
        .onDisappear { visible = false; preview.release(); UIDevice.current.endGeneratingDeviceOrientationNotifications() }
        .task(id: previewKey) { syncPreview() }
        .task(id: selId) { await loadGuide() }
        .task {
            // la barra de avance de los programas se mueve sola
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                now = Date().timeIntervalSince1970
            }
        }
        .onChange(of: state.play?.id) { id in
            guard id == nil, openedFull else { return }
            // de vuelta del reproductor: sigue en la miniatura con el último canal visto
            openedFull = false
            let last = Store.lastChannel()
            if last != 0 { selId = last }
            if UIDevice.current.orientation.isLandscape { armed = false }
            resumeTick += 1
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in rotated() }
    }

    /* ---------- acciones ---------- */
    private func select(_ c: Item) {
        selId = c.id
        Store.setLastChannel(c.id)
        active = true
    }

    private func toggleFav(_ c: Item) {
        var it = c
        it.kind = .live
        if cloud.demo { _ = Cloud.shared.blockedForDemo(); return }
        let on = Cloud.shared.toggleFav(it)
        state.toast = tr(on ? "Agregado a favoritos" : "Quitado de favoritos")
    }

    private func openFull(_ list: [Item], byRotation: Bool) {
        guard let ch = sel, state.play == nil else { return }
        active = true
        openedFull = true
        preview.release()
        if let i = list.firstIndex(where: { $0.id == ch.id }) { state.playLive(list, i, closeOnPortrait: byRotation) }
        else { state.playLive([ch], 0, closeOnPortrait: byRotation) }
    }

    /** girar el teléfono con un canal en la miniatura abre la pantalla completa */
    private func rotated() {
        guard phone else { return }
        let o = UIDevice.current.orientation
        if o == .portrait { armed = true; return }
        guard o.isLandscape, armed, active, visible, sel != nil, state.play == nil, state.tab == .live, phase == .active else { return }
        armed = false
        openFull(shown, byRotation: true)
    }

    private func syncPreview() {
        let on = active && visible && state.play == nil && phase == .active && state.tab == .live
        if on, let s = state.session, let ch = sel { preview.play(s, ch) } else { preview.release() }
    }

    /** guía del canal elegido: la del panel y, si no tiene, la del servidor IPTV (como la web) */
    private func loadGuide() async {
        guard let ch = sel, let s = state.session else { guide = []; return }
        guide = await PanelEpg.shared.cached(ch.id)
        var l = await PanelEpg.shared.guide(ch, neighbors: Array(shown.prefix(400)))
        if l.isEmpty { l = await Xtream.shortEpg(s, ch.id, limit: 12) }
        if selId == ch.id { guide = Array(l.prefix(15)) }
    }

    private func boxWidth(_ size: CGSize) -> CGFloat {
        // en iPad horizontal la miniatura no ocupa más de la mitad de la altura
        min(size.width, size.height * 0.5 * 16 / 9)
    }

    /* ---------- partes ---------- */
    private func playerBox(_ ch: Item?, _ nowProg: EpgEntry?, _ list: [Item]) -> some View {
        LivePlayerBox(preview: preview, channel: ch, active: active, nowProg: nowProg, now: now,
                      onStart: { active = true }, onRetry: { resumeTick += 1 }, onFull: { openFull(list, byRotation: false) })
    }

    /** iPad girado: la guía del canal elegido bajo el reproductor (hasta 10 programas) */
    private func sideGuide(_ l: [EpgEntry]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(tr("Guía de programas")).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 6)
                if guide != nil && l.isEmpty {
                    Text(tr("Guía no disponible")).font(.system(size: 13)).foregroundColor(LiveColors.empty).padding(16)
                }
                ForEach(l, id: \.self) { p in ProgramRow(program: p, now: now) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(LiveColors.col)
    }

    private func channelList(_ list: [Item], progs: [EpgEntry]) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    Color.clear.frame(height: 0).id("liveGuideTop")
                    guideBlock(progs)
                    Color.clear.frame(height: 0).id("liveListTop")
                    // la categoría queda fija arriba de la lista al bajar por los canales
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section(header: catMenu) {
                            HStack(alignment: .lastTextBaseline, spacing: 6) {
                                Text(tr("Canales")).font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                                if !list.isEmpty { Text("(\(list.count))").font(.system(size: 12)).foregroundColor(LiveColors.empty) }
                                Spacer()
                            }.padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 10)
                            filterField
                            if state.loading && state.live.isEmpty {
                                LoadingView(text: tr("Cargando canales…")).padding(.top, 20)
                            } else if list.isEmpty {
                                Text(tr(currentCat == LiveView.favs && q.trimmed.isEmpty ? "Aún no tienes canales favoritos." : "No hay canales en esta sección."))
                                    .font(.system(size: 14)).foregroundColor(LiveColors.empty).multilineTextAlignment(.center).padding(16)
                            }
                            ForEach(Array(list.enumerated()), id: \.element.id) { i, c in
                                LiveRow(channel: c, index: i, shown: list, active: c.id == selId, fav: cloud.isFav(c.key), now: now)
                                    .contentShape(Rectangle())
                                    .onTapGesture { select(c) }
                                    .onLongPressGesture(minimumDuration: 0.5) { toggleFav(c) }
                            }
                        }
                    }.padding(.bottom, 16)
                }
            }
            .coordinateSpace(name: "liveList")
            .scrollDismissesKeyboard(.immediately)
            .onPreferenceChange(LiveGuideNowKey.self) { b in let c = b.map { $0 <= 6 } ?? false; if c != compact { compact = c } }
            .onPreferenceChange(LiveGuideBottomKey.self) { b in if (b <= 0.5) != guideAway { guideAway = b <= 0.5 } }
            .onChange(of: scrollTarget) { t in
                guard let t else { return }
                scrollTarget = nil
                proxy.scrollTo(t, anchor: .top)
            }
        }
    }

    private func selectedRow(_ ch: Item, nowProg: EpgEntry?) -> some View {
        let on = cloud.isFav(ch.key)
        // con la guía fuera de la vista el nombre sube un poco y debajo aparece lo de ahora (nada cambia de alto)
        let showNow = compact && nowProg != nil
        return HStack(spacing: 12) {
            ChannelLogo(url: ch.poster).frame(width: 64, height: 42).clipShape(RoundedRectangle(cornerRadius: 4))
            ZStack(alignment: .leading) {
                Text(ch.name).font(.system(size: 16, weight: .bold)).foregroundColor(.white).lineLimit(1)
                    .offset(y: showNow ? -9 : 0)
                if let np = nowProg {
                    HStack(spacing: 0) {
                        Text("\(hm(np.start)) - \(hm(np.end))  ").font(.system(size: 12, weight: .bold)).foregroundColor(Theme.accent)
                        Text(np.title).font(.system(size: 12)).foregroundColor(Color(hex: 0xCCCCCC)).lineLimit(1)
                    }
                    .offset(y: showNow ? 10 : 14)
                    .opacity(showNow ? 1 : 0)
                }
            }
            .frame(height: 42)
            .animation(.easeOut(duration: 0.3), value: showNow)
            Spacer(minLength: 8)
            Button { toggleFav(ch) } label: {
                Image(systemName: "star.fill").font(.system(size: 19)).foregroundColor(on ? Theme.p.onAccent : .white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(on ? Theme.accent : Color(hex: 0x2A2A2A).opacity(0.6)))
                    .overlay(Circle().stroke(on ? Theme.accent : Color.white.opacity(0.6), lineWidth: 2))
            }.buttonStyle(.plain).accessibilityLabel(tr("Favorito"))
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    /** la guía dentro de la lista: el programa de ahora y los 2 siguientes (siempre está, con alto 0 si no hay guía) */
    private func guideBlock(_ l: [EpgEntry]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if !l.isEmpty {
                Text(tr("Guía de programas")).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 6)
                ForEach(l, id: \.self) { p in
                    ProgramRow(program: p, now: now)
                        .background(GeometryReader { g in
                            Color.clear.preference(key: LiveGuideNowKey.self,
                                                   value: p.start <= now && p.end > now ? g.frame(in: .named("liveList")).maxY : nil)
                        })
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(l.isEmpty ? Color.clear : LiveColors.col)
        .background(LiveGuideAnchor())
        .background(GeometryReader { g in
            Color.clear.preference(key: LiveGuideBottomKey.self, value: g.frame(in: .named("liveList")).maxY)
        })
    }

    private var catMenu: some View {
        Menu {
            ForEach(cats, id: \.id) { c in
                Button {
                    // la categoría nueva empieza en su primer canal; si la guía ya no se veía, sigue fuera de la vista
                    scrollTarget = guideAway ? "liveListTop" : "liveGuideTop"
                    cat = c.id
                } label: { if c.id == currentCat { Label(c.name, systemImage: "checkmark") } else { Text(c.name) } }
            }
        } label: {
            HStack {
                Text(cats.first { $0.id == currentCat }?.name ?? tr("Categorías")).font(.system(size: 14)).foregroundColor(.white).lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down").font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
            }
            .padding(.leading, 12).padding(.trailing, 10).padding(.vertical, 10)
            .background(Color.black)
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0x555555), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 8)
        .background(LiveColors.bg)
    }

    private var filterField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundColor(Theme.muted)
            TextField("", text: $q, prompt: Text(tr("Buscar canal...")).foregroundColor(Theme.muted))
                .font(.system(size: 14)).foregroundColor(.white)
                .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
            if !q.isEmpty {
                Button { q = "" } label: { Image(systemName: "xmark.circle.fill").foregroundColor(Theme.muted) }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Color(hex: 0x0F0F0F))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0x333333), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .padding(.horizontal, 12).padding(.bottom, 10)
    }
}

func hm(_ t: Double) -> String {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f.string(from: Date(timeIntervalSince1970: t))
}
