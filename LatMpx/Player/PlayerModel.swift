import Foundation
import Combine
import UIKit
import MobileVLCKit

/**
 * Reproductor (VLCKit): películas, episodios y canales. Lee el estado cada 0,5 s (más simple y
 * estable que el delegado), guarda el progreso en el panel cada 10 s y al salir, sigue en el
 * punto guardado, pasa al siguiente episodio y en canales prueba .m3u8 / .ts / sin extensión.
 */
struct Track: Hashable { let id: Int32; let name: String }

/**
 * VLC se detiene siempre en segundo plano: stop() (y cambiar de dirección sobre el mismo reproductor)
 * espera a que VLC suelte la conexión, y con un servidor que no responde eso tardaba segundos y
 * congelaba la pantalla (no se podía pausar ni salir). Cada dirección usa un reproductor nuevo.
 */
enum VLCRetire {
    private static let queue = DispatchQueue(label: "latmpx.vlc.stop", qos: .utility, attributes: .concurrent)
    static func stop(_ p: VLCMediaPlayer) { queue.async { p.stop() } }
}

final class PlayerModel: ObservableObject {
    private(set) var player = VLCMediaPlayer()
    private weak var surface: UIView?
    private var fillSize: CGSize = .zero
    let request: PlayRequest

    @Published private(set) var index: Int
    @Published private(set) var playing = false
    @Published private(set) var buffering = true
    @Published private(set) var time: Int64 = 0
    @Published private(set) var length: Int64 = 0
    @Published var error: String?
    @Published var fill = false
    @Published private(set) var audio: [Track] = []
    @Published private(set) var subs: [Track] = []
    @Published private(set) var currentAudio: Int32 = -1
    @Published private(set) var currentSub: Int32 = -1
    @Published var toast: String?

    private var urls: [String] = []
    private var urlIdx = 0
    /** la dirección actual ya se reintentó una vez (el servidor todavía contaba la conexión anterior) */
    private var retriedSame = false
    private var timer: Timer?
    private var openedAt = Date()
    private var resumeTo: Int64 = 0
    private var lastSave = Date()
    private var everPlayed = false
    private var appliedLang = false
    var onFinish: (() -> Void)?

    var kind: Kind { request.kind }
    var entry: QueueEntry { request.queue[index] }
    var hasNext: Bool { index + 1 < request.queue.count }

    init(request: PlayRequest) {
        self.request = request
        self.index = request.index
    }

    func attach(_ view: UIView) { surface = view; player.drawable = view }

    /** suelta el reproductor actual (sin esperar) y deja uno nuevo listo */
    private func freshPlayer() {
        let old = player
        PlayerDiag.phase("nuevo VLCMediaPlayer")
        player = VLCMediaPlayer()
        PlayerDiag.phase("drawable nuevo")
        player.drawable = surface
        PlayerDiag.phase("drawable viejo = nil")
        old.drawable = nil
        VLCRetire.stop(old)
        PlayerDiag.phase("")
    }

    func start() {
        load(index)
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
    }

    private var stopped = false
    private var startUsed = false
    private var loadSeq = 0
    /** la dirección actual ya pasó por "abriendo" (para notar cuando VLC se detiene sin imagen) */
    private var connecting = false

    func stop() {
        if stopped { return }
        stopped = true
        save(force: true)
        timer?.invalidate(); timer = nil
        PlayerDiag.log("stop")
        PlayerDiag.phase("stop: drawable = nil")
        player.drawable = nil
        VLCRetire.stop(player)
        PlayerDiag.phase("")
    }

