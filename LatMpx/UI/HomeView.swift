import SwiftUI

struct HomeView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    @EnvironmentObject var tenant: Tenant
    @State private var offset: CGFloat = 0

    var body: some View {
        GeometryReader { g in
            if state.loading && state.movies.isEmpty {
                LoadingView(text: "Preparando tu catálogo…")
            } else {
                content(g.size)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private func content(_ size: CGSize) -> some View {
        let pad = sidePad(size), pw = posterWidth(size)
        let movies = state.visibleItems(state.movies), series = state.visibleItems(state.series)
        let recentM = Array(movies.sorted { $0.added > $1.added }.prefix(40))
        let recentS = Array(series.sorted { $0.added > $1.added }.prefix(40))
        let top10 = Array(recentM.prefix(300).sorted { $0.rating > $1.rating }.prefix(10))
        let mcats = state.visible(state.movieCats)
        let safe = mcats + state.visible(state.seriesCats)
        let platforms = Platforms.list.filter { !Platforms.categoriesFor(safe, $0.kw).isEmpty }
        let genreRows: [(String, Set<String>, [Item])] = Platforms.genres.compactMap { (label, kw) in
            let ids = Platforms.categoriesFor(mcats, kw)
            if ids.isEmpty { return nil }
            let l = Array(movies.filter { ids.contains($0.categoryId) }.sorted { $0.added > $1.added }.prefix(30))
            return l.count >= 4 ? (label, ids, l) : nil
        }
        let cont = cloud.progressList()
        let favs = cloud.favList().filter { $0.kind != .live }
        let m = Array(recentM.prefix(30).sorted { $0.rating > $1.rating }.prefix(4))
        let se = Array(recentS.prefix(30).sorted { $0.rating > $1.rating }.prefix(3))
        var hero = [Item]()
        for i in 0..<max(m.count, se.count) { if i < m.count { hero.append(m[i]) }; if i < se.count { hero.append(se[i]) } }
        _ = cloud.rev
        _ = state.refresh

        return ZStack(alignment: .top) {
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ScrollOffsetReader(space: "home")
                if !hero.isEmpty { HeroCards(items: hero, width: size.width, topPad: 104).padding(.bottom, 8) }
                else { Color.clear.frame(height: 104) }
                ShelfRow(title: "Continuar viendo para \(state.session?.user ?? "")", items: cont, pad: pad, onViewAll: { state.push(.saved(true)) }) { _, p in
                    if let it = state.item(from: p) { ContinueCard(item: it, progress: p, width: pw) }
                }
                ShelfRow(title: "Mi lista", items: favs, pad: pad, onViewAll: { state.push(.saved(false)) }) { _, it in
                    PosterCard(item: it, width: pw) { state.push(.detail(it)) }
                }
                ShelfRow(title: "Top 10 de hoy", items: top10, pad: pad) { i, it in
                    Top10Card(rank: i + 1, item: it, width: pw * 1.15) { state.push(.detail(it)) }
                }
                ShelfRow(title: "Plataformas", items: platforms, pad: pad) { _, p in
                    PlatformCard(platform: p, width: size.width >= 700 ? 200 : 150) { state.push(.platform(p)) }
                }
                ShelfRow(title: "Películas recién agregadas", items: recentM, pad: pad, onViewAll: { state.push(.browse("Películas recién agregadas", .movie, [])) }) { _, it in
                    PosterCard(item: it, width: pw) { state.push(.detail(it)) }
                }
                ShelfRow(title: "Series recién agregadas", items: recentS, pad: pad, onViewAll: { state.push(.browse("Series recién agregadas", .series, [])) }) { _, it in
                    PosterCard(item: it, width: pw) { state.push(.detail(it)) }
                }
                ForEach(Array(genreRows.enumerated()), id: \.offset) { _, row in
                    ShelfRow(title: row.0, items: row.2, pad: pad, onViewAll: { state.push(.browse(row.0, .movie, row.1)) }) { _, it in
                        PosterCard(item: it, width: pw) { state.push(.detail(it)) }
                    }
                }
                Spacer(minLength: 40)
            }
          }
          .coordinateSpace(name: "home")
          .onPreferenceChange(ScrollOffsetKey.self) { offset = $0 }
          .refreshable { await Cloud.shared.load() }
          PhoneTopBar(current: nil, solid: offset > 260, pad: pad)
        }
    }

}

/** Continuar viendo: carátula con barra roja de avance */
struct ContinueCard: View {
    @EnvironmentObject var state: AppState
    let item: Item
    let progress: Progress
    let width: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            Button { state.push(.detail(item)) } label: {
                ZStack {
                    ItemPoster(item: progress.poster.isEmpty ? item : { var c = item; c.poster = progress.poster; return c }())
                    Image(systemName: "play.fill").font(.system(size: 20)).foregroundColor(.white)
                        .frame(width: 46, height: 46).background(Color.black.opacity(0.6)).clipShape(Circle()).overlay(Circle().stroke(Color.white, lineWidth: 1.5))
                }.frame(width: width, height: width * 1.5).clipped()
            }.buttonStyle(.plain)
            ProgressBar(value: progress.fraction).frame(height: 3)
            Text(progress.label).font(.system(size: 11)).foregroundColor(Theme.muted).lineLimit(1).padding(6).frame(width: width, alignment: .leading)
        }
        .background(Color(hex: 0x1F1F1F)).clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

struct Top10Card: View {
    let rank: Int
    let item: Item
    let width: CGFloat
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(alignment: .bottom, spacing: -14) {
                Text("\(rank)").font(.system(size: width * 0.7, weight: .black)).foregroundColor(.black)
                    .shadow(color: .white, radius: 0, x: 1, y: 1).shadow(color: .white, radius: 0, x: -1, y: -1)
                ItemPoster(item: item).frame(width: width * 0.75, height: width * 1.1).clipShape(RoundedRectangle(cornerRadius: 6))
            }.frame(height: width * 1.1)
        }.buttonStyle(.plain)
    }
}

struct PlatformCard: View {
    let platform: Platform
    let width: CGFloat
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                Color(hex: platform.color)
                if !platform.image.isEmpty { Image(platform.image).resizable().scaledToFill() }
                else { Text(platform.label).font(.system(size: 20, weight: .black)).foregroundColor(.white) }
            }
            .frame(width: width, height: width * 0.56).clipShape(RoundedRectangle(cornerRadius: 8))
        }.buttonStyle(.plain)
    }
}
