package com.latmpx.player.data

import android.content.Context
import android.os.Build
import com.latmpx.player.BuildConfig
import com.latmpx.player.Device
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

/**
 * Errores de la app al panel (api/report.php, cifrado como login.php): el dueño los ve en
 * «Errores de las apps» con el equipo, la hora, la línea y el detalle.
 *  - report(): fallos de reproducción, del panel o de la red (en segundo plano, nunca bloquea)
 *  - cierres inesperados: se guardan en un archivo y se mandan al abrir la app otra vez
 * Nunca se manda la contraseña de la línea (el panel además tapa usuario/contraseña de las direcciones).
 */
object ErrorReport {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var app: Context
    private const val CRASH_FILE = "pending_crash.json"
    private val recent = HashMap<String, Long>()

    fun init(ctx: Context) {
        app = ctx.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            runCatching {
                val o = base("crash", "${e.javaClass.simpleName}: ${e.message ?: ""}".take(400), e.stackTraceToString().take(8000), "hilo ${t.name}")
                File(app.filesDir, CRASH_FILE).writeText(o.toString())
            }
            previous?.uncaughtException(t, e)
        }
        // el cierre de la vez anterior
        io.launch {
            val f = File(app.filesDir, CRASH_FILE)
            if (f.exists()) {
                val body = runCatching { JSONObject(f.readText()) }.getOrNull()
                f.delete()
                if (body != null) send(body)
            }
        }
    }

    /** kind: crash | error | playback | network | panel | warning */
    fun report(kind: String, message: String, detail: String = "", screen: String = "") {
        if (!::app.isInitialized || message.isBlank()) return
        // el mismo error seguido no se manda más de una vez por minuto
        val key = "$kind|$message"
        val now = System.currentTimeMillis()
        synchronized(recent) {
            if ((recent[key] ?: 0L) > now - 60_000) return
            recent[key] = now
        }
        val body = base(kind, message.take(400), detail.take(8000), screen)
        io.launch { send(body) }
    }

    private fun base(kind: String, message: String, detail: String, screen: String): JSONObject {
        val s = runCatching { Store.session() }.getOrNull()
        val o = JSONObject()
            .put("app", Tenant.APP)
            .put("version", BuildConfig.VERSION_NAME)
            .put("kind", kind)
            .put("message", message)
            .put("detail", detail)
            .put("screen", screen)
            .put("device", runCatching { Device.id(app) }.getOrDefault(""))
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            .put("os", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            .put("user", s?.user.orEmpty())
            .put("server", s?.base.orEmpty())
        Tenant.code.takeIf { it.isNotEmpty() }?.let { o.put("tenant", it) }
        return o
    }

    private suspend fun send(o: JSONObject) {
        if (!PanelCrypto.hasKey()) return
        val data = runCatching { PanelCrypto.encrypt(o.toString()) }.getOrNull() ?: return
        runCatching { Net.postForm(PanelUrl.api("report.php"), mapOf("data" to data)) }
    }
}
