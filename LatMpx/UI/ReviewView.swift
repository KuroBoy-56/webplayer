import SwiftUI
import UIKit

/**
 * Tema de prueba (estilo IBO Player), solo con Omitir y si el panel lo ofrece (Pantalla Falsa): recuadros grandes con
 * Películas a la izquierda, Series al lado y Ajustes (solo «Cerrar sesión»). Reproduce los videos de la carpeta player
 * del panel (como una descarga: sin sesión ni progreso). No guarda nada; en el iPhone siempre en horizontal.
 */
struct ReviewView: View {
    let review: Panel.Review
    let onLogout: () -> Void
    @EnvironmentObject var state: AppState
    private enum Page { case home, movies, series, settings }
    @State private var page: Page = .home

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x0B1026), Color(hex: 0x1B0B2E), Color(hex: 0x05070F)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    if page != .home {
                        Button { page = .home } label: {
                            Image(systemName: "chevron.left").font(.system(size: 20, weight: .bold)).foregroundColor(.white)
                                .frame(width: 44, height: 44).background(Color.white.opacity(0.18)).clipShape(Circle())
                        }
                        .buttonStyle(.plain)
                    }
                    LogoHeader(height: 34)
                    Spacer()
                    if page != .home { Text(title).font(.system(size: 22, weight: .bold)).foregroundColor(.white) }
                }
                switch page {
                case .home: home
                case .movies: videos(review.movies)
                case .series: videos(review.series)
                case .settings: settings
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 12)
        }
        .onAppear { ReviewView.landscape(true) }
        .onDisappear { ReviewView.landscape(false) }
    }

    private var title: String {
        switch page {
        case .movies: return tr("Películas")
        case .series: return tr("Series")
        case .settings: return tr("Ajustes")
        case .home: return ""
        }
    }

    private var home: some View {
        HStack(spacing: 16) {
            tile(tr("Películas"), icon: "film", colors: [Color(hex: 0xE50914), Color(hex: 0x8E0E5C)]) { page = .movies }
            tile(tr("Series"), icon: "tv", colors: [Color(hex: 0x1E88E5), Color(hex: 0x4A148C)]) { page = .series }
            tile(tr("Ajustes"), icon: "gearshape.fill", colors: [Color(hex: 0x455A64), Color(hex: 0x263238)]) { page = .settings }
                .frame(maxWidth: 220)
        }
        .frame(maxHeight: .infinity)
    }

    private func tile(_ label: String, icon: String, colors: [Color], action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 52, weight: .bold))
                Text(label).font(.system(size: 24, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
            .clipShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func videos(_ list: [Panel.ReviewVideo]) -> some View {
        if list.isEmpty {
            Text(tr("Todavía no hay videos de prueba.")).font(.system(size: 17)).foregroundColor(Color(hex: 0xBBBBBB))
            Spacer()
        } else {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 14)], spacing: 14) {
                    ForEach(Array(list.enumerated()), id: \.offset) { i, v in
                        Button { play(v, i) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                ZStack {
                                    Color.black.opacity(0.35)
                                    Image(systemName: "play.circle.fill").font(.system(size: 44)).foregroundColor(.white)
                                }
                                .aspectRatio(16 / 9, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 8))
                                Text(v.name).font(.system(size: 15, weight: .semibold)).foregroundColor(.white).lineLimit(2)
                            }
                            .padding(10).background(Color.white.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var settings: some View {
        VStack(alignment: .leading) {
            Button(action: onLogout) {
                Label(tr("Cerrar sesión"), systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 24).padding(.vertical, 14).background(Color.white.opacity(0.18)).clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            Spacer()
        }
    }

    private func play(_ v: Panel.ReviewVideo, _ i: Int) {
        let ext = (URL(string: v.url)?.pathExtension).flatMap { $0.isEmpty ? nil : $0 } ?? "mp4"
        // como una descarga (offline): la dirección tal cual, sin sesión ni progreso en el panel
        state.play = PlayRequest(kind: .movie, queue: [QueueEntry(id: i, title: v.name, key: "review:\(i)", poster: "", ext: ext)],
                                 index: 0, directUrls: [v.url], offline: true)
    }

    /** iPhone: el tema va siempre en horizontal; al salir vuelve a vertical (iPad gira libre) */
    static func landscape(_ on: Bool) {
        AppDelegate.reviewOpen = on
        guard UIDevice.current.userInterfaceIdiom == .phone,
              let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene else { return }
        scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: on ? .landscape : .portrait)) { _ in }
    }
}
