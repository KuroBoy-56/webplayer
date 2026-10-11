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

final class PlayerModel: ObservableObject {
    let player = VLCMediaPlayer()
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

    func attach(_ view: UIView) { player.drawable = view }

    func start() {
        load(index)
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
    }

    private var stopped = false

    func stop() {
        if stopped { return }
        stopped = true
        save(force: true)
        timer?.invalidate(); timer = nil
        player.stop()
    }

    private func load(_ i: Int) {
        guard let s = Store.session(), request.queue.indices.contains(i) else { return }
        index = i
        let q = request.queue[i]
        switch kind {
        case .movie: urls = [Xtream.movieUrl(s, q.id, q.ext)]
        case .series: urls = [Xtream.episodeUrl(s, q.id, q.ext)]
        case .live: urls = Xtream.liveUrls(s, q.id)
        }
        urlIdx = 0
        resumeTo = 0
        if kind != .live, let p = Cloud.shared.progress(q.key), p.position > 30_000, p.duration <= 0 || Double(p.position) < Double(p.duration) * 0.95 {
            resumeTo = p.position
            toast = "Continuando desde \(fmtTime(p.position))"
        }
        everPlayed = false; appliedLang = false
        audio = []; subs = []; time = 0; length = 0; error = nil
        open(urls[0])
    }

    private func open(_ url: String) {
        guard let u = URL(string: url) else { error = "Dirección no válida"; return }
        let m = VLCMedia(url: u)
        m.addOption(":network-caching=\(kind == .live ? 2500 : 1500)")
        m.addOption(":http-user-agent=\(Net.ua)")
        m.addOption(":http-reconnect")
        player.media = m
        openedAt = Date()
        buffering = true
        player.play()
    }

    private func tick() {
        let st = player.state
        playing = player.isPlaying
        buffering = st == .opening || st == .buffering && !player.isPlaying
        let t = Int64(player.time.intValue)
        if t > 0 { time = t }
        if let l = player.media?.length.intValue, l > 0 { length = Int64(l) }
        if player.isPlaying {
            if !everPlayed {
                everPlayed = true
                if resumeTo > 0 { player.time = VLCTime(int: Int32(truncatingIfNeeded: resumeTo)) }
            }
            if !appliedLang && time > 1500 { appliedLang = true; readTracks(); applyPreferredLanguages() }
            if Date().timeIntervalSince(lastSave) >= 10 { save() }
        }
        switch st {
        case .error: failed()
        case .ended: ended()
        case .opening, .buffering:
            // canal o video que no arranca en 25 s: se prueba la siguiente dirección
            if !everPlayed && Date().timeIntervalSince(openedAt) > 25 { failed() }
        default: break
        }
    }

    private func failed() {
        if urlIdx + 1 < urls.count {
            urlIdx += 1
            open(urls[urlIdx])
            return
        }
        if error == nil {
            error = kind == .live ? "No se pudo reproducir este canal" : "No se pudo reproducir este video"
            ErrorReport.report("playback", error!, detail: "\(entry.title) · \(kind.rawValue) \(entry.id) · estado \(player.state.rawValue)", screen: "player")
        }
        player.stop()
    }

    private func ended() {
        if kind == .live { failed(); return }
        save(force: true, done: true)
        if kind == .series && hasNext { load(index + 1) } else { player.stop(); onFinish?() }
    }

    func retry() { error = nil; urlIdx = 0; open(urls.first ?? "") }

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
        Cloud.shared.saveProgress(Progress(key: q.key, title: request.saveTitle.ifEmpty(q.title), label: q.title,
                                           poster: request.savePoster.ifEmpty(q.poster), position: pos, duration: dur,
                                           updated: Date().timeIntervalSince1970, url: urls.indices.contains(urlIdx) ? urls[urlIdx] : "",
                                           categoryId: request.category), force: force)
    }
}
