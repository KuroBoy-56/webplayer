package com.latmpx.player.data

import com.latmpx.player.tr
import com.latmpx.player.R
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.latmpx.player.Device
import okhttp3.HttpUrl
import org.json.JSONObject

/**
 * Distribuidor (multi-tenant) del panel: número de 6 dígitos, marca (nombre, logo, colores) y "guardián".
 *  - sin elegir: se muestra la pantalla "Número de distribuidor"
 *  - Omitir ("skip"): la app funciona exactamente como antes (no se envía nada nuevo al panel)
 *  - con número ("code"): cada llamada al panel lleva "tenant" + "app"; la marca se guarda en el equipo
 *    y se vuelve a comprobar con tenant_config al abrir la app y cada recheck_after segundos.
 */
object Tenant {
    /** id de esta app en el panel */
    val APP: String get() = if (Device.TV_APP) "android_tv" else "android"

    /** pasado este tiempo sin poder comprobar el distribuidor (sin internet) ya no se usa la copia guardada */
    const val OFFLINE_GRACE_MS = 72 * 3600 * 1000L
    private const val DEFAULT_RECHECK_S = 21600L

    data class Colors(val accent: String, val bg: String, val surface: String, val text: String)

    data class Brand(
        val code: String,
        val name: String,
        val logoUrl: String,
        val logoRev: Int,
        val colors: Colors?,
        val expiresAt: Long,
        val expiresDate: String,
        val demo: Boolean,
        val alerts: Boolean,
        val sports: Boolean,
        /** false: el distribuidor no separa su contenido por plataformas (sin fila ni páginas de plataformas) */
        val platforms: Boolean = true,
        val rev: Int,
        val recheckAfter: Long,
    ) {
        /** expires_at 0 = sin vencimiento */
        fun expired(nowMs: Long = System.currentTimeMillis()): Boolean = expiresAt > 0 && nowMs / 1000 > expiresAt
    }

    /** marca del distribuidor elegido (null = Omitir o sin elegir: todo como siempre) */
    var brand by mutableStateOf<Brand?>(null)
        private set

    /** mensaje cuando el panel corta el distribuidor durante el uso (la interfaz vuelve a la pantalla del número) */
    var revoked by mutableStateOf<String?>(null)

    fun init() {
        brand = if (Store.distChoice == "code") parse(Store.distConfig) else null
    }

    /** número activo ("" con Omitir o sin elegir) */
    val code: String get() = if (Store.distChoice == "code") Store.distCode else ""

    val active: Boolean get() = code.isNotEmpty()

    /* ---------- funciones (Omitir = todo como hoy) ---------- */
    val demoEnabled: Boolean get() = brand?.demo ?: true
    val alertsEnabled: Boolean get() = brand?.alerts ?: true
    val sportsEnabled: Boolean get() = brand?.sports ?: true
    val platformsEnabled: Boolean get() = brand?.platforms ?: true

    /** letra de la marca para los destacados ("N SERIE"): inicial del distribuidor o de la app */
    fun initial(appName: String): String = nameOr(appName).trim().firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: "M"

    /** nombre del distribuidor o el de la app */
    fun nameOr(default: String): String = brand?.name?.takeIf { it.isNotBlank() } ?: default

    /** agrega "tenant" y "app" a un JSON para el panel (nada con Omitir) */
    fun tag(o: JSONObject): JSONObject {
        val c = code
        if (c.isNotEmpty()) o.put("tenant", c).put("app", APP)
        return o
    }

    /** agrega ?t=<número>&app=<app> a una dirección del panel (nada con Omitir) */
    fun tag(b: HttpUrl.Builder): HttpUrl.Builder {
        val c = code
        if (c.isNotEmpty()) b.addQueryParameter("t", c).addQueryParameter("app", APP)
        return b
    }

    /* ---------- errores del panel ---------- */

    /** errores que cortan el distribuidor: se borra todo y se vuelve a pedir el número */
    val FATAL = setOf("tenant_invalid", "tenant_expired", "tenant_suspended", "app_not_linked")

    fun message(code: String, fallback: String = ""): String = when (code) {
        "tenant_invalid" -> tr(R.string.tenant_invalid)
        "tenant_expired" -> tr(R.string.tenant_expired)
        "tenant_suspended" -> tr(R.string.tenant_suspended)
        "app_not_linked" -> tr(R.string.tenant_app_not_linked)
        "too_many_attempts" -> tr(R.string.tenant_too_many)
        "app_required" -> tr(R.string.tenant_app_required)
        else -> fallback.ifEmpty { tr(R.string.tenant_check_failed) }
    }

    /**
     * Respuesta de error del panel durante el uso (login.php, progress.php, epg.php, sports.php…):
     * si es un corte del distribuidor se avisa a la interfaz. Devuelve el mensaje en español o null.
     */
    fun onPanelError(j: JSONObject?): String? {
        val c = j?.s("code").orEmpty()
        if (c.isEmpty() || !active) return null
        if (c in FATAL) {
            revoked = message(c)
            return message(c)
        }
        return if (c == "too_many_attempts" || c == "app_required") message(c) else null
    }

    /** sin la fecha: el vencimiento del distribuidor es privado */
    @Suppress("UNUSED_PARAMETER")
    fun expiredMessage(b: Brand): String = message("tenant_expired")

