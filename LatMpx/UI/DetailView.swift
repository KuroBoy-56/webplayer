import SwiftUI

/** Ficha de película o serie, como la app de Netflix para celular. */
struct DetailView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    @EnvironmentObject var tenant: Tenant
    @Environment(\.openURL) private var openURL
    let media: Item
    @State private var det: Details?
    @State private var tmdb: Tmdb.Details?
    /** fotos del elenco buscadas en TMDB por nombre (respaldo para el elenco del servidor sin fotos) */
    @State private var photos: [String: String] = [:]
    @State private var season = -1

    var body: some View {
        GeometryReader { g in
            let pad = sidePad(g.size)
            let _ = cloud.rev
            let progress = cloud.progress(media.key)
            let lastEp = media.kind == .series ? cloud.seriesProgress(media.id) : nil
            let seasons = det?.seasons ?? []
            let cur = season >= 0 ? season : defaultSeason(seasons, lastEp)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ZStack(alignment: .bottom) {
                        RemoteImage(url: backdrop, maxPixel: 2560)
                            .frame(width: g.size.width, height: min(g.size.width / 1.6, 460)).clipped()
                        LinearGradient(colors: [Color.black.opacity(0.2), Theme.bg.opacity(0.6), Theme.bg], startPoint: .top, endPoint: .bottom).frame(height: 120)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text(media.name).font(.system(size: 26, weight: .black)).foregroundColor(.white)
                        HStack(spacing: 10) {
                            if media.rating > 0 { Text(String(format: "★ %.1f", media.rating)).font(.system(size: 14, weight: .bold)).foregroundColor(Theme.green) }
                            if !media.year.isEmpty { Text(String(media.year.prefix(4))).foregroundColor(Theme.muted) }
                            if let d = det?.duration, !d.isEmpty { Text(d).foregroundColor(Theme.muted) }
                            if media.kind == .series && !seasons.isEmpty { Text("\(seasons.count) temporada\(seasons.count > 1 ? "s" : "")").foregroundColor(Theme.muted) }
                            Text("HD").font(.system(size: 11, weight: .bold)).foregroundColor(Theme.muted).padding(.horizontal, 4).overlay(RoundedRectangle(cornerRadius: 3).stroke(Theme.muted))
                        }.font(.system(size: 14))
                        if let gnr = det?.genre, !gnr.isEmpty { Text(gnr).font(.system(size: 13)).foregroundColor(Theme.muted) }
                        AppButton(text: playLabel(progress, lastEp, seasons), icon: "play.fill") { play(lastEp, seasons) }
                            .disabled(det == nil)
                        if media.kind == .movie, let p = progress, p.duration > 0 {
                            HStack {
                                ProgressBar(value: p.fraction).frame(height: 3)
                                Text("Quedan \(fmtTime(p.duration - p.position))").font(.system(size: 12)).foregroundColor(Theme.muted)
                            }
                        }
                        let trailer = (tmdb?.trailer ?? "").ifEmpty(det?.trailer ?? "")
                        if !trailer.isEmpty {
                            AppButton(text: "Ver tráiler", icon: "film", primary: false) { openTrailer(trailer) }
                        }
                        let plot = (tmdb?.overview ?? "").ifEmpty(det?.plot ?? "").ifEmpty(media.plot)
                        if !plot.isEmpty { Text(plot).font(.system(size: 14)).foregroundColor(Color(hex: 0xE5E5E5)).fixedSize(horizontal: false, vertical: true) }
                        if det == nil { Text("Cargando información…").foregroundColor(Theme.muted) }
                        if let d = det, !d.director.isEmpty { Text("Dirección: \(d.director)").font(.system(size: 12)).foregroundColor(Theme.muted) }
                        HStack {
                            Spacer()
                            action(cloud.isFav(media.key) ? "checkmark" : "plus", "Mi lista") { Cloud.shared.toggleFav(media) }
                            Spacer()
                            if !trailer.isEmpty { action("film", "Tráiler") { openTrailer(trailer) }; Spacer() }
                            ShareLink(item: "Mira \"\(media.name)\" en \(tenant.nameOr("LatMpx"))") {
                                VStack(spacing: 4) { Image(systemName: "square.and.arrow.up").font(.system(size: 22)); Text("Compartir").font(.system(size: 11)).foregroundColor(Theme.muted) }
                                    .foregroundColor(.white)
                            }
                            Spacer()
                        }.padding(.vertical, 8)
                    }.padding(.horizontal, pad)

                    castRow(pad)

                    if media.kind == .series && !seasons.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) { ForEach(seasons.map { $0.0 }, id: \.self) { n in Chip(text: "Temporada \(n)", selected: n == cur) { season = n } } }
                                .padding(.horizontal, pad).padding(.vertical, 8)
                        }
                        let all = seasons.flatMap { $0.1 }
                        ForEach(seasons.first { $0.0 == cur }?.1 ?? [], id: \.id) { e in
                            EpisodeRow(episode: e, series: media, progress: cloud.progress("series:\(media.id):\(e.id)")?.fraction ?? 0) {
                                state.playEpisode(media, all, all.firstIndex(of: e) ?? 0)
                            }.padding(.horizontal, pad)
                        }
                    }

                    let pool = media.kind == .movie ? state.movies : state.series
                    let similar = Array(pool.filter { $0.categoryId == media.categoryId && $0.id != media.id }.prefix(60).shuffled().prefix(24))
                    ShelfRow(title: "Sugerencias", items: similar, pad: pad) { _, it in
                        PosterCard(item: it, width: posterWidth(g.size)) { state.push(.detail(it)) }
                    }.padding(.top, 16)
                    Spacer(minLength: 40)
                }
            }
            .ignoresSafeArea(edges: .top)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task(id: media.key) {
            guard let s = state.session else { return }
            let d = media.kind == .series ? await Xtream.seriesDetails(s, media) : await Xtream.movieDetails(s, media)
            det = d
            tmdb = await Tmdb.details(type: media.kind == .series ? "tv" : "movie", title: media.name, year: media.year, tmdbId: d.tmdbId)
            let missing = castPeople.filter { $0.2.isEmpty }.map { $0.0 }
            if !missing.isEmpty { photos = await Tmdb.personPhotos(missing) }
        }
    }

    private var backdrop: String {
        for u in [tmdb?.backdrop ?? "", det?.backdrop ?? "", media.backdrop, media.poster] where !u.isEmpty { return u }
        return ""
    }

    /** elenco de TMDB (con fotos) o, si no hay, el que manda el servidor IPTV: (nombre, personaje, foto) */
    private var castPeople: [(String, String, String)] {
        if let c = tmdb?.cast, !c.isEmpty { return c.map { ($0.name, $0.character, $0.profile) } }
        return (det?.cast ?? "").split(separator: ",").map { (String($0).trimmed, "", "") }.filter { !$0.0.isEmpty }
    }

    @ViewBuilder private func castRow(_ pad: CGFloat) -> some View {
        let people: [(String, String, String)] = castPeople.map { ($0.0, $0.1, $0.2.isEmpty ? (photos[$0.0] ?? "") : $0.2) }
        if !people.isEmpty {
            Text("Elenco").font(.system(size: 18, weight: .bold)).foregroundColor(.white).padding(.horizontal, pad).padding(.top, 8)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(people.enumerated()), id: \.offset) { _, p in
                        VStack(spacing: 4) {
                            ZStack {
                                Color(hex: 0x333333)
                                if p.2.isEmpty { Text(String(p.0.prefix(1))).font(.system(size: 22, weight: .bold)).foregroundColor(.white) }
                                else { RemoteImage(url: p.2, maxPixel: 360) }
                            }.frame(width: 60, height: 60).clipShape(Circle())
                            Text(p.0).font(.system(size: 12)).foregroundColor(.white).lineLimit(2).multilineTextAlignment(.center)
                            if !p.1.isEmpty { Text(p.1).font(.system(size: 11)).foregroundColor(Theme.muted).lineLimit(1) }
                        }.frame(width: 80)
                    }
                }.padding(.horizontal, pad).padding(.vertical, 8)
            }
        }
    }

    private func action(_ icon: String, _ label: String, _ f: @escaping () -> Void) -> some View {
        Button(action: f) {
            VStack(spacing: 4) { Image(systemName: icon).font(.system(size: 22)); Text(label).font(.system(size: 11)).foregroundColor(Theme.muted) }.foregroundColor(.white)
        }.buttonStyle(.plain)
    }

    private func defaultSeason(_ seasons: [(Int, [Episode])], _ lastEp: Progress?) -> Int {
        if let eid = lastEp.flatMap({ episodeId($0.key) }), let s = seasons.first(where: { $0.1.contains { $0.id == eid } }) { return s.0 }
        return seasons.first?.0 ?? 1
    }

    private func episodeId(_ key: String) -> Int? {
        let p = key.split(separator: ":")
        return p.count > 2 ? Int(p[2]) : nil
    }

    private func playLabel(_ progress: Progress?, _ lastEp: Progress?, _ seasons: [(Int, [Episode])]) -> String {
        if media.kind == .movie && progress != nil { return "Continuar" }
        if let l = lastEp {
            if let eid = episodeId(l.key), let e = seasons.flatMap({ $0.1 }).first(where: { $0.id == eid }) { return "Continuar T\(e.season) E\(e.num)" }
            return "Continuar"
        }
        return "Reproducir"
    }

    private func play(_ lastEp: Progress?, _ seasons: [(Int, [Episode])]) {
        guard let d = det else { return }
        if media.kind == .movie { state.playMovie(d.item, ext: d.item.ext); return }
        let all = seasons.flatMap { $0.1 }
        if all.isEmpty { state.toast = "Esta serie todavía no tiene episodios"; return }
        let eid = lastEp.flatMap { episodeId($0.key) }
        state.playEpisode(media, all, all.firstIndex { $0.id == eid } ?? 0)
    }

    private func openTrailer(_ id: String) {
        let key = id.contains("youtube.com") || id.contains("youtu.be") ? id : "https://www.youtube.com/watch?v=\(id)"
        if let u = URL(string: key) { openURL(u) }
    }
}

