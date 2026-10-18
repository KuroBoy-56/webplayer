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
    @State private var langOpen = false
    @ObservedObject private var lang = L10n.shared

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
                                    Text(cloud.demoLength.isEmpty ? tr("Cuenta DEMO") : tr("Cuenta DEMO · %@", cloud.demoLength)).font(.system(size: 14)).foregroundColor(Color(hex: 0xFFB300))
                                } else {
                                    Text(tr("Suscripción activa")).font(.system(size: 14)).foregroundColor(Color(hex: 0x4CAF50))
                                }
                            }
                        }
                        let cont = cloud.progressList()
                        ShelfRow(title: tr("Continuar viendo"), items: cont, pad: 0) { _, p in
                            if let it = state.item(from: p) { ContinueCard(item: it, progress: p, width: posterWidth(g.size)) }
                        }
                        section(tr("Detalles de la cuenta")) {
                            // demo: solo el fin que dice el panel (hora exacta); nada de la línea demo del servidor
                            if cloud.demo {
                                InfoRow(k: tr("Vencimiento"), v: cloud.demoEndText.isEmpty ? "—" : cloud.demoEndText)
                            } else {
                                InfoRow(k: tr("Vencimiento"), v: s.expires); Divider().background(Color(hex: 0x333333))
                                InfoRow(k: tr("Conexiones"), v: "\(s.activeCons) / \(s.maxCons)"); Divider().background(Color(hex: 0x333333))
                                InfoRow(k: tr("Servidor"), v: s.dnsName); Divider().background(Color(hex: 0x333333))
                                InfoRow(k: tr("Miembro desde"), v: s.createdAt)
                            }
                            // contenido del servidor (catálogo cargado; "…" mientras llega)
                            Divider().background(Color(hex: 0x333333))
                            InfoRow(k: tr("Canales en vivo"), v: count(state.live)); Divider().background(Color(hex: 0x333333))
                            InfoRow(k: tr("Películas"), v: count(state.movies)); Divider().background(Color(hex: 0x333333))
                            InfoRow(k: tr("Series"), v: count(state.series))
                        }
                    }
                    section(tr("Configuración de la aplicación")) {
                        setting("lock.fill", tr("Control parental"), tr("Activado · el PIN lo administra el panel")) { pinOpen = true }
                        Divider().background(Color(hex: 0x333333))
                        // películas y episodios guardados para ver sin internet
                        let done = dl.entries.filter { $0.state == .done }.count
                        let busy = dl.entries.filter { $0.state == .running || $0.state == .queued }.count
                        setting("arrow.down.circle", tr("Mis descargas"), busy > 0 ? tr("%d listas · %d descargando", done, busy) : done > 0 ? tr("%d para ver sin internet", done) : tr("Películas y episodios para ver sin internet")) {
                            state.push(.downloads)
                        }
                        Divider().background(Color(hex: 0x333333))
                        // idioma de la app: automático (el del equipo) o uno fijo; se aplica al momento
                        setting("globe", tr("Idioma de la app"), L10n.label(lang.choice)) { langOpen = true }
                        Divider().background(Color(hex: 0x333333))
                        setting("play.rectangle", tr("Formato de canales"), streamFormat == "ts" ? "MPEG-TS (.ts)" : "HLS (.m3u8)") {
                            streamFormat = streamFormat == "ts" ? "m3u8" : "ts"
                            Store.streamFormat = streamFormat
                        }
                        Divider().background(Color(hex: 0x333333))
                        setting("pip", tr("Reproductor"), nativePlayer ? tr("De iOS · imagen en imagen y AirPlay (VLC de la app solo si no abre)") : tr("De la app (sin imagen en imagen)")) {
                            nativePlayer.toggle()
                            Store.nativePlayer = nativePlayer
                        }
                        Divider().background(Color(hex: 0x333333))
                        DnsButton(fill: true)
                        Divider().background(Color(hex: 0x333333))
                        InfoRow(k: tr("Versión"), v: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
                        Divider().background(Color(hex: 0x333333))
                        HStack {
                            Text(tr("Dirección MAC")).font(.system(size: 15)).foregroundColor(Theme.muted)
                            Spacer()
                            Text(Device.id).font(.system(size: 15, weight: .bold, design: .monospaced)).foregroundColor(.white).textSelection(.enabled)
                        }
                    }
                    DistributorCard(onChange: onChangeDistributor)
                    AppButton(text: tr("Cerrar sesión"), icon: "rectangle.portrait.and.arrow.right", primary: false) { confirmLogout = true }
                    Spacer(minLength: 40)
                }
                .padding(pad)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $pinOpen) { ParentalSheet().environmentObject(state) }
        .confirmationDialog(tr("¿Cerrar sesión?"), isPresented: $confirmLogout, titleVisibility: .visible) {
            Button(tr("Cerrar sesión"), role: .destructive, action: onLogout)
            Button(tr("Cancelar"), role: .cancel) {}
        } message: { Text(tr("La próxima vez la app volverá a comprobar este equipo con el panel.")) }
        .confirmationDialog(tr("Idioma de la app"), isPresented: $langOpen, titleVisibility: .visible) {
            ForEach(L10n.choices, id: \.self) { c in
                Button(L10n.label(c) + (c == lang.choice ? " ✓" : "")) { lang.choice = c }
            }
            Button(tr("Cancelar"), role: .cancel) {}
        }
    }

    private func count(_ l: [Item]) -> String { l.isEmpty && state.loading ? "…" : "\(l.count)" }

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
            .navigationTitle(tr(step == .create ? "Nuevo PIN" : step == .cats ? "Carpetas bloqueadas" : "Control parental"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr(step == .cats || step == .create ? "Atrás" : "Cerrar")) {
                        if step == .cats { blocked = Store.blockedCats; step = .settings }
                        else if step == .create { pin = ""; err = nil; step = .settings }
                        else { dismiss() }
                    }
                }
                if step == .cats {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(tr("Guardar")) { Store.blockedCats = blocked; state.refresh += 1; step = .settings }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var pinStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(tr(step == .create ? "Escribe el nuevo PIN de 4 números (se guarda también en el panel):" : "Ingresa tu PIN (el de fábrica es 0000):"))
                .foregroundColor(.white)
            SecureField("PIN", text: $pin)
                .keyboardType(.numberPad).font(.system(size: 26, weight: .bold, design: .monospaced)).foregroundColor(.white)
                .padding(.horizontal, 14).frame(height: 56).background(Color(hex: 0x333333)).clipShape(RoundedRectangle(cornerRadius: 6))
                .onChange(of: pin) { v in let f = String(v.filter { $0.isNumber }.prefix(4)); if f != v { pin = f }; err = nil }
            if let e = err { Text(e).font(.system(size: 13)).foregroundColor(Color(hex: 0xFF8A80)) }
            if busy { HStack { ProgressView(); Text(tr("Guardando en el panel…")).foregroundColor(Theme.muted) } }
            AppButton(text: tr("Aceptar")) { accept() }.disabled(busy)
        }
    }

    private var settings: some View {
        VStack(spacing: 12) {
            row("lock.rotation", tr("Cambiar PIN"), tr("Se guarda en el panel")) { pin = ""; err = nil; step = .create }
            row("folder.badge.minus", tr("Carpetas bloqueadas"), tr("%d carpetas ocultas", blocked.count)) { step = .cats }
            row("folder", tr("Mostrar todas las carpetas"), tr("Quita las carpetas bloqueadas (el PIN sigue activo)")) {
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
                    Text(tr(c.kind == .live ? "TV" : c.kind == .movie ? "Película" : "Serie")).font(.system(size: 12)).foregroundColor(Theme.muted)
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
        if pin.count != 4 { err = tr("El PIN tiene 4 números"); return }
        if step == .enter {
            if pin == Store.parentalPin { current = pin; pin = ""; step = .settings } else { err = tr("PIN incorrecto"); pin = "" }
            return
        }
        let new = pin
        busy = true
        Task { @MainActor in
            let r = await Panel.setPin(old: current, new: new)
            busy = false
            if r.value != nil { current = new; pin = ""; err = nil; step = .settings; state.toast = tr("PIN guardado en el panel") }
            else { err = r.error ?? tr("No se pudo guardar el PIN en el panel") }
        }
    }
}