    /* ---------- tenant_config ---------- */

    sealed class Check {
        data class Ok(val brand: Brand) : Check()
        /** el panel cortó el número: hay que borrarlo y pedir otro */
        data class Denied(val message: String) : Check()
        /** error que no borra nada (llave, demasiados intentos, app_required) */
        data class Problem(val message: String) : Check()
        /** sin internet o error del servidor */
        data class Offline(val message: String) : Check()
    }

    /** consulta tenant_config para un número (nuevo o el guardado) */
    suspend fun fetch(code: String, deviceId: String): Check {
        val a = Panel.tenantConfig(code, deviceId)
        a.value?.let { cfg ->
            val b = parse(cfg.toString()) ?: return Check.Problem(tr(R.string.err_panel_bad_response))
            return Check.Ok(b)
        }
        val c = a.errorCode
        return when {
            c in FATAL -> Check.Denied(message(c))
            c == "too_many_attempts" || c == "app_required" -> Check.Problem(message(c))
            c == "no_key" -> Check.Problem(tr(R.string.err_panel_no_key))
            c == "offline" -> Check.Offline(a.error ?: tr(R.string.err_panel_offline_short))
            else -> Check.Problem(a.error ?: tr(R.string.tenant_check_failed))
        }
    }

    /** guarda el número elegido con su marca y la aplica */
    fun choose(b: Brand) {
        Store.distCode = b.code
        Store.distConfig = raw(b)
        Store.distLastOk = System.currentTimeMillis()
        Store.distChoice = "code"
        brand = b
        revoked = null
    }

    /** el guardián recibió datos nuevos: se guardan y se aplican si cambió algo */
    fun refresh(b: Brand) {
        Store.distConfig = raw(b)
        Store.distLastOk = System.currentTimeMillis()
        val old = brand
        if (old == null || old != b) brand = b
    }

    fun skip() {
        Store.distChoice = "skip"
        Store.distCode = ""
        Store.distConfig = ""
        brand = null
        revoked = null
    }

    /** "Cambiar distribuidor" o número cortado: se borra todo lo del distribuidor */
    fun clear() {
        Store.distChoice = ""
        Store.distCode = ""
        Store.distConfig = ""
        Store.distLastOk = 0L
        brand = null
    }

    /** toca volver a comprobar (al volver a la app) */
    fun due(): Boolean {
        val b = brand ?: return false
        val every = (if (b.recheckAfter > 0) b.recheckAfter else DEFAULT_RECHECK_S) * 1000L
        return System.currentTimeMillis() - Store.distLastOk >= every
    }

    /** la copia guardada todavía sirve sin conexión (< 72 h desde la última comprobación correcta) */
    fun offlineOk(): Boolean = System.currentTimeMillis() - Store.distLastOk < OFFLINE_GRACE_MS

    /* ---------- lectura de la respuesta ---------- */

    private val HEX = Regex("^#[0-9A-Fa-f]{6}$")

    /** convierte la respuesta de tenant_config (JSON descifrado) en Brand; null si no es válida */
    fun parse(raw: String): Brand? {
        if (raw.isBlank()) return null
        val j = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        if (j.s("status") != "ok") return null
        val t = j.optJSONObject("tenant") ?: return null
        val code = t.s("code")
        if (!code.matches(Regex("^\\d{6}$"))) return null
        val p = t.optJSONObject("palette")
        val colors = p?.let {
            val c = Colors(it.s("accent"), it.s("bg"), it.s("surface"), it.s("text"))
            if (listOf(c.accent, c.bg, c.surface, c.text).all { h -> HEX.matches(h) }) c else null
        }
        val f = j.optJSONObject("features")
        val logo = t.s("logo_url").takeIf { it.startsWith("http://") || it.startsWith("https://") }.orEmpty()
        return Brand(
            code = code,
            name = t.s("name"),
            logoUrl = logo,
            logoRev = t.i("logo_rev"),
            colors = colors,
            expiresAt = t.s("expires_at").toLongOrNull() ?: 0L,
            expiresDate = t.s("expires_date"),
            demo = f?.optBoolean("demo", true) ?: true,
            alerts = f?.optBoolean("alerts", true) ?: true,
            sports = f?.optBoolean("sports", true) ?: true,
            platforms = f?.optBoolean("platforms", true) ?: true,
            rev = t.i("rev"),
            recheckAfter = j.s("recheck_after").toLongOrNull()?.takeIf { it > 0 } ?: DEFAULT_RECHECK_S,
        )
    }

    /** misma forma que la respuesta del panel, para guardarla en el equipo */
    fun raw(b: Brand): String = JSONObject()
        .put("status", "ok")
        .put("tenant", JSONObject()
            .put("code", b.code).put("name", b.name).put("logo_url", b.logoUrl).put("logo_rev", b.logoRev)
            .put("palette", b.colors?.let { JSONObject().put("accent", it.accent).put("bg", it.bg).put("surface", it.surface).put("text", it.text) } ?: JSONObject.NULL)
            .put("expires_at", b.expiresAt).put("expires_date", b.expiresDate).put("rev", b.rev))
        .put("features", JSONObject().put("demo", b.demo).put("alerts", b.alerts).put("sports", b.sports).put("platforms", b.platforms))
        .put("recheck_after", b.recheckAfter)
        .toString()
}
