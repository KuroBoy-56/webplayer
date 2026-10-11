import Foundation
import Combine

/**
 * Distribuidor (multi-tenant) del panel: número de 6 dígitos, marca (nombre, logo, colores) y "guardián".
 *  - sin elegir: se muestra la pantalla "Número de distribuidor"
 *  - Omitir ("skip"): la app funciona como siempre (no se envía nada nuevo al panel)
 *  - con número ("code"): cada llamada al panel lleva "tenant" + "app"; la marca se guarda en el equipo
 *    y se vuelve a comprobar con tenant_config al abrir la app y cada recheck_after segundos.
 */
final class Tenant: ObservableObject {
    static let shared = Tenant()
    /** id de esta app en el panel */
    static let app = "ios"

    static let offlineGrace: Double = 72 * 3600
    private static let defaultRecheck: Double = 21600

    struct Colors: Equatable { let accent, bg, surface, text: String }

    struct Brand: Equatable {
        let code: String
        let name: String
        let logoUrl: String
        let logoRev: Int
        let colors: Colors?
        let expiresAt: Double
        let expiresDate: String
        let demo: Bool
        let alerts: Bool
        let sports: Bool
        let rev: Int
        let recheckAfter: Double

        /** "DD/MM/AAAA" o "" sin vencimiento */
        var expiresText: String {
            guard let g = Rx.groups(expiresDate, "^(\\d{4})-(\\d{2})-(\\d{2})$") else { return "" }
            return "\(g[3])/\(g[2])/\(g[1])"
        }
        func expired(_ now: Double = Date().timeIntervalSince1970) -> Bool { expiresAt > 0 && now > expiresAt }
    }

    /** marca del distribuidor elegido (nil = Omitir o sin elegir: todo como siempre) */
    @Published private(set) var brand: Brand?
    /** mensaje cuando el panel corta el distribuidor durante el uso */
    @Published var revoked: String?

    private init() {
        brand = Store.distChoice == "code" ? Tenant.parse(Store.distConfig) : nil
    }

    /** número activo ("" con Omitir o sin elegir) */
    static var code: String { Store.distChoice == "code" ? Store.distCode : "" }
    static var active: Bool { !code.isEmpty }

    var demoEnabled: Bool { brand?.demo ?? true }
    var alertsEnabled: Bool { brand?.alerts ?? true }
    var sportsEnabled: Bool { brand?.sports ?? true }

    func nameOr(_ def: String) -> String {
        if let n = brand?.name, !n.trimmed.isEmpty { return n }
        return def
    }

    /** agrega "tenant" y "app" a un JSON para el panel (nada con Omitir) */
    static func tag(_ o: inout JObj) {
        let c = code
        if !c.isEmpty { o["tenant"] = c; o["app"] = app }
    }

    /** ?t=<número>&app=<app> para una dirección del panel (nada con Omitir) */
    static func query() -> String {
        let c = code
        return c.isEmpty ? "" : "&t=\(urlEnc(c))&app=\(app)"
    }

    /* ---------- errores del panel ---------- */
    static let fatal: Set<String> = ["tenant_invalid", "tenant_expired", "tenant_suspended", "app_not_linked"]

    static func message(_ code: String, _ fallback: String = "") -> String {
        switch code {
        case "tenant_invalid": return "Número de distribuidor no válido"
        case "tenant_expired": return "El servicio de este distribuidor venció. Contacta a tu distribuidor."
        case "tenant_suspended": return "Este distribuidor está suspendido. Contacta a tu distribuidor."
        case "app_not_linked": return "Este número de distribuidor no está habilitado para esta aplicación."
        case "too_many_attempts": return "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo."
        case "app_required": return "Error de la app: no envió su identificador al panel (app_required). Actualiza la app."
        default: return fallback.isEmpty ? "No se pudo comprobar el distribuidor" : fallback
        }
    }

    /** error del panel durante el uso: si corta el distribuidor se avisa a la interfaz. Devuelve el mensaje o nil. */
    static func onPanelError(_ j: JObj?) -> String? {
        let c = j?.s("code") ?? ""
        if c.isEmpty || !active { return nil }
        if fatal.contains(c) {
            let m = message(c)
            DispatchQueue.main.async { Tenant.shared.revoked = m }
            return m
        }
        return c == "too_many_attempts" || c == "app_required" ? message(c) : nil
    }

