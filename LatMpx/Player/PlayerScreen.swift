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
                    .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { controls.toggle() }; if controls { autoHide() } }
                    .gesture(DragGesture(minimumDistance: 40).onEnded { v in
                        guard m.kind == .live, abs(v.translation.height) > abs(v.translation.width) else { return }
                        if v.translation.height < 0 { m.next() } else { m.previous() }
                    })
                // cargando sin controles: solo el círculo con la rueda (con controles va dentro del botón central)
                if m.buffering && m.error == nil && !controls {
                    ProgressView().tint(.white).scaleEffect(1.5).glassCircle(84).allowsHitTesting(false).transition(.opacity)
                }
                if let e = m.error { errorBox(e) }
                if controls && m.error == nil { controlsLayer.transition(.opacity) }
                // estado para la prueba del simulador: siempre presente (los controles se ocultan solos)
                Text(m.playing ? "playing" : "paused").font(.system(size: 1)).opacity(0.02).frame(width: 1, height: 1)
                    .allowsHitTesting(false).accessibilityIdentifier("player.state")
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

    /** controles: barra de arriba, botones del centro y barra de avance, sobre sombras arriba y abajo */
    private var controlsLayer: some View {
        ZStack {
            VStack(spacing: 0) {
                LinearGradient(colors: [Color.black.opacity(0.75), .clear], startPoint: .top, endPoint: .bottom).frame(height: 140)
                Spacer()
                LinearGradient(colors: [.clear, Color.black.opacity(0.85)], startPoint: .top, endPoint: .bottom).frame(height: 190)
            }
            .ignoresSafeArea().allowsHitTesting(false)
            VStack(spacing: 0) {
                topBar
                Spacer()
                bottomBar
            }
            .padding(.horizontal, 16)
            centerControls
        }
        .foregroundColor(.white)
        .buttonStyle(PlayerPress())
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button { close() } label: { playerBarIcon("xmark") }
                .accessibilityIdentifier("player.close").accessibilityLabel(tr("Cerrar"))
            VStack(alignment: .leading, spacing: 3) {
                Text(m.entry.title).font(.system(size: 17, weight: .bold)).lineLimit(1)
                subtitle
            }
            Spacer(minLength: 12)
            if m.kind == .live { Button { channels = true } label: { playerBarIcon("list.bullet") }.accessibilityLabel(tr("Canales")) }
            Button { m.readTracks(); tracks = true } label: { playerBarIcon("captions.bubble") }
                .accessibilityLabel(tr("Audio y subtítulos"))
            Button { m.fill.toggle(); m.applyFill(size); state.toast = nil } label: {
                playerBarIcon(m.fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
            }
            .accessibilityLabel(tr("Pantalla completa"))
        }
        .padding(.top, 8)
    }

    /** debajo del título: EN VIVO en canales, el nombre de la serie en episodios */
    @ViewBuilder private var subtitle: some View {
        if m.kind == .live {
            HStack(spacing: 6) {
                Circle().fill(Theme.accent).frame(width: 7, height: 7)
                Text(tr("EN VIVO")).font(.system(size: 11, weight: .heavy)).tracking(0.8)
            }
        } else if !m.request.saveTitle.isEmpty && m.request.saveTitle != m.entry.title {
            Text(m.request.saveTitle).font(.system(size: 13, weight: .medium)).foregroundColor(.white.opacity(0.7)).lineLimit(1)
        }
    }

    private var centerControls: some View {
        HStack(spacing: 48) {
            if m.kind == .live {
                Button { m.previous(); autoHide() } label: { Image(systemName: "chevron.up").font(.system(size: 24, weight: .semibold)).glassCircle(60) }
            } else {
                Button { m.seek(by: -10); autoHide() } label: { Image(systemName: "gobackward.10").font(.system(size: 25, weight: .medium)).glassCircle(60) }
            }
            Button { m.toggle(); autoHide() } label: {
                ZStack {
                    if m.buffering {
                        ProgressView().tint(.white).scaleEffect(1.5)
                    } else {
                        // el triángulo de play se ve corrido a la izquierda si se centra exacto
                        Image(systemName: m.playing ? "pause.fill" : "play.fill").font(.system(size: 34, weight: .bold)).offset(x: m.playing ? 0 : 3)
                    }
                }
                .glassCircle(84)
            }
            .accessibilityIdentifier("player.toggle").accessibilityLabel(tr(m.playing ? "Pausar" : "Reproducir"))
            .accessibilityValue(m.playing ? "playing" : "paused")
            if m.kind == .live {
                Button { m.next(); autoHide() } label: { Image(systemName: "chevron.down").font(.system(size: 24, weight: .semibold)).glassCircle(60) }
            } else {
                Button { m.seek(by: 10); autoHide() } label: { Image(systemName: "goforward.10").font(.system(size: 25, weight: .medium)).glassCircle(60) }
                    .accessibilityIdentifier("player.forward")
            }
        }
    }

    @ViewBuilder private var bottomBar: some View {
        if m.kind != .live {
            let shown = scrub.map { Int64(Double(m.length) * $0) } ?? m.time
            VStack(spacing: 8) {
                if m.kind == .series && m.hasNext {
                    HStack {
                        Spacer()
                        Button { m.next() } label: {
                            Label(tr("Siguiente episodio"), systemImage: "forward.end.fill").font(.system(size: 14, weight: .semibold))
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(.ultraThinMaterial, in: Capsule())
                                .contentShape(Capsule())
                        }
                    }
                }
                HStack(spacing: 12) {
                    Text(fmtTime(shown)).font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .accessibilityIdentifier("player.time")
                    ScrubBar(value: m.length > 0 ? Double(m.time) / Double(m.length) : 0, scrub: $scrub) { f in
                        m.seek(to: f); scrub = nil; autoHide()
                    }
                    .accessibilityValue(fmtTime(shown))
                    .accessibilityAdjustableAction { d in
                        switch d {
                        case .increment: m.seek(by: 10)
                        case .decrement: m.seek(by: -10)
                        @unknown default: break
                        }
                    }
                    Text("-" + fmtTime(max(0, m.length - shown))).font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .foregroundColor(.white.opacity(0.75))
                }
            }
            .padding(.horizontal, 8).padding(.bottom, 12)
        } else {
            Text(tr("Desliza arriba o abajo para cambiar de canal")).font(.system(size: 12, weight: .medium)).foregroundColor(.white.opacity(0.7)).padding(.bottom, 16)
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
