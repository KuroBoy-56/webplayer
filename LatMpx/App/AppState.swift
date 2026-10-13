import SwiftUI
import Combine

enum Tab: Hashable { case home, series, movies, live, account }

/** Pantallas que se apilan sobre las pestañas. */
enum Route: Hashable {
    case detail(Item)
    case browse(String, Kind, Set<String>)
    case platform(Platform)
    /** "Continuar viendo" (true) o "Mi lista" (false) */
    case saved(Bool)
    case sports
    case search
    /** Cuenta › Mis descargas */
    case downloads
}

/** Entrada de la lista de reproducción (siguiente episodio o canal anterior/siguiente). */
struct QueueEntry: Hashable { let id: Int; let title: String; let key: String; let poster: String; let ext: String }

struct PlayRequest: Identifiable {
    let id = UUID()
    let kind: Kind
    let queue: [QueueEntry]
    let index: Int
    /** título con el que se guarda el progreso en el panel (nombre de la película o de la serie) */
    var saveTitle = ""
    var savePoster = ""
    var category = ""
    /** abierto al girar el teléfono en TV en vivo: volver a vertical lo cierra */
    var closeOnPortrait = false
    /** solo la prueba del simulador: direcciones fijas en lugar de las de la línea */
    var directUrls: [String] = []
    /** seguir desde aquí (ms), por ejemplo al volver del reproductor de iOS */
    var startAt: Int64 = 0
    /** el reproductor de iOS no pudo: va al de la app (VLC) */
    var forceApp = false
    /** descarga del equipo: directUrls es el archivo y no se guarda progreso en el panel */
    var offline = false
}

final class AppState: ObservableObject {
    @Published var session: Session?
    @Published var tab: Tab = .home
    @Published var stacks: [Tab: [Route]] = [:]
    @Published var movieCats: [Category] = []
    @Published var seriesCats: [Category] = []
    @Published var liveCats: [Category] = []
    @Published var movies: [Item] = []
    @Published var series: [Item] = []
    @Published var live: [Item] = []
    @Published var loading = false
    @Published var play: PlayRequest?
    @Published var toast: String?
    /** cambia cada vez que se vuelve del reproductor o cambian las carpetas bloqueadas */
    @Published var refresh = 0

    func path(_ t: Tab) -> Binding<[Route]> {
        Binding(get: { self.stacks[t] ?? [] }, set: { self.stacks[t] = $0 })
    }

    func push(_ r: Route) { stacks[tab, default: []].append(r) }
    func pop() { if !(stacks[tab]?.isEmpty ?? true) { stacks[tab]?.removeLast() } }

    func open(_ t: Tab) {
        if tab == t { stacks[t] = [] }
        tab = t
    }

    func reset() {
        stacks = [:]; tab = .home; play = nil
        movies = []; series = []; live = []; movieCats = []; seriesCats = []; liveCats = []
    }

    /* ---------- títulos por categoría (se calcula una vez por catálogo, no en cada redibujo) ---------- */
    private var groupCache: [Kind: (Int, [String: [Item]])] = [:]

    /** categoría -> títulos, los más nuevos primero */
    func grouped(_ kind: Kind) -> [String: [Item]] {
        let all = kind == .movie ? movies : series
        let sig = all.count &* 31 &+ (all.first?.id ?? 0)
        if let c = groupCache[kind], c.0 == sig { return c.1 }
        var g: [String: [Item]] = [:]
        for it in all.sorted(by: { $0.added > $1.added }) { g[it.categoryId, default: []].append(it) }
        groupCache[kind] = (sig, g)
        return g
    }

    /** carpetas que el control parental no oculta */
    func visible(_ cats: [Category]) -> [Category] {
        let b = Store.blockedCats
        return b.isEmpty ? cats : cats.filter { !b.contains($0.id) }
    }

    func visibleItems(_ items: [Item]) -> [Item] {
        let b = Store.blockedCats
        return b.isEmpty ? items : items.filter { !b.contains($0.categoryId) }
    }

    /** película o serie completa a partir de una entrada de "Continuar viendo" ("movie:12" o "series:5:301") */
    func item(from p: Progress) -> Item? {
        let parts = p.key.split(separator: ":")
        guard parts.count >= 2, let id = Int(parts[1]) else { return nil }
        switch parts[0] {
        case "movie": return movies.first { $0.id == id } ?? Item(id: id, name: p.title, poster: p.poster, kind: .movie, categoryId: p.categoryId)
        case "series": return series.first { $0.id == id } ?? Item(id: id, name: p.title, poster: p.poster, kind: .series, categoryId: p.categoryId)
        default: return nil
        }
    }

