import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/**
 * DNS elegido por el usuario (botón "DNS", igual que Android). iOS no deja a una app cambiar el DNS del
 * sistema sin un permiso especial de Apple, así que la app resuelve ella misma los nombres de los
 * servidores IPTV con DNS sobre HTTPS (RFC 8484) y se conecta a la IP con el nombre original en el
 * encabezado Host. Solo para direcciones http (las https —panel, TMDB— siguen con el DNS del equipo).
 * Si el DNS elegido no responde se usa el del equipo, para no dejar la app sin conexión.
 */
enum SecureDns {
    struct Option: Hashable, Identifiable {
        let key, label, note, endpoint: String
        var id: String { key }
    }

    static let options: [Option] = [
        Option(key: "auto", label: "Automático", note: "El DNS de tu red (recomendado)", endpoint: ""),
        Option(key: "cloudflare", label: "Cloudflare", note: "Rápido y privado", endpoint: "https://cloudflare-dns.com/dns-query"),
        Option(key: "google", label: "Google", note: "Estable en todo el mundo", endpoint: "https://dns.google/dns-query"),
        Option(key: "quad9", label: "Quad9", note: "Bloquea sitios peligrosos", endpoint: "https://dns.quad9.net/dns-query"),
        Option(key: "adguard", label: "AdGuard", note: "Sin rastreo ni anuncios", endpoint: "https://dns.adguard-dns.com/dns-query"),
        Option(key: "nextdns", label: "NextDNS", note: "Anti-bloqueo geográfico", endpoint: "https://dns.nextdns.io/dns-query"),
        Option(key: "opendns", label: "OpenDNS", note: "Filtro de Cisco", endpoint: "https://doh.opendns.com/dns-query"),
    ]

    static var current: Option { options.first { $0.key == Store.dns } ?? options[0] }

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 6
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()
    private static let lock = NSLock()
    private static var cache: [String: (String, Double)] = [:]

    static func select(_ key: String) {
        Store.dns = key
        lock.locked { cache.removeAll() }
    }

    static func isIp(_ host: String) -> Bool {
        let p = host.split(separator: ".")
        return (p.count == 4 && p.allSatisfy { UInt8($0) != nil }) || host.contains(":")
    }

    /** IPv4 del nombre con el DNS elegido; nil con "Automático" o si no responde */
    static func resolve(_ host: String) async -> String? {
        let opt = current
        if opt.endpoint.isEmpty || host.isEmpty || isIp(host) { return nil }
        let k = opt.key + "|" + host.lowercased()
        let now = Date().timeIntervalSince1970
        if let c = lock.locked({ cache[k] }), c.1 > now { return c.0 }
        let q = query(host).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        guard let u = URL(string: opt.endpoint + "?dns=" + q) else { return nil }
        var r = URLRequest(url: u)
        r.setValue("application/dns-message", forHTTPHeaderField: "Accept")
        guard let (d, resp) = try? await session.data(for: r), (resp as? HTTPURLResponse)?.statusCode == 200,
              let ip = firstA(d) else { return nil }
        lock.locked { cache[k] = (ip, now + 600) }
        return ip
    }

    /** misma dirección con la IP del DNS elegido (y el nombre para el encabezado Host), o nil si no aplica */
    static func rewrite(_ url: URL) async -> (URL, String)? {
        guard url.scheme?.lowercased() == "http", let host = url.host, let ip = await resolve(host),
              var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        c.host = ip
        guard let nu = c.url else { return nil }
        return (nu, url.port.map { "\(host):\($0)" } ?? host)
    }

    /** direcciones para el reproductor: primero por la IP del DNS elegido y después la original */
    static func playable(_ urls: [String]) async -> [String] {
        var out = [String]()
        for s in urls {
            if let u = URL(string: s), let (nu, _) = await rewrite(u) { out.append(nu.absoluteString) }
            out.append(s)
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0).inserted }
    }

    /* ---------- mensaje DNS (pregunta A) ---------- */
    static func query(_ host: String) -> Data {
        var d = Data([0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        for label in host.split(separator: ".") {
            let b = Array(label.utf8.prefix(63))
            d.append(UInt8(b.count)); d.append(contentsOf: b)
        }
        d.append(contentsOf: [0x00, 0x00, 0x01, 0x00, 0x01])
        return d
    }

    /** primera respuesta A de un mensaje DNS */
    static func firstA(_ d: Data) -> String? {
        let b = [UInt8](d)
        guard b.count >= 12 else { return nil }
        let qd = Int(b[4]) << 8 | Int(b[5]), an = Int(b[6]) << 8 | Int(b[7])
        var i = 12
        func skipName() -> Bool {
            while i < b.count {
                let l = Int(b[i])
                if l == 0 { i += 1; return true }
                if l & 0xC0 == 0xC0 { i += 2; return true }
                i += l + 1
            }
            return false
        }
        for _ in 0..<qd { guard skipName() else { return nil }; i += 4 }
        for _ in 0..<an {
            guard skipName(), i + 10 <= b.count else { return nil }
            let type = Int(b[i]) << 8 | Int(b[i + 1])
            let len = Int(b[i + 8]) << 8 | Int(b[i + 9])
            i += 10
            guard i + len <= b.count else { return nil }
            if type == 1 && len == 4 { return "\(b[i]).\(b[i + 1]).\(b[i + 2]).\(b[i + 3])" }
            i += len
        }
        return nil
    }
}
