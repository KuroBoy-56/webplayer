import Foundation
import SwiftUI

/**
 * Idioma de la app: español (el texto del código y el de respaldo), inglés, portugués (Brasil) y francés.
 * "auto" = el idioma del equipo (si no es uno de los cuatro, español). Se cambia en Cuenta › Idioma de la app
 * y se aplica al momento: RootView vuelve a dibujar las pestañas con .id(idioma), sin cerrar sesión.
 * Las traducciones están en L10nStrings.swift (la clave es el texto en español).
 */
final class L10n: ObservableObject {
    static let shared = L10n()
    static let supported = ["es", "en", "pt", "fr"]

    /** "auto" o es / en / pt / fr (se guarda en el equipo) */
    @Published var choice: String {
        didSet {
            Store.appLang = choice
            L10n.set(L10n.resolve(choice))
        }
    }

    private init() { choice = Store.appLang }

    private static let lock = NSLock()
    private static var code = resolve(Store.appLang)

    /** idioma en uso: es / en / pt / fr */
    static var current: String { lock.lock(); defer { lock.unlock() }; return code }
    private static func set(_ c: String) { lock.lock(); code = c; lock.unlock() }

    static var locale: Locale { Locale(identifier: current) }

    /** el elegido o, en automático, el del equipo (primeras 2 letras); si no está entre los cuatro, español */
    static func resolve(_ c: String) -> String {
        if supported.contains(c) { return c }
        let dev = String((Locale.preferredLanguages.first ?? "es").prefix(2)).lowercased()
        return supported.contains(dev) ? dev : "es"
    }

    static func text(_ s: String) -> String {
        switch current {
        case "en": return en[s] ?? s
        case "pt": return pt[s] ?? s
        case "fr": return fr[s] ?? s
        default: return s
        }
    }

    /** opciones de Cuenta › Idioma de la app */
    static let choices = ["auto", "es", "en", "pt", "fr"]

    /** cada idioma con su propio nombre; solo "Automático" se traduce */
    static func label(_ c: String) -> String {
        switch c {
        case "es": return "Español"
        case "en": return "English"
        case "pt": return "Português"
        case "fr": return "Français"
        default: return tr("Automático (idioma del equipo)")
        }
    }
}

/** texto de la interfaz en el idioma de la app (la clave es el texto en español) */
func tr(_ s: String) -> String { L10n.text(s) }

/** con valores: tr("Continuando desde %@", tiempo) */
func tr(_ s: String, _ args: CVarArg...) -> String { String(format: L10n.text(s), arguments: args) }
