import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/** Respuesta HTTP simple: código (0 si no hubo conexión) y cuerpo. */
struct Resp {
    let code: Int
    let data: Data
    var ok: Bool { (200..<300).contains(code) }
    var text: String { String(decoding: data, as: UTF8.self) }
    func json() -> JObj? {
        let t = text.trimmed
        guard t.hasPrefix("{") else { return nil }
        return Json.obj(t)
    }
    func array() -> [Any]? {
        guard text.trimmed.hasPrefix("[") else { return nil }
        return Json.parse(data) as? [Any]
    }
}

enum Net {
    static let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 40
        c.timeoutIntervalForResource = 180
        c.httpAdditionalHeaders = ["User-Agent": ua]
        c.httpMaximumConnectionsPerHost = 6
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        return URLSession(configuration: c)
    }()

    static func exec(_ req: URLRequest) async -> Resp {
        let r = await send(req)
        // sin respuesta con el DNS del equipo y con un DNS elegido: se prueba la IP que da ese DNS
        // (con el nombre en Host); con respuesta se usa tal cual, para no romper servidores que van por nombre
        guard r.code == 0, let u = req.url, let (nu, host) = await SecureDns.rewrite(u) else { return r }
        var alt = req
        alt.url = nu
        alt.setValue(host, forHTTPHeaderField: "Host")
        let r2 = await send(alt)
        return r2.code != 0 ? r2 : r
    }

    private static func send(_ req: URLRequest) async -> Resp {
        do {
            let (data, r) = try await session.data(for: req)
            return Resp(code: (r as? HTTPURLResponse)?.statusCode ?? 0, data: data)
        } catch {
            return Resp(code: 0, data: Data())
        }
    }

    static func get(_ url: String, timeout: TimeInterval = 40) async -> Resp {
        guard let u = URL(string: url) else { return Resp(code: 0, data: Data()) }
        var r = URLRequest(url: u)
        r.timeoutInterval = timeout
        return await exec(r)
    }

    static func postForm(_ url: String, _ fields: [String: String]) async -> Resp {
        guard let u = URL(string: url) else { return Resp(code: 0, data: Data()) }
        var r = URLRequest(url: u)
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        r.httpBody = Data(fields.map { "\(urlEnc($0.key))=\(urlEnc($0.value))" }.joined(separator: "&").utf8)
        return await exec(r)
    }

    static func postJson(_ url: String, _ body: JObj) async -> Resp {
        guard let u = URL(string: url) else { return Resp(code: 0, data: Data()) }
        var r = URLRequest(url: u)
        r.httpMethod = "POST"
        r.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        r.httpBody = Data(Json.string(body).utf8)
        return await exec(r)
    }

    static func obj(_ url: String) async -> JObj? {
        let r = await get(url)
        return r.ok ? r.json() : nil
    }

    static func arr(_ url: String) async -> [Any]? {
        let r = await get(url, timeout: 90)
        return r.ok ? r.array() : nil
    }
}
