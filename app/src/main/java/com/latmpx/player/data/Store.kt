package com.latmpx.player.data

import android.content.Context
import android.content.SharedPreferences
import com.latmpx.player.Device
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Lo poco que se guarda en el equipo: sesión IPTV, token del panel e idioma preferido.
 * Continuar viendo y favoritos viven en el panel (ver Cloud.kt).
 */
object Store {
    private lateinit var p: SharedPreferences

    fun init(ctx: Context) {
        p = ctx.getSharedPreferences("latmpx", Context.MODE_PRIVATE)
        SecureDns.select(dns)
    }

    /* ---------- DNS elegido (Automático por defecto) ---------- */
    var dns: String
        get() = p.getString("dns", "auto") ?: "auto"
        set(v) { p.edit().putString("dns", v).apply(); SecureDns.select(v) }

    /* ---------- llave TMDB del panel (una por distribuidor; Omitir = la de siempre) ---------- */
    private fun tenantKey(base: String): String = Tenant.code.let { if (it.isEmpty()) base else "$base|$it" }

    var tmdbKey: String
        get() = p.getString(tenantKey("tmdb_key"), "") ?: ""
        set(v) = p.edit().putString(tenantKey("tmdb_key"), v).apply()

    /* ---------- distribuidor (ver Tenant.kt) ---------- */
    /** "" = sin elegir (se pregunta), "skip" = Omitir, "code" = con número */
    var distChoice: String
        get() = p.getString("dist_choice", "") ?: ""
        set(v) = p.edit().putString("dist_choice", v).apply()

    var distCode: String
        get() = p.getString("dist_code", "") ?: ""
        set(v) = p.edit().putString("dist_code", v).apply()

    /** última respuesta correcta de tenant_config (nombre, logo, colores, vencimiento, funciones) */
    var distConfig: String
        get() = p.getString("dist_config", "") ?: ""
        set(v) = p.edit().putString("dist_config", v).apply()

    /** hora (ms) de la última comprobación correcta con el panel */
    var distLastOk: Long
        get() = p.getLong("dist_last_ok", 0L)
        set(v) = p.edit().putLong("dist_last_ok", v).apply()

    var streamFormat: String
        get() = p.getString("stream_format", "m3u8") ?: "m3u8"
        set(v) = p.edit().putString("stream_format", v).apply()

    /** forma de ajustar el video: 0 ajustar, 3 estirar, 4 zoom (AspectRatioFrameLayout) */
    var resizeMode: Int
        get() = p.getInt("resize_mode", 0)
        set(v) = p.edit().putInt("resize_mode", v).apply()

    var externalPlayer: Boolean
        get() = p.getBoolean("ext_player", false)
        set(v) = p.edit().putBoolean("ext_player", v).apply()

    var parentalPin: String
        get() = p.getString("parental_pin", "") ?: ""
        set(v) = p.edit().putString("parental_pin", v).apply()

    var blockedCats: Set<String>
        get() = p.getStringSet("blocked_cats", emptySet()) ?: emptySet()
        set(v) = p.edit().putStringSet("blocked_cats", v).apply()

    /* ---------- identificador de respaldo para equipos sin Android ID ---------- */
    /** id del equipo (Device.id), lo carga App al iniciar: para las estadísticas del panel */
    @Volatile var deviceIdCache: String = ""
    fun deviceIdOrEmpty(): String = deviceIdCache

    fun fallbackDeviceId(): String {
        p.getString("device_id", null)?.takeIf { it.isNotEmpty() }?.let { return it }
        val b = ByteArray(8).also { SecureRandom().nextBytes(it) }
        b[0] = (b[0].toInt() or 0x10).toByte() // nunca empieza en "00": siempre 8 pares
        val id = Device.normalize(b.joinToString("") { "%02x".format(it) })
        p.edit().putString("device_id", id).apply()
        return id
    }

    /* ---------- sesión ---------- */
    fun saveSession(s: Session) = p.edit().putString("session", JSONObject().apply {
        put("dns", s.dnsName); put("base", s.base); put("user", s.user); put("pass", s.pass); put("exp", s.expires)
    }.toString()).apply()

    fun session(): Session? = p.getString("session", null)?.let { raw ->
        runCatching { JSONObject(raw).let { Session(it.s("dns"), it.s("base"), it.s("user"), it.s("pass"), it.s("exp")) } }.getOrNull()
    }

    /** el panel respondió que la demo ya se usó en este equipo: el botón queda desactivado */
    var demoUsed: Boolean
        get() = p.getBoolean(tenantKey("demo_used"), false)
        set(v) = p.edit().putBoolean(tenantKey("demo_used"), v).apply()

    /** se escribió el código de la pantalla falsa: este equipo ya no la ve */
    var fakeUnlocked: Boolean
        get() = p.getBoolean("fake_unlocked", false)
        set(v) = p.edit().putBoolean("fake_unlocked", v).apply()

    fun logout() = p.edit().remove("session").remove(tenantKey("cloud_token2")).apply()

    /* ---------- token de progress.php / epg.php / sports.php (30 días; uno por distribuidor) ---------- */
    var cloudToken: String?
        get() = p.getString(tenantKey("cloud_token2"), null)
        set(v) = p.edit().putString(tenantKey("cloud_token2"), v).apply()

    private fun scope(): String = session()?.let { "${it.user}@${it.base}" } ?: "-"

    /* ---------- idioma de audio elegido a mano ---------- */
    var audioLang: String?
        get() = p.getString("audio_lang", null)
        set(v) = p.edit().putString("audio_lang", v).apply()

    var subLang: String?
        get() = p.getString("sub_lang", null)
        set(v) = p.edit().putString("sub_lang", v).apply()

    /* ---------- último canal ---------- */
    fun lastChannel(): Int = p.getInt("last_ch|" + scope(), 0)
    fun setLastChannel(id: Int) = p.edit().putInt("last_ch|" + scope(), id).apply()
}
