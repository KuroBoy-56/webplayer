package com.latmpx.player.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Avisos de partidos en la nube (api/alerts.php del panel, por línea y perfil): lo que se marca aquí, en la computadora
 * o en la TV queda en el panel y este celular lo baja para programar las notificaciones de la barra del sistema. Solo
 * con perfiles activos (el panel contesta enabled=false si no). Los cambios de aquí se encolan y se mandan en orden;
 * sin red quedan para la próxima vez.
 */
object MatchAlertsCloud {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()

    private fun url() = PanelUrl.api("alerts.php")
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** un cambio hecho aquí (set_teams o event): a la cola y se intenta mandar ya */
    fun push(op: JSONObject) {
        MatchAlerts.enqueue(op.put("profile", Profiles.param()))
        io.launch { runCatching { sync(Profiles.param(), MatchAlerts.suffix()) } }
    }

    /**
     * Manda lo pendiente y baja lo de la nube para ese perfil («suffix» = la clave local de línea y perfil). true si
     * la nube contestó (y lo de la nube quedó guardado y programado).
     */
    suspend fun sync(prof: String, suffix: String): Boolean = lock.withLock {
        while (true) {
            val op = MatchAlerts.pendingFirst() ?: break
            val r = Cloud.call { t -> Net.postJson(url(), JSONObject(op.toString()).put("token", t)) } ?: return false
            // sin perfiles, perfil eliminado o pedido malo: se descarta (nunca bloquea la cola)
            if (r.code in 500..599 || r.code == 0 || (r.code == 200 && r.json() == null)) return false
            MatchAlerts.pendingDrop()
        }
        val r = Cloud.call { t -> Net.get(url() + "?token=" + enc(t) + (if (prof.isNotEmpty()) "&profile=" + enc(prof) else "")) } ?: return false
        val j = r.json() ?: return false
        if (!j.optBoolean("success") || !j.optBoolean("enabled")) return false
        MatchAlerts.applyCloud(j.optJSONArray("teams"), j.optJSONObject("events"), suffix)
        true
    }
}
