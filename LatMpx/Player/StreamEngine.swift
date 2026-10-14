import Foundation

/**
 * Motor de video del panel para iPhone / iPad (api/media_ios.php): convierte a HLS (fMP4) lo que el
 * reproductor de iOS no abre solo (MKV, AVI…), con el video sin tocar y el audio en AAC. Solo si el panel
 * tiene ffmpeg para iOS y el distribuidor lo permite (?do=status).
 */
@MainActor
enum StreamEngine {
    private static var known: (on: Bool, at: Date)?

    static func available() async -> Bool {
        if let k = known, Date().timeIntervalSince(k.at) < 600 { return k.on }
        guard let t = await Cloud.shared.lineToken() else { return false }
        let on = await Net.get(PanelUrl.api("media_ios.php") + "?do=status&token=" + urlEnc(t), timeout: 8).json()?.b("ffmpeg") ?? false
        known = (on, Date())
        return on
    }

    /** HLS del video desde el segundo `from` (el reproductor empieza en 0 = ese segundo) */
    static func url(_ video: String, from: Int) async -> String? {
        guard let t = await Cloud.shared.lineToken() else { return nil }
        let u = Data(video.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return PanelUrl.api("media_ios.php") + "?do=hls&token=\(urlEnc(t))&u=\(u)&a=0&t=\(max(0, from))&lang=\(L10n.current)"
    }
}
