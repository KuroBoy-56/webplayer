import Foundation

/**
 * Motor de video del panel para iPhone / iPad (api/media_ios.php): convierte a HLS (fMP4) lo que el
 * reproductor de iOS no abre solo (MKV, AVI…), con el video sin tocar y el audio en AAC. Solo si el panel
 * tiene ffmpeg para iOS y el distribuidor lo permite (?do=status).
 */
@MainActor
enum StreamEngine {
    /** respuesta de ?do=status por línea (usuario@servidor): se pregunta una vez por sesión, no en cada video */
    private static var known: (line: String, on: Bool)?

    private static var line: String { Store.session().map { $0.user + "@" + $0.base } ?? "" }

    static func available() async -> Bool {
        // tenant_config dice que el distribuidor no tiene el motor para esta app: ni se pregunta
        if Tenant.shared.brand?.ffmpeg == false { return false }
        let l = line
        if let k = known, k.line == l { return k.on }
        guard let t = await Cloud.shared.lineToken() else { return false }
        // sin respuesta (red): no se guarda, el próximo video vuelve a preguntar
        guard let j = await Net.get(PanelUrl.api("media_ios.php") + "?do=status&token=" + urlEnc(t), timeout: 8).json() else { return false }
        let on = j.b("ffmpeg")
        known = (l, on)
        return on
    }

    /** el motor respondió 503 / 501 (sin permiso o sin ffmpeg): apagado para esta línea, sin más pedidos */
    static func off() {
        PlayerDiag.log("motor del panel no disponible para esta línea")
        known = (line, false)
    }

    /** HLS del video desde el segundo `from` (el reproductor empieza en 0 = ese segundo) */
    static func url(_ video: String, from: Int) async -> String? {
        guard let t = await Cloud.shared.lineToken() else { return nil }
        let u = Data(video.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return PanelUrl.api("media_ios.php") + "?do=hls&token=\(urlEnc(t))&u=\(u)&a=0&t=\(max(0, from))&lang=\(L10n.current)"
    }
}
