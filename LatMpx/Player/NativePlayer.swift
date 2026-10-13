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
 * Reproductor de iOS (AVPlayerViewController): imagen en imagen (botón o al salir con Inicio), AirPlay y
 * sus controles. Es el reproductor por defecto para lo que Apple puede abrir: HLS (.m3u8, los canales se
 * piden en .m3u8) y MP4 / M4V / MOV, también descargados. MKV, AVI y TS van al reproductor de la app (VLC).
 * Si el de iOS falla, no arranca en 20 s o se queda sin imagen, el video pasa solo al de la app en el mismo
 * punto (antes quedaba en negro con algunos servidores). Ajustes › "Reproductor de iOS" lo apaga.
 */
final class NativePlayer: NSObject, AVPlayerViewControllerDelegate {
    static let shared = NativePlayer()

    private var vc: NativePlayerController?
    private var watch: [NSKeyValueObservation] = []
    private var timeObs: Any?
    private var endObs: NSObjectProtocol?
    private var timeout: DispatchWorkItem?
    private var pipActive = false
    private var request: PlayRequest?
    private var url = ""
    private weak var state: AppState?
    private var lastSave = Date()
    /** la app le baja el video al reproductor de iOS (servidores http / https / mixtos, 1 conexión) */
    private var loader: StreamLoader?

    var active: Bool { vc != nil }

    /* ---------- qué abre el reproductor de iOS ---------- */

    static func compatible(_ u: String) -> Bool {
        let ext = (URL(string: u)?.pathExtension ?? "").lowercased()
        return ["mp4", "m4v", "mov", "m3u8"].contains(ext)
    }


    /** dirección para el reproductor de iOS; nil = esta petición va al reproductor de la app */
    static func source(_ r: PlayRequest) -> String? {
        guard Store.nativePlayer, !r.forceApp, r.queue.indices.contains(r.index) else { return nil }
        let q = r.queue[r.index]
        // descargas: el archivo del equipo; la prueba del simulador (directUrls) sigue en el de la app
        if r.offline { return r.directUrls.indices.contains(r.index) && compatible(r.directUrls[r.index]) ? r.directUrls[r.index] : nil }
        guard r.directUrls.isEmpty, let s = Store.session() else { return nil }
        var u: String
        switch r.kind {
        case .movie: u = Xtream.movieUrl(s, q.id, q.ext)
        case .series: u = Xtream.episodeUrl(s, q.id, q.ext)
        case .live: u = Xtream.liveUrls(s, q.id).first { $0.lowercased().hasSuffix(".m3u8") } ?? ""
        }
        // el protocolo con el que este servidor ya entregó video (http / https)
        if Xtream.streamFlip { u = Xtream.otherScheme(u) }
        return compatible(u) ? u : nil
    }

    /** punto de inicio: el de la petición (vuelta de otro reproductor) o el progreso guardado */
    private static func startPoint(_ r: PlayRequest) -> Int64 {
        if r.kind == .live { return 0 }
        if r.startAt > 0 { return r.startAt }
        if r.offline {
            guard r.queue.indices.contains(r.index), let d = Downloads.shared.get(r.queue[r.index].key),
                  d.position > 30_000, d.duration <= 0 || Double(d.position) < Double(d.duration) * 0.95 else { return 0 }
            return d.position
        }
        guard r.queue.indices.contains(r.index), let p = Cloud.shared.progress(r.queue[r.index].key),
              p.position > 30_000, p.duration <= 0 || Double(p.position) < Double(p.duration) * 0.95 else { return 0 }
        return p.position
    }

    /* ---------- abrir / cerrar ---------- */

