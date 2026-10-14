import SwiftUI
import Combine
import UIKit

/**
 * TV en vivo igual que la app de Android en celular (y tvguide.php de la web): arriba (fijo) la miniatura
 * del canal elegido, el canal con su favorito y la guía de programas; debajo el selector de categorías,
 * el buscador y la lista de canales con lo que se emite ahora. Tocar un canal lo reproduce en la miniatura;
 * la pantalla completa se abre con su botón o al girar el teléfono (volver a vertical la cierra).
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

    static let favs = "__favs", all = "__all"
    private var phone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    private struct Cat: Hashable { let id: String; let name: String }

    private var cats: [Cat] {
        [Cat(id: LiveView.favs, name: "★ " + tr("Favoritos")), Cat(id: LiveView.all, name: tr("Todos"))] + state.visible(state.liveCats).map { Cat(id: $0.id, name: $0.name) }
    }

    private var currentCat: String { cat ?? (cloud.favList(.live).isEmpty ? LiveView.all : LiveView.favs) }

    private var shown: [Item] {
        let _ = cloud.rev
        let blocked = Store.blockedCats
        let base: [Item]
        switch currentCat {
        case LiveView.favs: base = cloud.favList(.live).map { f in state.live.first { $0.id == f.id } ?? f }
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
            VStack(spacing: 0) {
                LivePlayerBox(preview: preview, channel: ch, active: active, nowProg: nowProg, now: now,
                              onStart: { active = true }, onRetry: { resumeTick += 1 }, onFull: { openFull(list, byRotation: false) })
                    .frame(width: boxWidth(g.size), height: boxWidth(g.size) * 9 / 16)
                    .frame(maxWidth: .infinity)
                    .background(Color.black)
                if let ch = ch { selectedRow(ch) }
                if let gl = guide, ch != nil, !gl.isEmpty { guidePanel(gl, maxH: g.size.height * 0.24) }
                channelList(list)
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
    private func channelList(_ list: [Item]) -> some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                catMenu
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(tr("Canales")).font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                    if !list.isEmpty { Text("(\(list.count))").font(.system(size: 12)).foregroundColor(LiveColors.empty) }
                    Spacer()
                }.padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
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
            }.padding(.bottom, 16)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    private func selectedRow(_ ch: Item) -> some View {
        let on = cloud.isFav(ch.key)
        return HStack(spacing: 12) {
            ChannelLogo(url: ch.poster).frame(width: 64, height: 42).clipShape(RoundedRectangle(cornerRadius: 4))
            Text(ch.name).font(.system(size: 16, weight: .bold)).foregroundColor(.white).lineLimit(1)
            Spacer(minLength: 8)
            Button { toggleFav(ch) } label: {
                Image(systemName: "star.fill").font(.system(size: 19)).foregroundColor(on ? .black : .white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(on ? Color.white : Color(hex: 0x2A2A2A).opacity(0.6)))
                    .overlay(Circle().stroke(on ? Color.white : Color.white.opacity(0.6), lineWidth: 2))
            }.buttonStyle(.plain).accessibilityLabel(tr("Favorito"))
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func guidePanel(_ l: [EpgEntry], maxH: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(tr("Guía de programas")).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 6)
            ScrollView {
                LazyVStack(spacing: 0) { ForEach(l, id: \.self) { p in ProgramRow(program: p, now: now) } }
            }
        }
        .frame(height: min(maxH, 36 + CGFloat(l.count) * 52), alignment: .top)
        .frame(maxWidth: .infinity)
        .background(LiveColors.col)
    }

    private var catMenu: some View {
        Menu {
            ForEach(cats, id: \.id) { c in
                Button { cat = c.id } label: { if c.id == currentCat { Label(c.name, systemImage: "checkmark") } else { Text(c.name) } }
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
        .padding(.horizontal, 12).padding(.top, 10)
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
