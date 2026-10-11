import Foundation
import Combine
import UIKit
import MobileVLCKit

/**
 * Miniatura de TV en vivo (como LivePreview de Android): reproduce el canal elegido arriba de la lista.
 * Prueba .m3u8 / .ts / sin extensión (y la IP del DNS elegido) y avisa si ninguna arranca.
 */
final class LivePreview: ObservableObject {
    private var player: VLCMediaPlayer?
    private weak var view: UIView?
    private var urls: [String] = []
    private var urlIdx = 0
    private var openedAt = Date()
    private var timer: Timer?
    private var seq = 0
    private var channelId = 0
    private var connecting = false

    /** canal que ya muestra imagen / canal que no se pudo reproducir */
    @Published private(set) var showingId = 0
    @Published private(set) var failedId = 0

    func attach(_ v: UIView) {
        view = v
        player?.drawable = v
    }

    func play(_ s: Session, _ ch: Item) {
        release()
        seq += 1
        let my = seq
        channelId = ch.id
        failedId = 0
        let raw = Xtream.liveUrls(s, ch.id)
        Task { @MainActor [weak self] in
            let list = await SecureDns.playable(raw)
            guard let self = self, self.seq == my else { return }
            self.urls = list.isEmpty ? raw : list
            self.urlIdx = 0
            let p = VLCMediaPlayer()
            p.drawable = self.view
            self.player = p
            self.open()
            self.timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
        }
    }

    /** suelta la conexión (pantalla completa, segundo plano o al salir de TV en vivo) */
    func release() {
        seq += 1
        timer?.invalidate(); timer = nil
        // en segundo plano: stop() espera a que VLC suelte la conexión y congelaría la lista
        if let p = player { p.drawable = nil; VLCRetire.stop(p) }
        player = nil
        showingId = 0
    }

    private func open() {
        guard let old = player, urls.indices.contains(urlIdx), let u = URL(string: urls[urlIdx]) else { fail(); return }
        // cada dirección con un reproductor nuevo (cambiar la de uno que no conecta bloquea)
        let p = VLCMediaPlayer()
        p.drawable = view
        player = p
        if old.media != nil { old.drawable = nil; VLCRetire.stop(old) }
        connecting = false
        let m = VLCMedia(url: u)
        m.addOption(":network-caching=2500")
        m.addOption(":http-user-agent=\(Net.ua)")
        m.addOption(":http-reconnect")
        p.media = m
        openedAt = Date()
        p.play()
    }

    private func tick() {
        guard let p = player else { return }
        if p.isPlaying && p.hasVideoOut || p.isPlaying && p.time.intValue > 800 {
            if showingId != channelId { showingId = channelId }
            return
        }
        if p.state == .opening || p.state == .buffering { connecting = true }
        switch p.state {
        case .error, .ended: next()
        case .stopped where connecting: next()
        case .opening, .buffering, .stopped, .paused:
            if showingId != channelId && Date().timeIntervalSince(openedAt) > 20 { next() }
        default: break
        }
    }

    private func next() {
        if urlIdx + 1 < urls.count { urlIdx += 1; open() } else { fail() }
    }

    private func fail() {
        let id = channelId
        release()
        failedId = id
    }

    deinit {
        timer?.invalidate()
        if let p = player { VLCRetire.stop(p) }
    }
}
