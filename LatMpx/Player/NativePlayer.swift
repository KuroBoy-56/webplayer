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
 * sus controles. Es el reproductor de todo lo que se pueda: cada video se le da por varias vías, en orden,
 * sin cerrar la pantalla (ways): la app le baja el archivo (StreamLoader), la dirección directa (ya
 * redirigida), el otro protocolo (http / https) y, para lo que Apple no abre solo (MKV, AVI…) o si nada
 * de eso arrancó, el motor del panel (api/media_ios.php, HLS en fMP4; películas y episodios). Si un video que ya
 * se veía se corta, la misma vía se reintenta una vez desde donde iba. Las vías se repiten hasta que pasa
 * un minuto sin imagen; solo entonces (y como mucho a los 90 s) pasa al reproductor de la app (VLC), en el
 * mismo punto. Ajustes › "Reproductor de iOS" lo apaga.
 */
final class NativePlayer: NSObject, AVPlayerViewControllerDelegate {
    static let shared = NativePlayer()

    /** cómo se le da el video al reproductor de iOS */
    enum Way: Equatable {
        /** la app le baja el archivo (servidores http / https / mixtos, 1 conexión) */
        case loader(String)
        /** dirección directa (HLS o archivo del equipo) */
        case direct(String)
        /** la dirección final tras seguir las redirecciones (XUI.one salta de https a http, que iOS no sigue) */
        case redirected(String)
        /** el panel lo convierte a HLS (MKV, AVI…) */
        case engine(String)

        var label: String {
            switch self {
            case .loader: return "app"
            case .direct(let u): return u.hasPrefix("file:") ? "archivo" : "directo " + (URL(string: u)?.scheme ?? "")
            case .redirected: return "redirigido"
            case .engine: return "motor del panel"
            }
        }
    }

    private var vc: NativePlayerController?
    private var watch: [NSKeyValueObservation] = []
    private var itemWatch: NSKeyValueObservation?
    private var timeObs: Any?
    private var endObs: [NSObjectProtocol] = []
    private var timeout: DispatchWorkItem?
    private var pipActive = false
    private var request: PlayRequest?
    private var url = ""
    private weak var state: AppState?
    private var lastSave = Date()
    private var loader: StreamLoader?
    private var ways: [Way] = []
    private var wayIx = 0
    private var loadId = UUID()
    /** el HLS del panel empieza en este punto del video */
    private var offsetMs: Int64 = 0
    private var lastDurMs: Int64 = 0
    private var playedThisWay = false
    private var retriedThisWay = false
    /** vías que fallaron en este video (motivo), para el reporte al panel */
    private var failures: [String] = []
    /** desde cuándo no se ve nada (al abrir o desde el último corte); nil = está reproduciendo */
    private var failingSince: Date?
    /** el reproductor de la app (VLC) solo cuando el de iOS lleva este tiempo sin poder (y nunca antes de minTry) */
    private static let minTry: TimeInterval = 60
    private static let maxTry: TimeInterval = 90

    var active: Bool { vc != nil }

    /* ---------- qué abre el reproductor de iOS ---------- */

    static func compatible(_ u: String) -> Bool {
        let ext = (URL(string: u)?.pathExtension ?? "").lowercased()
        return ["mp4", "m4v", "mov", "m3u8"].contains(ext)
    }

    /** esta petición prueba primero el reproductor de iOS */
    static func wanted(_ r: PlayRequest) -> Bool {
        Store.nativePlayer && !r.forceApp && r.queue.indices.contains(r.index)
    }

    /** las vías para el reproductor de iOS, en orden; vacío = va directo al de la app */
    @MainActor
    static func ways(_ r: PlayRequest) async -> [Way] {
        guard wanted(r) else { return [] }
        if r.offline {
            // descargas: el archivo del equipo; la prueba del simulador (directUrls) sigue en el de la app
            guard r.directUrls.indices.contains(r.index), compatible(r.directUrls[r.index]) else { return [] }
            return [.direct(r.directUrls[r.index])]
        }
        guard r.directUrls.isEmpty, let s = Store.session() else { return [] }
        let q = r.queue[r.index]
        // el protocolo con el que este servidor ya entregó video (http / https)
        let flip = { (u: String) in Xtream.streamFlip ? Xtream.otherScheme(u) : u }
        var out: [Way] = []
        switch r.kind {
        case .live:
            guard let m = Xtream.liveUrls(s, q.id).first(where: { $0.lowercased().hasSuffix(".m3u8") }) else { return [] }
            let u = await preferHttp(flip(m))
            // canales: sin el motor del panel (solo convierte películas y episodios)
            out = [.redirected(u), .direct(u), .direct(Xtream.otherScheme(u))]
        case .movie, .series:
            let u = await preferHttp(flip(r.kind == .movie ? Xtream.movieUrl(s, q.id, q.ext) : Xtream.episodeUrl(s, q.id, q.ext)))
            let engine = await StreamEngine.available()
            if compatible(u) {
                out = [.loader(u), .redirected(u), .loader(Xtream.otherScheme(u))]
                if engine { out.append(.engine(u)) }
            } else {
                // MKV, AVI…: primero el motor del panel; igual se intenta directo (hay archivos con otra extensión)
                out = (engine ? [.engine(u)] : []) + [.loader(u), .redirected(u)]
            }
        }
        var seen: [Way] = []
        for w in out where !seen.contains(w) { seen.append(w) }
        return seen
    }

