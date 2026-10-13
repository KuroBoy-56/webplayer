import SwiftUI

/**
 * Mis descargas (Cuenta › Mis descargas, y en el inicio de sesión cuando no hay internet).
 * Películas: carátula y título. Series: cada serie abre sus episodios descargados. Se ven sin internet
 * y se pueden eliminar (se borra el archivo del equipo).
 */
struct DownloadsView: View {
    @EnvironmentObject var state: AppState
    @ObservedObject private var dl = Downloads.shared
    /** desde el inicio de sesión: botón para volver */
    var onClose: (() -> Void)?
    @State private var tab = 0
    @State private var openSeries = 0
    @State private var confirm: (String, () -> Void)?

    var body: some View {
        let _ = dl.entries
        VStack(alignment: .leading, spacing: 0) {
            header
            if openSeries != 0, !dl.episodes(openSeries).isEmpty {
                episodes(dl.episodes(openSeries))
            } else {
                HStack(spacing: 8) {
                    Chip(text: "Películas (\(dl.movies.count))", selected: tab == 0) { tab = 0 }
                    Chip(text: "Series (\(dl.series.count))", selected: tab == 1) { tab = 1 }
                }.padding(.horizontal, 14).padding(.vertical, 8)
                if tab == 0 { moviesGrid } else { seriesGrid }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .alert("Eliminar descarga", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })) {
            Button("Eliminar", role: .destructive) { confirm?.1(); confirm = nil }
            Button("Cancelar", role: .cancel) { confirm = nil }
        } message: { Text(confirm?.0 ?? "") }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button {
                if openSeries != 0 { openSeries = 0 } else if let c = onClose { c() } else { state.pop() }
            } label: {
                Image(systemName: "chevron.left").font(.system(size: 20, weight: .semibold)).foregroundColor(.white).frame(width: 44, height: 44)
            }
            let title = openSeries != 0 ? (dl.episodes(openSeries).first?.seriesName ?? "Mis descargas") : "Mis descargas"
            Text(title).font(.system(size: 20, weight: .bold)).foregroundColor(.white).lineLimit(1)
            Spacer()
        }.padding(.horizontal, 6).padding(.top, 6)
    }

    private let cols = [GridItem(.adaptive(minimum: 108), spacing: 10)]

    @ViewBuilder private var moviesGrid: some View {
        let list = dl.movies
        if list.isEmpty {
            EmptyMessage(text: "Aún no descargaste películas.\nEn la ficha de una película toca Descargar.")
        } else {
            ScrollView {
                LazyVGrid(columns: cols, spacing: 14) {
                    ForEach(list) { e in
                        card(Downloads.image(e.poster, e.posterUrl), e.title, e, nil) { tap(e) { state.playDownloads([e], 0) } }
                            onDelete: { confirm = ("¿Eliminar \"\(e.title)\" de este equipo?", { Downloads.shared.delete(e.key) }) }
                    }
                }.padding(14)
            }
        }
    }

    @ViewBuilder private var seriesGrid: some View {
        let list = dl.series
        if list.isEmpty {
            EmptyMessage(text: "Aún no descargaste episodios.\nEn una serie toca el icono de descarga de cada episodio.")
        } else {
            ScrollView {
                LazyVGrid(columns: cols, spacing: 14) {
                    ForEach(list, id: \.0.seriesId) { item in
                        let e = item.0, n = item.1
                        let busy = dl.episodes(e.seriesId).first { $0.state != .done }
                        card(Downloads.image(e.seriesPoster, e.seriesPosterUrl), e.seriesName, busy, "\(n) episodio\(n == 1 ? "" : "s")") { openSeries = e.seriesId }
                            onDelete: { confirm = ("¿Eliminar todos los episodios descargados de \(e.seriesName)?", { Downloads.shared.deleteSeries(e.seriesId) }) }
                    }
                }.padding(14)
            }
        }
    }

    private func episodes(_ eps: [Downloads.Entry]) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(eps) { e in
                    HStack(spacing: 12) {
                        ZStack {
                            RemoteImage(url: Downloads.image(e.poster, e.posterUrl), maxPixel: 400).frame(width: 140, height: 79).clipped()
                            if e.state == .done {
                                Image(systemName: "play.circle.fill").font(.system(size: 28)).foregroundColor(.white.opacity(0.9))
                                if e.duration > 0 && e.position > 0 {
                                    VStack { Spacer(); ProgressBar(value: Double(e.position) / Double(e.duration)).frame(height: 3) }
                                }
                            } else {
                                Color.black.opacity(0.6)
                                if e.state == .failed { Image(systemName: "arrow.clockwise").foregroundColor(.white) }
                                else { Text(Self.label(e)).font(.system(size: 12, weight: .bold)).foregroundColor(.white) }
                            }
                        }.frame(width: 140, height: 79).clipShape(RoundedRectangle(cornerRadius: 4))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("T\(e.season) E\(e.episode)").font(.system(size: 12)).foregroundColor(Theme.muted)
                            Text(e.title).font(.system(size: 14, weight: .semibold)).foregroundColor(.white).lineLimit(2)
                            if e.state == .failed && !e.error.isEmpty { Text(e.error).font(.system(size: 11)).foregroundColor(Color(hex: 0xE87C03)).lineLimit(2) }
                        }
                        Spacer(minLength: 0)
                        Button { confirm = ("¿Eliminar T\(e.season) E\(e.episode) de este equipo?", { Downloads.shared.delete(e.key) }) } label: {
                            Image(systemName: "trash").foregroundColor(Theme.muted).frame(width: 40, height: 40)
                        }.buttonStyle(.plain)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        tap(e) {
                            let done = eps.filter { $0.state == .done }
                            state.playDownloads(done, done.firstIndex(of: e) ?? 0)
                        }
                    }
                }
                Button {
                    let id = openSeries, name = eps.first?.seriesName ?? ""
                    confirm = ("¿Eliminar todos los episodios descargados de \(name)?", { Downloads.shared.deleteSeries(id); openSeries = 0 })
                } label: {
                    Label("Eliminar todos los episodios", systemImage: "trash").foregroundColor(Theme.accent)
                }.padding(14)
            }
        }
    }

    /** terminada: se reproduce; con error: se reintenta; bajando o en espera: nada */
    private func tap(_ e: Downloads.Entry, play: () -> Void) {
        switch e.state {
        case .done: play()
        case .failed: Downloads.shared.retry(e.key)
        default: break
        }
    }

    static func label(_ e: Downloads.Entry) -> String {
        switch e.state {
        case .done: return ""
        case .running: return e.total > 0 ? "\(e.percent) %" : "Descargando…"
        case .queued: return "En espera"
        case .failed: return "Error · tocar para reintentar"
        }
    }

    private func card(_ image: String, _ title: String, _ e: Downloads.Entry?, _ sub: String?, onTap: @escaping () -> Void, onDelete: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topTrailing) {
                Color(hex: 0x222222)
                RemoteImage(url: image, maxPixel: 500)
                if let e = e, e.state != .done {
                    ZStack {
                        Color.black.opacity(0.6)
                        Text(Self.label(e)).font(.system(size: 13, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center).padding(6)
                    }
                    if e.state == .running { VStack { Spacer(); ProgressBar(value: Double(e.percent) / 100).frame(height: 3) } }
                }
                Button(action: onDelete) {
                    Image(systemName: "trash").font(.system(size: 13)).foregroundColor(.white).frame(width: 30, height: 30)
                        .background(Circle().fill(Color.black.opacity(0.65)))
                }.buttonStyle(.plain).padding(4)
            }
            .aspectRatio(2 / 3, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
            .onTapGesture(perform: onTap)
            Text(title).font(.system(size: 13)).foregroundColor(.white).lineLimit(2)
            if let s = sub { Text(s).font(.system(size: 11)).foregroundColor(Theme.muted) }
        }
    }
}
