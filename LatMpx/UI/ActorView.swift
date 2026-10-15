import SwiftUI

/**
 * Actor del elenco (como Android): foto y biografía de TMDB y, debajo, las películas y series del servidor en
 * las que actúa (filmografía de TMDB cruzada con el catálogo; ver Data/Actor.swift).
 */
struct ActorView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    let name: String
    let tmdbId: Int
    let photo: String
    @State private var page: Actor.Page?
    @State private var bioOpen = false

    var body: some View {
        GeometryReader { g in
            let pad = sidePad(g.size)
            let cols = max(3, Int((g.size.width - pad * 2 + 8) / (posterWidth(g.size) + 8)))
            let w = (g.size.width - pad * 2 - CGFloat(cols - 1) * 8) / CGFloat(cols)
            let person = page?.person
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 16) {
                        ZStack {
                            Color(hex: 0x2A2A2A)
                            Text(initials).font(.system(size: 30, weight: .bold)).foregroundColor(Theme.muted)
                            let pic = (person?.photo ?? "").ifEmpty(photo)
                            if !pic.isEmpty { RemoteImage(url: pic, maxPixel: 600) }
                        }.frame(width: 110, height: 165).clipShape(RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 6) {
                            Text(person?.name ?? name).font(.system(size: 24, weight: .black)).foregroundColor(.white)
                            let facts = [person.map { $0.birthday.isEmpty ? "" : tr("Nació el %@", $0.birthday) } ?? "", person?.place ?? ""]
                                .filter { !$0.isEmpty }.joined(separator: " · ")
                            if !facts.isEmpty { Text(facts).font(.system(size: 13)).foregroundColor(Theme.muted) }
                            if let bio = person?.bio, !bio.isEmpty {
                                Button { bioOpen.toggle() } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(bio).font(.system(size: 14)).foregroundColor(Color(hex: 0xDDDDDD)).lineLimit(bioOpen ? nil : 5)
                                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                        Text(tr(bioOpen ? "Ver menos" : "Ver más")).font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                                    }
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    status
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(w), spacing: 8), count: cols), spacing: 8) {
                        ForEach(page?.items ?? [], id: \.key) { it in
                            PosterCard(item: it, width: w, progress: (it.kind == .series ? cloud.seriesProgress(it.id) : cloud.progress(it.key))?.fraction ?? 0) {
                                state.push(.detail(it))
                            }
                        }
                    }
                }.padding(.horizontal, pad).padding(.vertical, 16)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(tmdbId)|\(name)|\(state.movies.count)|\(state.series.count)") {
            page = await Actor.load(name: name, tmdbId: tmdbId, movies: state.visibleItems(state.movies), series: state.visibleItems(state.series))
        }
    }

    private var initials: String { name.split(separator: " ").prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined() }

    @ViewBuilder private var status: some View {
        if let p = page {
            if p.items.isEmpty {
                Text(p.person == nil ? tr("No hay información de este actor.") : tr("No encontramos títulos de %@ en el servidor.", p.person!.name))
                    .font(.system(size: 15)).foregroundColor(Theme.muted).padding(.top, 10)
            } else {
                Text(p.items.count == 1 ? tr("1 título disponible en el servidor") : tr("%d títulos disponibles en el servidor", p.items.count))
                    .font(.system(size: 18, weight: .bold)).foregroundColor(.white).padding(.top, 10)
            }
        } else {
            HStack(spacing: 10) {
                ProgressView().tint(.white)
                Text(tr("Buscando sus títulos en el servidor…")).font(.system(size: 14)).foregroundColor(Theme.muted)
            }.frame(maxWidth: .infinity).padding(.top, 24)
        }
    }
}
