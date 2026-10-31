package com.latmpx.player.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

data class SportEvent(
    val id: String,
    val sport: String,
    val league: String,
    val leagueBadge: String,
    val title: String,
    val home: String,
    val away: String,
    val homeBadge: String,
    val awayBadge: String,
    val homeScore: String,
    val awayScore: String,
    val start: Long,
    val venue: String,
    val status: String,
    val postponed: Boolean,
    /** canales donde se transmite (panel: "tv"), los de la región primero */
    val tv: List<TvChannel> = emptyList(),
    /** liga del partido en los JSON de Equipos / Selecciones (api/sports_fixtures.php: "l") */
    val leagueId: String = "",
)

data class TvChannel(val name: String, val country: String)

data class SportInfo(val label: String, val icon: String, val minutes: Int)

/** Reglas para encontrar el canal de cada partido ("match" de api/sports.php). */
class MatchRules(
    val stop: Set<String>,
    val alias: Map<String, String>,
    val eventCategory: Regex,
    val fullName: Int = 2,
    val token: Int = 1,
    val teamWeight: Int = 10,
    val bothTeamsBonus: Int = 15,
    val leagueBonus: Int = 3,
    val eventCategoryBonus: Int = 6,
    val singleTokenWeight: Int = 8,
)

/**
 * tablesOn / fixturesOn / nationsOn: el panel ofrece Tablas, Equipos y Selecciones (api/sports.php "tables" y
 * "fixtures"); *Rev: versión de esos JSON (si no cambió, lo guardado sirve).
 */
data class SportsData(
    val events: List<SportEvent>, val sports: Map<String, SportInfo>, val rules: MatchRules,
    val tablesOn: Boolean = false, val tablesRev: Long = 0, val fixturesOn: Boolean = false, val nationsOn: Boolean = false, val fixturesRev: Long = 0,
    /** «Solo los canales del servidor IPTV» del panel ("chan": "iptv"): en cada partido solo se nombran los que el cliente tiene */
    val iptvOnly: Boolean = false,
)

/** canales de un partido en la lista del cliente: el automático, cada canal que lo transmite (ch = el del cliente),
 *  los de la guía del panel y el de los equipos (como Roku y Vega) */
data class SportMatch(val best: Item?, val teams: Item?, val tv: List<Pair<TvChannel, Item?>>, val epg: List<Item> = emptyList()) {
    /** todos los del cliente, sin repetir: el automático primero */
    fun owned(): List<Item> = (listOf(best) + tv.map { it.second } + epg + listOf(teams)).filterNotNull().distinctBy { it.id }
}

/** Agenda deportiva del panel y búsqueda del canal en vivo (misma puntuación que la web). */
object Sports {
    /** Zona horaria del panel (la del distribuidor o del dueño, "tz" de api/sports.php): la hora de los partidos
     *  y Hoy / Mañana van en esa zona, no en la del equipo. Un panel viejo sin "tz": la del equipo. */
    @Volatile var zone: TimeZone = TimeZone.getDefault()
        private set

    private val DEFAULT_STOP = setOf("fc", "cf", "sc", "ac", "cd", "ca", "club", "de", "del", "la", "el", "los", "las", "the", "and", "vs", "v",
        "city", "united", "real", "sporting", "atletico", "deportivo", "union", "women", "femenil", "w", "u20", "u21", "u23", "sub")
    private const val DEFAULT_EVENT_CAT = "event|ppv|pay per view|deportes? en vivo|live sport|partidos? (de )?hoy"

    suspend fun load(): SportsData? {
        val r = Cloud.call { t -> Net.get(PanelUrl.api("sports.php") + "?token=" + URLEncoder.encode(t, "UTF-8")) } ?: return null
        val j = r.json() ?: return null
        return withContext(Dispatchers.Default) { parse(j) }
    }

