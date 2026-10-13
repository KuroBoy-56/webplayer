import AVFoundation
import UniformTypeIdentifiers

/**
 * El reproductor de iOS no pide el video al servidor IPTV: se lo pide a este cargador, que lo baja con
 * URLSession. Así funciona igual con servidores http, https o mixtos:
 * - XUI.one contesta la dirección del video con una redirección a su servidor de carga (a veces de https a
 *   http, con un token que vence). AVPlayer no sigue el salto de https a http; URLSession sí, y cada pedido
 *   vuelve a la dirección original, con un token nuevo.
 * - AVPlayer abre varias conexiones a la vez (principio y final del archivo); las líneas de 1 conexión (las
 *   demos) rechazaban la segunda. Aquí hay una sola conexión con el servidor: el pedido nuevo pasa primero y
 *   el anterior sigue después desde donde iba.
 * Solo para archivos (mp4 / m4v / mov); HLS (m3u8) va directo.
 */
final class StreamLoader: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate {
    static let scheme = "mpxstream"

    /** dirección para AVURLAsset (con el esquema propio, para que AVPlayer la pida aquí) */
    let assetURL: URL
    private let origin: URL
    private let queue = DispatchQueue(label: "mpx.streamloader")
    private var session: URLSession!

    private struct Job {
        let req: AVAssetResourceLoadingRequest
        let task: URLSessionDataTask
        let from: Int64
        /** bytes a saltar cuando el servidor no acepta rangos y manda el archivo desde el principio */
        var skip: Int64 = 0
    }
    private var active: Job?
    private var waiting: [AVAssetResourceLoadingRequest] = []
    private var length: Int64 = 0
    private var ranges = false
    private var mime = ""
    private var closed = false

    init?(_ url: URL) {
        guard let s = url.scheme?.lowercased(), s == "http" || s == "https",
              var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        c.scheme = Self.scheme
        guard let a = c.url else { return nil }
        origin = url
        assetURL = a
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.httpMaximumConnectionsPerHost = 1
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.urlCache = nil
        cfg.timeoutIntervalForRequest = 30
        cfg.httpAdditionalHeaders = ["User-Agent": Net.ua]
        let oq = OperationQueue()
        oq.maxConcurrentOperationCount = 1
        oq.underlyingQueue = queue
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: oq)
    }

    static func handles(_ url: URL) -> Bool {
        guard let s = url.scheme?.lowercased(), s == "http" || s == "https" else { return false }
        return !url.path.lowercased().hasSuffix(".m3u8")
    }

    func attach(_ asset: AVURLAsset) { asset.resourceLoader.setDelegate(self, queue: queue) }

    /** suelta la conexión con el servidor (cerrar el reproductor o pasar al de la app) */
    func close() {
        queue.async {
            self.closed = true
            self.active?.task.cancel()
            self.active = nil
            self.waiting.removeAll()
            self.session.invalidateAndCancel()
        }
    }

    /* ---------- pedidos de AVPlayer ---------- */

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        if closed { return false }
        // una sola conexión: el pedido nuevo pasa primero y el que estaba en curso espera
        if let a = active {
            active = nil
            a.task.cancel()
            waiting.append(a.req)
        }
        start(loadingRequest)
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        waiting.removeAll { $0 === loadingRequest }
        if let a = active, a.req === loadingRequest {
            active = nil
            a.task.cancel()
            next()
        }
    }

    private func start(_ r: AVAssetResourceLoadingRequest) {
        var from: Int64 = 0
        var end = "1"
        if let d = r.dataRequest {
            from = d.currentOffset
            if !d.requestsAllDataToEndOfResource {
                let last = d.requestedOffset + Int64(d.requestedLength) - 1
                if from > last { r.finishLoading(); next(); return }
                end = String(last)
            } else {
                end = ""
            }
        }
        var q = URLRequest(url: origin)
        q.setValue("bytes=\(from)-\(end)", forHTTPHeaderField: "Range")
        let t = session.dataTask(with: q)
        active = Job(req: r, task: t, from: from)
        t.resume()
    }

    /** sigue el pedido que quedó esperando más reciente */
    private func next() {
        guard active == nil, !closed else { return }
        while let r = waiting.popLast() {
            if r.isCancelled || r.isFinished { continue }
            start(r)
            return
        }
    }

    private func finish(_ a: Job, _ error: Error? = nil) {
        if !a.req.isCancelled && !a.req.isFinished {
            if let e = error { a.req.finishLoading(with: e) } else { a.req.finishLoading() }
        }
        next()
    }

    /* ---------- respuestas del servidor ---------- */

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard var a = active, a.task === dataTask else { completionHandler(.cancel); return }
        let h = response as? HTTPURLResponse
        let code = h?.statusCode ?? 0
        let type = (h?.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        // XUI.one con un problema de la línea contesta 200 con una página HTML: no es video
        guard (200..<300).contains(code), !type.hasPrefix("text/") else {
            completionHandler(.cancel)
            active = nil
            finish(a, NSError(domain: "StreamLoader", code: code,
                              userInfo: [NSLocalizedDescriptionKey: "El servidor respondió \(code) \(type)"]))
            return
        }
        if code == 206, let cr = h?.value(forHTTPHeaderField: "Content-Range"),
           let total = cr.split(separator: "/").last.flatMap({ Int64($0.trimmingCharacters(in: .whitespaces)) }) {
            length = total
            ranges = true
        } else if code == 200 {
            if response.expectedContentLength > 0 { length = response.expectedContentLength }
            a.skip = a.from
        }
        if !type.isEmpty { mime = type }
        if let info = a.req.contentInformationRequest {
            info.contentType = uti()
            info.contentLength = length
            info.isByteRangeAccessSupported = ranges
        }
        if a.req.dataRequest == nil {
            // solo pedía los datos del archivo (tipo y tamaño)
            completionHandler(.cancel)
            active = nil
            finish(a)
            return
        }
        active = a
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard var a = active, a.task === dataTask, let d = a.req.dataRequest else { return }
        if a.req.isCancelled { active = nil; dataTask.cancel(); next(); return }
        var chunk = data
        if a.skip > 0 {
            let n = Int(min(Int64(chunk.count), a.skip))
            chunk = chunk.subdata(in: n..<chunk.count)
            a.skip -= Int64(n)
        }
        active = a
        if chunk.isEmpty { return }
        if !d.requestsAllDataToEndOfResource {
            let room = d.requestedOffset + Int64(d.requestedLength) - d.currentOffset
            if Int64(chunk.count) > room { chunk = chunk.subdata(in: 0..<Int(max(room, 0))) }
        }
        if !chunk.isEmpty { d.respond(with: chunk) }
        if !d.requestsAllDataToEndOfResource && d.currentOffset >= d.requestedOffset + Int64(d.requestedLength) {
            active = nil
            dataTask.cancel()
            finish(a)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let a = active, a.task === task else { return }
        active = nil
        if let e = error, (e as? URLError)?.code != .cancelled { finish(a, e) } else { finish(a) }
    }

    /** tipo de archivo para AVPlayer: por la extensión y si no por el tipo que manda el servidor */
    private func uti() -> String {
        switch origin.pathExtension.lowercased() {
        case "mov": return AVFileType.mov.rawValue
        case "m4v": return AVFileType.m4v.rawValue
        case "mp4": return AVFileType.mp4.rawValue
        default: break
        }
        if let t = UTType(mimeType: mime), t.conforms(to: .audiovisualContent) { return t.identifier }
        return AVFileType.mp4.rawValue
    }
}
