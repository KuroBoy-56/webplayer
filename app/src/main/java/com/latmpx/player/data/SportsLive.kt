package com.latmpx.player.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URLEncoder
import java.util.Calendar

/**
 * Partidos EN VIVO con marcador para la fila de Inicio de la TV (api/sports_live.php?soon=1 del panel: también los que
 * empiezan en 5 minutos o menos). Solo hay datos si el panel tiene
 * una clave de pago de TheSportsDB para este cliente (la del dueño o la del distribuidor, cada uno la suya): si no,
 * enabled = false y la fila no existe. La fila los vuelve a pedir cada "ttl" segundos (30) mientras Inicio está abierto.
 */
/** Cuenta › Ligas favoritas: id de TheSportsDB, nombre y deporte; today = partidos de hoy en la agenda (solo al elegir) */
data class FavLeague(val id: String, val name: String, val sport: String, val today: Int = 0, val sportLabel: String = "")

object SportsLive {
    /** el panel tiene partidos en vivo para este cliente (clave de pago); null = todavía no contestó en esta sesión */
    var available by mutableStateOf<Boolean?>(null)
        private set

    /** sesión nueva: hasta la respuesta vale lo último que dijo el panel para esta línea (Store.liveAvail) */
    fun reset() { available = null }

    /**
     * con perfiles y partidos en vivo, Inicio no muestra las plataformas (salvo Cuenta › Habilitar tarjetas de
     * plataformas). Mientras el panel no contesta se usa lo de la última vez: así no aparecen y se van al cargar.
     */
    val hidesPlatforms: Boolean get() = MatchCloud.on && (available ?: Store.liveAvail) && !Store.platformCards

    /** sube al cambiar Cuenta › Deporte favorito: la fila de Inicio vuelve a filtrar */
    var prefRev by mutableStateOf(0)

    class Data(val enabled: Boolean, val ttl: Int, val events: List<SportEvent>, val sports: Map<String, SportInfo>, val rules: MatchRules, val iptvOnly: Boolean)

    /** null = el panel no respondió (la fila deja lo que tenía) */
    suspend fun load(): Data? = withContext(Dispatchers.IO) {
        val j = Cloud.call { t -> Net.get(PanelUrl.api("sports_live.php") + "?soon=1&next=1&token=" + URLEncoder.encode(t, "UTF-8")) }?.json() ?: return@withContext null
        val ttl = j.optInt("ttl", 30).coerceIn(15, 3600)
        withContext(Dispatchers.Main) { available = j.optBoolean("enabled", false); Store.liveAvail = available == true }
        if (!j.optBoolean("enabled", false)) return@withContext Data(false, ttl, emptyList(), emptyMap(), Sports.rulesOf(null), false)
        val now = System.currentTimeMillis()
        val events = j.optJSONArray("events").mapObj { e ->
            val id = e.s("id")
            // un próximo que «empezaba» hace más de 5 min y el livescore no trae: fuera
            if (id.isEmpty() || (e.s("h").isEmpty() && e.s("a").isEmpty() && e.s("ev").isEmpty()) ||
                (e.optBoolean("soon", false) && e.optLong("s", 0L) * 1000 in 1 until now - 300_000)) null
            else SportEvent(
                id = id, sport = e.s("sp"), league = e.s("lg"), leagueBadge = e.s("lb"), title = e.s("ev"),
                home = e.s("h"), away = e.s("a"), homeBadge = e.s("hb"), awayBadge = e.s("ab"),
                homeScore = e.s("hs"), awayScore = e.s("as"), start = e.optLong("s", 0L).takeIf { it > 0 }?.let { it * 1000 } ?: now,
                venue = "", status = e.s("st"), postponed = false,
                tv = e.optJSONArray("tv").mapObj { t -> t.s("n").takeIf { it.isNotBlank() }?.let { TvChannel(it, t.s("c")) } },
                leagueId = e.s("li"), progress = e.s("pr"), thumb = e.s("th"), soon = e.optBoolean("soon", false),
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

    /**
     * Cuenta › Ligas favoritas: las de la agenda (con cuántos partidos tienen hoy, en la hora del equipo) y las de los
     * próximos 21 días; con un deporte favorito, solo las de ese. Primero las que juegan hoy; las elegidas siempre
     * están para poder quitarlas.
     */
    suspend fun leagueChoices(): List<FavLeague> = withContext(Dispatchers.IO) {
        val ag = runCatching { Sports.load() }.getOrNull()
        val fx = runCatching { SportsPanel.fixtures(0).fx }.getOrNull()
        fun day(t: Long) = Calendar.getInstance().apply { timeInMillis = t }.let { it.get(Calendar.YEAR) * 1000 + it.get(Calendar.DAY_OF_YEAR) }
        val today = day(System.currentTimeMillis())
        val map = LinkedHashMap<String, FavLeague>()
        ag?.events?.forEach { e ->
            if (e.leagueId.isEmpty() || e.league.isEmpty()) return@forEach
            val x = map[e.leagueId] ?: FavLeague(e.leagueId, e.league, e.sport)
            map[e.leagueId] = if (day(e.start) == today) x.copy(today = x.today + 1) else x
        }
        fx?.leagues?.forEach { (id, v) -> if (id !in map && v.name.isNotEmpty()) map[id] = FavLeague(id, v.name, v.sport) }
        // copas internacionales y de selecciones (Champions, CONCACAF, Mundial FIFA…) aunque esta semana no jueguen
        ag?.cups?.forEach { if (it.id !in map && it.name.isNotEmpty()) map[it.id] = it }
        Store.liveLeagues.forEach { if (it.id !in map) map[it.id] = it }
        val sp = Store.liveSport
        // sin deporte favorito no se eligen eventos (la pantalla pide elegirlo primero)
        if (sp.isEmpty()) return@withContext emptyList()
        map.values.filter { it.sport.equals(sp, true) }
            .map { it.copy(sportLabel = ag?.sports?.get(it.sport)?.label ?: it.sport) }
            .sortedWith(compareBy<FavLeague>({ it.today == 0 }, { it.sport.lowercase() }, { it.name.lowercase() }))
    }
}
