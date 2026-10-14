import Foundation
import Combine

/**
 * Descargas para ver sin internet. Todo queda dentro de la app: los archivos van a su carpeta privada
 * (Application Support/Downloads, fuera de la copia de iCloud, no se ven en Archivos) y la dirección del
 * servidor nunca se muestra. Usa una sesión de URLSession en segundo plano: la descarga sigue aunque
 * la app quede suspendida, y si se corta se reanuda donde iba (resumeData).
 */
final class Downloads: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = Downloads()
    static let sessionId = "com.latmpx.player.downloads"

    enum State: String, Codable { case queued, running, done, failed }

    struct Entry: Codable, Identifiable, Equatable {
        var id: String { key }
        let key: String
        /** "movie" o "series" (episodio de seriesId) */
        let kind: String
        let streamId: Int
        let title: String
        let ext: String
        var url: String
        let posterUrl: String
        var poster = ""
        var seriesId = 0
        var seriesName = ""
        var seriesPosterUrl = ""
        var seriesPoster = ""
        var season = 0
        var episode = 0
        let file: String
        var size: Int64 = 0
        var total: Int64 = 0
        var state: State = .queued
        var error = ""
        var position: Int64 = 0
        var duration: Int64 = 0
        var added: Double = Date().timeIntervalSince1970

        var percent: Int { total > 0 ? Int(min(100, max(0, size * 100 / total))) : 0 }
        var isMovie: Bool { kind == "movie" }
    }

    @Published private(set) var entries: [Entry] = []
    /** lo que manda iOS al terminar descargas con la app cerrada (AppDelegate) */
    var backgroundDone: (() -> Void)?

    private let lock = NSLock()
    private var lastSave = Date.distantPast
    private var lastPublish = Date.distantPast
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
        c.sessionSendsLaunchEvents = true
        c.isDiscretionary = false
        c.allowsCellularAccess = true
        c.httpMaximumConnectionsPerHost = 1 // una a la vez por servidor: las demás esperan su turno
        c.timeoutIntervalForRequest = 60
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    static var dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var d = base.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        var v = URLResourceValues(); v.isExcludedFromBackup = true
        try? d.setResourceValues(v)
        return d
    }()

    /** al abrir la app: el índice guardado y las descargas que siguen vivas en el sistema */
    func boot() {
        load()
        session.getAllTasks { [weak self] tasks in
            guard let self = self else { return }
            let alive = Set(tasks.compactMap { $0.taskDescription })
            self.mutate { list in
                for i in list.indices where (list[i].state == .running || list[i].state == .queued) && !alive.contains(list[i].key) {
                    list[i].state = .failed
                    list[i].error = tr("Se interrumpió. Toca para seguir.")
                }
            }
        }
    }

    /* ---------- consulta ---------- */

    /** la lista al día (entries llega a las pantallas un instante después) */
    func all() -> [Entry] { lock.lock(); defer { lock.unlock() }; return store }
    func get(_ key: String) -> Entry? { lockedGet(key) }
    var movies: [Entry] { all().filter { $0.isMovie }.sorted { $0.added > $1.added } }
    func episodes(_ seriesId: Int) -> [Entry] {
        all().filter { !$0.isMovie && $0.seriesId == seriesId }.sorted { ($0.season, $0.episode) < ($1.season, $1.episode) }
    }
    /** series con algo descargado: (el episodio más reciente para el nombre y la carátula, cantidad) */
    var series: [(Entry, Int)] {
        Dictionary(grouping: all().filter { !$0.isMovie }, by: { $0.seriesId })
            .compactMap { _, eps in eps.max { $0.added < $1.added }.map { ($0, eps.count) } }
            .sorted { $0.0.added > $1.0.added }
    }
    func fileURL(_ e: Entry) -> URL { Self.dir.appendingPathComponent(e.file) }
    static func image(_ path: String, _ fallback: String) -> String { path.isEmpty ? fallback : URL(fileURLWithPath: path).absoluteString }

    /** HLS (.m3u8) no es un solo archivo: no se descarga */
    static func canDownload(_ ext: String) -> Bool { ext.lowercased() != "m3u8" }

    /* ---------- agregar / borrar ---------- */

    private static func safe(_ s: String) -> String { String(s.map { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" ? $0 : "_" }) }

    func addMovie(_ s: Session, _ item: Item, ext: String) {
        let e = ext.ifEmpty(item.ext).ifEmpty("mp4")
        add(Entry(key: "movie:\(item.id)", kind: "movie", streamId: item.id, title: item.name, ext: e, url: Xtream.movieUrl(s, item.id, e),
                  posterUrl: item.poster, file: Self.safe("movie_\(item.id)") + "." + Self.safe(e)))
    }

    func addEpisode(_ s: Session, _ series: Item, _ ep: Episode) {
        let e = ep.ext.ifEmpty("mp4")
        add(Entry(key: "series:\(series.id):\(ep.id)", kind: "series", streamId: ep.id, title: ep.title.ifEmpty(tr("Episodio %d", ep.num)), ext: e,
                  url: Xtream.episodeUrl(s, ep.id, e), posterUrl: ep.image.ifEmpty(series.poster), seriesId: series.id, seriesName: series.name,
                  seriesPosterUrl: series.poster, season: ep.season, episode: ep.num, file: Self.safe("ep_\(series.id)_\(ep.id)") + "." + Self.safe(e)))
    }

    private func add(_ e: Entry) {
        if let old = get(e.key) {
            if old.state == .failed { retry(old.key) }
            return
        }
        mutate { $0.append(e) }
        start(e, resume: nil)
        Task { await posters(e) }
    }

    /** una descarga que falló sigue donde se quedó */
    func retry(_ key: String) {
        guard let e = get(key), e.state == .failed else { return }
        let resume = try? Data(contentsOf: resumeFile(e))
        try? FileManager.default.removeItem(at: resumeFile(e))
        mutate { list in if let i = list.firstIndex(where: { $0.key == key }) { list[i].state = .queued; list[i].error = "" } }
        start(e, resume: resume)
        if e.poster.isEmpty { Task { await posters(e) } }
    }

    private func start(_ e: Entry, resume: Data?) {
        let task: URLSessionDownloadTask
        if let r = resume {
            task = session.downloadTask(withResumeData: r)
        } else {
            guard let u = URL(string: e.url) else { fail(e.key, tr("Dirección no válida")); return }
            var req = URLRequest(url: u)
            req.setValue(Net.ua, forHTTPHeaderField: "User-Agent")
            task = session.downloadTask(with: req)
        }
        task.taskDescription = e.key
        task.resume()
    }

    /** quita la descarga y su archivo (también la que se está bajando) */
    func delete(_ key: String) {
        guard let e = get(key) else { return }
        session.getAllTasks { tasks in tasks.filter { $0.taskDescription == key }.forEach { $0.cancel() } }
        mutate { $0.removeAll { $0.key == key } }
        let fm = FileManager.default
        try? fm.removeItem(at: fileURL(e))
        try? fm.removeItem(at: resumeFile(e))
        if !e.poster.isEmpty { try? fm.removeItem(atPath: e.poster) }
        // la carátula de la serie se borra con su último episodio
        if !e.isMovie, !e.seriesPoster.isEmpty, episodes(e.seriesId).isEmpty { try? fm.removeItem(atPath: e.seriesPoster) }
    }

    func deleteSeries(_ seriesId: Int) { episodes(seriesId).forEach { delete($0.key) } }

    /** donde se dejó (para seguir viendo sin internet) */
    func savePosition(_ key: String, _ pos: Int64, _ dur: Int64) {
        mutate { list in if let i = list.firstIndex(where: { $0.key == key }) { list[i].position = pos; list[i].duration = dur } }
    }

    /* ---------- URLSession ---------- */

    func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten w: Int64, totalBytesExpectedToWrite x: Int64) {
        guard let key = t.taskDescription else { return }
        mutate(save: false) { list in
            if let i = list.firstIndex(where: { $0.key == key }) { list[i].state = .running; list[i].size = w; list[i].total = max(x, 0) }
        }
    }

    func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let key = t.taskDescription, let e = get(key) else { return }
        if let h = t.response as? HTTPURLResponse, !(200...299).contains(h.statusCode) {
            fail(key, h.statusCode == 401 || h.statusCode == 403 ? tr("El servidor no permitió la descarga (%d)", h.statusCode) : tr("Error del servidor (%d)", h.statusCode))
            return
        }
        // el archivo temporal hay que moverlo antes de salir de este método
        let dest = fileURL(e)
        try? FileManager.default.removeItem(at: dest)
        do {
            try FileManager.default.moveItem(at: location, to: dest)
            let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64) ?? 0
            mutate { list in
                if let i = list.firstIndex(where: { $0.key == key }) { list[i].state = .done; list[i].size = size; list[i].total = size; list[i].error = "" }
            }
        } catch {
            fail(key, tr("No se pudo guardar el archivo (¿espacio en el equipo?)"))
        }
    }

    func urlSession(_ s: URLSession, task t: URLSessionTask, didCompleteWithError error: Error?) {
        guard let key = t.taskDescription, let err = error as NSError? else { return }
        if err.code == NSURLErrorCancelled && lockedGet(key) == nil { return } // se borró
        if let r = (error as? URLError)?.downloadTaskResumeData, let e = lockedGet(key) { try? r.write(to: resumeFile(e)) }
        let msg = err.code == NSURLErrorNotConnectedToInternet || err.code == NSURLErrorNetworkConnectionLost
            ? tr("Sin conexión. Toca para seguir.") : (err.localizedDescription.isEmpty ? tr("No se pudo descargar") : err.localizedDescription)
        fail(key, msg)
        ErrorReport.report("error", "Descarga fallida", detail: "\(key) · \(err.code) \(err.localizedDescription)", screen: "downloads")
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession s: URLSession) {
        DispatchQueue.main.async { [weak self] in self?.backgroundDone?(); self?.backgroundDone = nil }
    }

    /* ---------- estado ---------- */

    private func resumeFile(_ e: Entry) -> URL { Self.dir.appendingPathComponent(e.file + ".resume") }

    private func fail(_ key: String, _ msg: String) {
        mutate { list in if let i = list.firstIndex(where: { $0.key == key }) { list[i].state = .failed; list[i].error = msg } }
    }

    /** carátulas guardadas en el equipo (sin internet no se pueden pedir) */
    private func posters(_ e: Entry) async {
        func fetch(_ url: String, _ name: String) async -> String {
            let f = Self.dir.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: f.path) { return f.path }
            guard !url.isEmpty, let u = URL(string: url), let res = try? await URLSession.shared.data(from: u) else { return "" }
            let code = (res.1 as? HTTPURLResponse)?.statusCode ?? 200
            guard code < 300, !res.0.isEmpty, (try? res.0.write(to: f)) != nil else { return "" }
            return f.path
        }
        let p = await fetch(e.posterUrl, Self.safe("img_" + e.key) + ".jpg")
        let sp = e.isMovie ? "" : await fetch(e.seriesPosterUrl, "series_\(e.seriesId).jpg")
        mutate { list in if let i = list.firstIndex(where: { $0.key == e.key }) { list[i].poster = p; list[i].seriesPoster = sp } }
    }

    private var store: [Entry] = []
    private func lockedGet(_ key: String) -> Entry? { lock.lock(); defer { lock.unlock() }; return store.first { $0.key == key } }

    /** cambia la lista (desde cualquier hilo), la guarda y avisa a las pantallas */
    private func mutate(save: Bool = true, _ f: (inout [Entry]) -> Void) {
        lock.lock()
        f(&store)
        let snapshot = store
        let now = Date()
        let doSave = save || now.timeIntervalSince(lastSave) > 5
        if doSave { lastSave = now }
        let publish = save || now.timeIntervalSince(lastPublish) > 0.7
        if publish { lastPublish = now }
        lock.unlock()
        if doSave, let d = try? JSONEncoder().encode(snapshot) { try? d.write(to: Self.dir.appendingPathComponent("index.json"), options: .atomic) }
        if publish { DispatchQueue.main.async { self.entries = snapshot } }
    }

    private func load() {
        guard let d = try? Data(contentsOf: Self.dir.appendingPathComponent("index.json")),
              var list = try? JSONDecoder().decode([Entry].self, from: d) else { return }
        // un archivo terminado que ya no está (borrado por el sistema) no se muestra
        list.removeAll { $0.state == .done && !FileManager.default.fileExists(atPath: fileURL($0).path) }
        lock.lock(); store = list; lock.unlock()
        entries = list
    }
}
