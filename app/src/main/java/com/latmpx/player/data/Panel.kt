package com.latmpx.player.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * "Anillos de seguridad" del panel para activar el equipo:
 *  - login.php (POST action + data cifrada AES-256-GCM): check_mac, fetch_dns, submit_url, auto_demo
 *  - auth.php (POST {"data": mope}): listas del equipo
 * El equipo se identifica con mac_address = Android ID en formato MAC (ver Device.id).
 */
object Panel {
    /** Línea IPTV que el panel tiene asignada a este equipo. */
    /** demo: el panel dice que la línea es una demo (se muestra "DEMO", sin progreso ni Mi lista) */
    data class Line(val name: String, val base: String, val user: String, val pass: String, val demo: Boolean = false)

    /** Resultado con mensaje de error en español para mostrar en pantalla. */
    data class Answer<T>(val value: T?, val error: String? = null, val code: Int = 0)

    private const val NO_PANEL = "No se pudo conectar con el panel. Revisa tu conexión a internet."

    private fun device(id: String) = JSONObject().put("mac_address", id)

    /** POST a login.php con el JSON cifrado. Devuelve el cuerpo crudo o el error. Con distribuidor lleva "tenant" + "app". */
    private suspend fun login(action: String, payload: JSONObject, tag: Boolean = true): Answer<Net.Resp> {
        if (tag) Tenant.tag(payload)
        // en qué equipo está esta MAC (Clientes MAC › Dispositivo) y la pantalla falsa de esta app
        payload.put("platform", Tenant.APP)
        // check_mac y auto_demo traen la línea (usuario y contraseña): se piden cifradas
        val secret = action == "check_mac" || action == "auto_demo"
        if (secret) payload.put("enc", 1)
        val encReply = secret || action == "set_pin" // set_pin siempre responde cifrado cuando sale bien
        val data = try {
            PanelCrypto.encrypt(payload.toString())
        } catch (e: PanelCrypto.MissingKey) {
            return Answer(null, e.message)
        } catch (e: Exception) {
            return Answer(null, "No se pudo preparar la solicitud al panel")
        }
        val r = Net.postForm(PanelUrl.api("login.php"), mapOf("action" to action, "data" to data))
        if (r.code == 0) return Answer(null, NO_PANEL)
        // respuesta cifrada (panel nuevo) -> JSON; un panel viejo la manda en JSON y queda igual. Los errores siempre llegan en JSON.
        if (encReply && r.code == 200 && r.body.isNotBlank() && !r.body.trimStart().startsWith("{")) {
            val dec = runCatching { PanelCrypto.decrypt(r.body) }.getOrNull()
                ?: return Answer(null, "La llave de la app no coincide con la del panel")
            return Answer(r.copy(body = dec))
        }
        return Answer(r)
    }

    /** código de demo de un revendedor: 6 letras y números con al menos una letra (nunca solo números: eso es un distribuidor) */
    fun isResellerCode(s: String): Boolean {
        val t = s.trim()
        return t.length == 6 && t.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' } && t.any { it.isLetter() }
    }

    private fun errorOf(r: Net.Resp, fallback: String): String {
        val j = r.json()
        // distribuidor vencido / suspendido / no válido: Tenant avisa a la interfaz y da el mensaje en español
        Tenant.onPanelError(j)?.let { return it }
        val msg = j?.s("error").orEmpty().ifEmpty { j?.s("message").orEmpty() }
        return when {
            msg == "Server not configured" -> "El panel no está configurado"
            msg == "Decryption failed" -> "La llave de la app no coincide con la del panel"
            msg.isNotEmpty() -> msg
            else -> fallback
        }
    }

    /** pantalla falsa que mandó el último check_mac (null = ninguna) */
    @Volatile var fakeScreen: FakeScreen? = null
        private set

