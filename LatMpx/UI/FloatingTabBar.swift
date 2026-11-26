import SwiftUI

/**
 * Barra de abajo flotante como la app de Netflix (y Android 1.5.6): cápsula oscura con Inicio, TV en vivo, Buscar y
 * Perfil (la inicial del usuario; abre Mi cuenta). Series, Películas, Deportes y Mi lista están arriba, en Inicio, así
 * que con Series o Películas abiertas sigue resaltado Inicio. En iPad un poco más grande. El espacio que ocupa lo
 * reserva MainView con safeAreaInset: las listas pasan por detrás y lo último queda arriba de la barra.
 */
struct FloatingTabBar: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    let big: Bool

    static func height(big: Bool) -> CGFloat { big ? 76 : 64 }

    var body: some View {
        let cur: Tab = [.live, .search, .account].contains(state.tab) ? state.tab : .home
        HStack(spacing: 0) {
            item(.home, icon: "house", label: tr("Inicio"), cur: cur)
            item(.live, icon: "play.tv", label: tr("TV en vivo"), cur: cur)
            item(.search, icon: "magnifyingglass", label: tr("Buscar"), cur: cur)
            item(.account, icon: nil, label: tr("Perfil"), cur: cur)
        }
        .padding(5)
        .frame(maxWidth: big ? 640 : 520)
        .frame(height: Self.height(big: big))
        .background(Capsule().fill(Color(hex: 0x232323, alpha: 0.96)))
        .overlay(Capsule().stroke(Color.white.opacity(0.1), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 14, y: 4)
        .padding(.horizontal, 22)
        .padding(.bottom, 8)
    }

    private func item(_ t: Tab, icon: String?, label: String, cur: Tab) -> some View {
        let sel = t == cur
        let tint: Color = sel ? .white : Color(hex: 0xA6A6A6)
        return Button { state.open(t) } label: {
            VStack(spacing: 3) {
                if let icon {
                    Image(systemName: icon).font(.system(size: big ? 26 : 21, weight: .regular)).frame(height: big ? 30 : 25)
                } else {
                    // perfil: la inicial del usuario en el color del panel (dueño o distribuidor)
                    Text(String(cloud.shownUser(state.session).prefix(1)).uppercased().isEmpty ? "U" : String(cloud.shownUser(state.session).prefix(1)).uppercased())
                        .font(.system(size: big ? 15 : 13, weight: .bold)).foregroundColor(Theme.p.onAccent)
                        .frame(width: big ? 30 : 25, height: big ? 30 : 25)
                        .background(LinearGradient(colors: [Theme.accent, Theme.accent.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                Text(label).font(.system(size: big ? 13 : 11, weight: sel ? .semibold : .regular)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundColor(tint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Capsule().fill(sel ? Color(hex: 0x3D3D3D) : .clear))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(sel ? .isSelected : [])
    }
}
