import SwiftUI

/** Películas o Series: categorías arriba y rejilla de carátulas. */
struct CatalogView: View {
    @EnvironmentObject var state: AppState
    let kind: Kind
    @State private var cat = ""   // "" = todas
    @State private var q = ""

    var body: some View {
        GeometryReader { g in
            let all = kind == .movie ? state.movies : state.series
            let cats = state.visible(kind == .movie ? state.movieCats : state.seriesCats)
            let blocked = Store.blockedCats
            let ql = q.trimmed.folded
            let list = all.filter { (cat.isEmpty ? !blocked.contains($0.categoryId) : $0.categoryId == cat)
                && (ql.isEmpty || $0.name.folded.contains(ql)) }
                .sorted { $0.added > $1.added }
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(text: "Todas", selected: cat.isEmpty) { cat = "" }
                        ForEach(cats) { c in Chip(text: c.name, selected: cat == c.id) { cat = c.id } }
                    }.padding(.horizontal, sidePad(g.size)).padding(.vertical, 8)
                }
                if state.loading && all.isEmpty { LoadingView(text: "Cargando…") }
                else if list.isEmpty { EmptyMessage(text: q.isEmpty ? "No hay títulos en esta categoría." : "Sin resultados para \"\(q)\".") }
                else { PosterGrid(items: list, size: g.size) }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(kind == .movie ? "Películas" : "Series")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Buscar")
    }
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
                let all = state.visibleItems(kind == .series ? state.series : state.movies)
                let l = categoryIds.isEmpty ? all : all.filter { categoryIds.contains($0.categoryId) }
                return Array(l.sorted { $0.added > $1.added }.prefix(categoryIds.isEmpty ? 200 : 100000))
            }()
            if list.isEmpty { EmptyMessage(text: "No hay títulos.") } else { PosterGrid(items: list, size: g.size) }
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
            if list.isEmpty { EmptyMessage(text: continueWatching ? "Todavía no empezaste nada." : "Agrega películas y series con \"Mi lista\".") }
            else { PosterGrid(items: list, size: g.size, withProgress: continueWatching) }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(continueWatching ? "Continuar viendo" : "Mi lista")
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
                    if ql.count < 2 { Text("Escribe al menos 2 letras").foregroundColor(Theme.muted).padding(pad) }
                    else if movies.isEmpty && series.isEmpty && live.isEmpty { Text("Sin resultados para \"\(shown)\"").foregroundColor(Theme.muted).padding(pad) }
                    ShelfRow(title: "Películas", items: movies, pad: pad) { _, it in PosterCard(item: it, width: pw) { state.push(.detail(it)) } }
                    ShelfRow(title: "Series", items: series, pad: pad) { _, it in PosterCard(item: it, width: pw) { state.push(.detail(it)) } }
                    if !live.isEmpty {
                        Text("Canales").font(.system(size: 18, weight: .bold)).foregroundColor(.white).padding(.horizontal, pad).padding(.top, 8)
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
        .navigationTitle("Buscar")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: "Películas, series o canales")
        .task(id: q) {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if !Task.isCancelled { shown = q }
        }
    }
}
