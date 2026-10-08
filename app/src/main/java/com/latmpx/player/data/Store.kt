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

    /* ---------- llave TMDB del panel (solo para el fondo de pósters) ---------- */
    var tmdbKey: String
        get() = p.getString("tmdb_key", "") ?: ""
        set(v) = p.edit().putString("tmdb_key", v).apply()

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
        get() = p.getBoolean("demo_used", false)
        set(v) = p.edit().putBoolean("demo_used", v).apply()

    fun logout() = p.edit().remove("session").remove("cloud_token2").apply()

    /* ---------- token de progress.php / epg.php / sports.php (30 días) ---------- */
    var cloudToken: String?
        get() = p.getString("cloud_token2", null)
        set(v) = p.edit().putString("cloud_token2", v).apply()

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
