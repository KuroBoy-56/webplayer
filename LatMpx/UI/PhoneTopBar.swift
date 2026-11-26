import SwiftUI

/**
 * Barra superior como la app de Netflix (y Android 1.5.6): el logo y el nombre de la sección («Inicio», «Series»,
 * «Películas») con Mis descargas a la derecha; debajo los filtros Series / Películas / Deportes / Mi lista (con ✕ para
 * volver al inicio). Buscar y el perfil están en la barra de abajo (FloatingTabBar). Transparente sobre los destacados
 * y oscura al bajar; en iPad un poco más grande.
 */
struct PhoneTopBar: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var tenant: Tenant
    let current: Tab?
    var solid = false
    var pad: CGFloat = 16

    private var big: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    private var title: String {
        switch current {
        case .series: return tr("Series")
        case .movies: return tr("Películas")
        default: return tr("Inicio")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                LogoHeader(height: big ? 40 : 34)
                Text(title).font(.system(size: big ? 32 : 28, weight: .bold)).foregroundColor(.white).lineLimit(1)
                Spacer()
                Button { state.push(.downloads) } label: {
                    Image(systemName: "arrow.down.to.line").font(.system(size: big ? 24 : 21, weight: .semibold)).foregroundColor(.white)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }.accessibilityLabel(tr("Mis descargas"))
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    if current != nil { TopChip(text: "✕", big: big) { state.open(.home) }.accessibilityLabel(tr("Inicio")) }
                    TopChip(text: tr("Series"), selected: current == .series, big: big) { state.open(.series) }
                    TopChip(text: tr("Películas"), selected: current == .movies, big: big) { state.open(.movies) }
                    if tenant.sportsEnabled { TopChip(text: tr("Deportes"), big: big) { state.push(.sports) } }
                    TopChip(text: tr("Mi lista"), big: big) { state.push(.saved(false)) }
                }
            }
        }
        .padding(.horizontal, pad).padding(.top, 6).padding(.bottom, 10)
        .background(
            ZStack {
                (solid ? Color(hex: 0x141414, alpha: 0.95) : Color.clear)
                LinearGradient(colors: [Color.black.opacity(0.7), .clear], startPoint: .top, endPoint: .bottom)
            }
            .ignoresSafeArea(edges: .top)
            .animation(.easeInOut(duration: 0.2), value: solid)
        )
    }
}

/** filtro de arriba como Netflix: recuadro gris redondeado (el elegido, blanco) */
private struct TopChip: View {
    let text: String
    var selected = false
    var big = false
    let action: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 12)
        Button(action: action) {
            Text(text).font(.system(size: big ? 18 : 16, weight: .semibold)).lineLimit(1)
                .padding(.horizontal, 18).padding(.vertical, big ? 12 : 10)
                .foregroundColor(selected ? .black : .white)
                .background(shape.fill(selected ? Color.white : Color.white.opacity(0.18)))
                .overlay(shape.stroke(Color.white.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/** posición del scroll (para que la barra superior se oscurezca al bajar) */
struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct ScrollOffsetReader: View {
    let space: String
    var body: some View {
        GeometryReader { g in Color.clear.preference(key: ScrollOffsetKey.self, value: -g.frame(in: .named(space)).minY) }.frame(height: 0)
    }
}
