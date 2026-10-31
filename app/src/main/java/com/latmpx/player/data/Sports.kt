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
)

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
        // getTimeZone() da GMT con un nombre que no conoce: entonces el desfase del panel ("tzo", segundos sobre UTC, como
        // Vega) y solo si tampoco viene, la del equipo (un teléfono mal configurado mostraba otra hora)
        val tzo = if (j.has("tzo")) j.optInt("tzo", 0) else null
        zone = TimeZone.getTimeZone(tz).takeIf { tz.isNotEmpty() && it.id == tz }
            ?: tzo?.let { java.util.SimpleTimeZone(it * 1000, "panel") }
            ?: TimeZone.getDefault()
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
            fixturesRev = fx?.optLong("t", 0L) ?: 0L,
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

    // compiladas una sola vez (antes se compilaban en cada llamada: decenas de miles por búsqueda de canal)
    private val MARKS = Regex("\\p{M}+")
    private val NON_ALNUM = Regex("[^a-z0-9]+")

    fun norm(s: String): String =
        Normalizer.normalize(s.lowercase(Locale.ROOT), Normalizer.Form.NFD).replace(MARKS, "").replace(NON_ALNUM, " ").trim()

    private fun hasWord(chan: String, w: String): Boolean = w.isNotEmpty() && " $chan ".contains(" $w ")

    private fun tokens(s: String, r: MatchRules): List<String> = norm(s).split(' ').filter { it.length >= 3 && it !in r.stop }

    private fun aliases(name: String, r: MatchRules): List<String> {
        val n = norm(name)
        return r.alias[n]?.let { listOf(n, it) } ?: listOf(n)
    }

    /** un equipo ya normalizado (con su alias) y sus palabras distintivas: se arma una vez por partido */
    private class Team(val names: List<String>, val toks: List<List<String>>)

    private fun team(name: String, r: MatchRules): Team? {
        if (name.isBlank()) return null
        val names = aliases(name, r)
        return Team(names, names.map { n -> tokens(n, r).filter { it.length >= 4 } })
    }

    /** 0 = no aparece, token = una palabra distintiva, fullName = nombre completo */
    private fun teamScore(chan: String, t: Team?, r: MatchRules): Int {
        if (t == null) return 0
        var best = 0
        for ((i, n) in t.names.withIndex()) {
            if (n.length >= 3 && hasWord(chan, n)) return r.fullName
            if (t.toks[i].any { hasWord(chan, it) }) best = r.token
        }
        return best
    }

    /** Canal ya normalizado con su categoría, para no repetir el trabajo en cada partido. */
    class Chan(val item: Item, val norm: String, val isEvent: Boolean) {
        val key: List<String> = channelKey(item.name)
    }

    /**
     * Índice de los canales (como Vega / Roku): se arma una sola vez por catálogo y reglas, y cada partido compara
     * solo los canales que comparten alguna palabra con sus equipos o su canal de TV (no todos contra todos).
     * Antes cada toque normalizaba de nuevo todos los canales y los comparaba uno por uno: con catálogos grandes
     * la búsqueda tardaba muchísimo y el equipo mostraba «la aplicación no responde».
     */
    class Index(val chans: List<Chan>) {
        val words = HashMap<String, MutableList<Int>>()
        val keys = HashMap<String, MutableList<Int>>()
        val memo = java.util.concurrent.ConcurrentHashMap<String, Int>()

        init {
            fun add(m: HashMap<String, MutableList<Int>>, k: String, i: Int) {
                val l = m.getOrPut(k) { ArrayList(2) }
                if (l.isEmpty() || l[l.size - 1] != i) l.add(i)
            }
            chans.forEachIndexed { i, c ->
                for (w in c.norm.split(' ')) if (w.length >= 3) add(words, w, i)
                for (w in c.key) if (w.length >= 2 && !w.all(Char::isDigit)) add(words, w, i)
                val compact = c.key.joinToString("")
                if (compact.isNotEmpty()) add(keys, compact, i)
            }
        }
    }

    private var ixCache: Triple<List<Item>, MatchRules, Index>? = null

    /** el índice de este catálogo (el mismo mientras no cambien los canales ni las reglas) */
    @Synchronized
    fun index(channels: List<Item>, cats: List<Category>, r: MatchRules): Index {
        ixCache?.let { (ch, rr, ix) -> if (ch === channels && rr === r) return ix }
        return Index(prepare(channels, cats, r)).also { ixCache = Triple(channels, r, it) }
    }

    /* ---------- búsqueda por el canal que transmite ("ESPN 2" -> los canales ESPN 2 del cliente) ---------- */

    // lo que no distingue un canal de otro: calidad y país/región
    private val NOISE = setOf("hd", "fhd", "uhd", "sd", "4k", "8k", "hq", "hevc", "h264", "h265", "1080", "1080p", "720", "720p", "50fps", "60fps", "fps",
        "backup", "bk", "alt", "vip", "op1", "op2", "tv", "channel", "canal",
        "mx", "mex", "mexico", "us", "usa", "eeuu", "ar", "arg", "argentina", "co", "col", "colombia", "cl", "chile", "pe", "peru", "ec", "ecuador",
        "ve", "venezuela", "uy", "uruguay", "py", "paraguay", "bo", "bolivia", "cr", "pa", "panama", "gt", "hn", "sv", "ni", "do", "pr",
        "latam", "latin", "latino", "latina", "lat", "america", "es", "esp", "spain", "espana", "uk", "gb", "int", "intl", "international",
        "br", "bra", "brasil", "brazil", "pt", "portugal", "ca", "can", "canada", "fr", "france", "it", "italy", "de", "germany",
        "nl", "netherlands", "au", "australia", "nz", "zealand", "new", "ie", "ireland")

    /** palabras que identifican el canal; un número va pegado a la palabra anterior ("espn 2" -> "espn2") */
    fun channelKey(name: String): List<String> {
        val out = ArrayList<String>()
        for (t in norm(name).split(' ')) {
            if (t.isEmpty() || t in NOISE) continue
            if (t.all(Char::isDigit) && out.isNotEmpty() && !out.last().all(Char::isDigit)) out[out.size - 1] = out.last() + t else out.add(t)
        }
        return out
    }

    /**
     * Canales del cliente que son el canal que transmite: primero los que se llaman igual (sin calidad
     * ni país), después los que contienen todas sus palabras. "ESPN 2" nunca da "ESPN" ni "ESPN 3".
     */
    fun findByChannel(tvName: String, ix: Index): Item? {
        val hit = ix.memo[tvName]
        if (hit != null) return if (hit >= 0) ix.chans[hit].item else null
        val q = channelKey(tvName)
        if (q.isEmpty() || q.joinToString("").length < 2) { ix.memo[tvName] = -1; return null }
        val qs = q.toSet()
        // solo los canales que tienen la palabra (o el nombre pegado) del canal buscado
        val cand = LinkedHashSet<Int>()
        ix.keys[q.joinToString("")]?.let { cand.addAll(it) }
        ix.words[q[0]]?.let { cand.addAll(it) }
        val scored = ArrayList<Pair<Int, Int>>()
        for (ci in cand) {
            val c = ix.chans[ci]
            val k = c.key
            if (k.isEmpty()) continue
            val score = when {
                k == q -> 1000 - k.size
                k.joinToString("") == q.joinToString("") -> 900 - k.size
                k.containsAll(qs) -> 500 - 10 * (k.size - q.size)
                else -> continue
            }
            scored.add(score to ci)
        }
        val best = scored.sortedWith(compareByDescending<Pair<Int, Int>> { it.first }.thenBy { ix.chans[it.second].item.name.length }).firstOrNull()?.second ?: -1
        ix.memo[tvName] = best
        return if (best >= 0) ix.chans[best].item else null
    }

    /** El canal del partido: el primero de sus canales de TV que tiene el cliente; si no, por equipos o nombre del evento. */
    fun best(ev: SportEvent, ix: Index, r: MatchRules): Item? {
        for (t in ev.tv) findByChannel(t.name, ix)?.let { return it }
        return find(ev, ix, r)
    }

    fun prepare(channels: List<Item>, cats: List<Category>, r: MatchRules): List<Chan> {
        val eventCats = cats.filter { r.eventCategory.containsMatchIn(Platforms.fold(it.name)) }.map { it.id }.toSet()
        return channels.map { Chan(it, norm(it.name), it.categoryId in eventCats) }
    }

    private val VS = Regex(" (vs|v|x) ")

    fun find(ev: SportEvent, ix: Index, r: MatchRules): Item? {
        val h = ev.home.trim()
        val a = ev.away.trim()
        val leagueToks = tokens(ev.league, r)
        val single = if (h.isEmpty() && a.isEmpty()) tokens(ev.title, r) else emptyList()
        val ht = team(h, r)
        val at = team(a, r)
        // canales candidatos: los que tienen alguna palabra de los equipos (o del evento), como Vega
        val want = HashSet<String>()
        for (t in listOfNotNull(ht, at)) t.names.forEach { n ->
            val tk = tokens(n, r)
            if (tk.isNotEmpty()) want.addAll(tk) else n.split(' ').filter { it.length >= 3 }.forEach { want.add(it) }
        }
        want.addAll(single)
        val cand = java.util.TreeSet<Int>()
        for (w in want) ix.words[w]?.let { cand.addAll(it) }
        var best: Chan? = null
        var bestScore = Int.MIN_VALUE
        for (ci in cand) {
            val c = ix.chans[ci]
            val chan = c.norm
            var score: Int
            if (h.isNotEmpty() || a.isNotEmpty()) {
                val hs = teamScore(chan, ht, r)
                val aw = teamScore(chan, at, r)
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
