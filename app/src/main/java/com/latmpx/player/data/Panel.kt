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
    data class Line(val name: String, val base: String, val user: String, val pass: String)

    /** Resultado con mensaje de error en español para mostrar en pantalla. */
    data class Answer<T>(val value: T?, val error: String? = null, val code: Int = 0)

    private const val NO_PANEL = "No se pudo conectar con el panel. Revisa tu conexión a internet."

    private fun device(id: String) = JSONObject().put("mac_address", id)

    /** POST a login.php con el JSON cifrado. Devuelve el cuerpo crudo o el error. */
    private suspend fun login(action: String, payload: JSONObject): Answer<Net.Resp> {
        val data = try {
            PanelCrypto.encrypt(payload.toString())
        } catch (e: PanelCrypto.MissingKey) {
            return Answer(null, e.message)
        } catch (e: Exception) {
            return Answer(null, "No se pudo preparar la solicitud al panel")
        }
        val r = Net.postForm(PanelUrl.api("login.php"), mapOf("action" to action, "data" to data))
        if (r.code == 0) return Answer(null, NO_PANEL)
        return Answer(r)
    }

    private fun errorOf(r: Net.Resp, fallback: String): String {
        val j = r.json()
        val msg = j?.s("error").orEmpty().ifEmpty { j?.s("message").orEmpty() }
        return when {
            msg == "Server not configured" -> "El panel no está configurado"
            msg == "Decryption failed" -> "La llave de la app no coincide con la del panel"
            msg.isNotEmpty() -> msg
            else -> fallback
        }
    }

    /** ¿El equipo ya tiene una línea activa en el panel? */
    suspend fun checkMac(deviceId: String): Answer<Line> {
        val a = login("check_mac", device(deviceId))
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json() ?: return Answer(null, errorOf(r, "Respuesta no válida del panel"))
        if (!j.optBoolean("exists", false)) return Answer(null)
        val line = lineFromUrl("Servidor", j.s("url"), j.s("username"), j.s("password"))
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

    /** Demo automática de 24 h (una sola vez por equipo). */
    suspend fun autoDemo(deviceId: String): Answer<Pair<String, String>> {
        val a = login("auto_demo", device(deviceId))
        val r = a.value ?: return Answer(null, a.error)
        val j = r.json()
        if (r.ok && j?.s("status") == "ok" && j.s("username").isNotEmpty()) return Answer(j.s("username") to j.s("password"), code = r.code)
        val fallback = when (r.code) {
            403 -> "Demo ya utilizado en este dispositivo o dispositivo ya registrado."
            429 -> "Demasiadas demos desde esta conexión. Inténtalo mañana."
            else -> "No se pudo crear la demo"
        }
        return Answer(null, errorOf(r, fallback), r.code)
    }

    /** auth.php: listas asignadas al equipo (respuesta cifrada con mope). */
    suspend fun playlists(deviceId: String): Answer<List<Line>> {
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
