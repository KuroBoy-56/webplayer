import SwiftUI

/**
 * Colores de la app. Por defecto los mismos que la web y Android ("Rojo clásico");
 * con un distribuidor que tiene paleta {accent, bg, surface, text} se derivan de ella.
 */
struct Palette {
    var accent: Color
    var onAccent: Color
    var bg: Color
    var surface: Color
    var card: Color
    var text: Color
    var gray: Color
    var muted: Color
}

enum Theme {
    static let base = Palette(accent: Color(hex: 0xE50914), onAccent: .white, bg: Color(hex: 0x141414), surface: Color(hex: 0x181818),
                              card: Color(hex: 0x2F2F2F), text: Color(hex: 0xE5E5E5), gray: Color(hex: 0x808080), muted: Color(hex: 0xB3B3B3))

    static var p: Palette {
        guard let c = Tenant.shared.brand?.colors, let a = rgb(c.accent), let bg = rgb(c.bg), let s = rgb(c.surface), let t = rgb(c.text) else { return base }
        let lum = 0.2126 * a.0 + 0.7152 * a.1 + 0.0722 * a.2
        return Palette(accent: col(a), onAccent: lum > 0.5 ? .black : .white, bg: col(bg), surface: col(s), card: col(mix(s, t, 0.08)),
                       text: col(t), gray: col(mix(bg, t, 0.45)), muted: col(mix(bg, t, 0.65)))
    }

    static var accent: Color { p.accent }
    static var bg: Color { p.bg }
    static var muted: Color { p.muted }
    static let warn = Color(hex: 0xE87C03)
    static let green = Color(hex: 0x46D369)

    private static func rgb(_ h: String) -> (Double, Double, Double)? {
        guard h.count == 7, let v = UInt32(h.dropFirst(), radix: 16) else { return nil }
        return (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
    }
    private static func mix(_ a: (Double, Double, Double), _ b: (Double, Double, Double), _ t: Double) -> (Double, Double, Double) {
        (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, a.2 + (b.2 - a.2) * t)
    }
    private static func col(_ c: (Double, Double, Double)) -> Color { Color(red: c.0, green: c.1, blue: c.2) }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }
}

/** separación lateral: más en iPad */
func sidePad(_ size: CGSize) -> CGFloat { size.width >= 700 ? 32 : 16 }
func posterWidth(_ size: CGSize) -> CGFloat { size.width >= 700 ? 150 : 110 }
