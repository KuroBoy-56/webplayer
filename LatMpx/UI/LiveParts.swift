import SwiftUI
import UIKit

/** colores de tvguide.php (web), los mismos que Android */
enum LiveColors {
    static let bg = Color(hex: 0x141414)
    static let col = Color(hex: 0x1A1A1A)
    static let logoBg = Color(hex: 0x0D0D0D)
    static let active = Color(hex: 0x333333)
    static let line = Color(hex: 0x262626)
    static let empty = Color(hex: 0x888888)
}

private struct PreviewSurface: UIViewRepresentable {
    let preview: LivePreview
    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .black
        v.isUserInteractionEnabled = false
        preview.attach(v)
        return v
    }
    func updateUIView(_ v: UIView, context: Context) {}
}

/** miniatura del canal elegido: logo mientras arranca, "EN VIVO", lo que se emite y pantalla completa */
struct LivePlayerBox: View {
    @ObservedObject var preview: LivePreview
    let channel: Item?
    let active: Bool
    let nowProg: EpgEntry?
    let now: Double
    let onStart: () -> Void
    let onRetry: () -> Void
    let onFull: () -> Void

    var body: some View {
        ZStack {
            Color.black
            PreviewSurface(preview: preview).allowsHitTesting(false)
            if let ch = channel {
                let showing = active && preview.showingId == ch.id
                let failed = active && preview.failedId == ch.id
                if !showing {
                    ZStack {
                        Color.black
                        GeometryReader { g in
                            ChannelLogo(url: ch.poster, background: .clear)
                                .frame(width: g.size.width * 0.42, height: g.size.width * 0.42 * 9 / 16)
                                .position(x: g.size.width / 2, y: g.size.height / 2)
                        }
                        LinearGradient(colors: [Color.black.opacity(0.2), Color.black.opacity(0.13), Color.black.opacity(0.8)], startPoint: .top, endPoint: .bottom)
                    }
                    .allowsHitTesting(false)
                    if failed {
                        VStack(spacing: 10) {
                            Text("No se pudo reproducir este canal").font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                            Button(action: onRetry) {
                                Text("Reintentar").font(.system(size: 13, weight: .bold)).foregroundColor(.black)
                                    .padding(.horizontal, 14).padding(.vertical, 6).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 4))
                            }.buttonStyle(.plain)
                        }
                    } else if active {
                        ProgressView().tint(Theme.accent).scaleEffect(1.5).allowsHitTesting(false)
                    } else {
                        Button(action: onStart) {
                            Image(systemName: "play.fill").font(.system(size: 30)).foregroundColor(.white)
                                .frame(width: 64, height: 64)
                                .background(Circle().fill(Color.black.opacity(0.6)))
                                .overlay(Circle().stroke(Color.white.opacity(0.8), lineWidth: 2))
                        }.buttonStyle(.plain).accessibilityLabel("Ver")
                    }
                    if let p = nowProg {
                        VStack(alignment: .leading, spacing: 6) {
                            Spacer()
                            Text("\(hm(p.start)) - \(hm(p.end)) · \(p.title)").font(.system(size: 13, weight: .semibold)).foregroundColor(.white).lineLimit(1)
                            ProgressLine(program: p, now: now)
                        }
                        .padding(.leading, 12).padding(.trailing, 56).padding(.vertical, 10)
                        .allowsHitTesting(false)
                    }
                }
                VStack {
                    HStack {
                        Text("EN VIVO").font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(Theme.accent).clipShape(RoundedRectangle(cornerRadius: 3))
                        Spacer()
                    }
                    Spacer()
                    if active {
                        HStack {
                            Spacer()
                            Button(action: onFull) {
                                Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 17, weight: .semibold)).foregroundColor(.white)
                                    .frame(width: 40, height: 40).background(Circle().fill(Color.black.opacity(0.55)))
                            }.buttonStyle(.plain).accessibilityLabel("Pantalla completa")
                        }
                    }
                }
                .padding(10)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "tv").font(.system(size: 46)).foregroundColor(LiveColors.empty.opacity(0.5))
                    Text("Selecciona un canal para comenzar a ver").font(.system(size: 14)).foregroundColor(LiveColors.empty).multilineTextAlignment(.center)
                }
                .padding(16)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if channel != nil && !active { onStart() } }
        .clipped()
    }
}

