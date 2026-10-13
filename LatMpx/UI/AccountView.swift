import SwiftUI

struct AccountView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    let onLogout: () -> Void
    let onChangeDistributor: () -> Void
    @State private var streamFormat = Store.streamFormat
    @State private var nativePlayer = Store.nativePlayer
    @ObservedObject private var dl = Downloads.shared
    @State private var pinOpen = false
    @State private var confirmLogout = false

    var body: some View {
        GeometryReader { g in
            let pad = sidePad(g.size)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    LogoHeader(height: 44)
                    if let s = state.session {
                        HStack(spacing: 16) {
                            Text(String(cloud.shownUser(s).prefix(1)).uppercased()).font(.system(size: 28, weight: .bold)).foregroundColor(.white)
                                .frame(width: 64, height: 64).background(Theme.accent).clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading) {
                                // demo: nunca el usuario ni la contraseña de la línea
                                Text(cloud.shownUser(s)).font(.system(size: 24, weight: .bold)).foregroundColor(.white).lineLimit(1)
                                if cloud.demo {
                                    Text(cloud.demoLength.isEmpty ? "Cuenta DEMO" : "Cuenta DEMO · \(cloud.demoLength)").font(.system(size: 14)).foregroundColor(Color(hex: 0xFFB300))
                                } else {
                                    Text("Suscripción activa").font(.system(size: 14)).foregroundColor(Color(hex: 0x4CAF50))
                                }
                            }
                        }
                        let cont = cloud.progressList()
                        ShelfRow(title: "Continuar viendo", items: cont, pad: 0) { _, p in
                            if let it = state.item(from: p) { ContinueCard(item: it, progress: p, width: posterWidth(g.size)) }
                        }
                        section("Detalles de la cuenta") {
                            // demo: solo el fin que dice el panel (hora exacta); nada de la línea demo del servidor
                            if cloud.demo {
                                InfoRow(k: "Vencimiento", v: cloud.demoEndText.isEmpty ? "—" : cloud.demoEndText)
                            } else {
                                InfoRow(k: "Vencimiento", v: s.expires); Divider().background(Color(hex: 0x333333))
                                InfoRow(k: "Conexiones", v: "\(s.activeCons) / \(s.maxCons)"); Divider().background(Color(hex: 0x333333))
                                InfoRow(k: "Servidor", v: s.dnsName); Divider().background(Color(hex: 0x333333))
                                InfoRow(k: "Miembro desde", v: s.createdAt)
                            }
                        }
                    }
                    section("Configuración de la aplicación") {
                        setting("lock.fill", "Control parental", "Activado · el PIN lo administra el panel") { pinOpen = true }
                        Divider().background(Color(hex: 0x333333))
                        // películas y episodios guardados para ver sin internet
                        let done = dl.entries.filter { $0.state == .done }.count
                        let busy = dl.entries.filter { $0.state == .running || $0.state == .queued }.count
                        setting("arrow.down.circle", "Mis descargas", busy > 0 ? "\(done) listas · \(busy) descargando" : done > 0 ? "\(done) para ver sin internet" : "Películas y episodios para ver sin internet") {
                            state.push(.downloads)
                        }
                        Divider().background(Color(hex: 0x333333))
                        setting("play.rectangle", "Formato de canales", streamFormat == "ts" ? "MPEG-TS (.ts)" : "HLS (.m3u8)") {
                            streamFormat = streamFormat == "ts" ? "m3u8" : "ts"
                            Store.streamFormat = streamFormat
                        }
                        Divider().background(Color(hex: 0x333333))
                        setting("pip", "Reproductor", nativePlayer ? "De iOS · imagen en imagen y AirPlay (MKV y TS en el de la app)" : "De la app (sin imagen en imagen)") {
                            nativePlayer.toggle()
                            Store.nativePlayer = nativePlayer
                        }
                        Divider().background(Color(hex: 0x333333))
                        DnsButton(fill: true)
                        Divider().background(Color(hex: 0x333333))
                        InfoRow(k: "Versión", v: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
                        Divider().background(Color(hex: 0x333333))
                        HStack {
                            Text("Dirección MAC").font(.system(size: 15)).foregroundColor(Theme.muted)
                            Spacer()
                            Text(Device.id).font(.system(size: 15, weight: .bold, design: .monospaced)).foregroundColor(.white).textSelection(.enabled)
                        }
                    }
                    DistributorCard(onChange: onChangeDistributor)
                    AppButton(text: "Cerrar sesión", icon: "rectangle.portrait.and.arrow.right", primary: false) { confirmLogout = true }
                    Spacer(minLength: 40)
                }
                .padding(pad)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $pinOpen) { ParentalSheet().environmentObject(state) }
        .confirmationDialog("¿Cerrar sesión?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Cerrar sesión", role: .destructive, action: onLogout)
            Button("Cancelar", role: .cancel) {}
        } message: { Text("La próxima vez la app volverá a comprobar este equipo con el panel.") }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 18, weight: .bold)).foregroundColor(.white)
            VStack(spacing: 12) { content() }
                .padding(16)
                .background(LinearGradient(colors: [Color(hex: 0x2A2A2A), Color(hex: 0x1A1A1A)], startPoint: .top, endPoint: .bottom))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1)))
        }
    }

    private func setting(_ icon: String, _ title: String, _ sub: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: icon).font(.system(size: 20)).foregroundColor(Theme.muted).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 16)).foregroundColor(.white)
                    Text(sub).font(.system(size: 13)).foregroundColor(Theme.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundColor(Theme.muted)
            }.contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

