import SwiftUI
import AVKit
import WebKit

/**
 * Pantalla falsa a pantalla completa (equipo nuevo en una app elegida en el panel).
 * La calculadora funciona de verdad; el código del panel y "=" abre el inicio de sesión.
 * En imagen, carrusel, video o web: mantener pulsado 3 s para escribir el código.
 * Abajo, pequeño, el ID del equipo para que el distribuidor lo registre: al registrarse la app se abre sola.
 */
struct FakeScreenView: View {
    let screen: FakeScreen
    let onUnlock: () -> Void
    @State private var askCode = false
    @State private var code = ""

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(hex: 0x111827).ignoresSafeArea()
            switch screen.type {
            case "carrusel": Carousel(images: screen.images, interval: screen.interval).onLongPressGesture(minimumDuration: 3) { ask() }
            case "image": RemoteImage(url: screen.url, mode: .fit, maxPixel: 2000).ignoresSafeArea().onLongPressGesture(minimumDuration: 3) { ask() }
            case "video": LoopVideo(url: screen.url).ignoresSafeArea().onLongPressGesture(minimumDuration: 3) { ask() }
            case "web": WebPage(url: screen.url).ignoresSafeArea().onLongPressGesture(minimumDuration: 3) { ask() }
            default: Calculator(unlock: screen.unlock, onUnlock: onUnlock)
            }
            Text("ID \(Device.id)").font(.system(size: 10, design: .monospaced)).foregroundColor(Color.white.opacity(0.33)).padding(.bottom, 4)
        }
        .alert(tr("Código"), isPresented: $askCode) {
            SecureField(tr("Código"), text: $code).keyboardType(.numberPad)
            Button(tr("Abrir")) { if !screen.unlock.isEmpty && code == screen.unlock { onUnlock() }; code = "" }
            Button(tr("Cancelar"), role: .cancel) { code = "" }
        }
    }

    private func ask() { if !screen.unlock.isEmpty { askCode = true } }
}

private struct Carousel: View {
    let images: [String]
    let interval: Int
    @State private var i = 0
    var body: some View {
        ZStack { if !images.isEmpty { RemoteImage(url: images[i % images.count], mode: .fit, maxPixel: 2000) } }
            .frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(Rectangle())
            .task(id: images) {
                while images.count > 1 && !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000_000)
                    withAnimation { i = (i + 1) % images.count }
                }
            }
    }
}

private struct LoopVideo: UIViewControllerRepresentable {
    let url: String
    final class Holder { var looper: AVPlayerLooper? }
    func makeCoordinator() -> Holder { Holder() }
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.showsPlaybackControls = false
        vc.videoGravity = .resizeAspect
        if let u = URL(string: url) {
            let p = AVQueuePlayer()
            p.isMuted = true
            context.coordinator.looper = AVPlayerLooper(player: p, templateItem: AVPlayerItem(url: u))
            vc.player = p
            p.play()
        }
        return vc
    }
    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {}
    static func dismantleUIViewController(_ vc: AVPlayerViewController, coordinator: Holder) { vc.player?.pause(); coordinator.looper = nil }
}

private struct WebPage: UIViewRepresentable {
    let url: String
    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = .nonPersistent()
        let w = WKWebView(frame: .zero, configuration: c)
        if let u = URL(string: url) { w.load(URLRequest(url: u)) }
        return w
    }
    func updateUIView(_ w: WKWebView, context: Context) {}
}

/* ---------------- calculadora ---------------- */
private struct Calculator: View {
    let unlock: String
    let onUnlock: () -> Void
    @State private var expr = ""
    @State private var result = "0"

    private let keys: [[String]] = [["C", "(", ")", "÷"], ["7", "8", "9", "×"], ["4", "5", "6", "-"], ["1", "2", "3", "+"], ["0", ".", "⌫", "="]]

    var body: some View {
        GeometryReader { g in
            VStack(spacing: 10) {
                Spacer()
                Text(expr.isEmpty ? " " : expr).font(.system(size: 28)).foregroundColor(Color.white.opacity(0.6)).lineLimit(1).minimumScaleFactor(0.5).frame(maxWidth: .infinity, alignment: .trailing)
                Text(result).font(.system(size: 56, weight: .light)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.4).frame(maxWidth: .infinity, alignment: .trailing)
                let w = min((g.size.width - 32 - 30) / 4, 90)
                ForEach(keys, id: \.self) { row in
                    HStack(spacing: 10) {
                        ForEach(row, id: \.self) { k in
                            Button { press(k) } label: {
                                Text(k).font(.system(size: 28, weight: .medium)).foregroundColor(.white)
                                    .frame(width: w, height: w * 0.8)
                                    .background(["÷", "×", "-", "+", "="].contains(k) ? Color(hex: 0xF59E0B) : k == "C" ? Color(hex: 0x6B7280) : Color(hex: 0x374151))
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                            }.buttonStyle(.plain)
                        }
                    }
                }
                Spacer().frame(height: 24)
            }.padding(.horizontal, 16)
        }
    }

    private func press(_ k: String) {
        switch k {
        case "C": expr = ""; result = "0"
        case "⌫": if !expr.isEmpty { expr.removeLast() }
        case "=":
            // el código del panel seguido de "=" abre el inicio de sesión
            if !unlock.isEmpty && expr == unlock { onUnlock(); return }
            result = Calc.eval(expr).map(Calc.fmt) ?? "Error"
        default: if expr.count < 40 { expr += k }
        }
    }
}

/** evaluador de + - × ÷ y paréntesis (sin NSExpression ni eval) */
enum Calc {
    static func eval(_ s: String) -> Double? {
        var p = Parser(Array(s.replacingOccurrences(of: "×", with: "*").replacingOccurrences(of: "÷", with: "/")))
        guard let v = p.expr(), p.i == p.c.count, v.isFinite else { return nil }
        return v
    }
    static func fmt(_ v: Double) -> String {
        if v == v.rounded() && abs(v) < 1e15 { return String(Int64(v)) }
        return String(format: "%.8g", v)
    }
    private struct Parser {
        let c: [Character]
        var i = 0
        init(_ c: [Character]) { self.c = c }
        mutating func expr() -> Double? {
            guard var v = term() else { return nil }
            while i < c.count, c[i] == "+" || c[i] == "-" {
                let op = c[i]; i += 1
                guard let r = term() else { return nil }
                v = op == "+" ? v + r : v - r
            }
            return v
        }
        mutating func term() -> Double? {
            guard var v = factor() else { return nil }
            while i < c.count, c[i] == "*" || c[i] == "/" {
                let op = c[i]; i += 1
                guard let r = factor() else { return nil }
                v = op == "*" ? v * r : v / r
            }
            return v
        }
        mutating func factor() -> Double? {
            guard i < c.count else { return nil }
            if c[i] == "-" { i += 1; return factor().map { -$0 } }
            if c[i] == "(" {
                i += 1
                let v = expr()
                guard i < c.count, c[i] == ")" else { return nil }
                i += 1
                return v
            }
            var n = ""
            while i < c.count, c[i].isNumber || c[i] == "." { n.append(c[i]); i += 1 }
            return Double(n)
        }
    }
}