/** fila de canal: logo, nombre y lo que se emite ahora con su barra de avance */
struct LiveRow: View {
    let channel: Item
    let index: Int
    let shown: [Item]
    let active: Bool
    let fav: Bool
    let now: Double
    @State private var epg: [EpgEntry]?

    var body: some View {
        let cur = epg?.first { $0.start <= now && $0.end > now }
        HStack(spacing: 12) {
            ChannelLogo(url: channel.poster).frame(width: 54, height: 36).clipShape(RoundedRectangle(cornerRadius: 3))
            VStack(alignment: .leading, spacing: 4) {
                Text(channel.name).font(.system(size: 14, weight: active ? .bold : .regular)).foregroundColor(Color(hex: 0xEEEEEE)).lineLimit(1)
                if let c = cur {
                    Text(c.title).font(.system(size: 12)).foregroundColor(Color(hex: 0xB3B3B3)).lineLimit(1)
                    ProgressLine(program: c, now: now)
                }
            }
            Spacer(minLength: 0)
            if fav {
                Image(systemName: "star.fill").font(.system(size: 14)).foregroundColor(Theme.accent)
            } else if active {
                Image(systemName: "star").font(.system(size: 14)).foregroundColor(Color.white.opacity(0.4))
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(active ? LiveColors.active : Color.clear)
        .overlay(alignment: .leading) { if active { Rectangle().fill(Theme.accent).frame(width: 3) } }
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .padding(.horizontal, 8)
        .task(id: channel.id) {
            // guía del panel por lotes: la primera fila visible pide también las siguientes (hasta 400)
            if let c = await PanelEpg.shared.cached(channel.id) { epg = c; return }
            let from = min(index, shown.count), to = min(shown.count, index + 400)
            epg = await PanelEpg.shared.guide(channel, neighbors: Array(shown[from..<to]))
        }
    }
}

/** programa de la guía (el actual resaltado en rojo) */
struct ProgramRow: View {
    let program: EpgEntry
    let now: Double

    var body: some View {
        let on = program.start <= now && program.end > now
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                Text("\(hm(program.start)) - \(hm(program.end))").font(.system(size: 14)).foregroundColor(on ? Theme.accent : Color(hex: 0x999999))
                    .frame(width: 104, alignment: .leading)
                VStack(alignment: .leading, spacing: 6) {
                    Text(program.title).font(.system(size: 14, weight: on ? .bold : .regular)).foregroundColor(on ? .white : Color(hex: 0xDDDDDD)).lineLimit(2)
                    if on { ProgressLine(program: program, now: now) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            Rectangle().fill(LiveColors.line).frame(height: 1)
        }
        .background(on ? Theme.accent.opacity(0.12) : Color.clear)
    }
}

struct ProgressLine: View {
    let program: EpgEntry
    let now: Double
    var body: some View {
        let pct = program.end > program.start ? min(1, max(0, (now - program.start) / (program.end - program.start))) : 0
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Color(hex: 0x444444)
                Theme.accent.frame(width: g.size.width * pct)
            }
        }
        .frame(height: 3).clipShape(RoundedRectangle(cornerRadius: 2))
    }
}

/** logo del canal (o el de la app si no tiene) */
struct ChannelLogo: View {
    let url: String
    var background: Color = LiveColors.logoBg
    var body: some View {
        ZStack {
            background
            if url.isEmpty { Image("Logo").resizable().scaledToFit().padding(2) }
            else { RemoteImage(url: url, mode: .fit, maxPixel: 200).padding(2) }
        }
    }
}