/**
 * Control parental: siempre activo con el PIN del panel (0000 de fábrica). Se pide el PIN para entrar;
 * el PIN nuevo se guarda en el panel (set_pin), donde el dueño lo ve y lo puede volver a 0000.
 */
struct ParentalSheet: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    private enum Step { case enter, settings, create, cats }
    @State private var step: Step = .enter
    @State private var pin = ""
    @State private var current = ""
    @State private var err: String?
    @State private var busy = false
    @State private var blocked = Store.blockedCats

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .enter, .create: pinStep
                case .settings: settings
                case .cats: catsStep
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Color(hex: 0x141414).ignoresSafeArea())
            .navigationTitle(step == .create ? "Nuevo PIN" : step == .cats ? "Carpetas bloqueadas" : "Control parental")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(step == .cats || step == .create ? "Atrás" : "Cerrar") {
                        if step == .cats { blocked = Store.blockedCats; step = .settings }
                        else if step == .create { pin = ""; err = nil; step = .settings }
                        else { dismiss() }
                    }
                }
                if step == .cats {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Guardar") { Store.blockedCats = blocked; state.refresh += 1; step = .settings }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var pinStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(step == .create ? "Escribe el nuevo PIN de 4 números (se guarda también en el panel):" : "Ingresa tu PIN (el de fábrica es 0000):")
                .foregroundColor(.white)
            SecureField("PIN", text: $pin)
                .keyboardType(.numberPad).font(.system(size: 26, weight: .bold, design: .monospaced)).foregroundColor(.white)
                .padding(.horizontal, 14).frame(height: 56).background(Color(hex: 0x333333)).clipShape(RoundedRectangle(cornerRadius: 6))
                .onChange(of: pin) { v in let f = String(v.filter { $0.isNumber }.prefix(4)); if f != v { pin = f }; err = nil }
            if let e = err { Text(e).font(.system(size: 13)).foregroundColor(Color(hex: 0xFF8A80)) }
            if busy { HStack { ProgressView(); Text("Guardando en el panel…").foregroundColor(Theme.muted) } }
            AppButton(text: "Aceptar") { accept() }.disabled(busy)
        }
    }

    private var settings: some View {
        VStack(spacing: 12) {
            row("lock.rotation", "Cambiar PIN", "Se guarda en el panel") { pin = ""; err = nil; step = .create }
            row("folder.badge.minus", "Carpetas bloqueadas", "\(blocked.count) carpetas ocultas") { step = .cats }
            row("folder", "Mostrar todas las carpetas", "Quita las carpetas bloqueadas (el PIN sigue activo)") {
                Store.blockedCats = []; blocked = []; state.refresh += 1
            }
        }
    }

    private var catsStep: some View {
        let all = Array(Dictionary((state.movieCats + state.seriesCats + state.liveCats).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }).values)
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return List(all) { c in
            Button {
                if blocked.contains(c.id) { blocked.remove(c.id) } else { blocked.insert(c.id) }
            } label: {
                HStack {
                    Image(systemName: blocked.contains(c.id) ? "checkmark.square.fill" : "square").foregroundColor(blocked.contains(c.id) ? Theme.accent : Theme.muted)
                    Text(c.name).foregroundColor(.white)
                    Spacer()
                    Text(c.kind == .live ? "TV" : c.kind == .movie ? "Película" : "Serie").font(.system(size: 12)).foregroundColor(Theme.muted)
                }
            }.listRowBackground(Color(hex: 0x1C1C1C))
        }
        .listStyle(.plain).scrollContentBackground(.hidden)
    }

    private func row(_ icon: String, _ t: String, _ sub: String, _ f: @escaping () -> Void) -> some View {
        Button(action: f) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 20)).foregroundColor(Theme.muted).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) { Text(t).foregroundColor(.white); Text(sub).font(.system(size: 13)).foregroundColor(Theme.muted) }
                Spacer()
                Image(systemName: "chevron.right").foregroundColor(Theme.muted)
            }.padding(14).background(Color(hex: 0x1F1F1F)).clipShape(RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain)
    }

    private func accept() {
        if busy { return }
        if pin.count != 4 { err = "El PIN tiene 4 números"; return }
        if step == .enter {
            if pin == Store.parentalPin { current = pin; pin = ""; step = .settings } else { err = "PIN incorrecto"; pin = "" }
            return
        }
        let new = pin
        busy = true
        Task { @MainActor in
            let r = await Panel.setPin(old: current, new: new)
            busy = false
            if r.value != nil { current = new; pin = ""; err = nil; step = .settings; state.toast = "PIN guardado en el panel" }
            else { err = r.error ?? "No se pudo guardar el PIN en el panel" }
        }
    }
}
