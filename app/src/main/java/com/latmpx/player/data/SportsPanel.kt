package com.latmpx.player.data

import android.content.Context
import android.content.SharedPreferences
import com.latmpx.player.Lang
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** fila de una tabla de posiciones (api/sports_tables.php) */
data class StandingRow(
    val id: String, val rank: Int, val team: String, val badge: String, val played: Int, val won: Int, val drawn: Int, val lost: Int,
    val gf: Int, val ga: Int, val gd: Int, val pts: Int, val form: String, val zone: String,
)

data class StandingGroup(val name: String, val rows: List<StandingRow>)

/** liga o copa: rg = región, d = división (1.ª…), women = liga femenina */
data class League(val id: String, val name: String, val country: String, val badge: String, val sportLabel: String, val division: Int,
                  val region: String, val season: String, val women: Boolean, val groups: List<StandingGroup>)

data class FxLeague(val name: String, val badge: String, val country: String, val region: String, val women: Boolean)

/** partidos de los próximos 21 días para Equipos y Selecciones */
data class Fixtures(val events: List<SportEvent>, val leagues: Map<String, FxLeague>)

/**
 * Deportes con el panel (igual que Roku y Vega): Tablas (api/sports_tables.php), los partidos de Equipos / Selecciones
 * (api/sports_fixtures.php, 21 días) y la ficha del equipo (api/sports_team.php, en el idioma de la app). Todo sale de
 * los JSON que prepara el panel (la app nunca consulta TheSportsDB) y se guarda en el equipo: las tablas 7 días, los
 * partidos 12 h o hasta que el panel anuncie otra versión. Si el panel todavía está armando ("p": 1) se devuelve lo
 * que hay y se vuelve a preguntar.
 */
object SportsPanel {
    private var prefs: SharedPreferences? = null

    fun init(ctx: Context) { prefs = ctx.getSharedPreferences("sports_panel", Context.MODE_PRIVATE) }

    /** borrado de caché pedido por el panel */
    fun clear() { prefs?.edit()?.clear()?.commit() }

    private fun scope(): String = Tenant.code + "|" + (Store.session()?.let { it.user + "@" + it.base } ?: "")

    private fun now() = System.currentTimeMillis() / 1000

    // ---------- tablas ----------

    data class TablesResult(val on: Boolean, val ok: Boolean, val leagues: List<League>, val partial: Boolean = false, val fresh: Boolean = false)

    /** lo guardado (hasta 7 días); fresh = es la versión que anuncia el panel (y de menos de un día) */
    fun localTables(rev: Long): TablesResult? {
        val raw = prefs?.getString("tables|" + scope(), null) ?: return null
        val j = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val age = now() - j.optLong("saved", 0)
        if (age < 0 || age > 7 * 86400) return null
        val leagues = leaguesOf(j.optJSONArray("leagues"))
        if (leagues.isEmpty()) return null
        return TablesResult(true, true, leagues, fresh = age < 86400 && rev > 0 && j.optLong("mt", 0) == rev)
    }

    suspend fun fetchTables(): TablesResult = withContext(Dispatchers.IO) {
        val j = Cloud.call { t -> Net.get(PanelUrl.api("sports_tables.php") + "?token=" + URLEncoder.encode(t, "UTF-8")) }?.json()
            ?: return@withContext localTables(0) ?: TablesResult(true, false, emptyList())
        if (j.has("on") && !j.optBoolean("on", true)) {
            prefs?.edit()?.remove("tables|" + scope())?.apply()
            return@withContext TablesResult(false, true, emptyList())
        }
        val partial = j.optInt("p", 0) == 1
        val leagues = leaguesOf(j.optJSONArray("leagues"))
        if (leagues.isNotEmpty()) {
            // a medio armar sirve de respaldo, pero la próxima vez se vuelve a pedir
            prefs?.edit()?.putString("tables|" + scope(), JSONObject().put("leagues", j.optJSONArray("leagues")).put("mt", if (partial) 0 else j.optLong("mt", 0)).put("saved", now()).toString())?.apply()
            return@withContext TablesResult(true, true, leagues, partial)
        }
        localTables(0)?.copy(partial = partial) ?: TablesResult(true, partial, emptyList(), partial)
    }

    private fun leaguesOf(a: JSONArray?): List<League> = a.mapObj { l ->
        val groups = l.optJSONArray("g").mapObj { g ->
            StandingGroup(g.s("n"), g.optJSONArray("r").mapObj { r ->
                StandingRow(r.s("id"), r.i("r"), r.s("t"), r.s("b"), r.i("p"), r.i("w"), r.i("d"), r.i("l"), r.i("gf"), r.i("ga"), r.i("gd"), r.i("pts"), r.s("f"), r.s("z"))
            })
        }
        League(l.s("id"), l.s("n"), l.s("c"), l.s("b"), l.s("sl"), l.i("d").coerceAtLeast(1), l.s("rg"), l.s("s"), l.i("w") == 1, groups)
    }

    // ---------- ficha del equipo ----------

    /** ficha del equipo en el idioma de la app (el panel la guarda 30 días); null si no hay */
    suspend fun team(id: String): JSONObject? = withContext(Dispatchers.IO) {
        val j = Cloud.call { t ->
            Net.get(PanelUrl.api("sports_team.php") + "?token=" + URLEncoder.encode(t, "UTF-8") + "&id=" + URLEncoder.encode(id, "UTF-8") + "&lang=" + Lang.current)
        }?.json()
        j?.takeIf { it.optBoolean("ok", false) }
    }

    // ---------- partidos de Equipos y Selecciones ----------

