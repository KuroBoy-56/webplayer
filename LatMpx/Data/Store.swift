import Foundation

/**
 * Lo poco que se guarda en el equipo: distribuidor, token del panel y preferencias.
 * El usuario y la contraseña NUNCA se guardan: la sesión vive solo en memoria y en cada
 * inicio se le pide la línea al panel (check_mac) y se comprueba en el servidor IPTV.
 */
enum Store {
    private static let p = UserDefaults.standard

    static func boot() {
        // versiones de prueba anteriores
        p.removeObject(forKey: "session")
        p.removeObject(forKey: "parental_pin")
    }

    private static func tenantKey(_ base: String) -> String {
        let c = Tenant.code
        return c.isEmpty ? base : "\(base)|\(c)"
    }

    /* ---------- llave TMDB del panel ---------- */
    static var tmdbKey: String {
        get { p.string(forKey: tenantKey("tmdb_key")) ?? "" }
        set { p.set(newValue, forKey: tenantKey("tmdb_key")) }
    }

    /* ---------- distribuidor ---------- */
    /** "" = sin elegir (se pregunta), "skip" = Omitir, "code" = con número */
    static var distChoice: String {
        get { p.string(forKey: "dist_choice") ?? "" }
        set { p.set(newValue, forKey: "dist_choice") }
    }
    static var distCode: String {
        get { p.string(forKey: "dist_code") ?? "" }
        set { p.set(newValue, forKey: "dist_code") }
    }
    static var distConfig: String {
        get { p.string(forKey: "dist_config") ?? "" }
        set { p.set(newValue, forKey: "dist_config") }
    }
    static var distLastOk: Double {
        get { p.double(forKey: "dist_last_ok") }
        set { p.set(newValue, forKey: "dist_last_ok") }
    }

    /** DNS elegido (SecureDns): "auto" = el de la red */
    static var dns: String {
        get { p.string(forKey: "dns") ?? "auto" }
        set { p.set(newValue, forKey: "dns") }
    }

    /** idioma de la app: "auto" (el del equipo) o es / en / pt / fr */
    static var appLang: String {
        get { p.string(forKey: "app_lang") ?? "auto" }
        set { p.set(newValue, forKey: "app_lang") }
    }

    /** último canal visto (por línea) */
    static func lastChannel() -> Int { p.integer(forKey: "last_ch|" + scope()) }
    static func setLastChannel(_ id: Int) { p.set(id, forKey: "last_ch|" + scope()) }
    private static func scope() -> String { session().map { "\($0.user)@\($0.base)" } ?? "-" }

    /** reproductor de iOS (imagen en imagen, AirPlay) para lo que puede abrir; false = siempre el de la app */
    static var nativePlayer: Bool {
        get { p.object(forKey: "native_player") as? Bool ?? true }
        set { p.set(newValue, forKey: "native_player") }
    }

    static var streamFormat: String {
        get { p.string(forKey: "stream_format") ?? "m3u8" }
        set { p.set(newValue, forKey: "stream_format") }
    }

    /** PIN parental: siempre activo; es el del panel (check_mac) y los cambios se guardan allí (set_pin). 0000 = de fábrica */
    static var parentalPin: String {
        get {
            let v = p.string(forKey: tenantKey("panel_pin2")) ?? ""
            return v.count == 4 && v.isDigits ? v : "0000"
        }
        set { p.set(newValue, forKey: tenantKey("panel_pin2")) }
    }

    static var blockedCats: Set<String> {
        get { Set(p.stringArray(forKey: "blocked_cats") ?? []) }
        set { p.set(Array(newValue), forKey: "blocked_cats") }
    }

    /* ---------- sesión (solo en memoria) ---------- */
    private static let lock = NSLock()
    private static var mem: Session?

    static func saveSession(_ s: Session) { lock.lock(); mem = s; lock.unlock(); Xtream.streamFlip = false }
    static func session() -> Session? { lock.lock(); defer { lock.unlock() }; return mem }

    static var demoUsed: Bool {
        get { p.bool(forKey: tenantKey("demo_used")) }
        set { p.set(newValue, forKey: tenantKey("demo_used")) }
    }

    /** se escribió el código de la pantalla falsa: este equipo ya no la ve */
    static var fakeUnlocked: Bool {
        get { p.bool(forKey: "fake_unlocked") }
        set { p.set(newValue, forKey: "fake_unlocked") }
    }

    /** última orden de borrado de caché del panel ya aplicada (nil = todavía no llegó ninguna); el borrado no la toca */
    static var cacheClearSeen: Int? {
        get { p.object(forKey: tenantKey("cache_clear_seen")) as? Int }
        set { p.set(newValue, forKey: tenantKey("cache_clear_seen")) }
    }

    static func logout() {
        lock.lock(); mem = nil; lock.unlock()
        p.removeObject(forKey: tenantKey("cloud_token2"))
        p.removeObject(forKey: tenantKey("cloud_token2_scope"))
    }

    /* ---------- token de progress.php / epg.php / sports.php (uno por distribuidor) ---------- */
    static var cloudToken: String? {
        get { p.string(forKey: tenantKey("cloud_token2")) }
        set { if let v = newValue { p.set(v, forKey: tenantKey("cloud_token2")) } else { p.removeObject(forKey: tenantKey("cloud_token2")) } }
    }

    // usuario@servidor del token guardado: si entra otro usuario, el token no coincide y se pide uno
    // nuevo (no se reutiliza "Continuar viendo" ni "Mi lista" de la cuenta anterior)
    static var cloudTokenScope: String? {
        get { p.string(forKey: tenantKey("cloud_token2_scope")) }
        set { if let v = newValue { p.set(v, forKey: tenantKey("cloud_token2_scope")) } else { p.removeObject(forKey: tenantKey("cloud_token2_scope")) } }
    }

    static var audioLang: String? {
        get { p.string(forKey: "audio_lang") }
        set { p.set(newValue, forKey: "audio_lang") }
    }
    static var subLang: String? {
        get { p.string(forKey: "sub_lang") }
        set { p.set(newValue, forKey: "sub_lang") }
    }
}