    func open(_ r: PlayRequest, url: String, state: AppState) {
        close(save: false)
        self.state = state
        guard let u = URL(string: url), let top = Self.topController() else { backToApp(r, 0, nil); return }
        request = r
        self.url = url
        if r.kind == .live, r.queue.indices.contains(r.index) { Store.setLastChannel(r.queue[r.index].id) }

        let asset: AVURLAsset
        if StreamLoader.handles(u), let l = StreamLoader(u) {
            // películas y episodios: el video lo pide la app (sigue redirecciones http / https, una sola conexión)
            loader = l
            asset = AVURLAsset(url: l.assetURL)
            l.attach(asset)
        } else {
            asset = u.isFileURL ? AVURLAsset(url: u) : AVURLAsset(url: u, options: ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": Net.ua]])
        }
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
                DispatchQueue.main.async { self?.started(c) }
            },
        ]
        timeObs = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 5, preferredTimescale: 1), queue: .main) { [weak self] _ in
            guard let s = self, Date().timeIntervalSince(s.lastSave) >= 10 else { return }
            s.saveProgress()
        }
        endObs = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            self?.ended()
        }
        // si en 20 s no arrancó (servidor que no responde a este reproductor), pasa al de la app
        let t = DispatchWorkItem { [weak self] in
            guard let s = self, s.vc === c, p.timeControlStatus != .playing, !s.pipActive else { return }
            s.failed("sin respuesta")
        }
        timeout = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: t)

        let ms = Self.startPoint(r)
        if ms > 0 {
            p.seek(to: CMTime(value: ms, timescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
            if r.startAt <= 0 { state.toast = "Continuando desde \(fmtTime(ms))" }
        }
        PlayerDiag.log("nativo: abriendo \(u.isFileURL ? "archivo" : (u.host ?? ""))")
        top.present(c, animated: true) { p.play() }
    }

    /** ya reproduce: si a los 4 s no hay imagen (códec que Apple no decodifica) pasa al de la app */
    private func started(_ c: NativePlayerController) {
        timeout?.cancel()
        PlayerDiag.log("nativo: reproduciendo")
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let s = self, s.vc === c, let item = c.player?.currentItem, !s.pipActive else { return }
            // presentationSize sigue en cero cuando Apple no puede decodificar la imagen (en HLS assetTrack puede venir vacío)
            if item.presentationSize == .zero { s.failed("sin imagen") }
        }
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
        if let o = timeObs { vc?.player?.removeTimeObserver(o) }
        timeObs = nil
        if let o = endObs { NotificationCenter.default.removeObserver(o) }
        endObs = nil
        vc?.onClose = nil
        vc?.player?.pause()
        // suelta el video de verdad (cierra la conexión con el servidor IPTV antes de abrir otro reproductor)
        (vc?.player?.currentItem?.asset as? AVURLAsset)?.cancelLoading()
        vc?.player?.replaceCurrentItem(with: nil)
        loader?.close()
        loader = nil
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
        let r = request
        cleanup()
        finish(r)
    }

    /** terminó: el siguiente episodio (por el mismo camino que cualquier video) o cerrar */
    private func ended() {
        guard let r = request, let st = state else { return }
        saveProgress(done: true)
        if r.kind == .series && r.index + 1 < r.queue.count {
            st.play = PlayRequest(kind: r.kind, queue: r.queue, index: r.index + 1, saveTitle: r.saveTitle, savePoster: r.savePoster,
                                  category: r.category, directUrls: r.directUrls, offline: r.offline)
            return
        }
        close(save: false)
        finish(r)
    }

    private func finish(_ r: PlayRequest?) {
        if let st = state, let r = r, st.play?.id == r.id { st.play = nil }
        Task { @MainActor in PlayerPresenter.restoreOrientation() }
    }

    /** el reproductor de iOS no pudo con este video: al de la app, donde iba */
    private func failed(_ err: String) {
        guard vc != nil, let r = request else { return }
        PlayerDiag.log("nativo: falló \(err)")
        ErrorReport.report("playback", "El reproductor de iOS no pudo abrir el video", detail: err, screen: "player")
        let ms = currentMs()
        let c = vc
        cleanup()
        if let c = c, c.presentingViewController != nil {
            c.dismiss(animated: true) { [weak self] in self?.backToApp(r, ms, "Se abrió en el reproductor de la app") }
        } else {
            backToApp(r, ms, "Se abrió en el reproductor de la app")
        }
    }

    private func backToApp(_ r: PlayRequest, _ ms: Int64, _ msg: String?) {
        guard let st = state else { return }
        if let m = msg { st.toast = m }
        // unos segundos para que el servidor suelte la conexión del reproductor de iOS (con 1 conexión rechaza la nueva)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak st] in
            guard let st = st else { return }
            self.openInApp(st, r, ms)
        }
    }

    private func openInApp(_ st: AppState, _ r: PlayRequest, _ ms: Int64) {
        st.play = PlayRequest(kind: r.kind, queue: r.queue, index: r.index, saveTitle: r.saveTitle, savePoster: r.savePoster, category: r.category,
                              closeOnPortrait: false, directUrls: r.directUrls, startAt: r.kind == .live ? 0 : max(ms, r.startAt),
                              forceApp: true, offline: r.offline)
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
            let r = request
            cleanup()
            finish(r)
        }
    }

    func playerViewController(_ c: AVPlayerViewController,
                              restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completion: @escaping (Bool) -> Void) {
        // "volver a la app" desde la ventanita: el reproductor de iOS vuelve a pantalla completa
        guard let v = vc, v.presentingViewController == nil, let top = Self.topController() else { completion(true); return }
        AppDelegate.playerOpen = true
        top.present(v, animated: true) { completion(true) }
    }

    /* ---------- progreso en el panel ---------- */
    private func currentMs() -> Int64 {
        guard let t = vc?.player?.currentTime(), t.isNumeric else { return 0 }
        return Int64(t.seconds * 1000)
    }

    private func saveProgress(done: Bool = false) {
        lastSave = Date()
        guard let r = request, r.kind != .live, r.queue.indices.contains(r.index) else { return }
        let q = r.queue[r.index]
        var dur: Int64 = 0
        if let d = vc?.player?.currentItem?.duration, d.isNumeric { dur = Int64(d.seconds * 1000) }
        let pos = done ? dur : currentMs()
        if pos < 5_000 { return }
        // sin internet: donde se dejó queda en el equipo
        if r.offline { Downloads.shared.savePosition(q.key, pos, dur); return }
        guard r.directUrls.isEmpty else { return }
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