    /**
     * DNS en https con el servidor del video en http (XUI.one salta de https a http): el video se pide por
     * http desde el principio, como con una DNS http, y la sesión lo recuerda (Xtream.streamFlip).
     */
    @MainActor
    private static func preferHttp(_ u: String) async -> String {
        guard u.lowercased().hasPrefix("https://"), let hop = await StreamRedirect.firstHop(u),
              hop.lowercased().hasPrefix("http://") else { return u }
        PlayerDiag.log("nativo: la DNS https entrega el video por http")
        Xtream.streamFlip.toggle()
        return Xtream.otherScheme(u)
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

    func open(_ r: PlayRequest, ways: [Way], state: AppState) {
        close(save: false)
        self.state = state
        guard !ways.isEmpty, let top = Self.topController() else { backToApp(r, 0, nil); return }
        request = r
        self.ways = ways
        wayIx = 0
        retriedThisWay = false
        failures = []
        lastDurMs = 0
        failingSince = Date()
        if r.kind == .live, r.queue.indices.contains(r.index) { Store.setLastChannel(r.queue[r.index].id) }

        let p = AVPlayer()
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
            p.observe(\.timeControlStatus, options: [.new]) { [weak self] pl, _ in
                guard pl.timeControlStatus == .playing else { return }
                DispatchQueue.main.async { self?.started(c) }
            },
        ]
        timeObs = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 5, preferredTimescale: 1), queue: .main) { [weak self] _ in
            guard let s = self, Date().timeIntervalSince(s.lastSave) >= 10 else { return }
            s.saveProgress()
        }
        let ms = Self.startPoint(r)
        if ms > 0 && r.startAt <= 0 { state.toast = tr("Continuando desde %@", fmtTime(ms)) }
        PlayerDiag.log("nativo: \(ways.count) vías: " + ways.map(\.label).joined(separator: ", "))
        top.present(c, animated: true) { [weak self] in self?.load(ms) }
    }

    /** le da el video al reproductor por la vía actual, desde ms */
    private func load(_ ms: Int64) {
        guard let c = vc, let p = c.player, ways.indices.contains(wayIx) else { return }
        let way = ways[wayIx]
        let id = UUID()
        loadId = id
        releaseItem()
        playedThisWay = false
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            let asset = await self.asset(way, ms)
            guard self.loadId == id, self.vc === c else { return }
            guard let asset = asset else { self.failed("sin dirección", retry: false); return }
            let item = AVPlayerItem(asset: asset)
            // el video llega por partes: un poco de colchón contra cortes
            item.preferredForwardBufferDuration = 30
            self.itemWatch = item.observe(\.status, options: [.new]) { [weak self] it, _ in
                guard it.status == .failed else { return }
                let e = it.error as NSError?
                let err = (e?.localizedDescription ?? "") + " (\(e?.code ?? 0))"
                DispatchQueue.main.async { if self?.loadId == id { self?.failed(err, format: Self.formatError(e)) } }
            }
            self.endObs = [
                NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                    self?.ended()
                },
                NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self] n in
                    let err = (n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription ?? "cortado"
                    if self?.loadId == id { self?.failed(err) }
                },
            ]
            p.replaceCurrentItem(with: item)
            if self.offsetMs == 0, ms > 0, self.request?.kind != .live {
                p.seek(to: CMTime(value: ms, timescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { _ in }
            }
            // si no arranca, la vía siguiente (el panel tarda más: prepara los primeros segmentos)
            let wait: Double
            if case .engine = way { wait = 75 } else { wait = 15 }
            // sin pasar el límite total (maxTry), salvo los 15 s mínimos de cada vía
            let left = (self.failingSince ?? Date()).addingTimeInterval(Self.maxTry).timeIntervalSinceNow
            self.armTimeout(id, p, max(15, min(wait, left)), until: Date().addingTimeInterval(max(15, min(90, left))), bytes: -1)
            PlayerDiag.log("nativo: vía \(self.wayIx + 1)/\(self.ways.count) \(way.label)")
            p.play()
        }
    }

    /**
     * Si no arranca en `wait` s, la vía siguiente; pero mientras el video siga llegando (archivos pesados, 4K,
     * índice al final del archivo) se espera más, hasta `until`.
     */
    private func armTimeout(_ id: UUID, _ p: AVPlayer, _ wait: Double, until: Date, bytes: Int64) {
        let t = DispatchWorkItem { [weak self] in
            guard let s = self, s.loadId == id, p.timeControlStatus != .playing, !s.pipActive else { return }
            let now = s.loader?.received ?? Int64(p.currentItem?.accessLog()?.events.last?.numberOfBytesTransferred ?? 0)
            if now > max(bytes, 0) && Date() < until {
                s.armTimeout(id, p, 8, until: until, bytes: now)
                return
            }
            s.failed("sin respuesta", retry: false)
        }
        timeout = t
        DispatchQueue.main.asyncAfter(deadline: .now() + wait, execute: t)
    }

    /** errores de AVFoundation de un formato o códec que el reproductor de iOS no abre (no es la red) */
    private static func formatError(_ e: NSError?) -> Bool {
        guard let e = e else { return false }
        let codes = [-11828, -11829, -11833, -11821, -11838, -12847]
        if e.domain == AVFoundationErrorDomain && codes.contains(e.code) { return true }
        if let u = e.userInfo[NSUnderlyingErrorKey] as? NSError { return formatError(u) }
        return false
    }

    @MainActor
    private func asset(_ way: Way, _ ms: Int64) async -> AVURLAsset? {
        let ua = ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": Net.ua]]
        switch way {
        case .loader(let s):
            offsetMs = 0
            url = s
            guard let u = URL(string: s), let l = StreamLoader(u) else { return nil }
            loader = l
            let a = AVURLAsset(url: l.assetURL)
            l.attach(a)
            return a
        case .direct(let s):
            offsetMs = 0
            url = s
            guard let u = URL(string: s) else { return nil }
            return u.isFileURL ? AVURLAsset(url: u) : AVURLAsset(url: u, options: ua)
        case .redirected(let s):
            // se resuelve al usarla (no antes: con líneas de 1 conexión ocuparía la conexión de otra vía)
            offsetMs = 0
            url = s
            let final = await StreamRedirect.resolve(s)
            guard let u = URL(string: final) else { return nil }
            return AVURLAsset(url: u, options: ua)
        case .engine(let s):
            let from = request?.kind == .live ? 0 : Int(ms / 1000)
            url = s
            guard let e = await StreamEngine.url(s, from: from), let u = URL(string: e) else { return nil }
            offsetMs = Int64(from) * 1000
            return AVURLAsset(url: u, options: ua)
        }
    }

    /** ya reproduce: si a los 4 s no hay imagen (códec que Apple no decodifica) prueba la vía siguiente */
    private func started(_ c: NativePlayerController) {
        guard vc === c else { return }
        timeout?.cancel()
        if !playedThisWay { PlayerDiag.log("nativo: reproduciendo") }
        playedThisWay = true
        let id = loadId
        if !failures.isEmpty {
            // las vías que no sirvieron: a Errores de las apps del panel, para ver por qué
            ErrorReport.report("playback", "El reproductor de iOS abrió el video por otra vía", detail: failures.joined(separator: " | "), screen: "player")
            failures = []
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let s = self, s.vc === c, s.loadId == id, let item = c.player?.currentItem, !s.pipActive else { return }
            // presentationSize sigue en cero cuando Apple no puede decodificar la imagen (en HLS assetTrack puede venir vacío)
            if item.presentationSize == .zero && item.currentTime().seconds > 3 { s.failed("sin imagen", retry: false, format: true); return }
            // ya hay imagen: el plazo para pasar a VLC vuelve a contar desde el próximo corte
            s.failingSince = nil
        }
    }

    /** cierra el reproductor de iOS y su ventanita (otro video, cerrar sesión) */
    func close(save: Bool = true) {
        if save { saveProgress() }
        let c = vc
        cleanup()
        if let c = c, c.presentingViewController != nil { c.dismiss(animated: false) }
    }

    /** suelta el video actual (cierra la conexión con el servidor IPTV antes de abrir otra vía u otro reproductor) */
    private func releaseItem() {
        timeout?.cancel(); timeout = nil
        itemWatch?.invalidate(); itemWatch = nil
        endObs.forEach { NotificationCenter.default.removeObserver($0) }
        endObs = []
        if let d = vc?.player?.currentItem?.duration, d.isNumeric, d.seconds > 0, offsetMs == 0 { lastDurMs = Int64(d.seconds * 1000) }
        (vc?.player?.currentItem?.asset as? AVURLAsset)?.cancelLoading()
        vc?.player?.replaceCurrentItem(with: nil)
        loader?.close()
        loader = nil
    }

    private func cleanup() {
        loadId = UUID()
        releaseItem()
        watch.forEach { $0.invalidate() }; watch = []
        if let o = timeObs { vc?.player?.removeTimeObserver(o) }
        timeObs = nil
        vc?.onClose = nil
        vc?.player?.pause()
        vc?.player = nil
        vc?.delegate = nil
        vc = nil
        pipActive = false
        ways = []
        offsetMs = 0
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

    /**
     * Esta vía no pudo: si ya se veía y se cortó, la misma otra vez (una vez) desde donde iba; si no, la
     * siguiente. Sin vías: al reproductor de la app, donde iba.
     */
    private func failed(_ err: String, retry: Bool = true, format: Bool = false) {
        guard vc != nil, let r = request else { return }
        let pos = currentMs()
        let ms = r.kind == .live ? 0 : (pos > 0 ? pos : Self.startPoint(r))
        if failingSince == nil { failingSince = Date() }
        let trying = Date().timeIntervalSince(failingSince ?? Date())
        PlayerDiag.log("nativo: falló \(err) (vía \(wayIx + 1)/\(ways.count), \(Int(trying)) s)")
        if ways.indices.contains(wayIx) { failures.append(ways[wayIx].label + ": " + err) }
        if retry && !format && playedThisWay && !retriedThisWay {
            retriedThisWay = true
            again(ms)
            return
        }
        // formato o códec que Apple no abre: las otras vías directas darían lo mismo, sigue el motor del panel
        var next = wayIx + 1
        if format, let e = ways.lastIndex(where: { if case .engine = $0 { return true } else { return false } }), e > wayIx { next = e }
        let engineIx = ways.firstIndex { if case .engine = $0 { return true } else { return false } }
        if next >= ways.count && trying < Self.minTry {
            // sin vías antes del minuto: otra vuelta (el motor del panel primero si lo hay), con una pausa para el servidor
            next = engineIx ?? 0
            PlayerDiag.log("nativo: otra vuelta por las vías")
            wayIx = next
            retriedThisWay = false
            again(ms, after: 4)
            return
        }
        if next < ways.count && trying < Self.maxTry {
            wayIx = next
            retriedThisWay = false
            again(ms)
            return
        }
        ErrorReport.report("playback", "El reproductor de iOS no pudo abrir el video", detail: failures.joined(separator: " | "), screen: "player")
        failures = []
        let c = vc
        cleanup()
        if let c = c, c.presentingViewController != nil {
            c.dismiss(animated: true) { [weak self] in self?.backToApp(r, ms, tr("Se abrió en el reproductor de la app")) }
        } else {
            backToApp(r, ms, tr("Se abrió en el reproductor de la app"))
        }
    }

    /** otra vía en la misma pantalla; antes, un segundo para que el servidor suelte la conexión anterior (líneas de 1 conexión) */
    private func again(_ ms: Int64, after: Double = 1) {
        releaseItem()
        let id = UUID()
        loadId = id
        DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak self] in
            guard let s = self, s.loadId == id, s.vc != nil else { return }
            s.load(ms)
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
        guard let t = vc?.player?.currentTime(), t.isNumeric, t.seconds > 0 else { return 0 }
        return offsetMs + Int64(t.seconds * 1000)
    }

    private func saveProgress(done: Bool = false) {
        lastSave = Date()
        guard let r = request, r.kind != .live, r.queue.indices.contains(r.index) else { return }
        let q = r.queue[r.index]
        // el HLS del panel solo conoce lo que ya convirtió: la duración es la de una vía anterior (o 0)
        var dur: Int64 = offsetMs > 0 ? lastDurMs : 0
        if offsetMs == 0, let d = vc?.player?.currentItem?.duration, d.isNumeric, d.seconds > 0 { dur = Int64(d.seconds * 1000) }
        // el motor del panel no sabe la duración total: la del servidor, para que Continuar viendo tenga su avance
        if dur <= 0 { dur = q.durMs }
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
