import SwiftUI

/** Primera pantalla: "Número de distribuidor" (6 dígitos) con Continuar / Omitir. */
struct DistributorView: View {
    let message: String?
    let onDone: () -> Void
    @EnvironmentObject var tenant: Tenant
    @State private var code = ""
    @State private var busy = false
    @State private var err: String?
    @State private var posters: [String] = []

    var body: some View {
        GeometryReader { g in
            ZStack {
                PosterWall(posters: posters, columns: g.size.width > 700 ? 8 : 4)
                ScrollView {
                    VStack(spacing: 0) {
                        HStack { LogoHeader(height: 46); Spacer() }.padding(.horizontal, sidePad(g.size)).padding(.vertical, 20)
                        Spacer(minLength: 16)
                        VStack(spacing: 14) {
                            Text(tr("Número de distribuidor")).font(.system(size: 28, weight: .bold)).foregroundColor(.white).frame(maxWidth: .infinity, alignment: .leading)
                            Text(tr("Escribe el número de 6 dígitos que te dio tu distribuidor. Si no tienes uno, elige Omitir."))
                                .font(.system(size: 14)).foregroundColor(Theme.muted).frame(maxWidth: .infinity, alignment: .leading)
                            if let e = err { ErrorBanner(text: e) }
                            TextField("", text: $code, prompt: Text(tr("Número de distribuidor")).foregroundColor(Theme.muted))
                                .keyboardType(.numberPad).font(.system(size: 22, design: .monospaced)).foregroundColor(.white)
                                .padding(.horizontal, 14).frame(height: 56).background(Color(hex: 0x333333)).clipShape(RoundedRectangle(cornerRadius: 4))
                                .onChange(of: code) { v in
                                    let f = String(v.filter { $0.isNumber }.prefix(6))
                                    if f != v { code = f }
                                    err = nil
                                }
                                .disabled(busy)
                            AppButton(text: tr("Continuar")) { submit() }
                            AppButton(text: tr("Omitir"), primary: false) { if !busy { tenant.skip(); onDone() } }
                            if busy {
                                VStack(spacing: 8) { ProgressView().tint(Theme.accent); Text(tr("Comprobando el número…")).font(.system(size: 13)).foregroundColor(Theme.muted) }
                            }
                        }
                        .padding(.horizontal, 24).padding(.vertical, 28).background(Color.black.opacity(0.75)).clipShape(RoundedRectangle(cornerRadius: 6))
                        .frame(maxWidth: 400).padding(.horizontal, 16)
                        Spacer(minLength: 40)
                    }.frame(minHeight: g.size.height)
                }
            }
        }
        .background(Color.black.ignoresSafeArea())
        .onAppear { err = message }
        .task { posters = await Tmdb.nowPlaying() }
    }

    private func submit() {
        if busy { return }
        if code.count != 6 { err = tr("Escribe los 6 dígitos del número de distribuidor"); return }
        if !PanelCrypto.hasKey { err = tr("Esta versión de la app no tiene la llave del panel"); return }
        err = nil; busy = true
        Task { @MainActor in
            switch await Tenant.fetch(code) {
            case .ok(let b): if b.expired() { err = Tenant.expiredMessage(b) } else { tenant.choose(b); onDone() }
            case .denied(let m), .problem(let m), .offline(let m): err = m
            }
            busy = false
        }
    }
}

/** Sin conexión con el panel por más de 72 h (o error que no borra el número). */
struct TenantRetryView: View {
    let message: String
    let busy: Bool
    let onRetry: () -> Void
    let onChange: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            LogoHeader(height: 46)
            Text(tr("No se pudo comprobar tu distribuidor")).font(.system(size: 22, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
            ErrorBanner(text: message)
            if busy { ProgressView().tint(Theme.accent) }
            AppButton(text: tr("Reintentar")) { if !busy { onRetry() } }
            AppButton(text: tr("Cambiar distribuidor"), primary: false) { if !busy { onChange() } }
        }
        .padding(.horizontal, 24).padding(.vertical, 28).background(Color.black.opacity(0.75)).clipShape(RoundedRectangle(cornerRadius: 6))
        .frame(maxWidth: 460).padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.black.ignoresSafeArea())
    }
}

/** Cuenta: distribuidor (marca y número; su vencimiento es privado) y "Cambiar distribuidor". */
struct DistributorCard: View {
    @EnvironmentObject var tenant: Tenant
    let onChange: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(tr("Distribuidor")).font(.system(size: 18, weight: .bold)).foregroundColor(.white)
            VStack(spacing: 10) {
                if let b = tenant.brand {
                    InfoRow(k: tr("Distribuidor"), v: "\(b.name.isEmpty ? tr("Distribuidor") : b.name) (\(b.code))")
                } else {
                    InfoRow(k: tr("Distribuidor"), v: tr("Ninguno"))
                }
                AppButton(text: tr("Cambiar distribuidor"), icon: "arrow.left.arrow.right", primary: false, action: onChange)
            }
            .padding(16).background(Color(hex: 0x1F1F1F)).clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}

struct InfoRow: View {
    let k: String
    let v: String
    var body: some View {
        HStack(alignment: .top) {
            Text(k).font(.system(size: 15)).foregroundColor(Theme.muted)
            Spacer(minLength: 12)
            Text(v.isEmpty ? "—" : v).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.trailing)
        }
    }
}
