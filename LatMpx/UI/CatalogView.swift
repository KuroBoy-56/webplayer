import SwiftUI

/**
 * Películas o Series, igual que Android para celular: destacados, "Agregadas recientemente", Top 10 y una
 * fila por categoría (con "Ver todo"); arriba la barra con Series / Películas / Deportes / Mi lista.
 */
struct CatalogView: View {
    @EnvironmentObject var state: AppState
    let kind: Kind
    /** la barra se oscurece al bajar (solo cambia al cruzar el límite: no redibuja en cada paso del scroll) */
    @State private var solid = false

    var body: some View {
        GeometryReader { g in
            // las más nuevas primero, ordenadas una vez por catálogo
            let all = state.visibleItems(state.recent(kind == .movie ? .movie : .series))
            if state.loading && all.isEmpty {
                LoadingView(text: tr("Preparando tu catálogo…"))
            } else {
                content(g.size, all)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private func content(_ size: CGSize, _ all: [Item]) -> some View {
        let pad = sidePad(size), pw = posterWidth(size)
        let recent = Array(all.prefix(20))
        let top10 = Array(all.prefix(300).sorted { $0.rating > $1.rating }.prefix(10))
        let hero = Array(all.prefix(40).sorted { $0.rating > $1.rating }.prefix(6))
        let cats = state.visible(kind == .movie ? state.movieCats : state.seriesCats)
        let groups = state.grouped(kind)
        let rows: [CatRow] = cats.compactMap { c in
            guard let l = groups[c.id], !l.isEmpty else { return nil }
            return CatRow(cat: c, items: Array(l.prefix(20)))
        }
        let title = kind == .movie ? "Películas" : "Series"
        return ZStack(alignment: .top) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ScrollOffsetReader(space: "cat\(title)")
                    if !hero.isEmpty { HeroCards(items: hero, width: size.width, topPad: 104).padding(.bottom, 8) }
                    else { Color.clear.frame(height: 104) }
                    ShelfRow(title: tr("Agregadas recientemente"), items: recent, pad: pad, onViewAll: { state.push(.browse(tr("Agregadas recientemente"), kind, [])) }) { _, it in
                        PosterCard(item: it, width: pw) { state.push(.detail(it)) }
                    }
                    ShelfRow(title: tr("Top 10"), items: top10, pad: pad) { i, it in
                        Top10Card(rank: i + 1, item: it, width: pw * 1.15) { state.push(.detail(it)) }
                    }
                    ForEach(rows) { row in
                        ShelfRow(title: row.cat.name, items: row.items, pad: pad, onViewAll: { state.push(.browse(row.cat.name, kind, [row.cat.id])) }) { _, it in
                            PosterCard(item: it, width: pw) { state.push(.detail(it)) }
                        }
                    }
                    if all.isEmpty { EmptyMessage(text: tr(kind == .movie ? "No hay películas en tu lista." : "No hay series en tu lista.")).frame(height: 240) }
                    Spacer(minLength: 40)
                }
            }
            .coordinateSpace(name: "cat\(title)")
            .onPreferenceChange(ScrollOffsetKey.self) { v in if (v > 260) != solid { solid = v > 260 } }
            PhoneTopBar(current: kind == .movie ? .movies : .series, solid: solid, pad: pad)
        }
    }
}

struct CatRow: Identifiable {
    let cat: Category
    let items: [Item]
    var id: String { cat.id }
}

/** rejilla de carátulas (miles de títulos: LazyVGrid solo dibuja lo visible) */
struct PosterGrid: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    let items: [Item]
    let size: CGSize
    var withProgress = false

    var body: some View {
        let pad = sidePad(size)
        let cols = max(3, Int((size.width - pad * 2 + 8) / (posterWidth(size) + 8)))
        let w = (size.width - pad * 2 - CGFloat(cols - 1) * 8) / CGFloat(cols)
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(w), spacing: 8), count: cols), spacing: 8) {
                ForEach(items, id: \.key) { it in
                    PosterCard(item: it, width: w, progress: withProgress ? (it.kind == .series ? cloud.seriesProgress(it.id) : cloud.progress(it.key))?.fraction ?? 0 : 0) {
                        state.push(.detail(it))
                    }
                }
            }.padding(.horizontal, pad).padding(.vertical, 12)
        }
    }
}

