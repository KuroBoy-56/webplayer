package com.latmpx.player.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

/**
 * Página de actor, igual que la app de Windows: la persona de TMDB (foto y biografía) y su filmografía
 * (combined_credits) cruzada con el catálogo del servidor por título normalizado; solo se muestran
 * los títulos que el servidor tiene. Sin TMDB se usa el elenco que envía el servidor en la lista.
 */
object Actor {
    data class Person(val id: Int, val name: String, val photo: String, val bio: String, val birthday: String, val place: String)

    /** person = null: TMDB no respondió o no conoce a la persona */
    data class Page(val person: Person?, val items: List<Item>)

    private val memo = HashMap<String, Page>()

    suspend fun load(name: String, tmdbId: Int, movies: List<Item>, series: List<Item>): Page {
        val memoKey = "$tmdbId|${fold(name)}|${movies.size}|${series.size}"
        synchronized(memo) { memo[memoKey] }?.let { return it }

        var id = tmdbId
        if (id <= 0) id = Tmdb.searchPersonId(name) ?: 0
        val json = if (id > 0) Tmdb.person(id) else null
        var person: Person? = null
        val credits = ArrayList<Credit>()
        if (json != null) {
            var bio = json.optString("biography").clean()
            if (bio.isBlank()) bio = Tmdb.personBioEn(id).clean()
            person = Person(
                id = id,
                name = json.optString("name").clean().ifEmpty { name },
                photo = json.optString("profile_path").clean().let { if (it.isNotEmpty()) "https://image.tmdb.org/t/p/w342$it" else "" },
                bio = bio,
                birthday = json.optString("birthday").clean(),
                place = json.optString("place_of_birth").clean(),
            )
            credits += parseCredits(json)
        }

        val page = withContext(Dispatchers.Default) {
            val out = LinkedHashMap<String, Item>()
            if (credits.isNotEmpty()) {
                val movieIdx = Index(movies)
                val seriesIdx = Index(series)
                for (c in credits) {
                    val idx = if (c.tv) seriesIdx else movieIdx
                    idx.match(c).forEach { out.putIfAbsent(it.key, it) }
                }
            }
            // respaldo (y complemento): títulos cuyo elenco del servidor incluye el nombre
            val needle = fold(person?.name ?: name).trim()
            if (needle.length >= 3) {
                (movies.asSequence() + series.asSequence())
                    .filter { it.cast.isNotEmpty() && castHas(it.cast, needle) }
                    .forEach { out.putIfAbsent(it.key, it) }
            }
            Page(person, out.values.toList())
        }
        // solo se recuerda cuando TMDB respondió (si no, se vuelve a intentar la próxima vez)
        if (json != null) synchronized(memo) { memo[memoKey] = page }
        return page
    }

    /* ---------- filmografía ---------- */

    private class Credit(val tv: Boolean, val titles: List<String>, val year: Int?)

