import SwiftUI

/** piezas de los controles del reproductor de la app (VLC), con el aspecto del de iOS y el acento de la marca */

/** al tocar, el botón se achica un poco */
struct PlayerPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .opacity(configuration.isPressed ? 0.75 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension View {
    /** círculo translúcido con desenfoque (se lee sobre cualquier imagen) */
    func glassCircle(_ d: CGFloat) -> some View {
        frame(width: d, height: d)
            .background(.ultraThinMaterial, in: Circle())
            .background(Circle().fill(Color.black.opacity(0.25)))
            .overlay(Circle().stroke(Color.white.opacity(0.14), lineWidth: 1))
            .contentShape(Circle())
    }
}

/** icono de la barra de arriba, con el área de toque de 44 pt */
func playerBarIcon(_ name: String) -> some View {
    Image(systemName: name).font(.system(size: 19, weight: .semibold)).frame(width: 44, height: 44).contentShape(Rectangle())
}

/** barra de avance: pista fina, avance en el color de acento y una bolita que crece al arrastrar */
struct ScrubBar: View {
    /** avance actual (0…1) */
    let value: Double
    /** posición mientras se arrastra (nil sin arrastrar) */
    @Binding var scrub: Double?
    /** al soltar: la posición elegida */
    let onCommit: (Double) -> Void

    var body: some View {
        GeometryReader { g in
            let w = max(g.size.width, 1)
            let f = CGFloat(min(max(scrub ?? value, 0), 1))
            let on = scrub != nil
            let knob: CGFloat = on ? 20 : 13
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.28)).frame(height: on ? 6 : 4)
                Capsule().fill(Theme.accent).frame(width: w * f, height: on ? 6 : 4)
                Circle().fill(Theme.accent).frame(width: knob, height: knob)
                    .shadow(color: Color.black.opacity(0.4), radius: 3)
                    .offset(x: w * f - knob / 2)
            }
            .frame(width: w, height: g.size.height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { v in scrub = Double(min(max(v.location.x / w, 0), 1)) }
                .onEnded { v in onCommit(Double(min(max(v.location.x / w, 0), 1))) })
            .animation(.easeOut(duration: 0.15), value: on)
        }
        .frame(height: 30)
        .accessibilityElement(children: .ignore)
    }
}
