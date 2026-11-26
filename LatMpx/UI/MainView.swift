import SwiftUI
import Combine

/**
 * Pestañas como la app de Netflix; cada una con su propia pila de pantallas. La barra de abajo del sistema no se ve: en
 * su lugar va la cápsula flotante (FloatingTabBar: Inicio, TV en vivo, Buscar, Perfil). Series y Películas se abren
 * desde arriba, en Inicio.
 */
struct MainView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var tenant: Tenant
    let onLogout: () -> Void
    let onChangeDistributor: () -> Void

    init(onLogout: @escaping () -> Void, onChangeDistributor: @escaping () -> Void) {
        self.onLogout = onLogout
        self.onChangeDistributor = onChangeDistributor
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

    /** iPad: la barra de abajo un poco más grande */
    private var big: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: selection) {
                stack(.home) { HomeView() }.tag(Tab.home)
                stack(.series) { CatalogView(kind: .series) }.tag(Tab.series)
                stack(.movies) { CatalogView(kind: .movie) }.tag(Tab.movies)
                stack(.live) { LiveView() }.tag(Tab.live)
                stack(.search) { SearchView() }.tag(Tab.search)
                stack(.account) { AccountView(onLogout: onLogout, onChangeDistributor: onChangeDistributor) }.tag(Tab.account)
            }
            // con el teclado abierto (Buscar) la barra se queda abajo, detrás del teclado
            FloatingTabBar(big: big).ignoresSafeArea(.keyboard, edges: .bottom)
        }
        .toast($state.toast)
        // línea demo: Mi lista y el progreso no se guardan
        .onReceive(NotificationCenter.default.publisher(for: Cloud.demoBlocked)) { _ in state.toast = tr("No disponible en la DEMO") }
    }

    private func stack<V: View>(_ t: Tab, @ViewBuilder _ root: () -> V) -> some View {
        NavigationStack(path: state.path(t)) {
            root()
                .toolbar(.hidden, for: .tabBar)
                .navigationDestination(for: Route.self) { r in RouteView(route: r).toolbar(.hidden, for: .tabBar) }
        }
        // el espacio de la barra flotante: las listas pasan por detrás y lo último queda arriba de la barra
        .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: FloatingTabBar.height(big: big) + 8).allowsHitTesting(false) }
    }
}

struct RouteView: View {
    @EnvironmentObject var tenant: Tenant
    let route: Route
    var body: some View {
        switch route {
        case .detail(let it): DetailView(media: it)
        case .browse(let title, let kind, let ids): BrowseView(title: title, kind: kind, categoryIds: ids, platform: nil)
        case .platform(let p): BrowseView(title: tr(p.label), kind: nil, categoryIds: [], platform: p)
        case .saved(let cw): SavedView(continueWatching: cw)
        case .sports: if tenant.sportsEnabled { SportsView() } else { EmptyMessage(text: tr("Deportes no está disponible.")) }
        case .search: SearchView()
        case .downloads: DownloadsView()
        case .actor(let name, let id, let photo): ActorView(name: name, tmdbId: id, photo: photo)
        }
    }
}
