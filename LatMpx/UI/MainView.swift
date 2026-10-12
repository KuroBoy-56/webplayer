import SwiftUI
import Combine

/** Pestañas de abajo como la app de Netflix; cada una con su propia pila de pantallas. */
struct MainView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var tenant: Tenant
    let onLogout: () -> Void
    let onChangeDistributor: () -> Void

    init(onLogout: @escaping () -> Void, onChangeDistributor: @escaping () -> Void) {
        self.onLogout = onLogout
        self.onChangeDistributor = onChangeDistributor
        let a = UITabBarAppearance()
        a.configureWithOpaqueBackground()
        a.backgroundColor = UIColor(red: 0.043, green: 0.043, blue: 0.043, alpha: 1)
        UITabBar.appearance().standardAppearance = a
        UITabBar.appearance().scrollEdgeAppearance = a
        let n = UINavigationBarAppearance()
        n.configureWithTransparentBackground()
        n.titleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = n
        UINavigationBar.appearance().scrollEdgeAppearance = n
        UINavigationBar.appearance().compactAppearance = n
    }

    private var selection: Binding<Tab> {
        Binding(get: { state.tab }, set: { t in
            if t == state.tab { state.stacks[t] = [] }
            state.tab = t
        })
    }

    var body: some View {
        TabView(selection: selection) {
            stack(.home) { HomeView() }.tabItem { Label("Inicio", systemImage: "house.fill") }.tag(Tab.home)
            stack(.series) { CatalogView(kind: .series) }.tabItem { Label("Series", systemImage: "tv") }.tag(Tab.series)
            stack(.movies) { CatalogView(kind: .movie) }.tabItem { Label("Películas", systemImage: "film") }.tag(Tab.movies)
            stack(.live) { LiveView() }.tabItem { Label("TV en vivo", systemImage: "dot.radiowaves.left.and.right") }.tag(Tab.live)
            stack(.account) { AccountView(onLogout: onLogout, onChangeDistributor: onChangeDistributor) }
                .tabItem { Label("Cuenta", systemImage: "person.crop.circle") }.tag(Tab.account)
        }
        .toast($state.toast)
        // línea demo: Mi lista y el progreso no se guardan
        .onReceive(NotificationCenter.default.publisher(for: Cloud.demoBlocked)) { _ in state.toast = "No disponible en la DEMO" }
    }

    private func stack<V: View>(_ t: Tab, @ViewBuilder _ root: () -> V) -> some View {
        NavigationStack(path: state.path(t)) {
            root()
                .navigationDestination(for: Route.self) { r in RouteView(route: r) }
        }
    }
}

struct RouteView: View {
    @EnvironmentObject var tenant: Tenant
    let route: Route
    var body: some View {
        switch route {
        case .detail(let it): DetailView(media: it)
        case .browse(let title, let kind, let ids): BrowseView(title: title, kind: kind, categoryIds: ids, platform: nil)
        case .platform(let p): BrowseView(title: p.label, kind: nil, categoryIds: [], platform: p)
        case .saved(let cw): SavedView(continueWatching: cw)
        case .sports: if tenant.sportsEnabled { SportsView() } else { EmptyMessage(text: "Deportes no está disponible.") }
        case .search: SearchView()
        }
    }
}