    private func load(_ i: Int) {
        guard request.queue.indices.contains(i) else { return }
        let q = request.queue[i]
        if request.offline {
            // descarga: el archivo del equipo de este episodio o película
            urls = request.directUrls.indices.contains(i) ? [request.directUrls[i]] : []
            if urls.isEmpty { return }
        } else if !request.directUrls.isEmpty {
            urls = request.directUrls
        } else {
            guard let s = Store.session() else { return }
            switch kind {
            case .movie: urls = [Xtream.movieUrl(s, q.id, q.ext)]
            case .series: urls = [Xtream.episodeUrl(s, q.id, q.ext)]
            case .live: urls = Xtream.liveUrls(s, q.id); Store.setLastChannel(q.id)
            }
            // servidores http, https o mixtos: si el video no sale por un protocolo se prueba el otro; el que
            // funcionó se recuerda (Xtream.streamFlip) y va primero en los siguientes videos de la sesión
            let other = urls.map { Xtream.otherScheme($0) }
            urls = Xtream.streamFlip ? other + urls : urls + other
        }
        index = i
        urlIdx = 0
        retriedSame = false
        resumeTo = 0
        if kind != .live && i == request.index && request.startAt > 0 && !startUsed {
            // de vuelta de imagen en imagen: donde iba
            startUsed = true
            resumeTo = request.startAt
        } else if request.offline, let d = Downloads.shared.get(q.key), d.position > 30_000, d.duration <= 0 || Double(d.position) < Double(d.duration) * 0.95 {
            resumeTo = d.position
            toast = "Continuando desde \(fmtTime(d.position))"
        } else if kind != .live, !request.offline, let p = Cloud.shared.progress(q.key), p.position > 30_000, p.duration <= 0 || Double(p.position) < Double(p.duration) * 0.95 {
            resumeTo = p.position
            toast = "Continuando desde \(fmtTime(p.position))"
        }
        everPlayed = false; appliedLang = false
        audio = []; subs = []; time = 0; length = 0; error = nil
        loadSeq += 1
        let raw = urls, my = loadSeq
        if SecureDns.current.endpoint.isEmpty || request.offline { open(raw[0]); return }
        // DNS elegido en Ajustes: si las direcciones de siempre no abren, se prueba la IP que da ese DNS
        buffering = true
        freshPlayer()
        Task { @MainActor [weak self] in
            let list = await SecureDns.playable(raw)
            guard let self = self, !self.stopped, self.loadSeq == my else { return }
            self.urls = list.isEmpty ? raw : list
            self.urlIdx = 0
            self.open(self.urls[0])
        }
    }

    private func open(_ url: String) {
        guard let u = URL(string: url) else { error = "Dirección no válida"; return }
        let m = VLCMedia(url: u)
        // películas y episodios: más búfer (4K / HDR de alto bitrate se cortaban con 1,5 s)
        m.addOption(":network-caching=\(kind == .live ? 2500 : 3000)")
        m.addOption(":http-user-agent=\(Net.ua)")
        m.addOption(":http-reconnect")
        PlayerDiag.log("abrir \(urlIdx): \(u.host ?? "")")
        freshPlayer()
        connecting = false
        PlayerDiag.phase("media = m")
        player.media = m
        openedAt = Date()
        buffering = true
        PlayerDiag.phase("play()")
        player.play()
        PlayerDiag.phase("")
        if fill { applyFill(fillSize) }
    }

    private func tick() {
        PlayerDiag.phase("tick: state")
        defer { PlayerDiag.phase("") }
        let st = player.state
        playing = player.isPlaying
        buffering = st == .opening || st == .buffering && !player.isPlaying
        PlayerDiag.phase("tick: time")
        let t = Int64(player.time.intValue)
        PlayerDiag.phase("tick: length")
        if t > 0 { time = t }
        if let l = player.media?.length.intValue, l > 0 { length = Int64(l) }
        if player.isPlaying {
            if !everPlayed {
                everPlayed = true
                // protocolo con el que el servidor entrega el video (http / https), para los siguientes
                if !request.offline, request.directUrls.isEmpty, let s = Store.session(), urls.indices.contains(urlIdx) {
                    let scheme = (s.base.lowercased().components(separatedBy: "://").first ?? "http") + "://"
                    Xtream.streamFlip = !urls[urlIdx].lowercased().hasPrefix(scheme)
                }
                if resumeTo > 0 { player.time = VLCTime(int: Int32(truncatingIfNeeded: resumeTo)) }
            }
            if !appliedLang && time > 1500 { appliedLang = true; readTracks(); applyPreferredLanguages() }
            if Date().timeIntervalSince(lastSave) >= 10 { save() }
        }
        if st == .opening || st == .buffering { connecting = true }
        switch st {
        case .error: if error == nil { failed() }
        case .stopped where connecting && !everPlayed && error == nil:
            // VLC se detuvo sin dar imagen (dirección rechazada): la siguiente al momento, sin esperar 25 s
            failed()
        case .ended: ended()
        case .opening, .buffering, .stopped:
            // canal o video que no arranca en 25 s: se prueba la siguiente dirección
            if !everPlayed && error == nil && Date().timeIntervalSince(openedAt) > 25 { failed() }
        default: break
        }
    }