    /* ---------- reproducción ---------- */
    func playMovie(_ item: Item, ext: String) {
        play = PlayRequest(kind: .movie, queue: [QueueEntry(id: item.id, title: item.name, key: item.key, poster: item.poster, ext: ext.ifEmpty(item.ext))],
                           index: 0, saveTitle: item.name, savePoster: item.poster, category: item.categoryId)
    }

    func playEpisode(_ series: Item, _ eps: [Episode], _ index: Int) {
        let q = eps.map { e in
            QueueEntry(id: e.id, title: "\(series.name) · T\(e.season) E\(e.num)" + (!e.title.isEmpty && !e.title.contains(series.name) ? " · \(e.title)" : ""),
                       key: "series:\(series.id):\(e.id)", poster: e.image.ifEmpty(series.poster), ext: e.ext)
        }
        play = PlayRequest(kind: .series, queue: q, index: max(0, min(index, q.count - 1)), saveTitle: series.name, savePoster: series.poster, category: series.categoryId)
    }

    /** descargas sin internet: una película o los episodios descargados de una serie (pasa al siguiente) */
    func playDownloads(_ list: [Downloads.Entry], _ index: Int) {
        guard !list.isEmpty else { return }
        let i = max(0, min(index, list.count - 1))
        let q = list.map { e in
            QueueEntry(id: e.streamId, title: e.isMovie ? e.title : "\(e.seriesName) · T\(e.season) E\(e.episode) · \(e.title)",
                       key: e.key, poster: Downloads.image(e.poster, e.posterUrl), ext: e.ext)
        }
        let first = list[i]
        play = PlayRequest(kind: first.isMovie ? .movie : .series, queue: q, index: i, saveTitle: first.isMovie ? first.title : first.seriesName,
                           directUrls: list.map { Downloads.shared.fileURL($0).absoluteString }, offline: true)
    }

    /** canal: la lista de su categoría permite cambiar de canal en el reproductor */
    func playLive(_ channels: [Item], _ index: Int, closeOnPortrait: Bool = false) {
        guard !channels.isEmpty else { return }
        let from = max(0, index - 300), to = min(channels.count, index + 300)
        let win = Array(channels[from..<to])
        play = PlayRequest(kind: .live, queue: win.map { QueueEntry(id: $0.id, title: $0.name, key: $0.key, poster: $0.poster, ext: "") }, index: index - from,
                           closeOnPortrait: closeOnPortrait)
    }

    /** canal dentro de su categoría (o de la lista completa) */
    func playChannel(_ ch: Item) {
        let list = live.filter { $0.categoryId == ch.categoryId }
        let l = list.isEmpty ? [ch] : list
        playLive(l, l.firstIndex { $0.id == ch.id } ?? 0)
    }

    /* ---------- catálogo ---------- */
    private func put(_ kind: Kind, _ cats: [Category], _ items: [Item]) {
        switch kind {
        case .movie: if !cats.isEmpty { movieCats = cats }; movies = items
        case .series: if !cats.isEmpty { seriesCats = cats }; series = items
        case .live: if !cats.isEmpty { liveCats = cats }; live = items
        }
    }

    /** primero la copia del equipo (al instante) y después, en segundo plano, el servidor si la copia es vieja */
    @MainActor
    func loadCatalog(_ s: Session) async {
        let kinds: [Kind] = [.movie, .series, .live]
        for k in kinds { if let c = Xtream.cached(s, k) { put(k, c.0, c.1) } }
        loading = movies.isEmpty
        await withTaskGroup(of: (Kind, ([Category], [Item])?).self) { g in
            for k in kinds {
                g.addTask {
                    if CatalogCache.isStale(s, k) || Xtream.cached(s, k) == nil { return (k, await Xtream.refresh(s, k)) }
                    return (k, nil)
                }
            }
            for await (k, r) in g {
                guard session == s else { continue }
                if let r = r { put(k, r.0, r.1) }
                if k == .movie { loading = false }
            }
        }
        // categorías que faltan (catálogo guardado sin categorías)
        for k in kinds where (k == .movie ? movieCats : k == .series ? seriesCats : liveCats).isEmpty {
            let c = await Xtream.categories(s, k)
            if session == s && !c.isEmpty { put(k, c, k == .movie ? movies : k == .series ? series : live) }
        }
        loading = false
        // sin nada de un tipo: el servidor IPTV no respondió (o la línea no lo trae)
        guard session == s else { return }
        let empty = kinds.filter { (k: Kind) -> Bool in (k == .movie ? movies : k == .series ? series : live).isEmpty }
        if !empty.isEmpty {
            let names = empty.map { $0 == .movie ? "películas" : $0 == .series ? "series" : "canales" }.joined(separator: ", ")
            ErrorReport.report("network", "No se pudo cargar: \(names)", detail: "servidor \(s.dnsName)", screen: "catalogo")
        }
    }
}
