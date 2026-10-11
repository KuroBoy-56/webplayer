import SwiftUI

/**
 * Barra superior como la app de Android para celular: "Para <usuario>" (inicio) o el logo, buscar y
 * perfil; debajo los filtros Series / Películas / Deportes / Mi lista (con ✕ para volver al inicio).
 * Transparente sobre los destacados y oscura al bajar.
 */
struct PhoneTopBar: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var tenant: Tenant
    let current: Tab?
    var solid = false
    var pad: CGFloat = 16
    @State private var profile = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 18) {
                if current == nil {
                    Text("Para \(state.session?.user ?? "")").font(.system(size: 22, weight: .bold)).foregroundColor(.white).lineLimit(1)
                } else {
                    LogoHeader(height: 28)
                }
                Spacer()
                Button { state.push(.search) } label: { Image(systemName: "magnifyingglass").font(.system(size: 22)).foregroundColor(.white) }
                Button { profile = true } label: {
                    Text(String((state.session?.user ?? "U").prefix(1)).uppercased()).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .frame(width: 30, height: 30)
                        .background(LinearGradient(colors: [Theme.accent, Theme.accent.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if current != nil { Chip(text: "✕") { state.open(.home) } }
                    Chip(text: "Series", selected: current == .series) { state.open(.series) }
                    Chip(text: "Películas", selected: current == .movies) { state.open(.movies) }
                    if tenant.sportsEnabled { Chip(text: "Deportes") { state.push(.sports) } }
                    Chip(text: "Mi lista") { state.push(.saved(false)) }
                }
            }
        }
        .padding(.horizontal, pad).padding(.top, 8).padding(.bottom, 10)
        .background(
            ZStack {
                (solid ? Color(hex: 0x141414, alpha: 0.95) : Color.clear)
                LinearGradient(colors: [Color.black.opacity(0.7), .clear], startPoint: .top, endPoint: .bottom)
            }
            .ignoresSafeArea(edges: .top)
            .animation(.easeInOut(duration: 0.2), value: solid)
        )
        .sheet(isPresented: $profile) { ProfileSheet().environmentObject(state).environmentObject(tenant) }
    }
}

/** Perfil (igual que Android): Mi cuenta, Ajustes y Deportes */
struct ProfileSheet: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var tenant: Tenant
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Perfil").font(.system(size: 20, weight: .bold)).foregroundColor(.white)
            VStack(alignment: .leading, spacing: 4) {
                Text(state.session?.user ?? "").font(.system(size: 16)).foregroundColor(.white)
                Text(state.session?.dnsName ?? "").font(.system(size: 13)).foregroundColor(Theme.muted)
            }
            Divider().background(Color.white.opacity(0.2))
            row("person.fill", "Mi cuenta") { go { state.open(.account) } }
            row("gearshape.fill", "Ajustes") { go { state.open(.account) } }
            if tenant.sportsEnabled { row("sportscourt.fill", "Deportes") { go { state.push(.sports) } } }
            row("bookmark.fill", "Mi lista") { go { state.push(.saved(false)) } }
            HStack { Spacer(); Button("Cerrar") { dismiss() }.foregroundColor(Theme.accent) }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(LinearGradient(colors: [Color(hex: 0x141414), .black], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
        .presentationDetents([.medium])
        .preferredColorScheme(.dark)
    }

    /** cierra la hoja y después navega (si no, la navegación se pierde al cerrarse) */
    private func go(_ f: @escaping () -> Void) {
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: f)
    }

    private func row(_ icon: String, _ text: String, _ f: @escaping () -> Void) -> some View {
        Button(action: f) {
            HStack(spacing: 16) {
                Image(systemName: icon).font(.system(size: 18)).foregroundColor(.white).frame(width: 24)
                Text(text).font(.system(size: 16)).foregroundColor(.white)
                Spacer()
            }.padding(.vertical, 6).contentShape(Rectangle())
        }.buttonStyle(.plain)
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
