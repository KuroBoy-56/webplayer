import Foundation

/**
 * "Anillos de seguridad" del panel para activar el equipo:
 *  - login.php (POST action + data cifrada AES-256-GCM): check_mac, fetch_dns, submit_url, auto_demo, set_pin, tenant_config
 *  - auth.php (POST {"data": mope}): listas del equipo
 * El equipo se identifica con mac_address = Device.id.
 */
enum Panel {
    /** Línea IPTV que el panel tiene asignada a este equipo. */
    /** demo: el panel dice que la línea es una demo (se muestra "DEMO", sin progreso ni Mi lista) */
    struct Line: Equatable { let name, base, user, pass: String; var demo = false }

    /** Resultado con mensaje de error en español para mostrar en pantalla. */
    struct Answer<T> {
        var value: T?
        var error: String?
        var code: Int = 0
    }

    static let noPanel = "No se pudo conectar con el panel. Revisa tu conexión a internet."

    private static func device() -> JObj { ["mac_address": Device.id] }

    /** POST a login.php con el JSON cifrado. Con distribuidor lleva "tenant" + "app". */
    private static func login(_ action: String, _ payload: JObj, tag: Bool = true) async -> Answer<Resp> {
        var p = payload
        if tag { Tenant.tag(&p) }
        // en qué equipo está esta MAC (Clientes MAC › Dispositivo) y la pantalla falsa de esta app
        p["platform"] = Tenant.app
        // check_mac y auto_demo traen la línea (usuario y contraseña): se piden cifradas
        let secret = action == "check_mac" || action == "auto_demo"
        if secret { p["enc"] = 1 }
        let encReply = secret || action == "set_pin"
        let data: String
        do { data = try PanelCrypto.encrypt(Json.string(p)) } catch is PanelCrypto.MissingKey {
            return Answer(value: nil, error: PanelCrypto.missingKeyMessage)
        } catch { return Answer(value: nil, error: "No se pudo preparar la solicitud al panel") }
        let r = await Net.postForm(PanelUrl.api("login.php"), ["action": action, "data": data])
        if r.code == 0 { return Answer(value: nil, error: noPanel) }
        // respuesta cifrada (panel nuevo) -> JSON; los errores siempre llegan en JSON
        let body = r.text.trimmed
        if encReply && r.code == 200 && !body.isEmpty && !body.hasPrefix("{") {
            guard let dec = (try? PanelCrypto.decrypt(body)) ?? nil else {
                return Answer(value: nil, error: "La llave de la app no coincide con la del panel")
            }
            return Answer(value: Resp(code: r.code, data: Data(dec.utf8)))
        }
        return Answer(value: r)
    }

