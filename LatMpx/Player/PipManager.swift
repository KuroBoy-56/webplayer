import AVKit
import UIKit

/**
 * Imagen en imagen (Picture in Picture). VLCKit 3 no la ofrece en iOS, así que al tocar el botón el mismo
 * video pasa al reproductor de Apple (AVPlayer) en el mismo punto y sale en la ventanita del sistema; el
 * reproductor de VLC se cierra y se puede seguir usando la app. "Volver" en la ventanita reabre el video
 * en la app donde iba; cerrarla guarda el progreso (películas y episodios).
 * AVPlayer abre HLS (.m3u8) y MP4 / M4V / MOV: los canales se pasan a su versión .m3u8; MKV, AVI y TS no.
 */
final class PipManager: NSObject, AVPictureInPictureControllerDelegate {
    static let shared = PipManager()
    static var supported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }

    /** capa del video a pantalla completa mientras arranca la ventanita (de ahí sale la animación) */
    private final class HostView: UIView {
        let playerLayer = AVPlayerLayer()
        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .black
            playerLayer.videoGravity = .resizeAspect
            layer.addSublayer(playerLayer)
        }
        required init?(coder: NSCoder) { nil }
        override func layoutSubviews() { super.layoutSubviews(); playerLayer.frame = bounds }
    }

    private var player: AVPlayer?
    private var host: HostView?
    private var pip: AVPictureInPictureController?
    private var watch: [NSKeyValueObservation] = []
    private var timeout: DispatchWorkItem?
    private var started = false
    private var restoring = false
    private var request: PlayRequest?
    private var index = 0
    private var url = ""
    private weak var state: AppState?
    private var onStarted: (() -> Void)?
    private var onFailed: (() -> Void)?

    var active: Bool { pip != nil }
    /** se está volviendo de la ventanita a la app (ese video no la cierra) */
    var isRestoring: Bool { restoring }

    /**
     * Abre el video en AVPlayer y lo pasa a la ventanita. onStarted: la ventanita ya está en pantalla (se cierra
     * el reproductor de VLC); onFailed: no se pudo (el reproductor de VLC sigue como estaba).
     */
    func start(url: String, at ms: Int64, request: PlayRequest, index: Int, state: AppState,
               onStarted: @escaping () -> Void, onFailed: @escaping () -> Void) {
        stop()
        guard Self.supported, let u = URL(string: url), let window = Self.keyWindow() else { onFailed(); return }
        self.request = request
        self.index = index
        self.url = url
        self.state = state
        self.onStarted = onStarted
        self.onFailed = onFailed
        started = false
        restoring = false

        let asset = AVURLAsset(url: u, options: ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": Net.ua]])
        let p = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        let h = HostView(frame: window.bounds)
        h.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        h.playerLayer.player = p
        window.addSubview(h)
        player = p
        host = h

        guard let c = AVPictureInPictureController(playerLayer: h.playerLayer) else { fail(); return }
        c.delegate = self
        if #available(iOS 14.2, *) { c.canStartPictureInPictureAutomaticallyFromInline = false }
        pip = c
        if ms > 0 && request.kind != .live { p.seek(to: CMTime(value: ms, timescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) }
        p.play()
        PlayerDiag.log("pip: abriendo \(u.host ?? "")")

        // en cuanto el sistema la permite (video listo) se abre la ventanita
        watch = [c.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] c, _ in
            guard c.isPictureInPicturePossible else { return }
            DispatchQueue.main.async { if let s = self, !s.started, s.pip === c { c.startPictureInPicture() } }
        }]
        let t = DispatchWorkItem { [weak self] in
            guard let s = self, !s.started else { return }
            PlayerDiag.log("pip: no arrancó a tiempo")
            s.fail()
        }
        timeout = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: t)
    }

    /** cierra la ventanita (otro video, cerrar sesión) */
    func stop() {
        if let c = pip, c.isPictureInPictureActive { c.stopPictureInPicture() }
        cleanup()
    }

    private func fail() {
        let f = onFailed
        cleanup()
        f?()
    }

    private func cleanup() {
        timeout?.cancel(); timeout = nil
        watch.forEach { $0.invalidate() }; watch = []
        player?.pause()
        host?.playerLayer.player = nil
        host?.removeFromSuperview()
        host = nil
        player = nil
        pip?.delegate = nil
        pip = nil
        onStarted = nil
        onFailed = nil
    }

    /* ---------- delegado ---------- */
    func pictureInPictureControllerDidStartPictureInPicture(_ c: AVPictureInPictureController) {
        started = true
        timeout?.cancel(); timeout = nil
        host?.isHidden = true
        PlayerDiag.log("pip iniciado")
        let f = onStarted
        onStarted = nil
        f?()
    }

    func pictureInPictureController(_ c: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        PlayerDiag.log("pip: falló \(error.localizedDescription)")
        ErrorReport.report("playback", "No se pudo abrir imagen en imagen", detail: error.localizedDescription, screen: "player")
        fail()
    }

    /** "Volver a la app": el video sigue en el reproductor de la app donde iba */
    func pictureInPictureController(_ c: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completion: @escaping (Bool) -> Void) {
        restoring = true
        if var r = request, let st = state {
            let ms = currentMs()
            r = PlayRequest(kind: r.kind, queue: r.queue, index: index, saveTitle: r.saveTitle, savePoster: r.savePoster, category: r.category,
                            closeOnPortrait: false, directUrls: r.directUrls, startAt: r.kind == .live ? 0 : ms)
            DispatchQueue.main.async { st.play = r }
        }
        completion(true)
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ c: AVPictureInPictureController) {
        PlayerDiag.log("pip cerrado")
        saveProgress()
        cleanup()
    }

    /* ---------- progreso ---------- */
    private func currentMs() -> Int64 {
        guard let t = player?.currentTime(), t.isNumeric else { return 0 }
        return Int64(t.seconds * 1000)
    }

    private func saveProgress() {
        guard let r = request, r.kind != .live, r.directUrls.isEmpty, r.queue.indices.contains(index) else { return }
        let q = r.queue[index]
        let pos = currentMs()
        var dur: Int64 = 0
        if let d = player?.currentItem?.duration, d.isNumeric { dur = Int64(d.seconds * 1000) }
        if pos < 5_000 { return }
        Cloud.shared.saveProgress(Progress(key: q.key, title: r.saveTitle.ifEmpty(q.title), label: q.title, poster: r.savePoster.ifEmpty(q.poster),
                                           position: pos, duration: dur, updated: Date().timeIntervalSince1970, url: url, categoryId: r.category), force: true)
    }

    private static func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        return scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
    }
}
