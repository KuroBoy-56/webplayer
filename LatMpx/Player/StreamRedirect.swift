import Foundation

/**
 * Servidores mixtos: XUI.one contesta la dirección del video (https://servidor/movie/…) con una redirección a
 * su servidor de carga por http (http://IP:80/…?token=…). Ni VLC ni el reproductor de iOS siguen un salto de
 * https a http («insecure redirect»), así que no abría ningún video aunque el servidor sí lo entregaba.
 * La app sigue ella misma las redirecciones (sin descargar el video) y, si hay un salto de https a http, le
 * da al reproductor esa dirección final. Sin salto inseguro la dirección queda igual.
 */
enum StreamRedirect {
    private final class Stop: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 6
        c.httpAdditionalHeaders = ["User-Agent": Net.ua]
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c, delegate: Stop(), delegateQueue: nil)
    }()

    /** adónde manda el servidor principal (sin seguir el salto: el servidor del video no se toca); nil = no redirige */
    static func firstHop(_ url: String) async -> String? {
        guard let u = URL(string: url), let (bytes, resp) = try? await session.bytes(for: URLRequest(url: u)) else { return nil }
        bytes.task.cancel()
        guard let h = resp as? HTTPURLResponse, (300..<400).contains(h.statusCode),
              let loc = h.value(forHTTPHeaderField: "Location") else { return nil }
        return URL(string: loc, relativeTo: u)?.absoluteString
    }

    static func resolve(_ url: String) async -> String {
        guard var cur = URL(string: url), let s = cur.scheme?.lowercased(), s == "http" || s == "https" else { return url }
        for _ in 0..<6 {
            guard let (bytes, resp) = try? await session.bytes(for: URLRequest(url: cur)) else { return url }
            // el video no se descarga: solo interesa la respuesta (redirección o no)
            bytes.task.cancel()
            guard let h = resp as? HTTPURLResponse, (300..<400).contains(h.statusCode),
                  let loc = h.value(forHTTPHeaderField: "Location"),
                  let next = URL(string: loc, relativeTo: cur)?.absoluteURL else { return url }
            if cur.scheme?.lowercased() == "https" && next.scheme?.lowercased() == "http" {
                PlayerDiag.log("redirección https → http: \(next.host ?? "")")
                return next.absoluteString
            }
            cur = next
        }
        return url
    }
}
