import SwiftUI

/** Aviso del panel (bienvenida o vencimiento) con un solo botón. */
struct PanelAlertView: View {
    let alert: Alerts.Alert
    let onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.7).ignoresSafeArea()
            VStack(spacing: 16) {
                Text(alert.title).font(.system(size: 20, weight: .bold)).foregroundColor(alert.expiry ? Color(hex: 0xDC143C) : Color(hex: 0xFFD700)).multilineTextAlignment(.center)
                if !alert.image.isEmpty { RemoteImage(url: alert.image, mode: .fit, maxPixel: 1200).frame(maxHeight: 220).clipShape(RoundedRectangle(cornerRadius: 8)) }
                ScrollView { Text(alert.message).font(.system(size: 15)).foregroundColor(.white).multilineTextAlignment(.center).frame(maxWidth: .infinity) }.frame(maxHeight: 240)
                AppButton(text: alert.button, action: onClose)
            }
            .padding(24).frame(maxWidth: 420)
            .background(Color(hex: 0x1A1A1A)).clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.2)))
            .padding(24)
        }
    }
}
