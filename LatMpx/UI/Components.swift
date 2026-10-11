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
                Text(tenant.nameOr("LatMpx")).font(.system(size: height * 0.6, weight: .black)).foregroundColor(Theme.accent).lineLimit(1)
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
                .foregroundColor(selected ? .black : .white)
                .background(selected ? Color.white : Color.white.opacity(0.08))
                .overlay(Capsule().stroke(Color.white.opacity(selected ? 0 : 0.5), lineWidth: 1))
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
                        Button(action: v) { HStack(spacing: 2) { Text("Ver todo"); Image(systemName: "chevron.right") }.font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.muted) }
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

/** fondo de pósters del inicio de sesión (TMDB) */
struct PosterWall: View {
    let posters: [String]
    var columns = 4

    var body: some View {
        GeometryReader { g in
            let w = g.size.width / CGFloat(columns)
            let rows = Int(ceil(g.size.height / (w * 1.5))) + 1
            VStack(spacing: 0) {
                ForEach(0..<rows, id: \.self) { r in
                    HStack(spacing: 0) {
                        ForEach(0..<columns, id: \.self) { c in
                            let i = r * columns + c
                            if !posters.isEmpty { RemoteImage(url: posters[i % posters.count], maxPixel: 300).frame(width: w, height: w * 1.5).clipped() }
                            else { Color.black.frame(width: w, height: w * 1.5) }
                        }
                    }
                }
            }
            .overlay(LinearGradient(colors: [Color.black.opacity(0.85), Color.black.opacity(0.55), Color.black.opacity(0.9)], startPoint: .top, endPoint: .bottom))
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