    private fun parse(j: JSONObject): SportsData {
        val tz = j.s("tz")
        // getTimeZone() da GMT con un nombre que no conoce
        zone = if (tz.isNotEmpty()) TimeZone.getTimeZone(tz).takeIf { it.id == tz } ?: TimeZone.getDefault() else TimeZone.getDefault()
        val events = j.optJSONArray("events").mapObj { e -> event(e) }.sortedBy { it.start }
        val sports = LinkedHashMap<String, SportInfo>()
        j.optJSONObject("sports")?.let { so ->
            so.keys().forEach { k -> so.optJSONObject(k)?.let { o -> sports[k] = SportInfo(o.s("label").ifEmpty { k }, o.s("icon"), o.i("minutes").takeIf { it > 0 } ?: 120) } }
        }
        val m = j.optJSONObject("match")
        val stop = m?.optJSONArray("stop")?.let { a -> (0 until a.length()).map { a.optString(it) }.toSet() }?.takeIf { it.isNotEmpty() } ?: DEFAULT_STOP
        val alias = HashMap<String, String>()
        m?.optJSONObject("alias")?.let { ao -> ao.keys().forEach { k -> alias[norm(k)] = norm(ao.optString(k)) } }
        val evCat = runCatching { Regex(m?.s("eventCategory").orEmpty().ifEmpty { DEFAULT_EVENT_CAT }, RegexOption.IGNORE_CASE) }
            .getOrDefault(Regex(DEFAULT_EVENT_CAT, RegexOption.IGNORE_CASE))
        val sc = m?.optJSONObject("scoring")
        fun w(k: String, def: Int) = sc?.optInt(k, def) ?: def
        val rules = MatchRules(
            stop, alias, evCat, w("fullName", 2), w("token", 1), w("teamWeight", 10), w("bothTeamsBonus", 15),
            w("leagueBonus", 3), w("eventCategoryBonus", 6), w("singleTokenWeight", 8),
        )
        val tb = j.optJSONObject("tables")
        val fx = j.optJSONObject("fixtures")
        return SportsData(
            events, sports, rules,
            tablesOn = tb?.optBoolean("on", false) == true, tablesRev = tb?.optLong("t", 0L) ?: 0L,
            fixturesOn = fx?.optBoolean("on", false) == true, nationsOn = fx?.optBoolean("on", false) == true && fx.optBoolean("nat", true),
            fixturesRev = fx?.optLong("t", 0L) ?: 0L, iptvOnly = j.s("chan") == "iptv",
        )
    }

    /** un partido de la agenda o de Equipos / Selecciones (mismas claves en los dos JSON del panel) */
    fun event(e: JSONObject): SportEvent? {
        val start = e.optLong("s", 0L).takeIf { it > 0 }?.let { it * 1000 } ?: parseTs(e.s("ts"))
        return if (start <= 0) null else SportEvent(
            id = e.s("id"), sport = e.s("sp"), league = e.s("lg"), leagueBadge = e.s("lb"), title = e.s("ev"),
            home = e.s("h"), away = e.s("a"), homeBadge = e.s("hb"), awayBadge = e.s("ab"),
            homeScore = e.s("hs"), awayScore = e.s("as"), start = start, venue = e.s("v"), status = e.s("st"),
            postponed = e.optBoolean("pp", false),
            tv = e.optJSONArray("tv").mapObj { t -> t.s("n").takeIf { it.isNotBlank() }?.let { TvChannel(it, t.s("c")) } },
            leagueId = e.s("l"),
        )
    }

