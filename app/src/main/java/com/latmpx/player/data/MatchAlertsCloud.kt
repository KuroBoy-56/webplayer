package com.latmpx.player.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
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
        applyPrefs(j.optJSONObject("prefs"), suffix)
        true
    }

    // ---------- Ajustes › Deporte preferido y Ligas favoritas en la nube («prefs» de api/alerts.php) ----------
    // Lo que se elige en la TV (Roku, Android TV, webOS…) se ve aquí y al revés. La nube manda; si nunca se guardó
    // (at = 0) se sube lo que este celular tenía guardado de antes.

    /** solo para el perfil abierto (la actualización de fondo no toca los ajustes) */
    private suspend fun applyPrefs(p: JSONObject?, suffix: String) {
        if (p == null || suffix != MatchAlerts.suffix() || MatchAlerts.pendingHas("set_prefs")) return
        withContext(Dispatchers.Main) {
            if (p.optLong("at") <= 0L) {
                if (Store.preferredSport.isNotEmpty() || Store.liveLeagues.isNotEmpty()) pushPrefs()
                return@withContext
            }
            val sp = p.optString("sp")
            val a = p.optJSONArray("lg")
            val lg = (0 until (a?.length() ?: 0)).mapNotNull { i ->
                a?.optJSONObject(i)?.let { o -> FavLeague(o.optString("id"), o.optString("n"), o.optString("sp")).takeIf { it.id.isNotEmpty() } }
            }
            if (sp == Store.preferredSport && lg.map { it.id } == Store.liveLeagues.map { it.id }) return@withContext
            Store.preferredSport = sp
            Store.liveLeagues = lg
            SportsLive.prefRev++
        }
    }

    /** sube el deporte preferido y las ligas favoritas de este perfil (después de elegirlos en Ajustes) */
    fun pushPrefs() {
        if (Profiles.current == null) return
        val sp = Store.preferredSport
        val lg = org.json.JSONArray(Store.liveLeagues.map { JSONObject().put("id", it.id).put("n", it.name).put("sp", it.sport) })
        push(JSONObject().put("action", "set_prefs").put("prefs", JSONObject().put("sp", sp).put("spn", if (sp.isEmpty()) "" else SportsLive.labels[sp] ?: sp).put("lg", lg)))
    }
}