    /** ¿El equipo ya tiene una línea activa en el panel? */
    suspend fun checkMac(deviceId: String): Answer<Line> {
        val a = login("check_mac", device(deviceId))
        val r = a.value ?: return Answer(null, a.error)
        // con distribuidor: un error del panel (vencido, suspendido…) se muestra en vez de "no hay línea"
        if (Tenant.active && r.code in 400..499) return Answer(null, errorOf(r, "El panel rechazó la solicitud"))
        val j = r.json() ?: return Answer(null, errorOf(r, "Respuesta no válida del panel"))
        fakeScreen = FakeScreen.parse(j)
        if (!j.optBoolean("exists", false)) return Answer(null)
        // PIN parental del panel: es el que usa la app
        j.s("pin").takeIf { it.length == 4 && it.all(Char::isDigit) }?.let { Store.parentalPin = it }
        val line = lineFromUrl("Servidor", j.s("url"), j.s("username"), j.s("password"))?.copy(demo = j.optBoolean("demo", false))
        return Answer(line)
    }

    /** Lista de DNS del panel (respuesta cifrada). */
    suspend fun fetchDns(): Answer<List<String>> {
        val a = login("fetch_dns", JSONObject())
        val r = a.value ?: return Answer(null, a.error)
        if (!r.ok) return Answer(null, errorOf(r, "El panel no devolvió los servidores"))
        val dec: String? = try {
            PanelCrypto.decrypt(r.body)
        } catch (e: PanelCrypto.MissingKey) {
            return Answer(null, e.message)
        }
        val plain = dec ?: return Answer(null, "La llave de la app no coincide con la del panel")
        val arr = runCatching { JSONArray(plain) }.getOrNull() ?: return Answer(null, "Lista de servidores no válida")
        val out = (0 until arr.length()).map { arr.optString(it).trim() }.filter { it.isNotEmpty() }
        return Answer(out)
    }

    /** Activa el equipo con usuario, contraseña y el DNS elegido. */
    suspend fun submitUrl(deviceId: String, user: String, pass: String, dns: String): Answer<Unit> {
        val payload = device(deviceId).put("username", user).put("password", pass).put("url", dns)
        val a = login("submit_url", payload)
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json()
        if (r.ok && j?.s("status") == "ok") return Answer(Unit)
        return Answer(null, errorOf(r, "No se pudo activar el equipo"))
    }

    /** Demo automática (una sola vez por equipo). Con el código de un revendedor la demo queda a su nombre en el panel. */
    suspend fun autoDemo(deviceId: String, reseller: String = ""): Answer<Pair<String, String>> {
        val p = device(deviceId)
        if (isResellerCode(reseller)) p.put("reseller", reseller.trim().uppercase())
        val a = login("auto_demo", p)
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json()
        if (r.ok && j?.s("status") == "ok" && j.s("username").isNotEmpty()) return Answer(j.s("username") to j.s("password"), code = r.code)
        val fallback = when (r.code) {
            403 -> "Demo ya utilizado en este dispositivo o dispositivo ya registrado."
            404 -> "Código de revendedor no válido o sin demo disponible."
            429 -> "Demasiadas demos desde esta conexión. Inténtalo mañana."
            else -> "No se pudo crear la demo"
        }
        return Answer(null, errorOf(r, fallback), r.code)
    }

    /** Cambia el PIN parental en el panel (pide el actual). Si el panel no lo acepta, el PIN no cambia. */
    suspend fun setPin(deviceId: String, oldPin: String, newPin: String): Answer<Unit> {
        val a = login("set_pin", device(deviceId).put("old_pin", oldPin).put("pin", newPin))
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json()
        if (r.ok && j?.optBoolean("ok") == true) {
            Store.parentalPin = newPin
            return Answer(Unit)
        }
        return Answer(null, errorOf(r, "El panel no guardó el PIN (${r.code})"), r.code)
    }

    /** Respuesta de tenant_config: la configuración descifrada o el código de error (tenant_invalid, offline, no_key…). */
    data class TenantAnswer(val value: JSONObject?, val error: String? = null, val errorCode: String = "")

