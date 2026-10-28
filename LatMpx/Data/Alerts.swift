import Foundation

/**
 * Aviso del panel al abrir la app (Alertas → api/alerta.php?format=json): bienvenida o vencimiento.
 * Se muestra una vez cada vez que se abre la app (y otra vez tras iniciar sesión).
 */
enum Alerts {
    /// images: todas las imágenes de Alertas del panel, en orden (la primera es image); cambian cada interval s
    struct Alert: Identifiable, Equatable {
        let id = UUID(); let expiry: Bool; let title, message, image, button: String
        var images: [String] = []
        var interval: Int = 3
    }

    private static var shownFor: String?
    static func reset() { shownFor = nil }

    static func forLaunch(_ s: Session) async -> Alert? {
        let key = "\(s.user)@\(s.base)"
        if shownFor == key || !Tenant.shared.alertsEnabled { return nil }
        let url = PanelUrl.api("alerta.php") + "?format=json" + Tenant.query() + "&user=\(urlEnc(s.user))&pass=\(urlEnc(s.pass))&dns=\(urlEnc(s.base))&title=\(urlEnc(s.dnsName))&lang=\(L10n.current)"
        let r = await Net.get(url, timeout: 15)
        guard r.ok, let j = r.json() else { return nil }
        let type = j.s("type")
        guard type == "welcome" || type == "expiry" else { return nil }
        shownFor = key
        let path = j.s("image_path")
        var image = ""
        if type == "welcome" {
            if Rx.has(path, "^img/alertas/[A-Za-z0-9._-]+$") {
                var base = PanelUrl.apiBase
                if base.hasSuffix("api/") { base.removeLast(4) }
                image = base + path
            } else if j.s("image").hasPrefix("http") { image = j.s("image") }
        }
        // todas las imágenes del registro del panel (Alertas), en orden; sin la lista (panel anterior), la de siempre
        var images = type == "welcome" ? (j.a("images") ?? []).compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespaces) }.filter { $0.hasPrefix("http") } : []
        if images.isEmpty && !image.isEmpty { images = [image] }
        let interval = j.i("interval") >= 1 ? j.i("interval") : 3
        return Alert(expiry: type == "expiry", title: j.s("title"), message: j.s("message"), image: images.first ?? "",
                     button: j.s("button").ifEmpty(tr("Entendido")), images: images, interval: interval)
    }
}
