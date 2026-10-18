import SwiftUI

/** Logo de la app o del distribuidor (si no tiene logo, su nombre; nunca el logo de la app). */
struct LogoHeader: View {
    @EnvironmentObject var tenant: Tenant
    var height: CGFloat = 34

    var body: some View {
        if let b = tenant.brand {
            if !b.logoUrl.isEmpty {
                RemoteImage(url: b.logoUrl + (b.logoUrl.contains("?") ? "&" : "?") + "r=\(b.logoRev)", mode: .fit, maxPixel: 600)
                    .frame(maxWidth: height * 6, maxHeight: height)
            } else {
                Text(tenant.nameOr("MPX Player")).font(.system(size: height * 0.6, weight: .black)).foregroundColor(Theme.accent).lineLimit(1)
            }
        } else {
            Image("Logo").resizable().scaledToFit().frame(height: height).clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }
}

struct AppButton: View {
    let text: String
    var icon: String? = nil
    var primary = true
    var height: CGFloat = 48
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let i = icon { Image(systemName: i).font(.system(size: 16, weight: .bold)) }
                Text(text).font(.system(size: 16, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: height)
            .foregroundColor(primary ? Theme.p.onAccent : .white)
            .background(primary ? Theme.accent : Color.white.opacity(0.18))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }
}

struct Chip: View {
    let text: String
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                .padding(.horizontal, 14).padding(.vertical, 7)
                // elegido: en el acento del distribuidor (sin paleta, el rojo de siempre)
                .foregroundColor(selected ? Theme.p.onAccent : .white)
                .background(selected ? Theme.accent : Color.white.opacity(0.08))
                .overlay(Capsule().stroke(Color.white.opacity(selected ? 0.25 : 0.5), lineWidth: 1))  // borde: se ve aunque el acento sea oscuro
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct ErrorBanner: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 14)).foregroundColor(.white).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 12).background(Theme.warn).clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

struct LoadingView: View {
    let text: String
    var body: some View {
        VStack(spacing: 14) {
            ProgressView().tint(Theme.accent).scaleEffect(1.3)
            Text(text).foregroundColor(Theme.muted).font(.system(size: 15))
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.bg)
    }
}

struct EmptyMessage: View {
    let text: String
    var body: some View {
        Text(text).foregroundColor(Theme.muted).font(.system(size: 16)).multilineTextAlignment(.center).padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.bg)
    }
}

struct PosterCard: View {
    let item: Item
    let width: CGFloat
    var progress: Double = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .bottom) {
                ItemPoster(item: item)
                if progress > 0 {
                    ProgressBar(value: progress).frame(height: 3)
                }
            }
            .frame(width: width, height: width * 1.5)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }
}

struct ProgressBar: View {
    let value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color(hex: 0x4D4D4D))
                Rectangle().fill(Theme.accent).frame(width: g.size.width * min(1, max(0, value)))
            }
        }
    }
}

/** fila horizontal con título y "Ver todo" opcional */
struct ShelfRow<T, Cell: View>: View {
    let title: String
    let items: [T]
    var pad: CGFloat = 16
    var onViewAll: (() -> Void)? = nil
    @ViewBuilder let cell: (Int, T) -> Cell

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(title).font(.system(size: 18, weight: .bold)).foregroundColor(.white).lineLimit(1)
                    Spacer()
                    if let v = onViewAll {
                        Button(action: v) { HStack(spacing: 2) { Text(tr("Ver todo")); Image(systemName: "chevron.right") }.font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.muted) }
                    }
                }.padding(.horizontal, pad)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 8) {
                        ForEach(Array(items.enumerated()), id: \.offset) { i, it in cell(i, it) }
                    }.padding(.horizontal, pad)
                }
            }.padding(.vertical, 8)
        }
    }
}

/**
 * Fondo del inicio de sesión como la web y Android (.nf-login-wall): cuadrícula de pósters inclinada -8°
 * que sube despacio sin fin (120 s por vuelta), con la sombra negra encima. Sin pósters (el panel no
 * tiene clave TMDB) queda negro.
 */
struct PosterWall: View {
    let posters: [String]
    var columns = 4
    private let gap: CGFloat = 10
    private let period: Double = 120
    @State private var rolling = false

    var body: some View {
        GeometryReader { g in
            ZStack {
                Color.black
                if posters.count >= columns {
                    let width = g.size.width * 1.3
                    let w = (width - gap * CGFloat(columns - 1)) / CGFloat(columns)
                    let rowH = w * 1.5 + gap
                    // filas de la vuelta: las carátulas repetidas hasta cubrir la pantalla inclinada
                    let base = Array(posters.prefix(posters.count - posters.count % columns))
                    let baseRows = stride(from: 0, to: base.count, by: columns).map { Array(base[$0..<$0 + columns]) }
                    let reps = max(1, Int(ceil(g.size.height * 1.6 / (CGFloat(baseRows.count) * rowH))))
                    let loop = Array(repeating: baseRows, count: reps).flatMap { $0 }
                    let loopH = CGFloat(loop.count) * rowH
                    VStack(spacing: gap) {
                        ForEach(0..<(loop.count * 2), id: \.self) { r in
                            HStack(spacing: gap) {
                                ForEach(0..<columns, id: \.self) { c in
                                    RemoteImage(url: loop[r % loop.count][c], maxPixel: 300)
                                        .frame(width: w, height: w * 1.5)
                                        .background(Color(hex: 0x111111))
                                        .clipShape(RoundedRectangle(cornerRadius: 4))
                                }
                            }
                        }
                    }
                    .frame(width: width, alignment: .top)
                    // sube una vuelta (la segunda mitad es igual a la primera) y vuelve a empezar sin salto
                    .offset(y: (rolling ? -loopH : 0) - g.size.height * 0.2)
                    .animation(.linear(duration: period).repeatForever(autoreverses: false), value: rolling)
                    .frame(width: g.size.width, height: g.size.height, alignment: .top)
                    .rotationEffect(.degrees(-8))
                    .onAppear { rolling = true }
                }
                // .nf-login-shade
                Color.black.opacity(0.55)
                LinearGradient(colors: [Color.black.opacity(0.85), Color.black.opacity(0.35), Color.black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
            }
            .frame(width: g.size.width, height: g.size.height)
            .clipped()
        }
        .ignoresSafeArea()
    }
}

/** toast simple en la parte de abajo */
struct ToastModifier: ViewModifier {
    @Binding var text: String?
    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let t = text {
                Text(t).font(.system(size: 14, weight: .medium)).foregroundColor(.white).padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color.black.opacity(0.85)).clipShape(Capsule()).padding(.bottom, 90).padding(.horizontal, 20)
                    .transition(.opacity)
                    .task(id: t) { try? await Task.sleep(nanoseconds: 3_000_000_000); if text == t { withAnimation { text = nil } } }
            }
        }
    }
}

extension View {
    func toast(_ text: Binding<String?>) -> some View { modifier(ToastModifier(text: text)) }
}
