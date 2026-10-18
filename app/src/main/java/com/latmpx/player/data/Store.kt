package com.latmpx.player.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import com.latmpx.player.Device
import com.latmpx.player.Lang
import com.latmpx.player.R
import com.latmpx.player.tr
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Lo poco que se guarda en el equipo: sesión IPTV, token del panel e idioma preferido.
 * Continuar viendo y favoritos viven en el panel (ver Cloud.kt).
 */
object Store {
    private lateinit var p: SharedPreferences
    private lateinit var appCtx: Context

    fun init(ctx: Context) {
        appCtx = ctx.applicationContext
        p = ctx.getSharedPreferences("latmpx", Context.MODE_PRIVATE)
        p.edit().remove("session").remove("parental_pin").apply() // usuario/contraseña y PIN local de versiones anteriores
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

    /* ---------- borrado de caché remoto (ver CacheClear.kt) ---------- */
    /** última orden de borrado aplicada (null = nunca recibida). commit(): la app se cierra justo después */
    var cacheClearSeen: Long?
        get() = if (p.contains("cache_clear_seen")) p.getLong("cache_clear_seen", 0L) else null
        set(v) { p.edit().apply { if (v == null) remove("cache_clear_seen") else putLong("cache_clear_seen", v) }.commit() }

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

    /** PIN parental: siempre activo; es el del panel (check_mac) y los cambios se guardan allí (set_pin). 0000 = de fábrica */
    var parentalPin: String
        get() = p.getString(tenantKey("panel_pin2"), null)?.takeIf { it.length == 4 } ?: "0000"
        set(v) = p.edit().putString(tenantKey("panel_pin2"), v).apply()

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
    // Solo en memoria: el usuario y la contraseña nunca se guardan en el equipo. Cada vez que se
    // abre la app se le pide la línea al panel (check_mac) y se comprueba en el servidor IPTV.
    @Volatile private var mem: Session? = null

    /**
     * Servidores mixtos: true = el video sale por el otro protocolo que el de la sesión (p. ej. la sesión en
     * https y el video solo en http). Lo pone el reproductor cuando un video arranca; vale para la sesión.
     */
    @Volatile var streamFlip = false

    fun saveSession(s: Session) {
        mem = s
        streamFlip = false
        p.edit().remove("session").apply() // versiones anteriores la guardaban: se borra
    }

    fun session(): Session? = mem

    /**
     * Línea DEMO (botón Autodemo o el panel dice "demo"): la app muestra "DEMO" en lugar del usuario y
     * nunca la contraseña, y no guarda "Continuar viendo" ni "Mi lista". Solo en memoria: cada inicio
     * de sesión normal lo apaga.
     */
    var demo by androidx.compose.runtime.mutableStateOf(false)

    /** fin de la demo según el panel (segundos Unix, "demo_expires"; 0 = no se sabe) */
    var demoExpires by androidx.compose.runtime.mutableLongStateOf(0L)

    /** duración de la demo según el panel (segundos, "demo_duration"; 0 = no se sabe) */
    var demoDuration by androidx.compose.runtime.mutableLongStateOf(0L)

    /** la línea abierta es una demo: guarda su fin y su duración (lo que dice el panel) */
    fun setDemo(on: Boolean, expires: Long = 0L, duration: Long = 0L) {
        demo = on
        demoExpires = if (on) expires else 0L
        demoDuration = if (on) duration else 0L
    }

    /** "1 hora", "2 horas", "30 minutos", "1 día"… según la duración del panel ('' si no la mandó) */
    fun demoLength(sec: Long = demoDuration): String {
        if (sec <= 0) return ""
        val days = sec / 86400; val h = sec / 3600; val m = sec / 60
        return when {
            sec % 86400 == 0L -> Lang.plural(R.plurals.days, days.toInt(), days)
            sec % 3600 == 0L -> Lang.plural(R.plurals.hours, h.toInt(), h)
            else -> Lang.plural(R.plurals.minutes, m.toInt(), m)
        }
    }

    /** fin de la demo con la hora exacta del equipo: "13/10/2026 18:45" ('' si el panel no lo mandó) */
    fun demoEndText(): String {
        if (demoExpires <= 0) return ""
        return java.text.SimpleDateFormat("dd/MM/yyyy HH:mm", java.util.Locale.getDefault()).format(java.util.Date(demoExpires * 1000))
    }

    /** texto a mostrar en lugar del usuario de la línea */
    fun shownUser(s: Session?): String = if (demo) "DEMO" else s?.user.orEmpty()

    /** demo: avisa que no está disponible y devuelve true (quien llama no sigue) */
    fun blockedForDemo(): Boolean {
        if (!demo) return false
        runCatching {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                android.widget.Toast.makeText(appCtx, tr(R.string.demo_unavailable), android.widget.Toast.LENGTH_SHORT).show()
            }
        }
        return true
    }

    /** el panel respondió que la demo ya se usó en este equipo: el botón queda desactivado */
    var demoUsed: Boolean
        get() = p.getBoolean(tenantKey("demo_used"), false)
        set(v) = p.edit().putBoolean(tenantKey("demo_used"), v).apply()

    /** se escribió el código de la pantalla falsa: este equipo ya no la ve */
    var fakeUnlocked: Boolean
        get() = p.getBoolean("fake_unlocked", false)
        set(v) = p.edit().putBoolean("fake_unlocked", v).apply()

    fun logout() {
        mem = null
        setDemo(false)
        p.edit().remove("session").remove(tenantKey("cloud_token2")).remove(tenantKey("cloud_token2_scope")).apply()
    }

    /* ---------- token de progress.php / epg.php / sports.php (30 días; uno por distribuidor) ---------- */
    var cloudToken: String?
        get() = p.getString(tenantKey("cloud_token2"), null)
        set(v) = p.edit().putString(tenantKey("cloud_token2"), v).apply()

    // usuario@servidor al que pertenece el token guardado: si entra otro usuario, el token no coincide
    // y se pide uno nuevo (no se reutiliza "Continuar viendo" ni "Mi lista" de la cuenta anterior)
    var cloudTokenScope: String?
        get() = p.getString(tenantKey("cloud_token2_scope"), null)
        set(v) = p.edit().putString(tenantKey("cloud_token2_scope"), v).apply()

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
