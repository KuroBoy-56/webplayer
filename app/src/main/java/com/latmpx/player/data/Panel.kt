package com.latmpx.player.data
import com.latmpx.player.Lang

import com.latmpx.player.tr
import com.latmpx.player.R
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
    data class Line(
        val name: String, val base: String, val user: String, val pass: String, val demo: Boolean = false,
        /** demo: fin (segundos Unix) y duración (segundos) según el panel */
        val demoExpires: Long = 0L, val demoDuration: Long = 0L,
    )

    /** Resultado con mensaje de error en español para mostrar en pantalla. */
    data class Answer<T>(val value: T?, val error: String? = null, val code: Int = 0)

    private val NO_PANEL get() = tr(R.string.err_panel_offline)

    private fun device(id: String) = JSONObject().put("mac_address", id)

    /** diferencia entre la hora del panel y la del equipo (segundos), para el "ts" de cada pedido */
    @Volatile private var clockSkew = 0L

    /** POST a login.php con el JSON cifrado. Devuelve el cuerpo crudo o el error. Con distribuidor lleva "tenant" + "app". */
    private suspend fun login(action: String, payload: JSONObject, tag: Boolean = true): Answer<Net.Resp> {
        if (tag) Tenant.tag(payload)
        // en qué equipo está esta MAC (Clientes MAC › Dispositivo) y la pantalla falsa de esta app
        payload.put("platform", Tenant.APP)
        payload.put("lang", Lang.current) // el panel responde sus mensajes en el idioma de la app
        // check_mac y auto_demo traen la línea (usuario y contraseña): se piden cifradas
        val secret = action == "check_mac" || action == "auto_demo"
        if (secret) payload.put("enc", 1)
        val encReply = secret || action == "set_pin" // set_pin siempre responde cifrado cuando sale bien
        // verificador antihack del panel: hora del pedido ("ts"); si el reloj del equipo está mal, el panel
        // responde 401 ts_expired con su hora y se reintenta una vez con el reloj corregido
        var r = Net.Resp(0, "")
        for (attempt in 0..1) {
            payload.put("ts", System.currentTimeMillis() / 1000 + clockSkew)
            val data = try {
                PanelCrypto.encrypt(payload.toString())
            } catch (e: PanelCrypto.MissingKey) {
                return Answer(null, e.message)
            } catch (e: Exception) {
                return Answer(null, tr(R.string.err_panel_prepare))
            }
            r = Net.postForm(PanelUrl.api("login.php"), mapOf("action" to action, "data" to data))
            val j = if (r.code == 401) r.json() else null
            val server = j?.optLong("server_time", 0L) ?: 0L
            if (attempt == 0 && server > 0 && j?.optString("code").orEmpty().startsWith("ts_")) {
                clockSkew = server - System.currentTimeMillis() / 1000
                continue
            }
            break
        }
        if (r.code == 0) return Answer(null, NO_PANEL)
        // respuesta cifrada (panel nuevo) -> JSON; un panel viejo la manda en JSON y queda igual. Los errores siempre llegan en JSON.
        if (encReply && r.code == 200 && r.body.isNotBlank() && !r.body.trimStart().startsWith("{")) {
            val dec = runCatching { PanelCrypto.decrypt(r.body) }.getOrNull()
                ?: return Answer(null, tr(R.string.err_panel_key_mismatch))
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
            msg == "Server not configured" -> tr(R.string.err_panel_not_configured)
            msg == "Decryption failed" -> tr(R.string.err_panel_key_mismatch)
            msg.isNotEmpty() -> msg
            else -> fallback
        }
    }

    /** pantalla falsa que mandó el último check_mac (null = ninguna) */
    @Volatile var fakeScreen: FakeScreen? = null
        private set

    /** ¿El equipo ya tiene una línea activa en el panel? */
    // poll: la app ya abierta vuelve a preguntar (cada 10 min): el panel no lo cuenta como otra apertura
    suspend fun checkMac(deviceId: String, poll: Boolean = false): Answer<Line> {
        // "cc": última orden de borrado de caché que ya se aplicó (0 = ninguna)
        val a = login("check_mac", device(deviceId).put("cc", Store.cacheClearSeen ?: 0L).apply { if (poll) put("poll", 1) })
        val r = a.value ?: return Answer(null, a.error)
        // con distribuidor: un error del panel (vencido, suspendido…) se muestra en vez de "no hay línea"
        if (Tenant.active && r.code in 400..499) return Answer(null, errorOf(r, tr(R.string.err_panel_rejected)))
        val j = r.json() ?: return Answer(null, errorOf(r, tr(R.string.err_panel_bad_response)))
        fakeScreen = FakeScreen.parse(j)
        // orden de borrado de caché del panel (viene con línea o sin ella; un panel viejo no la manda)
        if (j.has("cache_clear")) CacheClear.received(j.optLong("cache_clear", 0L), j.optLong("cache_clear_at", 0L), System.currentTimeMillis() / 1000 + clockSkew)
        if (!j.optBoolean("exists", false)) return Answer(null)
        // PIN parental del panel: es el que usa la app
        j.s("pin").takeIf { it.length == 4 && it.all(Char::isDigit) }?.let { Store.parentalPin = it }
        val line = lineFromUrl(tr(R.string.server), j.s("url"), j.s("username"), j.s("password"))?.copy(demo = j.optBoolean("demo", false), demoExpires = j.optLong("demo_expires", 0L), demoDuration = j.optLong("demo_duration", 0L))
        return Answer(line)
    }

    /** Lista de DNS del panel (respuesta cifrada). */
    suspend fun fetchDns(): Answer<List<String>> {
        val a = login("fetch_dns", JSONObject())
        val r = a.value ?: return Answer(null, a.error)
        if (!r.ok) return Answer(null, errorOf(r, tr(R.string.err_panel_no_servers)))
        val dec: String? = try {
            PanelCrypto.decrypt(r.body)
        } catch (e: PanelCrypto.MissingKey) {
            return Answer(null, e.message)
        }
        val plain = dec ?: return Answer(null, tr(R.string.err_panel_key_mismatch))
        val arr = runCatching { JSONArray(plain) }.getOrNull() ?: return Answer(null, tr(R.string.err_panel_bad_servers))
        val out = (0 until arr.length()).map { arr.optString(it).trim() }.filter { it.isNotEmpty() }
        return Answer(out)
    }

    /** Activa el equipo con usuario, contraseña y el DNS elegido. */
    // validated: la app ya entró con esta línea en el servidor IPTV (el panel la registra aunque él no llegue a ese servidor)
    suspend fun submitUrl(deviceId: String, user: String, pass: String, dns: String, validated: Boolean = false, expTs: Long = 0L): Answer<Unit> {
        val payload = device(deviceId).put("username", user).put("password", pass).put("url", dns)
        if (validated) payload.put("validated", 1).put("exp_date", expTs)
        val a = login("submit_url", payload)
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json()
        if (r.ok && j?.s("status") == "ok") return Answer(Unit)
        return Answer(null, errorOf(r, tr(R.string.err_panel_activate)), r.code)
    }

    /** Línea de la demo automática: usuario, contraseña y el servidor de la demo (url, puede venir vacío en paneles viejos). */
    data class Demo(val user: String, val pass: String, val url: String, val expires: Long = 0L, val duration: Long = 0L)

    /** Demo automática (una sola vez por equipo). Con el código de un revendedor la demo queda a su nombre en el panel. */
    suspend fun autoDemo(deviceId: String, reseller: String = ""): Answer<Demo> {
        val p = device(deviceId)
        if (isResellerCode(reseller)) p.put("reseller", reseller.trim().uppercase())
        val a = login("auto_demo", p)
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json()
        if (r.ok && j?.s("status") == "ok" && j.s("username").isNotEmpty()) return Answer(Demo(j.s("username"), j.s("password"), j.s("url"), j.optLong("demo_expires", 0L), j.optLong("demo_duration", 0L)), code = r.code)
        val fallback = when (r.code) {
            403 -> tr(R.string.err_demo_used)
            404 -> tr(R.string.err_demo_reseller)
            429 -> tr(R.string.err_demo_too_many)
            503 -> tr(R.string.err_demo_unavailable)
            else -> tr(R.string.err_demo_create)
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
        return Answer(null, errorOf(r, tr(R.string.err_pin_not_saved_code, r.code)), r.code)
    }

    /**
     * login.php action features: ¿hay una demo activa en «Configurar Demo» de este distribuidor (o del dueño
     * con Omitir)? null = sin respuesta válida (sin red, sin llave o panel viejo con "Invalid action").
     */
    suspend fun demoConfigured(deviceId: String): Boolean? {
        val r = login("features", device(deviceId)).value ?: return null
        val f = r.json()?.takeIf { r.ok && it.s("status") == "ok" }?.optJSONObject("features") ?: return null
        // tema de prueba (Pantalla Falsa del panel): solo con Omitir
        reviewOffered = f.optBoolean("review", false) && !Tenant.active
        return if (f.has("demo")) f.optBoolean("demo") else null
    }

    /** el panel ofrece el tema de prueba (lo dice features; con Omitir) */
    @Volatile var reviewOffered = false

    /** Tema de prueba: videos de Películas y Series (carpeta player del panel). */
    data class ReviewVideo(val name: String, val url: String)
    data class Review(val movies: List<ReviewVideo>, val series: List<ReviewVideo>)

    /**
     * login.php action review_login: Auto-Demo (demo) o una cuenta del tema de prueba. No registra nada en el panel ni
     * vence. code 401 = no es una cuenta del tema (sigue el inicio de sesión de siempre); 403 = el tema no está.
     */
    suspend fun reviewLogin(user: String, pass: String, demo: Boolean): Answer<Review> {
        val p = JSONObject()
        if (demo) p.put("demo", 1) else p.put("username", user).put("password", pass)
        val a = login("review_login", p)
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json()
        if (!r.ok || j?.s("status") != "ok") return Answer(null, errorOf(r, tr(R.string.err_panel_rejected)), r.code)
        fun list(k: String) = j.optJSONArray(k)?.let { arr ->
            (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { ReviewVideo(it.s("name"), it.s("url")) } }.filter { it.url.isNotBlank() }
        }.orEmpty()
        return Answer(Review(list("movies"), list("series")))
    }

    /** Respuesta de tenant_config: la configuración descifrada o el código de error (tenant_invalid, offline, no_key…). */
    data class TenantAnswer(val value: JSONObject?, val error: String? = null, val errorCode: String = "")

    /** login.php action tenant_config con {code, app, device} cifrado; la respuesta viene cifrada igual que fetch_dns. */
    suspend fun tenantConfig(code: String, deviceId: String): TenantAnswer {
        if (!PanelCrypto.hasKey()) return TenantAnswer(null, tr(R.string.err_panel_no_key), "no_key")
        val payload = JSONObject().put("code", code).put("app", Tenant.APP).put("device", deviceId)
        val a = login("tenant_config", payload, tag = false)
        val r = a.value ?: return TenantAnswer(null, a.error, "offline")
        if (r.code >= 500) return TenantAnswer(null, NO_PANEL, "offline")
        if (!r.ok) {
            val j = r.json()
            val c = j?.s("code").orEmpty()
            val msg = j?.s("error").orEmpty().let { m ->
                when (m) {
                    "Decryption failed" -> tr(R.string.err_panel_key_mismatch)
                    "Server not configured" -> tr(R.string.err_panel_not_configured)
                    else -> m.ifEmpty { tr(R.string.err_panel_rejected_code, r.code) }
                }
            }
            return TenantAnswer(null, msg, c.ifEmpty { "http_${r.code}" })
        }
        val dec: String? = try {
            PanelCrypto.decrypt(r.body)
        } catch (e: PanelCrypto.MissingKey) {
            return TenantAnswer(null, tr(R.string.err_panel_no_key), "no_key")
        }
        val plain = dec ?: return TenantAnswer(null, tr(R.string.err_panel_key_mismatch), "bad_key")
        val j = runCatching { JSONObject(plain) }.getOrNull()
        if (j == null || j.s("status") != "ok") return TenantAnswer(null, tr(R.string.err_panel_bad_response), "bad_response")
        return TenantAnswer(j)
    }

    /** auth.php: listas asignadas al equipo (respuesta cifrada con mope). */
    suspend fun playlists(deviceId: String): Answer<List<Line>> {
        // auth.php solo conoce las listas del dueño: con distribuidor se usa check_mac (que sí lo respeta)
        if (Tenant.active) return Answer(emptyList())
        val body = JSONObject().put("data", PanelCrypto.mopeEncrypt(device(deviceId).toString()))
        val r = Net.postJson(PanelUrl.api("auth.php"), body)
        if (r.code == 0) return Answer(null, NO_PANEL)
        val outer = r.json() ?: return Answer(null, tr(R.string.err_panel_bad_response))
        if (!r.ok) return Answer(null, errorOf(r, tr(R.string.err_panel_rejected)))
        val resp = outer.s("data").takeIf { it.isNotEmpty() }?.let { PanelCrypto.mopeDecrypt(it) }
            ?.let { runCatching { JSONObject(it) }.getOrNull() } ?: outer.optJSONObject("plain")
            ?: return Answer(null, tr(R.string.err_panel_bad_response))
        // llave TMDB configurada en el panel: se usa para el fondo de pósters del inicio de sesión
        resp.s("tmdbKey").takeIf { it.isNotEmpty() && it != "missing_tmdb_key" }?.let { Store.tmdbKey = it }
        resp.s("parent_control").takeIf { it.length == 4 && it.all(Char::isDigit) }?.let { Store.parentalPin = it }
        val lines = resp.optJSONArray("urls").mapObj { o -> lineFromUrl(o.s("name").ifEmpty { tr(R.string.server) }, o.s("url"), "", "") }
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
