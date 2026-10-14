import Foundation

/**
 * Por qué el servidor no entrega un video: se piden sus primeros bytes (como lo haría el reproductor) y se
 * lee la respuesta. XUI.one en «Debug Mode» contesta 200 con una página HTML que trae el motivo
 * («XUI.ONE EXPIRED …»), y ningún reproductor la puede abrir: sin esto solo se veía «No se pudo reproducir».
 */
enum StreamProbe {
    struct Result {
        /** texto para la pantalla, o nil si el servidor sí entrega video (el problema es el formato) */
        let message: String?
        /** detalle para el informe de errores del panel */
        let detail: String
    }

    static func check(_ url: String) async -> Result {
        guard let u = URL(string: url) else { return Result(message: nil, detail: "dirección no válida") }
        let host = u.host ?? ""
        var r = URLRequest(url: u, timeoutInterval: 12)
        r.setValue("bytes=0-4095", forHTTPHeaderField: "Range")
        do {
            let (bytes, resp) = try await Net.session.bytes(for: r)
            defer { bytes.task.cancel() }
            var head = Data()
            for try await b in bytes {
                head.append(b)
                if head.count >= 4096 { break }
            }
            let h = resp as? HTTPURLResponse
            let code = h?.statusCode ?? 0
            let type = (h?.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
            var reached = ""
            if let f = resp.url {
                reached = "\(f.scheme ?? "")://\(f.host ?? "")" + (f.port.map { ":\($0)" } ?? "")
            }
            let got = "HTTP \(code) · \(type.isEmpty ? "sin tipo" : type) · llega a \(reached)"
            if let x = Xtream.xuiError(String(decoding: head, as: UTF8.self)) {
                return Result(message: reason(x), detail: "XUI \(x) · \(got)")
            }
            switch code {
            case 200..<300 where type.contains("text/html"):
                return Result(message: tr("El servidor respondió una página en lugar del video"), detail: got)
            case 200..<300:
                return Result(message: nil, detail: "el servidor sí entrega datos · \(got)")
            case 401, 403:
                return Result(message: tr("El servidor rechazó el video (%d)", code), detail: got)
            case 404, 410:
                return Result(message: tr("El servidor no tiene este video (%d)", code), detail: got)
            case 429:
                return Result(message: tr("El servidor tiene demasiadas conexiones de tu línea (429)"), detail: got)
            case 500...:
                return Result(message: tr("El servidor de video tiene un error (%d)", code), detail: got)
            default:
                return Result(message: tr("El servidor respondió %d", code), detail: got)
            }
        } catch {
            let e = (error as? URLError)?.code ?? .unknown
            let msg: String
            switch e {
            case .cannotFindHost, .dnsLookupFailed:
                msg = tr("No se encuentra el servidor de video (%@). Prueba otro DNS en Ajustes", host)
            case .timedOut, .cannotConnectToHost, .networkConnectionLost:
                msg = tr("El servidor de video (%@) no responde", host)
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot:
                msg = tr("Falla la conexión segura (https) con %@", host)
            case .notConnectedToInternet:
                msg = tr("Sin conexión a internet")
            default:
                msg = tr("No hay conexión con el servidor de video (%@)", host)
            }
            return Result(message: msg, detail: "\(error.localizedDescription) · \(u.scheme ?? "")://\(host)")
        }
    }

    /** motivos de XUI.one al pedir un video */
    static func reason(_ code: String) -> String {
        switch code {
        case "INVALID_CREDENTIALS", "EXPIRED", "BANNED", "DISABLED": return Xtream.xuiMessage(code)
        case "USER_ALREADY_CONNECTED", "MAX_CONNECTIONS", "CONNECTION_LIMIT":
            return tr("Tu línea ya se está usando en otro equipo (límite de conexiones)")
        case "NOT_IN_BOUQUET": return tr("Tu línea no incluye este contenido")
        case "USER_DISALLOW_EXT": return tr("Tu línea no permite este formato de video")
        case "NOT_IN_ALLOWED_COUNTRY": return tr("El servidor no permite ver desde tu país")
        case "DEVICE_NOT_ALLOWED", "USER_AGENT_BAN", "UA_BLOCKED": return tr("El servidor no permite este equipo")
        case "IP_BLOCKED", "ISP_BLOCKED", "ASN_BLOCKED", "PROXY_DETECT", "HOSTING_DETECT", "VPN_DETECT":
            return tr("El servidor bloquea tu red (%@)", code)
        case "STREAM_OFFLINE", "NO_SERVERS_AVAILABLE", "STREAM_NOT_FOUND":
            return tr("Este contenido no está disponible ahora en el servidor")
        default: return tr("El servidor rechazó el video (%@)", code)
        }
    }
}
