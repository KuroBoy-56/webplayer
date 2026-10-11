import SwiftUI

/** guía de cada canal: primero la del servidor IPTV y si no trae, la del panel (api/epg.php) */
actor EpgCache {
    static let shared = EpgCache()
    private var mem: [Int: (Double, [EpgEntry])] = [:]

    func guide(_ s: Session, _ ch: Item, neighbors: [Item]) async -> [EpgEntry] {
        let now = Date().timeIntervalSince1970
        if let c = mem[ch.id], now - c.0 < 600 { return c.1.filter { $0.end > now } }
        var l = await Xtream.shortEpg(s, ch.id, limit: 4)
        if l.isEmpty { l = await PanelEpg.shared.guide(ch, neighbors: neighbors) }
        mem[ch.id] = (now, l)
        return l
    }
}

struct LiveView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    @State private var cat = "__all"
    @State private var q = ""

    private static let favs = "__favs", all = "__all"

    var body: some View {
        GeometryReader { g in
            let pad = sidePad(g.size)
            let cats = state.visible(state.liveCats)
            let blocked = Store.blockedCats
            let ql = q.trimmed.folded
            let base: [Item] = {
                let _ = cloud.rev
                switch cat {
                case LiveView.favs: return cloud.favList(.live).map { f in state.live.first { $0.id == f.id } ?? f }
                case LiveView.all: return state.live.filter { !blocked.contains($0.categoryId) }
                default: return state.live.filter { $0.categoryId == cat }
                }
            }()
            let list = ql.isEmpty ? base : base.filter { $0.name.folded.contains(ql) }
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(text: "★ Favoritos", selected: cat == LiveView.favs) { cat = LiveView.favs }
                        Chip(text: "Todos", selected: cat == LiveView.all) { cat = LiveView.all }
                        ForEach(cats) { c in Chip(text: c.name, selected: cat == c.id) { cat = c.id } }
                    }.padding(.horizontal, pad).padding(.vertical, 8)
                }
                if state.loading && state.live.isEmpty { LoadingView(text: "Cargando canales…") }
                else if list.isEmpty { EmptyMessage(text: cat == LiveView.favs ? "Mantén presionado un canal para agregarlo a favoritos." : "No hay canales.") }
                else {
                    List {
                        ForEach(Array(list.enumerated()), id: \.element.key) { i, ch in
                            ChannelRow(channel: ch, neighbors: Array(list[max(0, i - 20)..<min(list.count, i + 40)]), fav: cloud.isFav(ch.key))
                                .contentShape(Rectangle())
                                .onTapGesture { state.playLive(list, i) }
                                .contextMenu {
                                    Button { Cloud.shared.toggleFav(ch) } label: {
                                        Label(cloud.isFav(ch.key) ? "Quitar de favoritos" : "Agregar a favoritos", systemImage: cloud.isFav(ch.key) ? "star.slash" : "star")
                                    }
                                }
                                .swipeActions(edge: .trailing) {
                                    Button { Cloud.shared.toggleFav(ch) } label: { Image(systemName: cloud.isFav(ch.key) ? "star.slash" : "star.fill") }.tint(.yellow)
                                }
                                .listRowBackground(Theme.bg)
                                .listRowInsets(EdgeInsets(top: 6, leading: pad, bottom: 6, trailing: pad))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("TV en vivo")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Buscar canal")
    }
}

struct ChannelRow: View {
    @EnvironmentObject var state: AppState
    let channel: Item
    let neighbors: [Item]
    let fav: Bool
    @State private var now: EpgEntry?

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(url: channel.poster, mode: .fit, maxPixel: 200)
                .frame(width: 64, height: 40).background(Color(hex: 0x222222)).clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if fav { Image(systemName: "star.fill").font(.system(size: 11)).foregroundColor(.yellow) }
                    Text(channel.name).font(.system(size: 15, weight: .semibold)).foregroundColor(.white).lineLimit(1)
                }
                if let n = now {
                    Text("\(hm(n.start)) - \(hm(n.end)) · \(n.title)").font(.system(size: 12)).foregroundColor(Theme.muted).lineLimit(1)
                    ProgressBar(value: (Date().timeIntervalSince1970 - n.start) / max(1, n.end - n.start)).frame(height: 2).clipShape(Capsule())
                }
            }
            Spacer(minLength: 0)
        }
        .task(id: channel.id) {
            guard let s = state.session else { return }
            let l = await EpgCache.shared.guide(s, channel, neighbors: neighbors)
            let t = Date().timeIntervalSince1970
            now = l.first { $0.start <= t && $0.end > t }
        }
    }
}

func hm(_ t: Double) -> String {
    let f = DateFormatter()
    f.dateFormat = "H:mm"
    return f.string(from: Date(timeIntervalSince1970: t))
}
