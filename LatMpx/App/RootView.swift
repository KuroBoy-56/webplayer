import SwiftUI

/** puerta del distribuidor antes del inicio de sesión */
private enum Gate { case choose, retry, open }

struct RootView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var tenant: Tenant
    @Environment(\.scenePhase) private var phase
    @State private var booted = false
    @State private var gate: Gate = .open
    @State private var distMsg: String?
    @State private var retryMsg = ""
    @State private var checking = false
    @State private var alert: Alerts.Alert?
    @State private var lastPanelCheck = Date()

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if !booted {
                Splash()
            } else if gate == .choose {
                DistributorView(message: distMsg) {
                    // con un número nuevo no se reutiliza la sesión de antes
                    if Tenant.active { Store.logout() }
                    distMsg = nil
                    gate = .open
                }
            } else if gate == .retry {
                TenantRetryView(message: retryMsg, busy: checking, onRetry: guardTenant, onChange: { wipe(nil) })
            } else if state.session == nil {
                LoginView { s in
                    lastPanelCheck = Date()
                    Store.saveSession(s)
                    Xtream.clearCache()
                    state.session = s
                }
            } else {
                MainView(onLogout: logout, onChangeDistributor: { wipe(nil) })
            }
            if let a = alert, state.session != nil {
                PanelAlertView(alert: a) { alert = nil }
            }
        }
        .onAppear(perform: boot)
        .onChange(of: tenant.revoked) { m in
            guard let m = m else { return }
            tenant.revoked = nil
            if Tenant.active { wipe(m) }
        }
        .onChange(of: phase) { p in if p == .active { resumed() } }
        .task(id: state.session) {
            guard let s = state.session else { return }
            Task { await Cloud.shared.load() }
            Task { let a = await Alerts.forLaunch(s); await MainActor.run { alert = a } }
            await state.loadCatalog(s)
        }
        .onAppear { PlayerPresenter.bind(state, tenant) }
    }

    private func boot() {
        guard !booted else { return }
        #if DEBUG
        // prueba automática del simulador (LatMpxUITests): abre el reproductor con direcciones fijas
        if let u = UserDefaults.standard.string(forKey: "ui_test_player"), !u.isEmpty {
            let live = UserDefaults.standard.bool(forKey: "ui_test_live")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                state.play = PlayRequest(kind: live ? .live : .movie, queue: [QueueEntry(id: 0, title: "Prueba", key: "test:0", poster: "", ext: "")],
                                         index: 0, directUrls: u.components(separatedBy: "|"))
            }
        }
        #endif
        if Store.distChoice.isEmpty { gate = .choose }
        else if Store.distChoice == "code" && tenant.brand == nil { wipe(nil) }
        else { gate = .open }
        booted = true
        if gate == .open && Tenant.active { guardTenant() }
    }

    private func clearAll() {
        Store.logout(); Alerts.reset(); alert = nil; Xtream.clearCache(); Cloud.shared.clear()
        Task { await PanelEpg.shared.clear() }
        state.reset(); state.session = nil
    }

    private func logout() { clearAll(); CatalogCache.clear() }

    /** "Cambiar distribuidor" o número cortado: se borra el número, su marca, la sesión y el token */
    private func wipe(_ msg: String?) {
        Store.logout()
        tenant.clear()
        clearAll()
        CatalogCache.clear()
        distMsg = msg
        gate = .choose
    }

    /** guardián: vuelve a pedir tenant_config (al abrir y al volver a la app pasado recheck_after) */
    private func guardTenant() {
        guard let b = tenant.brand else { return }
        if b.expired() { wipe(Tenant.expiredMessage(b)); return }
        if checking { return }
        checking = true
        Task { @MainActor in
            let r = await Tenant.fetch(b.code)
            checking = false
            if Tenant.code != b.code { return }
            switch r {
            case .ok(let nb):
                if nb.expired() { wipe(Tenant.expiredMessage(nb)) } else { tenant.refresh(nb); if gate == .retry { gate = .open } }
            case .denied(let m): wipe(m)
            case .offline(let m), .problem(let m):
                if !tenant.offlineOk() { retryMsg = m; gate = .retry }
            }
        }
    }

    /**
     * Al volver a la app (como mucho cada 15 min): si el panel ya no tiene la línea de este equipo, o el
     * servidor IPTV ya no acepta el usuario (contraseña cambiada, vencida), se vuelve al inicio de sesión.
     * Sin conexión no se cierra nada.
     */
    private func resumed() {
        guard booted else { return }
        state.refresh += 1
        if state.session != nil { Task { await Cloud.shared.load() } }
        if Tenant.active && (tenant.due() || tenant.brand?.expired() == true) { guardTenant() }
        guard let s = state.session, Date().timeIntervalSince(lastPanelCheck) >= 15 * 60 else { return }
        lastPanelCheck = Date()
        Task { @MainActor in
            let c = await Panel.checkMac()
            guard state.session == s else { return }
            if c.error == nil && c.value == nil { clearAll(); return }
            guard let line = c.value else { return }
            if case .fail(let m) = await Xtream.login([(line.name, line.base)], user: line.user, pass: line.pass), m != "No se pudo conectar con el servidor" {
                if state.session == s { clearAll() }
            }
        }
    }
}

private struct Splash: View {
    var body: some View {
        VStack(spacing: 24) {
            LogoHeader(height: 90)
            ProgressView().tint(Theme.accent)
        }
    }
}