    /** código de demo de un revendedor: 6 letras y números con al menos una letra (solo números = distribuidor) */
    static func isResellerCode(_ s: String) -> Bool {
        let t = s.trimmed
        return t.count == 6 && t.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) } && t.contains { $0.isLetter }
    }

    private static func errorOf(_ r: Resp, _ fallback: String) -> String {
        let j = r.json()
        if let m = Tenant.onPanelError(j) { return m }
        var msg = j?.s("error") ?? ""
        if msg.isEmpty { msg = j?.s("message") ?? "" }
        switch msg {
        case "Server not configured": return "El panel no está configurado"
        case "Decryption failed": return "La llave de la app no coincide con la del panel"
        case "": return fallback
        default: return msg
        }
    }

    /** pantalla falsa que mandó el último check_mac (nil = ninguna) */
    private(set) static var fakeScreen: FakeScreen?

    /** ¿El equipo ya tiene una línea activa en el panel? value nil + error nil = no la tiene. */
    static func checkMac() async -> Answer<Line> {
        let a = await login("check_mac", device())
        guard let r = a.value else { return Answer(value: nil, error: a.error) }
        if Tenant.active && (400..<500).contains(r.code) { return Answer(value: nil, error: errorOf(r, "El panel rechazó la solicitud")) }
        guard let j = r.json() else { return Answer(value: nil, error: errorOf(r, "Respuesta no válida del panel")) }
        fakeScreen = FakeScreen.parse(j)
        if !j.b("exists") { return Answer(value: nil, error: nil) }
        // PIN parental del panel: es el que usa la app
        let pin = j.s("pin")
        if pin.count == 4 && pin.isDigits { Store.parentalPin = pin }
        var line = lineFromUrl("Servidor", j.s("url"), j.s("username"), j.s("password"))
        line?.demo = j.b("demo")
        return Answer(value: line)
    }

    /** Lista de DNS del panel (respuesta cifrada). */
    static func fetchDns() async -> Answer<[String]> {
        let a = await login("fetch_dns", [:])
        guard let r = a.value else { return Answer(value: nil, error: a.error) }
        if !r.ok { return Answer(value: nil, error: errorOf(r, "El panel no devolvió los servidores")) }
        let dec: String?
        do { dec = try PanelCrypto.decrypt(r.text) } catch { return Answer(value: nil, error: PanelCrypto.missingKeyMessage) }
        guard let plain = dec else { return Answer(value: nil, error: "La llave de la app no coincide con la del panel") }
        guard let arr = Json.parse(Data(plain.utf8)) as? [Any] else { return Answer(value: nil, error: "Lista de servidores no válida") }
        return Answer(value: arr.compactMap { ($0 as? String)?.trimmed }.filter { !$0.isEmpty })
    }

    /** Activa el equipo con usuario, contraseña y el DNS elegido. */
    static func submitUrl(user: String, pass: String, dns: String) async -> Answer<Bool> {
        var p = device()
        p["username"] = user; p["password"] = pass; p["url"] = dns
        let a = await login("submit_url", p)
        guard let r = a.value else { return Answer(value: nil, error: a.error) }
        if r.ok && r.json()?.s("status") == "ok" { return Answer(value: true) }
        return Answer(value: nil, error: errorOf(r, "No se pudo activar el equipo"))
    }

    /** Demo automática. Con el código de un revendedor la demo queda a su nombre en el panel. */
    static func autoDemo(reseller: String) async -> Answer<(String, String)> {
        var p = device()
        if isResellerCode(reseller) { p["reseller"] = reseller.trimmed.uppercased() }
        let a = await login("auto_demo", p)
        guard let r = a.value else { return Answer(value: nil, error: a.error) }
        let j = r.json()
        if r.ok, let j = j, j.s("status") == "ok", !j.s("username").isEmpty {
            return Answer(value: (j.s("username"), j.s("password")), code: r.code)
        }
        let fallback: String
        switch r.code {
        case 403: fallback = "Demo ya utilizado en este dispositivo o dispositivo ya registrado."
        case 404: fallback = "Código de revendedor no válido o sin demo disponible."
        case 429: fallback = "Demasiadas demos desde esta conexión. Inténtalo mañana."
        default: fallback = "No se pudo crear la demo"
        }
        return Answer(value: nil, error: errorOf(r, fallback), code: r.code)
    }

    /** Cambia el PIN parental en el panel (pide el actual). Si el panel no lo acepta, el PIN no cambia. */
    static func setPin(old: String, new: String) async -> Answer<Bool> {
        var p = device()
        p["old_pin"] = old; p["pin"] = new
        let a = await login("set_pin", p)
        guard let r = a.value else { return Answer(value: nil, error: a.error) }
        if r.ok && r.json()?.b("ok") == true {
            Store.parentalPin = new
            return Answer(value: true)
        }
        return Answer(value: nil, error: errorOf(r, "El panel no guardó el PIN (\(r.code))"), code: r.code)
    }

    struct TenantAnswer { var value: JObj?; var error: String?; var errorCode: String = "" }

    /** tenant_config con {code, app, device} cifrado; la respuesta viene cifrada. */
    static func tenantConfig(_ code: String) async -> TenantAnswer {
        if !PanelCrypto.hasKey { return TenantAnswer(value: nil, error: "Esta versión de la app no tiene la llave del panel", errorCode: "no_key") }
        let a = await login("tenant_config", ["code": code, "app": Tenant.app, "device": Device.id], tag: false)
        guard let r = a.value else { return TenantAnswer(value: nil, error: a.error, errorCode: "offline") }
        if r.code >= 500 { return TenantAnswer(value: nil, error: noPanel, errorCode: "offline") }
        if !r.ok {
            let j = r.json()
            let c = j?.s("code") ?? ""
            let m = j?.s("error") ?? ""
            let msg: String
            switch m {
            case "Decryption failed": msg = "La llave de la app no coincide con la del panel"
            case "Server not configured": msg = "El panel no está configurado"
            case "": msg = "El panel rechazó el número (\(r.code))"
            default: msg = m
            }
            return TenantAnswer(value: nil, error: msg, errorCode: c.isEmpty ? "http_\(r.code)" : c)
        }
        let dec: String?
        do { dec = try PanelCrypto.decrypt(r.text) } catch { return TenantAnswer(value: nil, error: "Esta versión de la app no tiene la llave del panel", errorCode: "no_key") }
        guard let plain = dec else { return TenantAnswer(value: nil, error: "La llave de la app no coincide con la del panel", errorCode: "bad_key") }
        guard let j = Json.obj(plain), j.s("status") == "ok" else { return TenantAnswer(value: nil, error: "Respuesta no válida del panel", errorCode: "bad_response") }
        return TenantAnswer(value: j)
    }

    /** auth.php: listas asignadas al equipo (respuesta cifrada con mope). */
    static func playlists() async -> Answer<[Line]> {
        // auth.php solo conoce las listas del dueño: con distribuidor se usa check_mac
        if Tenant.active { return Answer(value: []) }
        let body: JObj = ["data": PanelCrypto.mopeEncrypt(Json.string(device()))]
        let r = await Net.postJson(PanelUrl.api("auth.php"), body)
        if r.code == 0 { return Answer(value: nil, error: noPanel) }
        guard let outer = r.json() else { return Answer(value: nil, error: "Respuesta no válida del panel") }
        if !r.ok { return Answer(value: nil, error: errorOf(r, "El panel rechazó la solicitud")) }
        var resp: JObj?
        let d = outer.s("data")
        if !d.isEmpty, let plain = PanelCrypto.mopeDecrypt(d) { resp = Json.obj(plain) }
        guard let res = resp ?? outer.o("plain") else { return Answer(value: nil, error: "Respuesta no válida del panel") }
        let k = res.s("tmdbKey")
        if !k.isEmpty && k != "missing_tmdb_key" { Store.tmdbKey = k }
        let pc = res.s("parent_control")
        if pc.count == 4 && pc.isDigits { Store.parentalPin = pc }
        var seen = Set<String>()
        let lines = res.objs("urls").compactMap { o -> Line? in
            lineFromUrl(o.s("name").ifEmpty("Servidor"), o.s("url"), "", "")
        }.filter { seen.insert("\($0.base)|\($0.user)").inserted }
        return Answer(value: lines)
    }

    /** ".../get.php?username=u&password=p&type=m3u_plus" -> base + usuario + contraseña */
    static func lineFromUrl(_ name: String, _ url: String, _ user: String, _ pass: String) -> Line? {
        let u = url.trimmed
        if u.isEmpty { return nil }
        let q = URLComponents(string: u)?.queryItems ?? []
        let usr = user.isEmpty ? (q.first { $0.name == "username" }?.value ?? "") : user
        let pwd = pass.isEmpty ? (q.first { $0.name == "password" }?.value ?? "") : pass
        var base: String
        if let r = u.range(of: "/get.php") { base = String(u[..<r.lowerBound]) }
        else { base = String(u.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "") }
        while base.hasSuffix("/") { base.removeLast() }
        if usr.isEmpty || pwd.isEmpty || base.isEmpty { return nil }
        return Line(name: name, base: base, user: usr, pass: pwd)
    }
}
