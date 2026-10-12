import AVKit
import UIKit

/** El reproductor de iOS presentado a pantalla completa; avisa cuando el usuario lo cierra con "Listo". */
private final class NativePlayerController: AVPlayerViewController {
    var onClose: (() -> Void)?
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { onClose?() }
    }
}

/**
 * Botón "Reproductor de iOS" del reproductor: el video pasa al reproductor de Apple (AVPlayerViewController)
 * en el mismo punto, con su propia imagen en imagen (botón o al salir con Inicio), AirPlay y controles.
 * Si ese reproductor no puede abrir el video, la app vuelve sola a su reproductor donde iba (nunca queda en negro).
 * Abre HLS (.m3u8) y MP4 / M4V / MOV: los canales se pasan a su versión .m3u8; MKV, AVI y TS no.
 */
final class NativePlayer: NSObject, AVPlayerViewControllerDelegate {
    static let shared = NativePlayer()

    private var vc: NativePlayerController?
    private var watch: [NSKeyValueObservation] = []
    private var timeout: DispatchWorkItem?
    private var pipActive = false
    private var request: PlayRequest?
    private var index = 0
    private var url = ""
    private weak var state: AppState?

    var active: Bool { vc != nil }

    func open(url: String, at ms: Int64, request: PlayRequest, index: Int, state: AppState) {
        close(save: false)
        guard let u = URL(string: url), let top = Self.topController() else { backToApp(ms, "No se pudo abrir el reproductor de iOS"); return }
        self.request = request
        self.index = index
        self.url = url
        self.state = state

        let asset = AVURLAsset(url: u, options: ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": Net.ua]])
        let item = AVPlayerItem(asset: asset)
        let p = AVPlayer(playerItem: item)
        let c = NativePlayerController()
        c.player = p
        c.delegate = self
        c.allowsPictureInPicturePlayback = true
        if #available(iOS 14.2, *) { c.canStartPictureInPictureAutomaticallyFromInline = true }
        c.modalPresentationStyle = .fullScreen
        c.overrideUserInterfaceStyle = .dark
        c.onClose = { [weak self] in self?.closedByUser() }
        vc = c
        AppDelegate.playerOpen = true

        watch = [
            item.observe(\.status, options: [.new]) { [weak self] it, _ in
                guard it.status == .failed else { return }
                let err = it.error?.localizedDescription ?? ""
                DispatchQueue.main.async { self?.failed(err) }
            },
            p.observe(\.timeControlStatus, options: [.new]) { [weak self] pl, _ in
                guard pl.timeControlStatus == .playing else { return }
                DispatchQueue.main.async {
                    self?.timeout?.cancel()
                    PlayerDiag.log("nativo: reproduciendo")
                }
            },
        ]
        // si en 25 s no arrancó (servidor que no responde a este reproductor), se vuelve al de la app
        let t = DispatchWorkItem { [weak self] in
            guard let s = self, s.vc === c, p.timeControlStatus != .playing, !s.pipActive else { return }
            s.failed("sin respuesta")
        }
        timeout = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: t)

        if ms > 0 && request.kind != .live { p.seek(to: CMTime(value: ms, timescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) }
        PlayerDiag.log("nativo: abriendo \(u.host ?? "")")
        top.present(c, animated: true) { p.play() }
    }

    /** cierra el reproductor de iOS y su ventanita (otro video, cerrar sesión) */
    func close(save: Bool = true) {
        if save { saveProgress() }
        let c = vc
        cleanup()
        if let c = c, c.presentingViewController != nil { c.dismiss(animated: false) }
    }

    private func cleanup() {
        timeout?.cancel(); timeout = nil
        watch.forEach { $0.invalidate() }; watch = []
        vc?.onClose = nil
        vc?.player?.pause()
        vc?.player = nil
        vc?.delegate = nil
        vc = nil
        pipActive = false
    }

    /** "Listo" del reproductor de iOS */
    private func closedByUser() {
        guard !pipActive, vc != nil else { return }
        PlayerDiag.log("nativo: cerrado")
        saveProgress()
        cleanup()
        restore()
    }

    /** el reproductor de iOS no pudo con este video: de vuelta al de la app, donde iba */
    private func failed(_ err: String) {
        guard vc != nil else { return }
        PlayerDiag.log("nativo: falló \(err)")
        ErrorReport.report("playback", "El reproductor de iOS no pudo abrir el video", detail: err, screen: "player")
        let ms = currentMs()
        let c = vc
        cleanup()
        if let c = c, c.presentingViewController != nil {
            c.dismiss(animated: true) { [weak self] in self?.backToApp(ms, "El reproductor de iOS no pudo abrir este video") }
        } else {
            backToApp(ms, "El reproductor de iOS no pudo abrir este video")
        }
    }

    private func backToApp(_ ms: Int64, _ msg: String) {
        guard let r = request, let st = state else { restore(); return }
        st.toast = msg
        st.play = PlayRequest(kind: r.kind, queue: r.queue, index: index, saveTitle: r.saveTitle, savePoster: r.savePoster, category: r.category,
                              closeOnPortrait: false, directUrls: r.directUrls, startAt: r.kind == .live ? 0 : ms)
    }

    /* ---------- imagen en imagen (la maneja el reproductor de iOS) ---------- */
    func playerViewControllerWillStartPictureInPicture(_ c: AVPlayerViewController) {
        pipActive = true
        PlayerDiag.log("nativo: imagen en imagen")
    }

    func playerViewControllerDidStopPictureInPicture(_ c: AVPlayerViewController) {
        pipActive = false
        // cerró la ventanita sin volver a la app
        if let v = vc, v.presentingViewController == nil {
            saveProgress()
            cleanup()
            restore()
        }
    }

    func playerViewController(_ c: AVPlayerViewController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completion: @escaping (Bool) -> Void) {
        // "volver a la app" desde la ventanita: el reproductor de iOS vuelve a pantalla completa
        guard let v = vc, v.presentingViewController == nil, let top = Self.topController() else { completion(true); return }
        AppDelegate.playerOpen = true
        top.present(v, animated: true) { completion(true) }
    }

    private func restore() { Task { @MainActor in PlayerPresenter.restoreOrientation() } }

    /* ---------- progreso ---------- */
    private func currentMs() -> Int64 {
        guard let t = vc?.player?.currentTime(), t.isNumeric else { return 0 }
        return Int64(t.seconds * 1000)
    }

    private func saveProgress() {
        guard let r = request, r.kind != .live, r.directUrls.isEmpty, r.queue.indices.contains(index) else { return }
        let q = r.queue[index]
        let pos = currentMs()
        var dur: Int64 = 0
        if let d = vc?.player?.currentItem?.duration, d.isNumeric { dur = Int64(d.seconds * 1000) }
        if pos < 5_000 { return }
        Cloud.shared.saveProgress(Progress(key: q.key, title: r.saveTitle.ifEmpty(q.title), label: q.title, poster: r.savePoster.ifEmpty(q.poster),
                                           position: pos, duration: dur, updated: Date().timeIntervalSince1970, url: url, categoryId: r.category), force: true)
    }

    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        var top = (scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first)?.rootViewController
        while let p = top?.presentedViewController, !p.isBeingDismissed { top = p }
        return top
    }
}
