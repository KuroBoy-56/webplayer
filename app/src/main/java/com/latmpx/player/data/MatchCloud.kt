package com.latmpx.player.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Recordatorios de partidos en la nube (api/alerts.php del panel, por línea y perfil), solo con perfiles: lo que se
 * marca en la TV queda en el panel y el celular de la misma línea y perfil avisa en su barra de notificaciones (30 min,
 * 10 min y al empezar). También trae los equipos favoritos que se eligieron en el celular o la computadora (la fila
 * «En vivo ahora» suma los partidos de hoy de esos equipos) y la marca para el aviso («instala la app … en tu celular»).
 */
object MatchCloud {
    /** equipo favorito (api/alerts.php: n = nombre, l = nombre en el idioma, b = escudo, lg = liga, sp = deporte) */
    data class FavTeam(val name: String, val label: String, val badge: String, val league: String, val sport: String)
    /** partido marcado (api/alerts.php: t = título, s = inicio en ms, h / a = equipos) */
    data class Marked(val id: String, val title: String, val start: Long, val home: String, val away: String)

    /** ids de los partidos con recordatorio (sube al cambiar: el menú del partido se vuelve a dibujar) */
    var marked by mutableStateOf<Set<String>>(emptySet())
        private set
    var teams by mutableStateOf<Set<String>>(emptySet())
        private set
    /** los equipos favoritos completos (Cuenta › Equipos favoritos y la campanita) */
    var teamList by mutableStateOf<List<FavTeam>>(emptyList())
        private set
    var markedList by mutableStateOf<List<Marked>>(emptyList())
        private set
    private var brand = ""
    private var at = 0L

    /** perfiles activos con un perfil elegido que no es el infantil, y Deportes del distribuidor encendido */
    val on: Boolean get() = Profiles.current != null && !Profiles.kids && Tenant.sportsEnabled

    /** el nombre para el aviso: el del distribuidor (o el del dueño) que dice el panel */
    fun brandName(): String = brand.ifBlank { Tenant.nameOr("MPX Player") }

    private fun url() = PanelUrl.api("alerts.php")
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private suspend fun apply(j: JSONObject?) = withContext(Dispatchers.Main) {
        if (j == null || !j.optBoolean("success") || !j.optBoolean("enabled")) return@withContext false
        val ev = j.optJSONObject("events")
        marked = ev?.keys()?.asSequence()?.toSet() ?: emptySet()
        val a = j.optJSONArray("teams")
        teamList = (0 until (a?.length() ?: 0)).mapNotNull { i ->
            a?.optJSONObject(i)?.let { o -> o.optString("n").takeIf { it.isNotBlank() }?.let { FavTeam(it, o.optString("l"), o.optString("b"), o.optString("lg"), o.optString("sp")) } }
        }
        teams = teamList.map { it.name }.toSet()
        markedList = ev?.keys()?.asSequence()?.mapNotNull { id ->
            ev.optJSONObject(id)?.let { o -> Marked(id, o.optString("t"), o.optLong("s"), o.optString("h"), o.optString("a")) }
        }?.toList() ?: emptyList()
        brand = j.optString("brand")
        at = System.currentTimeMillis()
        true
    }

    /** baja lo de la nube (5 min en memoria salvo force) */
    suspend fun refresh(force: Boolean = false) {
        if (!on || (!force && System.currentTimeMillis() - at < 300_000L)) return
        val prof = Profiles.param()
        val r = withContext(Dispatchers.IO) {
            Cloud.call { t -> Net.get(url() + "?token=" + enc(t) + (if (prof.isNotEmpty()) "&profile=" + enc(prof) else "")) }
        }
        apply(r?.json())
    }

    /** guarda los equipos favoritos en la nube (el celular y la computadora de la misma línea y perfil avisan) */
    suspend fun setTeams(list: List<FavTeam>): Boolean {
        if (!on) return false
        val arr = org.json.JSONArray()
        list.forEach { t -> arr.put(JSONObject().put("n", t.name).put("l", t.label).put("b", t.badge).put("lg", t.league).put("sp", t.sport)) }
        val body = JSONObject().put("action", "set_teams").put("teams", arr)
        Profiles.param().takeIf { it.isNotEmpty() }?.let { body.put("profile", it) }
        val r = withContext(Dispatchers.IO) { Cloud.call { t -> Net.postJson(url(), JSONObject(body.toString()).put("token", t)) } }
        return apply(r?.json())
    }

    /** marca o quita el recordatorio de un partido; true si quedó guardado en la nube */
    suspend fun set(e: SportEvent, wanted: Boolean): Boolean {
        if (!on) return false
        val title = if (e.home.isNotBlank() && e.away.isNotBlank()) "${e.home} vs ${e.away}" else e.title.ifBlank { e.league }
        val body = JSONObject().put("action", "event").put("id", e.id).put("on", wanted)
            .put("event", JSONObject().put("t", title).put("s", e.start).put("h", e.home).put("a", e.away))
        Profiles.param().takeIf { it.isNotEmpty() }?.let { body.put("profile", it) }
        val r = withContext(Dispatchers.IO) { Cloud.call { t -> Net.postJson(url(), JSONObject(body.toString()).put("token", t)) } }
        return apply(r?.json())
    }
}
