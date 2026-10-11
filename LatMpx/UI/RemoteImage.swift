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

    func load(_ url: String, maxPixel: CGFloat) async -> UIImage? {
        let key = url as NSString
        if let i = mem.object(forKey: key) { return i }
        let t: Task<UIImage?, Never> = lock.locked {
            if let t = tasks[url] { return t }
            let t = Task<UIImage?, Never> { [session] in
                guard let u = URL(string: url) else { return nil }
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
        }
    }
}

/** póster del servidor o, si no trae, el de TMDB */
struct ItemPoster: View {
    let item: Item
    @State private var resolved = ""

    var body: some View {
        ZStack {
            Color(hex: 0x2A2A2A)
            if item.poster.isEmpty && resolved.isEmpty {
                Text(item.name).font(.system(size: 13, weight: .semibold)).foregroundColor(.white).multilineTextAlignment(.center).padding(8)
            } else {
                RemoteImage(url: item.poster.isEmpty ? resolved : item.poster)
            }
        }
        .task(id: item.key) {
            if item.poster.isEmpty && item.kind != .live { resolved = await Posters.resolve(item) }
        }
    }
}