    private fun parseCredits(json: JSONObject): List<Credit> {
        val arr = json.optJSONObject("combined_credits")?.optJSONArray("cast") ?: return emptyList()
        val out = ArrayList<Credit>()
        val seen = HashSet<String>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val type = o.optString("media_type")
            if (type != "movie" && type != "tv") continue
            if (!seen.add("$type:${o.optInt("id")}")) continue
            val tv = type == "tv"
            val titles = listOf(
                o.optString(if (tv) "name" else "title").clean(),
                o.optString(if (tv) "original_name" else "original_title").clean(),
            ).filter { it.isNotEmpty() }.distinct()
            if (titles.isEmpty()) continue
            val date = o.optString(if (tv) "first_air_date" else "release_date").clean()
            out += Credit(tv, titles, YEAR.find(date)?.value?.toIntOrNull())
        }
        // primero lo más reciente (sin fecha al final)
        return out.sortedByDescending { it.year ?: -1 }
    }

    /* ---------- títulos normalizados (mismo criterio que title-normalization.util.ts de Windows) ---------- */

    /** exact: con el año final; base: sin él; year: el año quitado (o el que venía entre paréntesis) */
    data class Keys(val exact: String, val base: String, val year: Int?)

    private val YEAR = Regex("\\b(19\\d{2}|20\\d{2})\\b")
    private val BRACKET_YEAR = Regex("[\\(\\[]\\s*(19\\d{2}|20\\d{2})\\s*[\\)\\]]")
    private val TRAILING_YEAR = Regex("(?:^|\\s)(19\\d{2}|20\\d{2})$")
    private val SEASON = Regex("(?:^|\\s)(?:s\\d{1,2}|season\\s*\\d{1,2}|temporada\\s*\\d{1,2}|t\\d{1,2})$")
    private val PREFIX = Regex("^[A-Z]{2,4}\\s*[-|:]\\s+")
    private val QUALITY = setOf(
        "4k", "uhd", "fhd", "hd", "sd", "hdr", "hevc", "h264", "h265", "x264", "x265", "480p", "720p", "1080p", "2160p",
        "multi", "multisub", "dual", "latino", "lat", "castellano", "subtitulado", "subtitulada", "sub", "esp", "vose", "cam",
    )

    private val MARKS = Regex("\\p{M}+")
    private val BRACKETS = Regex("\\[[^\\]\\[]*\\]|\\([^()]*\\)|\\{[^{}]*\\}")
    private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")
    private val SPACES = Regex("\\s+")

    fun fold(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).replace(MARKS, "").lowercase(Locale.ROOT)

    fun keys(raw: String): Keys {
        if (raw.isBlank()) return Keys("", "", null)
        val bracketYear = BRACKET_YEAR.find(raw)?.groupValues?.get(1)?.toIntOrNull()
        val cleaned = fold(
            raw.replace(BRACKETS, " ").trim().replace(PREFIX, ""),
        ).replace(NON_WORD, " ")
            .split(' ').filter { it.isNotEmpty() && it !in QUALITY }.joinToString(" ").trim()
        fun stripSeason(v: String) = v.replace(SEASON, "").trim().ifEmpty { v }
        val exact = stripSeason(cleaned)
        val ym = TRAILING_YEAR.find(cleaned)
        val without = cleaned.replace(TRAILING_YEAR, "").replace(SPACES, " ").trim()
        if (ym == null || without.isEmpty()) return Keys(exact, exact, bracketYear)
        return Keys(exact, stripSeason(without), ym.groupValues[1].toIntOrNull() ?: bracketYear)
    }

    private fun yearsOk(a: Int?, b: Int?) = a == null || b == null || kotlin.math.abs(a - b) <= 1

    /** catálogo indexado por título normalizado (exacto y sin año final) */
    private class Index(items: List<Item>) {
        private val exact = HashMap<String, MutableList<Pair<Item, Int?>>>()
        private val base = HashMap<String, MutableList<Pair<Item, Int?>>>()

        init {
            for (it in items) {
                val k = keys(it.name)
                if (k.exact.length < 2) continue
                val y = it.year.take(4).toIntOrNull()?.takeIf { v -> v in 1900..2100 } ?: k.year
                exact.getOrPut(k.exact) { ArrayList() }.add(it to y)
                base.getOrPut(k.base) { ArrayList() }.add(it to y)
            }
        }

        fun match(c: Credit): List<Item> {
            for (t in c.titles) {
                val k = keys(t)
                if (k.exact.length < 2) continue
                val e = exact[k.exact].orEmpty().filter { yearsOk(c.year, it.second) }
                if (e.isNotEmpty()) return e.map { it.first }
            }
            for (t in c.titles) {
                val k = keys(t)
                if (k.base.length < 2) continue
                val b = base[k.base].orEmpty().filter { yearsOk(c.year, it.second) }
                if (b.isNotEmpty()) return b.map { it.first }
            }
            return emptyList()
        }
    }

    private fun castHas(cast: String, needle: String): Boolean =
        fold(cast).contains(needle)

    private fun String.clean(): String = trim().let { if (it == "null") "" else it }
}