    static func expiredMessage(_ b: Brand) -> String {
        b.expiresText.isEmpty ? message("tenant_expired") : "Tu distribuidor venció el \(b.expiresText) (hora de Panamá)."
    }

    /* ---------- tenant_config ---------- */
    enum Check {
        case ok(Brand)
        case denied(String)   // el panel cortó el número
        case problem(String)  // error que no borra nada
        case offline(String)  // sin internet o error del servidor
    }

    static func fetch(_ code: String) async -> Check {
        let a = await Panel.tenantConfig(code)
        if let cfg = a.value {
            guard let b = parse(Json.string(cfg)) else { return .problem("Respuesta no válida del panel") }
            return .ok(b)
        }
        let c = a.errorCode
        if fatal.contains(c) { return .denied(message(c)) }
        if c == "too_many_attempts" || c == "app_required" { return .problem(message(c)) }
        if c == "no_key" { return .problem("Esta versión de la app no tiene la llave del panel") }
        if c == "offline" { return .offline(a.error ?? "No se pudo conectar con el panel") }
        return .problem(a.error ?? "No se pudo comprobar el distribuidor")
    }

    func choose(_ b: Brand) {
        Store.distCode = b.code
        Store.distConfig = Tenant.raw(b)
        Store.distLastOk = Date().timeIntervalSince1970
        Store.distChoice = "code"
        brand = b
        revoked = nil
    }

    func refresh(_ b: Brand) {
        Store.distConfig = Tenant.raw(b)
        Store.distLastOk = Date().timeIntervalSince1970
        if brand != b { brand = b }
    }

    func skip() {
        Store.distChoice = "skip"; Store.distCode = ""; Store.distConfig = ""
        brand = nil; revoked = nil
    }

    func clear() {
        Store.distChoice = ""; Store.distCode = ""; Store.distConfig = ""; Store.distLastOk = 0
        brand = nil
    }

    func due() -> Bool {
        guard let b = brand else { return false }
        let every = b.recheckAfter > 0 ? b.recheckAfter : Tenant.defaultRecheck
        return Date().timeIntervalSince1970 - Store.distLastOk >= every
    }

    func offlineOk() -> Bool { Date().timeIntervalSince1970 - Store.distLastOk < Tenant.offlineGrace }

    /* ---------- lectura ---------- */
    static func parse(_ raw: String) -> Brand? {
        guard !raw.trimmed.isEmpty, let j = Json.obj(raw), j.s("status") == "ok", let t = j.o("tenant") else { return nil }
        let code = t.s("code")
        guard Rx.has(code, "^\\d{6}$") else { return nil }
        var colors: Colors?
        if let p = t.o("palette") {
            let c = Colors(accent: p.s("accent"), bg: p.s("bg"), surface: p.s("surface"), text: p.s("text"))
            if [c.accent, c.bg, c.surface, c.text].allSatisfy({ Rx.has($0, "^#[0-9A-Fa-f]{6}$") }) { colors = c }
        }
        let f = j.o("features")
        let logo = t.s("logo_url")
        return Brand(
            code: code, name: t.s("name"),
            logoUrl: logo.hasPrefix("http://") || logo.hasPrefix("https://") ? logo : "",
            logoRev: t.i("logo_rev"), colors: colors,
            expiresAt: Double(t.s("expires_at")) ?? 0, expiresDate: t.s("expires_date"),
            demo: f?.b("demo", true) ?? true, alerts: f?.b("alerts", true) ?? true, sports: f?.b("sports", true) ?? true,
            rev: t.i("rev"),
            recheckAfter: Double(j.s("recheck_after")).flatMap { $0 > 0 ? $0 : nil } ?? defaultRecheck
        )
    }

    static func raw(_ b: Brand) -> String {
        var tenant: JObj = ["code": b.code, "name": b.name, "logo_url": b.logoUrl, "logo_rev": b.logoRev,
                            "expires_at": b.expiresAt, "expires_date": b.expiresDate, "rev": b.rev]
        if let c = b.colors { tenant["palette"] = ["accent": c.accent, "bg": c.bg, "surface": c.surface, "text": c.text] }
        let o: JObj = ["status": "ok", "tenant": tenant,
                       "features": ["demo": b.demo, "alerts": b.alerts, "sports": b.sports], "recheck_after": b.recheckAfter]
        return Json.string(o)
    }
}
