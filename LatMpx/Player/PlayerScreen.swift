import SwiftUI
import Combine
import UIKit

private struct VideoSurface: UIViewRepresentable {
    let model: PlayerModel
    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .black
        // los toques los recibe la capa de SwiftUI de encima, nunca la vista de VLC
        v.isUserInteractionEnabled = false
        model.attach(v)
        return v
    }
    func updateUIView(_ v: UIView, context: Context) {}
}

/** Reproductor a pantalla completa: tocar muestra u oculta los controles. */
struct PlayerScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var m: PlayerModel
    @State private var controls = true
    @State private var hideTask: Task<Void, Never>?
    @State private var scrub: Double?
    @State private var tracks = false
    @State private var channels = false
    @State private var size: CGSize = .zero

    init(request: PlayRequest) { _m = StateObject(wrappedValue: PlayerModel(request: request)) }

    var body: some View {
        GeometryReader { g in
            ZStack {
                Color.black.ignoresSafeArea()
                VideoSurface(model: m).ignoresSafeArea().allowsHitTesting(false)
                    .onAppear { size = g.size }
                    .onChange(of: g.size) { s in size = s; m.applyFill(s) }
                // capa de toques: mostrar u ocultar controles y, en canales, deslizar para cambiar
                Color.clear.contentShape(Rectangle()).ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { controls.toggle() }; if controls { autoHide() } }
                    .gesture(DragGesture(minimumDistance: 40).onEnded { v in
                        guard m.kind == .live, abs(v.translation.height) > abs(v.translation.width) else { return }
                        if v.translation.height < 0 { m.next() } else { m.previous() }
                    })
                if m.buffering && m.error == nil { ProgressView().tint(.white).scaleEffect(1.6).allowsHitTesting(false) }
                if let e = m.error { errorBox(e) }
                if controls && m.error == nil { overlay }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("player.screen")
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .toast($m.toast)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            m.onFinish = { close() }
            m.start()
            autoHide()
        }
        .onDisappear {
            m.stop()
            UIApplication.shared.isIdleTimerDisabled = false
            state.refresh += 1
        }
        .confirmationDialog(tr("Audio y subtítulos"), isPresented: $tracks, titleVisibility: .visible) {
            ForEach(m.audio, id: \.self) { t in Button("🔊 " + t.name + (t.id == m.currentAudio ? " ✓" : "")) { m.setAudio(t.id, t.name) } }
            ForEach(m.subs, id: \.self) { t in Button("💬 " + t.name + (t.id == m.currentSub ? " ✓" : "")) { m.setSub(t.id, t.name) } }
            Button(tr("Cancelar"), role: .cancel) {}
        }
        .sheet(isPresented: $channels) { channelList }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            // abierto al girar el teléfono en TV en vivo: ponerlo vertical vuelve a la miniatura
            if m.request.closeOnPortrait && UIDevice.current.orientation == .portrait { close() }
        }
    }

    private func close() {
        PlayerDiag.log("cerrar")
        m.stop()
        if state.play?.id == m.request.id { state.play = nil }
    }

    private func autoHide() {
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            if !Task.isCancelled && m.playing && scrub == nil { withAnimation { controls = false } }
        }
    }

    private var overlay: some View {
        ZStack {
            LinearGradient(colors: [Color.black.opacity(0.7), .clear, .clear, Color.black.opacity(0.8)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea().allowsHitTesting(false)
            VStack {
                HStack(spacing: 18) {
                    Button { close() } label: { Image(systemName: "xmark").font(.system(size: 22, weight: .semibold)).frame(width: 44, height: 44) }
                        .accessibilityIdentifier("player.close").accessibilityLabel(tr("Cerrar"))
                    Text(m.entry.title).font(.system(size: 17, weight: .semibold)).lineLimit(1)
                    Spacer()
                    if m.kind == .live { Button { channels = true } label: { Image(systemName: "list.bullet").font(.system(size: 20)) }.accessibilityLabel(tr("Canales")) }
                    Button { m.readTracks(); tracks = true } label: { Image(systemName: "captions.bubble").font(.system(size: 20)) }
                        .accessibilityLabel(tr("Audio y subtítulos"))
                    Button { m.fill.toggle(); m.applyFill(size); state.toast = nil } label: {
                        Image(systemName: m.fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right").font(.system(size: 20))
                    }
                }.padding(.horizontal, 20).padding(.top, 14)
                Spacer()
                HStack(spacing: 56) {
                    if m.kind == .live {
                        Button { m.previous(); autoHide() } label: { Image(systemName: "chevron.up.circle").font(.system(size: 38)) }
                    } else {
                        Button { m.seek(by: -10); autoHide() } label: { Image(systemName: "gobackward.10").font(.system(size: 34)).frame(width: 56, height: 56) }
                    }
                    Button { m.toggle(); autoHide() } label: { Image(systemName: m.playing ? "pause.fill" : "play.fill").font(.system(size: 46)).frame(width: 70, height: 70) }
                        .accessibilityIdentifier("player.toggle").accessibilityLabel(tr(m.playing ? "Pausar" : "Reproducir"))
                        .accessibilityValue(m.playing ? "playing" : "paused")
                    if m.kind == .live {
                        Button { m.next(); autoHide() } label: { Image(systemName: "chevron.down.circle").font(.system(size: 38)) }
                    } else {
                        Button { m.seek(by: 10); autoHide() } label: { Image(systemName: "goforward.10").font(.system(size: 34)).frame(width: 56, height: 56) }
                            .accessibilityIdentifier("player.forward")
                    }
                }
                Spacer()
                if m.kind != .live {
                    VStack(spacing: 6) {
                        Slider(value: Binding(get: { scrub ?? (m.length > 0 ? Double(m.time) / Double(m.length) : 0) }, set: { scrub = $0 }),
                               in: 0...1, onEditingChanged: { editing in
                                   if !editing, let f = scrub { m.seek(to: f); scrub = nil; autoHide() }
                               })
                            .tint(Theme.accent)
                        HStack {
                            Text(fmtTime(scrub.map { Int64(Double(m.length) * $0) } ?? m.time)).font(.system(size: 13, design: .monospaced))
                                .accessibilityIdentifier("player.time")
                            Spacer()
                            if m.kind == .series && m.hasNext {
                                Button { m.next() } label: { Label(tr("Siguiente episodio"), systemImage: "forward.end.fill").font(.system(size: 14, weight: .semibold)) }
                            }
                            Spacer()
                            Text("-" + fmtTime(max(0, m.length - m.time))).font(.system(size: 13, design: .monospaced))
                        }
                    }.padding(.horizontal, 24).padding(.bottom, 18)
                } else {
                    Text(tr("Desliza arriba o abajo para cambiar de canal")).font(.system(size: 12)).foregroundColor(.white.opacity(0.7)).padding(.bottom, 18)
                }
            }
            .foregroundColor(.white)
        }
    }

    private func errorBox(_ e: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 34)).foregroundColor(Theme.warn)
            Text(e).font(.system(size: 16, weight: .semibold)).foregroundColor(.white).multilineTextAlignment(.center)
            Text(m.entry.title).font(.system(size: 13)).foregroundColor(.white.opacity(0.7)).lineLimit(1)
            if let d = m.errorDetail {
                Text(d).font(.system(size: 11)).foregroundColor(.white.opacity(0.5)).multilineTextAlignment(.center).lineLimit(3)
            }
            HStack(spacing: 12) {
                AppButton(text: tr("Reintentar"), height: 42) { m.retry() }.frame(width: 150)
                if m.kind == .live { AppButton(text: tr("Siguiente canal"), primary: false, height: 42) { m.next() }.frame(width: 170) }
                AppButton(text: tr("Salir"), primary: false, height: 42) { close() }.frame(width: 110).accessibilityIdentifier("player.exit")
            }
        }
        .padding(24).background(Color.black.opacity(0.8)).clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var channelList: some View {
        NavigationStack {
            List {
                ForEach(Array(m.request.queue.enumerated()), id: \.offset) { i, q in
                    Button { channels = false; m.jump(to: i) } label: {
                        HStack(spacing: 12) {
                            RemoteImage(url: q.poster, mode: .fit, maxPixel: 160).frame(width: 52, height: 32).background(Color(hex: 0x222222)).clipShape(RoundedRectangle(cornerRadius: 4))
                            Text(q.title).foregroundColor(i == m.index ? Theme.accent : .white).lineLimit(1)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle(tr("Canales")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(tr("Cerrar")) { channels = false } } }
        }
        .preferredColorScheme(.dark)
    }
}