/** "Ver todo", plataformas y géneros */
struct BrowseView: View {
    @EnvironmentObject var state: AppState
    let title: String
    let kind: Kind?
    let categoryIds: Set<String>
    let platform: Platform?

    var body: some View {
        GeometryReader { g in
            let list: [Item] = {
                if let p = platform {
                    let ids = Platforms.categoriesFor(state.visible(state.movieCats + state.seriesCats), p.kw)
                    return (state.movies + state.series).filter { ids.contains($0.categoryId) }.sorted { $0.added > $1.added }
                }
                let all = state.visibleItems(state.recent(kind == .series ? .series : .movie))
                return categoryIds.isEmpty ? all : all.filter { categoryIds.contains($0.categoryId) }
            }()
            if list.isEmpty { EmptyMessage(text: tr("No hay títulos.")) } else { PosterGrid(items: list, size: g.size) }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/** rejilla completa de "Continuar viendo" o de "Mi lista" */
struct SavedView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    let continueWatching: Bool

    var body: some View {
        GeometryReader { g in
            let list: [Item] = {
                _ = cloud.rev
                if continueWatching {
                    var seen = Set<String>()
                    return cloud.progressList().compactMap { p in state.item(from: p).map { var c = $0; if !p.poster.isEmpty { c.poster = p.poster }; return c } }
                        .filter { seen.insert($0.key).inserted }
                }
                return cloud.favList().filter { $0.kind != .live }
            }()
            if list.isEmpty { EmptyMessage(text: tr(continueWatching ? "Todavía no empezaste nada." : "Agrega películas y series con \"Mi lista\".")) }
            else { PosterGrid(items: list, size: g.size, withProgress: continueWatching) }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(tr(continueWatching ? "Continuar viendo" : "Mi lista"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/** Buscar en películas, series y canales */
struct SearchView: View {
    @EnvironmentObject var state: AppState
    @State private var q = ""
    @State private var shown = ""

    var body: some View {
        GeometryReader { g in
            let ql = shown.trimmed.folded
            let movies = ql.count < 2 ? [] : Array(state.visibleItems(state.movies).filter { $0.name.folded.contains(ql) }.prefix(60))
            let series = ql.count < 2 ? [] : Array(state.visibleItems(state.series).filter { $0.name.folded.contains(ql) }.prefix(60))
            let live = ql.count < 2 ? [] : Array(state.visibleItems(state.live).filter { $0.name.folded.contains(ql) }.prefix(40))
            let pad = sidePad(g.size), pw = posterWidth(g.size)
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if ql.count < 2 { Text(tr("Escribe al menos 2 letras")).foregroundColor(Theme.muted).padding(pad) }
                    else if movies.isEmpty && series.isEmpty && live.isEmpty { Text(tr("Sin resultados para \"%@\"", shown)).foregroundColor(Theme.muted).padding(pad) }
                    ShelfRow(title: tr("Películas"), items: movies, pad: pad) { _, it in PosterCard(item: it, width: pw) { state.push(.detail(it)) } }
                    ShelfRow(title: tr("Series"), items: series, pad: pad) { _, it in PosterCard(item: it, width: pw) { state.push(.detail(it)) } }
                    if !live.isEmpty {
                        Text(tr("Canales")).font(.system(size: 18, weight: .bold)).foregroundColor(.white).padding(.horizontal, pad).padding(.top, 8)
                        ForEach(live, id: \.key) { ch in
                            Button { state.playChannel(ch) } label: {
                                HStack(spacing: 12) {
                                    RemoteImage(url: ch.poster, mode: .fit, maxPixel: 160).frame(width: 56, height: 36).background(Color(hex: 0x222222)).clipShape(RoundedRectangle(cornerRadius: 4))
                                    Text(ch.name).foregroundColor(.white).lineLimit(1)
                                    Spacer()
                                    Image(systemName: "play.circle").foregroundColor(Theme.muted)
                                }.padding(.horizontal, pad).padding(.vertical, 6)
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(tr("Buscar"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: tr("Películas, series o canales"))
        .task(id: q) {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if !Task.isCancelled { shown = q }
        }
    }
}