struct EpisodeRow: View {
    let episode: Episode
    let series: Item
    let progress: Double
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack(alignment: .bottom) {
                    RemoteImage(url: episode.image.ifEmpty(series.poster), maxPixel: 400).frame(width: 150, height: 84).clipped()
                    Image(systemName: "play.circle").font(.system(size: 26)).foregroundColor(.white.opacity(0.9)).frame(maxHeight: .infinity)
                    if progress > 0 { ProgressBar(value: progress).frame(height: 3) }
                }.frame(width: 150, height: 84).clipShape(RoundedRectangle(cornerRadius: 4))
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(episode.num). \(episode.title.isEmpty ? "Episodio \(episode.num)" : episode.title)").font(.system(size: 15, weight: .semibold)).foregroundColor(.white).lineLimit(2)
                    if !episode.duration.isEmpty { Text(episode.duration).font(.system(size: 12)).foregroundColor(Theme.muted) }
                    if !episode.plot.isEmpty { Text(episode.plot).font(.system(size: 12)).foregroundColor(Theme.muted).lineLimit(2) }
                }
                Spacer(minLength: 0)
            }.padding(.vertical, 6).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

/** 1:23:45 / 23:45 */
func fmtTime(_ ms: Int64) -> String {
    let t = max(0, ms / 1000)
    let h = t / 3600, m = (t % 3600) / 60, s = t % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}