    private func failed() {
        PlayerDiag.log("falló \(urlIdx) estado \(player.state.rawValue)")
        // ya se mostró el error: no se vuelve a crear un reproductor en cada vuelta del reloj
        if error != nil { return }
        // se cortó enseguida sin dar imagen: muchas veces el servidor rechaza porque todavía cuenta la conexión
        // anterior (líneas de 1 conexión). Se espera y se reintenta la misma dirección una vez.
        if !everPlayed && !retriedSame && !request.offline && Date().timeIntervalSince(openedAt) < 8 {
            retriedSame = true
            buffering = true
            connecting = false
            openedAt = Date()
            let my = loadSeq, url = urls[urlIdx]
            freshPlayer()
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard let self = self, !self.stopped, self.loadSeq == my, self.error == nil else { return }
                self.open(url)
            }
            return
        }
        if urlIdx + 1 < urls.count {
            urlIdx += 1
            open(urls[urlIdx])
            return
        }
        if error == nil {
            error = kind == .live ? "No se pudo reproducir este canal" : "No se pudo reproducir este video"
            ErrorReport.report("playback", error!, detail: "\(entry.title) · \(kind.rawValue) \(entry.id) · estado \(player.state.rawValue)", screen: "player")
        }
        buffering = false
        freshPlayer()
    }

    private func ended() {
        if kind == .live { failed(); return }
        save(force: true, done: true)
        if kind == .series && hasNext { load(index + 1) } else { freshPlayer(); onFinish?() }
    }

    func retry() { error = nil; urlIdx = 0; retriedSame = false; open(urls.first ?? "") }

    func toggle() { player.isPlaying ? player.pause() : player.play(); if !player.isPlaying { save(force: true) } }
    func seek(by s: Int32) { s >= 0 ? player.jumpForward(s) : player.jumpBackward(-s) }
    func seek(to fraction: Double) { if length > 0 { player.time = VLCTime(int: Int32(truncatingIfNeeded: Int64(Double(length) * fraction))) } }
    func next() { save(force: true); if hasNext { load(index + 1) } else if kind == .live { load(0) } }
    func previous() {
        if kind != .live { return }
        load(index > 0 ? index - 1 : request.queue.count - 1)
    }
    func jump(to i: Int) { save(force: true); load(i) }

    /* ---------- pistas ---------- */
    func readTracks() {
        func pairs(_ idx: [Any]?, _ names: [Any]?) -> [Track] {
            let ids = (idx ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
            let ns = (names ?? []).map { "\($0)" }
            return zip(ids, ns).map { Track(id: $0, name: $1) }
        }
        audio = pairs(player.audioTrackIndexes, player.audioTrackNames).filter { $0.id >= 0 }
        subs = pairs(player.videoSubTitlesIndexes, player.videoSubTitlesNames)
        currentAudio = player.currentAudioTrackIndex
        currentSub = player.currentVideoSubTitleIndex
    }

    func setAudio(_ id: Int32, _ name: String) {
        player.currentAudioTrackIndex = id
        currentAudio = id
        Store.audioLang = name
    }

    func setSub(_ id: Int32, _ name: String) {
        player.currentVideoSubTitleIndex = id
        currentSub = id
        Store.subLang = id < 0 ? "" : name
    }

    /** el idioma elegido a mano la última vez (por nombre de pista) */
    private func applyPreferredLanguages() {
        if let a = Store.audioLang?.lowercased(), !a.isEmpty,
           let t = audio.first(where: { $0.name.lowercased() == a }) ?? audio.first(where: { $0.name.lowercased().contains(String(a.prefix(5))) }) {
            if t.id != currentAudio { setAudio(t.id, t.name) }
        }
        if let sl = Store.subLang?.lowercased(), !sl.isEmpty, let t = subs.first(where: { $0.id >= 0 && $0.name.lowercased() == sl }) {
            if t.id != currentSub { setSub(t.id, t.name) }
        }
    }

    /** ajustar (todo el video) o llenar la pantalla (recorta los bordes) */
    func applyFill(_ size: CGSize) {
        fillSize = size
        if fill && size.width > 0 && size.height > 0 {
            let g = gcd(Int(size.width), Int(size.height))
            player.videoCropGeometry = strdup("\(Int(size.width) / g):\(Int(size.height) / g)")
        } else {
            player.videoCropGeometry = nil
        }
    }

    private func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? max(a, 1) : gcd(b, a % b) }

    /* ---------- progreso en el panel ---------- */
    private func save(force: Bool = false, done: Bool = false) {
        lastSave = Date()
        guard kind != .live, request.queue.indices.contains(index) else { return }
        let q = entry
        let dur = length
        let pos = done ? dur : time
        if pos < 5_000 { return }
        // sin internet: donde se dejó queda en el equipo
        if request.offline { Downloads.shared.savePosition(q.key, pos, dur); return }
        guard request.directUrls.isEmpty else { return }
        Cloud.shared.saveProgress(Progress(key: q.key, title: request.saveTitle.ifEmpty(q.title), label: q.title,
                                           poster: request.savePoster.ifEmpty(q.poster), position: pos, duration: dur,
                                           updated: Date().timeIntervalSince1970, url: urls.indices.contains(urlIdx) ? urls[urlIdx] : "",
                                           categoryId: request.category), force: force)
    }
}