    /** "2026-10-03T15:00:00Z" / "+00:00" / sin segundos -> epoch ms (compatible con Android 6) */
    fun parseTs(raw: String): Long {
        var t = raw.trim().replace(' ', 'T')
        if (t.isEmpty()) return 0
        t = when {
            t.endsWith("Z", true) -> t.dropLast(1) + "+0000"
            Regex("[+-]\\d\\d:\\d\\d$").containsMatchIn(t) -> t.dropLast(3) + t.takeLast(2)
            Regex("[+-]\\d{4}$").containsMatchIn(t) -> t
            else -> "$t+0000"
        }
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ssZ", "yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mmZ")) {
            val f = SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC"); isLenient = false }
            runCatching { f.parse(t)?.time }.getOrNull()?.let { return it }
        }
        return 0
    }

    /* ---------- búsqueda del canal ---------- */

    /** minúsculas, sin acentos, todo lo que no sea [a-z0-9] -> espacio */
    /** Buscador de la agenda: equipos, evento, liga, deporte y canales que lo transmiten; sin acentos y
     *  con todas las palabras ("america espn"). */
    fun matches(e: SportEvent, sportLabel: String, q: String): Boolean {
        val words = norm(q).split(' ').filter { it.isNotEmpty() }
        if (words.isEmpty()) return true
        val hay = norm("${e.home} ${e.away} ${e.title} ${e.league} ${e.sport} $sportLabel ${e.tv.joinToString(" ") { it.name }}")
        return words.all { hay.contains(it) }
    }

    fun norm(s: String): String =
        Normalizer.normalize(s.lowercase(Locale.ROOT), Normalizer.Form.NFD).replace("\\p{M}+".toRegex(), "")
            .replace("[^a-z0-9]+".toRegex(), " ").trim()

    private fun hasWord(chan: String, w: String): Boolean = w.isNotEmpty() && " $chan ".contains(" $w ")

    private fun tokens(s: String, r: MatchRules): List<String> = norm(s).split(' ').filter { it.length >= 3 && it !in r.stop }

    private fun aliases(name: String, r: MatchRules): List<String> {
        val n = norm(name)
        return r.alias[n]?.let { listOf(n, it) } ?: listOf(n)
    }

    /** 0 = no aparece, token = una palabra distintiva, fullName = nombre completo */
    private fun teamScore(chan: String, team: String, r: MatchRules): Int {
        if (team.isBlank()) return 0
        var best = 0
        for (n in aliases(team, r)) {
            if (n.length >= 3 && hasWord(chan, n)) return r.fullName
            if (tokens(n, r).any { it.length >= 4 && hasWord(chan, it) }) best = r.token
        }
        return best
    }

    /** Canal ya normalizado con su categoría, para no repetir el trabajo en cada partido. */
    class Chan(val item: Item, val norm: String, val isEvent: Boolean) {
        val key: List<String> by lazy { channelKey(item.name) }
    }

    /* ---------- búsqueda por el canal que transmite ("ESPN 2" -> los canales ESPN 2 del cliente) ---------- */

    // lo que no distingue un canal de otro: calidad y país/región
    private val NOISE = setOf("hd", "fhd", "uhd", "sd", "4k", "8k", "hq", "hevc", "h264", "h265", "1080", "1080p", "720", "720p", "50fps", "60fps", "fps",
        "backup", "bk", "alt", "vip", "op1", "op2", "tv", "channel", "canal",
        "mx", "mex", "mexico", "us", "usa", "eeuu", "ar", "arg", "argentina", "co", "col", "colombia", "cl", "chile", "pe", "peru", "ec", "ecuador",
        "ve", "venezuela", "uy", "uruguay", "py", "paraguay", "bo", "bolivia", "cr", "pa", "panama", "gt", "hn", "sv", "ni", "do", "pr",
        "latam", "latin", "latino", "latina", "lat", "america", "es", "esp", "spain", "espana", "uk", "gb", "int", "intl", "international",
        "br", "bra", "brasil", "brazil", "pt", "portugal", "ca", "can", "canada", "fr", "france", "it", "italy", "de", "germany",
        "nl", "netherlands", "au", "australia", "nz", "zealand", "new", "ie", "ireland", "en", "network", "net")

    /** palabras que identifican el canal; un número va pegado a la palabra anterior ("espn 2" -> "espn2") */
    fun channelKey(name: String): List<String> {
        val out = ArrayList<String>()
        for (raw in norm(name).split(' ')) {
            // "M+ LaLiga" (Movistar Plus) llega como "m laliga"
            val t = if (raw == "m") "movistar" else raw
            if (t.isEmpty() || t in NOISE) continue
            if (t.all(Char::isDigit) && out.isNotEmpty() && !out.last().all(Char::isDigit)) out[out.size - 1] = out.last() + t else out.add(t)
        }
        return out
    }

    /**
     * Canales del cliente que son el canal que transmite: primero los que se llaman igual (sin calidad
     * ni país), después los que contienen todas sus palabras. "ESPN 2" nunca da "ESPN" ni "ESPN 3".
     */
    fun findByChannel(tvName: String, chans: List<Chan>): List<Item> {
        val q = channelKey(tvName)
        if (q.isEmpty() || q.joinToString("").length < 2) return emptyList()
        val qs = q.toSet()
        val scored = ArrayList<Pair<Int, Chan>>()
        for (c in chans) {
            val k = c.key
            if (k.isEmpty()) continue
            val score = when {
                k == q -> 1000 - k.size
                k.joinToString("") == q.joinToString("") -> 900 - k.size
                k.containsAll(qs) -> 500 - 10 * (k.size - q.size)
                else -> continue
            }
            scored.add(score to c)
        }
        if (scored.isEmpty()) return findLoose(q, chans)
        return scored.sortedWith(compareByDescending<Pair<Int, Chan>> { it.first }.thenBy { it.second.item.name.length }).map { it.second.item }
    }

    /** último intento: las palabras del canal pegadas contienen cada palabra buscada sin que la siga un número
     *  ("Fox Sports" da "FOXSPORTS PREMIUM", nunca "FoxSports2") */
    private fun findLoose(q: List<String>, chans: List<Chan>): List<Item> {
        if (q.first().length < 3) return emptyList()
        val want = q.joinToString("").length
        val scored = ArrayList<Pair<Int, Chan>>()
        for (c in chans) {
            val compact = c.key.joinToString("")
            if (compact.isEmpty()) continue
            val ok = q.all { t -> val p = compact.indexOf(t); p >= 0 && compact.getOrNull(p + t.length)?.isDigit() != true }
            if (ok) scored.add((300 - (compact.length - want) - c.item.name.length) to c)
        }
        return scored.sortedByDescending { it.first }.map { it.second.item }
    }

    /**
     * Canales de un partido como Roku y Vega: cada canal que lo transmite (el que tiene el cliente) y el de los equipos o
     * el nombre del evento; el automático es el primero de los que lo transmiten y, si no, el de los equipos.
     */
    fun match(ev: SportEvent, chans: List<Chan>, r: MatchRules): SportMatch {
        val tv = ev.tv.map { t -> t to findByChannel(t.name, chans).firstOrNull() }
        val teams = find(ev, chans, r)
        return SportMatch(tv.firstOrNull { it.second != null }?.second ?: teams, teams, tv)
    }

    // canales deportivos para buscar el partido en la guía del panel (api/sports_epg.php): por el nombre del canal o de su
    // carpeta, sin las carpetas de eventos; primero los que tienen guía propia (como Vega)
    private val SPORT_RE = Regex("sport|deport|espn|fox|tnt|tudn|dazn|bein|sky|movistar|futbol|soccer|nba|nfl|mlb|nhl|ufc|liga|win |directv|dsports|claro|vix|paramount|peacock|tyc|gol|telemundo|univision|azteca|canal 5|caracol|rcn|tsn|eurosport|teledeporte|cbs|nbc|usa network|f1|golf|tenis|tennis|box|universo|sportsnet|telefe|tv publica|teletica|tigo|max|apple tv", RegexOption.IGNORE_CASE)

    fun epgChannels(chans: List<Chan>, cats: List<Category>, maxN: Int = 600): List<Item> {
        val sportCat = cats.filter { SPORT_RE.containsMatchIn(Platforms.fold(it.name)) }.map { it.id }.toSet()
        val withEpg = ArrayList<Item>()
        val noEpg = ArrayList<Item>()
        for (c in chans) {
            if (c.isEvent) continue
            if (c.item.categoryId !in sportCat && !SPORT_RE.containsMatchIn(c.norm)) continue
            if (c.item.epgId.isNotBlank()) withEpg += c.item else noEpg += c.item
            if (withEpg.size >= maxN) break
        }
        return (withEpg + noEpg).take(maxN)
    }

    /** El canal del partido: el primero de sus canales de TV que tiene el cliente; si no, por equipos o nombre del evento. */
    fun best(ev: SportEvent, chans: List<Chan>, r: MatchRules): Item? {
        for (t in ev.tv) findByChannel(t.name, chans).firstOrNull()?.let { return it }
        return find(ev, chans, r)
    }

    /** solo los canales de las carpetas que el cliente ve (las ocultas con el PIN no cuentan), como Roku y Vega */
    fun prepare(channels: List<Item>, cats: List<Category>, r: MatchRules): List<Chan> {
        val eventCats = cats.filter { r.eventCategory.containsMatchIn(Platforms.fold(it.name)) }.map { it.id }.toSet()
        val hidden = Store.blockedCats
        return channels.filter { it.categoryId !in hidden }.map { Chan(it, norm(it.name), it.categoryId in eventCats) }
    }

    private val VS = Regex(" (vs|v|x) ")

    fun find(ev: SportEvent, chans: List<Chan>, r: MatchRules): Item? {
        val h = ev.home.trim()
        val a = ev.away.trim()
        val leagueToks = tokens(ev.league, r)
        val single = if (h.isEmpty() && a.isEmpty()) tokens(ev.title, r) else emptyList()
        var best: Chan? = null
        var bestScore = Int.MIN_VALUE
        for (c in chans) {
            val chan = c.norm
            var score: Int
            if (h.isNotEmpty() || a.isNotEmpty()) {
                val hs = teamScore(chan, h, r)
                val aw = teamScore(chan, a, r)
                if (hs == 0 && aw == 0) continue
                val both = hs > 0 && aw > 0
                // fuera de las carpetas de eventos solo cuenta si aparecen los dos equipos
                if (!c.isEvent && !both) continue
                // "Real Madrid vs Barcelona" no sirve para "Real Madrid vs Getafe"
                if (!both && VS.containsMatchIn(" $chan ")) continue
                score = hs * r.teamWeight + aw * r.teamWeight + (if (both) r.bothTeamsBonus else 0)
            } else {
                val hit = single.count { it.length >= 3 && hasWord(chan, it) }
                if (hit == 0 || (!c.isEvent && hit < 2)) continue
                score = hit * r.singleTokenWeight
            }
            if (leagueToks.any { hasWord(chan, it) }) score += r.leagueBonus
            if (c.isEvent) score += r.eventCategoryBonus
            if (best == null || score > bestScore) { best = c; bestScore = score }
        }
        return best?.item
    }
}