    /** login.php action tenant_config con {code, app, device} cifrado; la respuesta viene cifrada igual que fetch_dns. */
    suspend fun tenantConfig(code: String, deviceId: String): TenantAnswer {
        if (!PanelCrypto.hasKey()) return TenantAnswer(null, "Esta versión de la app no tiene la llave del panel", "no_key")
        val payload = JSONObject().put("code", code).put("app", Tenant.APP).put("device", deviceId)
        val a = login("tenant_config", payload, tag = false)
        val r = a.value ?: return TenantAnswer(null, a.error, "offline")
        if (r.code >= 500) return TenantAnswer(null, NO_PANEL, "offline")
        if (!r.ok) {
            val j = r.json()
            val c = j?.s("code").orEmpty()
            val msg = j?.s("error").orEmpty().let { m ->
                when (m) {
                    "Decryption failed" -> "La llave de la app no coincide con la del panel"
                    "Server not configured" -> "El panel no está configurado"
                    else -> m.ifEmpty { "El panel rechazó el número (${r.code})" }
                }
            }
            return TenantAnswer(null, msg, c.ifEmpty { "http_${r.code}" })
        }
        val dec: String? = try {
            PanelCrypto.decrypt(r.body)
        } catch (e: PanelCrypto.MissingKey) {
            return TenantAnswer(null, "Esta versión de la app no tiene la llave del panel", "no_key")
        }
        val plain = dec ?: return TenantAnswer(null, "La llave de la app no coincide con la del panel", "bad_key")
        val j = runCatching { JSONObject(plain) }.getOrNull()
        if (j == null || j.s("status") != "ok") return TenantAnswer(null, "Respuesta no válida del panel", "bad_response")
        return TenantAnswer(j)
    }

    /** auth.php: listas asignadas al equipo (respuesta cifrada con mope). */
    suspend fun playlists(deviceId: String): Answer<List<Line>> {
        // auth.php solo conoce las listas del dueño: con distribuidor se usa check_mac (que sí lo respeta)
        if (Tenant.active) return Answer(emptyList())
        val body = JSONObject().put("data", PanelCrypto.mopeEncrypt(device(deviceId).toString()))
        val r = Net.postJson(PanelUrl.api("auth.php"), body)
        if (r.code == 0) return Answer(null, NO_PANEL)
        val outer = r.json() ?: return Answer(null, "Respuesta no válida del panel")
        if (!r.ok) return Answer(null, errorOf(r, "El panel rechazó la solicitud"))
        val resp = outer.s("data").takeIf { it.isNotEmpty() }?.let { PanelCrypto.mopeDecrypt(it) }
            ?.let { runCatching { JSONObject(it) }.getOrNull() } ?: outer.optJSONObject("plain")
            ?: return Answer(null, "Respuesta no válida del panel")
        // llave TMDB configurada en el panel: se usa para el fondo de pósters del inicio de sesión
        resp.s("tmdbKey").takeIf { it.isNotEmpty() && it != "missing_tmdb_key" }?.let { Store.tmdbKey = it }
        resp.s("parent_control").takeIf { it.length == 4 && it.all(Char::isDigit) }?.let { Store.parentalPin = it }
        val lines = resp.optJSONArray("urls").mapObj { o -> lineFromUrl(o.s("name").ifEmpty { "Servidor" }, o.s("url"), "", "") }
        return Answer(lines.distinctBy { "${it.base}|${it.user}" })
    }

    /** ".../get.php?username=u&password=p&type=m3u_plus" -> base + usuario + contraseña */
    private fun lineFromUrl(name: String, url: String, user: String, pass: String): Line? {
        if (url.isBlank()) return null
        val u = url.trim().toHttpUrlOrNull()
        val usr = user.ifEmpty { u?.queryParameter("username").orEmpty() }
        val pwd = pass.ifEmpty { u?.queryParameter("password").orEmpty() }
        val base = if (url.contains("/get.php")) url.substringBefore("/get.php") else url.substringBefore("?").trimEnd('/')
        if (usr.isEmpty() || pwd.isEmpty() || base.isEmpty()) return null
        return Line(name, base, usr, pwd)
    }
}
