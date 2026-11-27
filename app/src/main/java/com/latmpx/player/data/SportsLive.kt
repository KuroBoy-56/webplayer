package com.latmpx.player.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URLEncoder

/**
 * Partidos EN VIVO con marcador para la fila de Inicio (api/sports_live.php del panel) y, con next=1, los próximos de las
 * 24 h siguientes (soon, sin marcador). Solo hay datos si el panel tiene
 * una clave de pago de TheSportsDB para este cliente (la del dueño o la del distribuidor, cada uno la suya): si no,
 * enabled = false y la fila no existe. La fila los vuelve a pedir cada "ttl" segundos (30) mientras Inicio está abierto.
 */
object SportsLive {
    /** el panel dio partidos en vivo para este cliente (clave de pago): Ajustes muestra «Deporte preferido» */
    var available by mutableStateOf(false)
        private set

    /** nombres de las disciplinas del panel (api/sports.php, en el idioma de la app): Deporte preferido y Equipos favoritos */
    var labels by mutableStateOf<Map<String, String>>(emptyMap())

    class Data(val enabled: Boolean, val ttl: Int, val events: List<SportEvent>, val sports: Map<String, SportInfo>, val rules: MatchRules, val iptvOnly: Boolean)

    /** null = el panel no respondió (la fila deja lo que tenía) */
    suspend fun load(): Data? = withContext(Dispatchers.IO) {
        val j = Cloud.call { t -> Net.get(PanelUrl.api("sports_live.php") + "?next=1&token=" + URLEncoder.encode(t, "UTF-8")) }?.json() ?: return@withContext null
        val ttl = j.optInt("ttl", 30).coerceIn(15, 3600)
        withContext(Dispatchers.Main) { available = j.optBoolean("enabled", false); Store.liveAvail = available }
        if (!j.optBoolean("enabled", false)) return@withContext Data(false, ttl, emptyList(), emptyMap(), Sports.rulesOf(null), false)
        val now = System.currentTimeMillis()
        val events = j.optJSONArray("events").mapObj { e ->
            val id = e.s("id")
            val soon = e.optBoolean("soon", false)
            // un próximo que «empezaba» hace más de 5 min y el livescore no trae: fuera
            if (id.isEmpty() || (e.s("h").isEmpty() && e.s("a").isEmpty() && e.s("ev").isEmpty()) || (soon && e.optLong("s", 0L) * 1000 in 1 until now - 300_000)) null
            else SportEvent(
                id = id, sport = e.s("sp"), league = e.s("lg"), leagueBadge = e.s("lb"), title = e.s("ev"),
                home = e.s("h"), away = e.s("a"), homeBadge = e.s("hb"), awayBadge = e.s("ab"),
                homeScore = e.s("hs"), awayScore = e.s("as"), start = e.optLong("s", 0L).takeIf { it > 0 }?.let { it * 1000 } ?: now,
                venue = "", status = e.s("st"), postponed = false,
                tv = e.optJSONArray("tv").mapObj { t -> t.s("n").takeIf { it.isNotBlank() }?.let { TvChannel(it, t.s("c")) } },
                leagueId = e.s("li"), progress = e.s("pr"), soon = soon,
            )
        }
        val sports = LinkedHashMap<String, SportInfo>()
        j.optJSONObject("sports")?.let { so ->
            so.keys().forEach { k -> so.optJSONObject(k)?.let { o -> sports[k] = SportInfo(o.s("label").ifEmpty { k }, o.s("icon"), o.optInt("minutes", 120)) } }
        }
        Data(true, ttl, events, sports, Sports.rulesOf(j.optJSONObject("match")), j.s("chan") == "iptv")
    }

    /** deportes para Ajustes › Deporte preferido: nombre de TheSportsDB -> nombre que se muestra (los de Deportes) */
    val CHOICES: List<Pair<String, String>> = listOf(
        "Soccer" to "Fútbol", "Basketball" to "Baloncesto", "American Football" to "Fútbol americano", "Baseball" to "Béisbol",
        "Ice Hockey" to "Hockey", "Tennis" to "Tenis", "Motorsport" to "Motor", "Fighting" to "Combate", "Boxing" to "Boxeo",
        "Rugby" to "Rugby", "Volleyball" to "Voleibol", "Handball" to "Balonmano", "Golf" to "Golf", "Cricket" to "Cricket",
        "Esports" to "eSports",
    )
}
