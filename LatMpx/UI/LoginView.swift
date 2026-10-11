import SwiftUI

/**
 * Inicio de sesión. Sin datos guardados: al abrir se pregunta al panel por este equipo (auth.php /
 * check_mac) y, si tiene línea, se comprueba en el servidor IPTV antes de entrar.
 * Logo arriba, la caja en el medio y la firma del distribuidor abajo.
 */
struct LoginView: View {
    let onLogged: (Session) -> Void
    @EnvironmentObject var tenant: Tenant
    @State private var busy = true
    @State private var status = "Comprobando el equipo en el panel…"
    @State private var err: String?
    @State private var lines: [Panel.Line] = []
    @State private var dns: [String] = []
    @State private var user = ""
    @State private var pass = ""
    @State private var posters: [String] = []
    @State private var fake: FakeScreen?
    @State private var started = false
    /** ojito: ver la contraseña en texto o volver a ocultarla */
    @State private var showPass = false

    var body: some View {
        if let f = fake {
            FakeScreenView(screen: f) { Store.fakeUnlocked = true; fake = nil }
                .task(id: f) { await pollWhileFake() }
        } else {
            content
        }
    }

    private var content: some View {
        GeometryReader { g in
            ZStack {
                PosterWall(posters: posters, columns: g.size.width > 700 ? 8 : 4)
                ScrollView {
                    VStack(spacing: 0) {
                        HStack { LogoHeader(height: 46); Spacer() }.padding(.horizontal, sidePad(g.size)).padding(.vertical, 20)
                        Spacer(minLength: 16)
                        box.frame(maxWidth: 400).padding(.horizontal, 16)
                        Spacer(minLength: 28)
                        Text("© " + String(Calendar.current.component(.year, from: Date())) + " " + tenant.nameOr("Garevyn TV"))
                            .font(.system(size: 14)).foregroundColor(Color(hex: 0x999999))
                            .frame(maxWidth: .infinity).padding(20).background(Color.black.opacity(0.6))
                    }
                    .frame(minHeight: g.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background(Color.black.ignoresSafeArea())
        .task {
            guard !started else { return }
            started = true
            posters = await Tmdb.nowPlaying()
            _ = await resolve()
            if lines.isEmpty && !Store.fakeUnlocked { fake = Panel.fakeScreen }
            if lines.isEmpty && PanelCrypto.hasKey, let d = await Panel.fetchDns().value { dns = d }
            if posters.isEmpty { posters = await Tmdb.nowPlaying() }
        }
    }

    @ViewBuilder private var box: some View {
        VStack(spacing: 14) {
            if !PanelCrypto.hasKey {
                ErrorBanner(text: "Esta versión de la app no tiene la llave del panel (PANEL_MASTER_KEY). La activación no funcionará hasta instalar una versión configurada.")
            }
            if lines.count > 1 {
                Text("Elige tu servicio").font(.system(size: 26, weight: .bold)).foregroundColor(.white)
                ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                    AppButton(text: l.name.isEmpty ? "Servicio \(i + 1)" : l.name, icon: "play.fill", primary: i == 0) { act { await connect(l) } }
                }
                if let e = err { ErrorBanner(text: e) }
            } else {
                Text("Iniciar sesión").font(.system(size: 28, weight: .bold)).foregroundColor(.white).frame(maxWidth: .infinity, alignment: .leading)
                if let e = err { ErrorBanner(text: e) }
                field("Usuario", text: $user, secure: false)
                field("Contraseña", text: $pass, secure: true)
                VStack(spacing: 2) {
                    Text("Código MAC (Activación remota)").font(.system(size: 12)).foregroundColor(Theme.muted)
                    Text(Device.id).font(.system(size: 18, weight: .bold, design: .monospaced)).foregroundColor(.white).textSelection(.enabled)
                }
                .frame(maxWidth: .infinity).padding(12).background(Color.white.opacity(0.2)).clipShape(RoundedRectangle(cornerRadius: 4))
                AppButton(text: "Iniciar sesión") { act { await submit() } }
                if tenant.demoEnabled {
                    AppButton(text: "Autodemo", icon: "gift.fill", primary: false) { act { await demo() } }
                }
            }
            if busy {
                VStack(spacing: 8) {
                    ProgressView().tint(Theme.accent)
                    Text(status).font(.system(size: 13)).foregroundColor(Theme.muted).multilineTextAlignment(.center)
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 28)
        .background(Color.black.opacity(0.75)).clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func field(_ label: String, text: Binding<String>, secure: Bool) -> some View {
        HStack(spacing: 8) {
            Group {
                if secure && !showPass { SecureField("", text: text, prompt: Text(label).foregroundColor(Theme.muted)) }
                else { TextField("", text: text, prompt: Text(label).foregroundColor(Theme.muted)) }
            }
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .textContentType(.none)
            .foregroundColor(.white)
            if secure {
                Button { showPass.toggle() } label: {
                    Image(systemName: showPass ? "eye.slash" : "eye").font(.system(size: 18)).foregroundColor(Theme.muted)
                        .frame(width: 36, height: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showPass ? "Ocultar contraseña" : "Ver contraseña")
            }
        }
        .padding(.leading, 14).padding(.trailing, secure ? 6 : 14).frame(height: 52)
        .background(Color(hex: 0x333333)).clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0x555555)))
    }

    private func act(_ block: @escaping () async -> Void) {
        if busy { return }
        err = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        Task { @MainActor in busy = true; await block(); busy = false }
    }

    @MainActor private func connect(_ line: Panel.Line) async {
        status = "Conectando con \(line.name)…"
        switch await Xtream.login([(line.name, line.base)], user: line.user, pass: line.pass) {
        case .ok(let s): onLogged(s)
        case .fail(let m): err = m
        }
    }

    /** líneas del equipo en el panel; con una sola se entra (después de comprobarla en el servidor) */
    @MainActor private func resolve() async -> Bool {
        busy = true; status = "Comprobando el equipo en el panel…"
        let a = await Panel.playlists()
        var found = a.value ?? []
        var problem = a.error
        if found.isEmpty {
            let c = await Panel.checkMac()
            if let l = c.value { found = [l] }
            if problem == nil { problem = c.error }
        }
        lines = found
        if found.count == 1 { await connect(found[0]) }
        else if found.isEmpty, let p = problem, PanelCrypto.hasKey { err = p } // sin llave ya lo dice el aviso de arriba
        busy = false
        return !found.isEmpty
    }

    @MainActor private func submit() async {
        let u = user.trimmed, p = pass.trimmed
        if u.isEmpty || p.isEmpty { err = "Escribe tu usuario y contraseña"; return }
        if dns.isEmpty {
            let d = await Panel.fetchDns()
            if let v = d.value { dns = v } else { err = d.error }
        }
        guard let server = dns.first else { if err == nil { err = "El panel no tiene servidores disponibles" }; return }
        status = "Activando…"
        let r = await Panel.submitUrl(user: u, pass: p, dns: server)
        if r.value == nil { err = r.error; return }
        if !(await resolve()) && err == nil { await connect(Panel.Line(name: "Servidor 1", base: Xtream.normalize(server), user: u, pass: p)) }
    }

    /** el panel decide (si el dueño borró el registro, el equipo puede pedir otra demo); un código de revendedor en Contraseña deja la demo a su nombre */
    @MainActor private func demo() async {
        status = "Creando demo…"
        let r = await Panel.autoDemo(reseller: pass)
        guard let cred = r.value else {
            err = r.error
            if r.code == 403 { Store.demoUsed = true }
            return
        }
        Store.demoUsed = false
        if !(await resolve()) && err == nil {
            var d = dns
            if d.isEmpty { d = await Panel.fetchDns().value ?? [] }
            if let first = d.first { await connect(Panel.Line(name: "Demo", base: Xtream.normalize(first), user: cred.0, pass: cred.1)) }
            else { err = "Demo creada, pero el panel no devolvió el servidor." }
        }
    }

    /** con la pantalla falsa se pregunta cada 30 s: si el distribuidor registra el equipo, la app se abre sola */
    @MainActor private func pollWhileFake() async {
        while fake != nil {
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            if Task.isCancelled { return }
            let c = await Panel.checkMac()
            if let line = c.value { fake = nil; busy = true; await connect(line); busy = false; return }
            if c.error == nil && Panel.fakeScreen == nil { fake = nil }
        }
    }
}
