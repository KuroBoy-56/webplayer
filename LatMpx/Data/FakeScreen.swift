import Foundation

/**
 * Pantalla falsa del panel (Pantalla Falsa, solo el dueño): la manda check_mac a los equipos
 * nuevos de las apps elegidas. type: calculator | carrusel | image | video | web.
 * unlock: código que abre el inicio de sesión ("" = sin código).
 */
struct FakeScreen: Equatable {
    let type: String
    let url: String
    let images: [String]
    let interval: Int
    let unlock: String

    static func parse(_ j: JObj?) -> FakeScreen? {
        guard let f = j?.o("fake_screen"), f.b("show") else { return nil }
        let types: Set<String> = ["calculator", "carrusel", "image", "video", "web"]
        let t = types.contains(f.s("type")) ? f.s("type") : "calculator"
        let u = f.s("url")
        let imgs = (f.a("images") ?? []).compactMap { $0 as? String }.filter { $0.hasPrefix("http") }
        let iv = max(1, min(120, f.i("interval") == 0 ? 5 : f.i("interval")))
        return FakeScreen(type: t, url: u.hasPrefix("http://") || u.hasPrefix("https://") ? u : "", images: imgs, interval: iv,
                          unlock: f.s("unlock").filter { $0.isNumber })
    }
}
