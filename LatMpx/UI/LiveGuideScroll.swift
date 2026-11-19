import SwiftUI
import UIKit

/// Borde de abajo del programa de ahora de la guía, en el espacio de la lista de TV en vivo (nil = no hay programa de ahora).
struct LiveGuideNowKey: PreferenceKey {
    static var defaultValue: CGFloat? = nil
    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) { value = nextValue() ?? value }
}

/// Borde de abajo de toda la guía, en el espacio de la lista de TV en vivo.
struct LiveGuideBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/**
 * Como tvguide.php de la web: con la guía arriba, fuera de la vista, si cambia de alto (se eligió otro canal) la lista
 * queda donde estaba. Va de fondo de la guía y, cuando su alto cambia, corre el desplazamiento de la lista lo mismo en
 * el mismo paso de dibujo, así no hay saltos ni parpadeos. Con la guía a la vista la lista baja o sube con ella.
 */
struct LiveGuideAnchor: UIViewRepresentable {
    func makeUIView(context: Context) -> AnchorView { AnchorView() }
    func updateUIView(_ uiView: AnchorView, context: Context) {}

    final class AnchorView: UIView {
        private var lastHeight: CGFloat = -1

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            backgroundColor = .clear
        }

        required init?(coder: NSCoder) { nil }

        override func layoutSubviews() {
            super.layoutSubviews()
            let h = bounds.height
            defer { lastHeight = h }
            guard lastHeight >= 0, abs(h - lastHeight) > 0.5, let sv = scrollView() else { return }
            let top = sv.adjustedContentInset.top, y = sv.contentOffset.y + top
            // la guía estaba entera arriba, fuera de la vista: la lista se queda en el mismo lugar (con la lista arriba
            // del todo la guía que llega se ve)
            if y > 0.5 && y >= lastHeight {
                sv.contentOffset.y = max(-top, sv.contentOffset.y + h - lastHeight)
            }
        }

        private func scrollView() -> UIScrollView? {
            var v = superview
            while let s = v {
                if let sv = s as? UIScrollView { return sv }
                v = s.superview
            }
            return nil
        }
    }
}