    data class FixturesResult(val on: Boolean, val ok: Boolean, val fx: Fixtures?, val partial: Boolean = false)

    private fun fxKey() = "fixtures|" + scope() + "|" + Lang.current

    private fun parseFx(j: JSONObject): Fixtures {
        val lg = HashMap<String, FxLeague>()
        j.optJSONObject("leagues")?.let { o ->
            o.keys().forEach { k -> o.optJSONObject(k)?.let { x -> lg[k] = FxLeague(x.s("n"), x.s("b"), x.s("c"), x.s("rg"), x.optInt("w", 0) == 1) } }
        }
        return Fixtures(j.optJSONArray("events").mapObj { Sports.event(it) }.sortedBy { it.start }, lg)
    }

    /** el JSON de 21 días: el guardado (misma versión y menos de 12 h) o el del panel */
    suspend fun fixtures(rev: Long): FixturesResult = withContext(Dispatchers.IO) {
        val saved = prefs?.getString(fxKey(), null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (saved != null && rev > 0 && saved.optLong("mt", 0) == rev && now() - saved.optLong("saved", 0) < 43200) {
            return@withContext FixturesResult(true, true, parseFx(saved))
        }
        val j = Cloud.call { t -> Net.get(PanelUrl.api("sports_fixtures.php") + "?token=" + URLEncoder.encode(t, "UTF-8")) }?.json()
        if (j != null) {
            if (j.has("on") && !j.optBoolean("on", true)) {
                prefs?.edit()?.remove(fxKey())?.apply()
                return@withContext FixturesResult(false, true, null)
            }
            val partial = j.optInt("p", 0) == 1
            val ev = j.optJSONArray("events")
            if (ev != null && ev.length() > 0) {
                prefs?.edit()?.putString(fxKey(), JSONObject().put("events", ev).put("leagues", j.optJSONObject("leagues") ?: JSONObject())
                    .put("mt", if (partial) 0 else j.optLong("t", 0)).put("saved", now()).toString())?.apply()
                return@withContext FixturesResult(true, true, parseFx(j), partial)
            }
            if (partial && saved == null) return@withContext FixturesResult(true, true, null, true)
        }
        if (saved != null) FixturesResult(true, true, parseFx(saved)) else FixturesResult(true, false, null)
    }

    private fun ended(e: SportEvent, minutes: (String) -> Int, nowMs: Long) = nowMs >= e.start + minutes(e.sport) * 60_000L

    /** nombre comparable con el alias del panel (también en español: «Alemania» = «Germany») */
    private fun teamText(name: String, alias: Map<String, String>): String {
        val n = Sports.norm(name)
        if (n.isEmpty()) return ""
        val a = alias[n]
        return if (a != null && a != n) "$n $a" else n
    }

    /**
     * Por equipo (cada palabra en el local o en el visitante, también en español) o por país (el país completo: la
     * selección y los partidos de las ligas de ese país). Solo los que no terminaron, hasta 80.
     */
    fun searchTeam(fx: Fixtures, q: String, alias: Map<String, String>, minutes: (String) -> Int): List<SportEvent> {
        val qn = Sports.norm(q)
        val words = qn.split(' ').filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        val countryLg = fx.leagues.filter { (_, l) -> teamText(l.country, alias).let { c -> c.isNotEmpty() && " $c ".contains(" $qn ") } }.keys
        val nowMs = System.currentTimeMillis()
        val out = ArrayList<SportEvent>()
        for (e in fx.events) {
            val teams = if (e.home.isEmpty() && e.away.isEmpty()) listOf(Sports.norm(e.title)) else listOf(teamText(e.home, alias), teamText(e.away, alias))
            val ok = e.leagueId in countryLg || teams.any { t -> t.isNotEmpty() && words.all { t.contains(it) } }
            if (ok && !ended(e, minutes, nowMs)) { out.add(e); if (out.size >= 80) break }
        }
        return out
    }

    /**
     * Selecciones (ligas "nat") por empezar o en vivo, en vivo primero; chips = competiciones masculinas y al final
     * «Selección femenina» (comp "w": todas las femeninas juntas)
     */
    fun nations(fx: Fixtures, comp: String, minutes: (String) -> Int): Triple<List<SportEvent>, List<Pair<String, String>>, Boolean> {
        val nowMs = System.currentTimeMillis()
        val live = ArrayList<SportEvent>()
        val next = ArrayList<SportEvent>()
        val chips = ArrayList<Pair<String, String>>()
        val have = HashSet<String>()
        var women = false
        for (e in fx.events) {
            val info = fx.leagues[e.leagueId] ?: continue
            if (info.region != "nat" || ended(e, minutes, nowMs)) continue
            if (info.women) women = true
            else if (have.add(e.leagueId)) chips.add(e.leagueId to info.name)
            if (comp.isEmpty() || comp == e.leagueId || (comp == "w" && info.women)) {
                if (e.start <= nowMs) live.add(e) else if (next.size < 150) next.add(e)
            }
        }
        return Triple(live + next, chips, women)
    }

    // ---------- equipos buscados ----------

    fun recentTeams(): List<String> = prefs?.getString("team_recent", null)?.let { raw ->
        runCatching { JSONArray(raw).let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.isNotBlank() } } }.getOrNull()
    }.orEmpty()

    fun rememberTeam(q: String): List<String> {
        val out = (listOf(q) + recentTeams().filter { !it.equals(q, ignoreCase = true) }).take(5)
        prefs?.edit()?.putString("team_recent", JSONArray(out).toString())?.apply()
        return out
    }
}
