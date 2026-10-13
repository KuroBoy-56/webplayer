import SwiftUI

/**
 * Aviso del panel (bienvenida o vencimiento) con el mismo diseño que Android: franja de color arriba,
 * logo, título, mensaje e imagen (solo si la trae) y un botón. La tarjeta mide lo que mide su contenido:
 * un aviso de solo texto queda como una tarjeta horizontal baja, no como un cuadrado; si el texto es muy
 * largo, se desplaza dentro de la tarjeta.
 */
struct PanelAlertView: View {
    let alert: Alerts.Alert
    let onClose: () -> Void
    /** alto real del contenido (se mide): la tarjeta nunca es más alta que lo que muestra */
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        GeometryReader { g in
            ZStack {
                RadialGradient(colors: [Color(hex: 0x1A0003, alpha: 0.8), Color.black.opacity(0.95)], center: .center, startRadius: 0, endRadius: max(g.size.width, g.size.height))
                    .ignoresSafeArea()
                card(maxHeight: g.size.height - 40)
                    .frame(width: min(480, g.size.width - 40))
            }
            .frame(width: g.size.width, height: g.size.height)
        }
    }

    // Como Android: franja, contenido y botón; la altura es la del contenido y solo si no cabe en la
    // pantalla se desplaza (antes el marco con alto máximo estiraba la tarjeta hasta casi toda la pantalla).
    private func card(maxHeight: CGFloat) -> some View {
        VStack(spacing: 0) {
            LinearGradient(colors: alert.expiry ? [Theme.accent, Theme.accent] : [Theme.accent, Color(hex: 0xF5C518)], startPoint: .leading, endPoint: .trailing)
                .frame(height: 4)
            ScrollView(showsIndicators: false) {
                content
                    .background(GeometryReader { c in
                        Color.clear.preference(key: AlertHeightKey.self, value: c.size.height)
                    })
            }
            .frame(height: contentHeight > 0 ? min(contentHeight, maxHeight - 4) : nil)
            .onPreferenceChange(AlertHeightKey.self) { contentHeight = $0 }
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(LinearGradient(colors: [Color(hex: 0x1F1F1F), Color(hex: 0x121212)], startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.13), lineWidth: 1))
    }

    private var content: some View {
        VStack(spacing: 0) {
            LogoHeader(height: 34)
            Text(alert.title)
                .font(.system(size: 22, weight: .black))
                .foregroundColor(alert.expiry ? Theme.accent : .white)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 18)
            if !alert.message.trimmed.isEmpty {
                Text(alert.message)
                    .font(.system(size: 16))
                    .lineSpacing(4)
                    .foregroundColor(Color(hex: 0xB3B3B3))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)
            }
            if !alert.image.isEmpty {
                RemoteImage(url: alert.image, mode: .fit, maxPixel: 1400)
                    .frame(maxWidth: .infinity)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding(.top, 18)
            }
            AppButton(text: alert.button.uppercased(), action: onClose)
                .padding(.top, 24)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }
}

private struct AlertHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
