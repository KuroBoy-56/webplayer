import SwiftUI
import UIKit

/**
 * Carátulas y logos con caché en memoria y en disco. Manda Referer del propio servidor (como la web)
 * y reduce cada imagen al tamaño en pantalla para no gastar memoria con miles de pósters.
 */
final class ImageLoader {
    static let shared = ImageLoader()
    private let mem = NSCache<NSString, UIImage>()
    private let session: URLSession
    private var tasks: [String: Task<UIImage?, Never>] = [:]
    private let lock = NSLock()

    private init() {
        mem.countLimit = 600
        let c = URLSessionConfiguration.default
        c.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 400 << 20, diskPath: "images")
        c.requestCachePolicy = .returnCacheDataElseLoad
        c.timeoutIntervalForRequest = 20
        c.httpMaximumConnectionsPerHost = 8
        c.httpAdditionalHeaders = ["User-Agent": Net.ua]
        session = URLSession(configuration: c)
    }

    func cached(_ url: String) -> UIImage? { mem.object(forKey: url as NSString) }

    /** borrado de caché del panel: memoria y disco */
    func clear() {
        mem.removeAllObjects()
        session.configuration.urlCache?.removeAllCachedResponses()
    }

    func load(_ url: String, maxPixel: CGFloat) async -> UIImage? {
        let key = url as NSString
        if let i = mem.object(forKey: key) { return i }
        let t: Task<UIImage?, Never> = lock.locked {
            if let t = tasks[url] { return t }
            let t = Task<UIImage?, Never> { [session] in
                guard let u = URL(string: url) else { return nil }
                // carátula de una descarga (guardada en el equipo, sin internet)
                if u.isFileURL {
                    guard let img = UIImage(contentsOfFile: u.path) else { return nil }
                    return img.preparingForDisplay() ?? img
                }
                var r = URLRequest(url: u)
                if let h = u.host, let s = u.scheme { r.setValue("\(s)://\(h)/", forHTTPHeaderField: "Referer") }
                guard let (d, resp) = try? await session.data(for: r), (resp as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
                      let img = UIImage(data: d) else { return nil }
                let scale = min(1, maxPixel / max(img.size.width, img.size.height, 1))
                if scale < 0.95, let small = img.preparingThumbnail(of: CGSize(width: img.size.width * scale, height: img.size.height * scale)) { return small }
                return img.preparingForDisplay() ?? img
            }
            tasks[url] = t
            return t
        }
        let img = await t.value
        lock.locked { tasks[url] = nil }
        if let img = img { mem.setObject(img, forKey: key) }
        return img
    }
}

struct RemoteImage: View {
    let url: String
    var mode: ContentMode = .fill
    var maxPixel: CGFloat = 600
    /** no se pudo cargar (la carátula pasa a la siguiente dirección) */
    var onFail: (() -> Void)? = nil
    @State private var img: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let i = img ?? (url.isEmpty ? nil : ImageLoader.shared.cached(url)) {
                Image(uiImage: i).resizable().aspectRatio(contentMode: mode)
            } else {
                Color(hex: 0x222222)
            }
        }
        .task(id: url) {
            guard !url.isEmpty else { img = nil; return }
            if let c = ImageLoader.shared.cached(url) { img = c; return }
            img = await ImageLoader.shared.load(url, maxPixel: maxPixel)
            failed = img == nil
            if failed && !Task.isCancelled { onFail?() }
        }
    }
}

/** Imagen con respaldo: si una dirección no carga, la siguiente (caché del panel → img.php → original). */
struct ChainImage: View {
    let sources: [String]
    var mode: ContentMode = .fill
    var maxPixel: CGFloat = 600
    /** ninguna cargó */
    var onAllFailed: (() -> Void)? = nil
    @State private var idx = 0

    var body: some View {
        RemoteImage(url: idx < sources.count ? sources[idx] : "", mode: mode, maxPixel: maxPixel) {
            if idx + 1 < sources.count { idx += 1 } else { onAllFailed?() }
        }
        .onChange(of: sources) { _ in idx = 0 }
    }
}

/**
 * Carátula por la caché del panel como Roku, Vega y Android: la copia del panel (imgc), img.php (con el título busca en
 * TMDB si el servidor no tiene) y la original; si todo falla (o la caché está apagada y el servidor no trae imagen), se
 * busca en TMDB desde el equipo. Mientras tanto se ve el título.
 */
struct ItemPoster: View {
    let item: Item
    @State private var resolved = ""
    @State private var chainFailed = false

    var body: some View {
        let sources = PanelImg.posterSources(item)
        ZStack {
            Color(hex: 0x2A2A2A)
            Text(item.name).font(.system(size: 13, weight: .semibold)).foregroundColor(.white).multilineTextAlignment(.center).padding(8)
            if !sources.isEmpty && !chainFailed {
                ChainImage(sources: sources) { chainFailed = true }
            } else if !resolved.isEmpty {
                RemoteImage(url: resolved)
            }
        }
        .task(id: "\(item.key)|\(chainFailed)") {
            if (sources.isEmpty || chainFailed) && resolved.isEmpty && item.kind != .live { resolved = await Posters.resolve(item) }
        }
        .onChange(of: item.key) { _ in chainFailed = false; resolved = "" }
    }
}
