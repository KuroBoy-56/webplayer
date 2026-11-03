package com.latmpx.player.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.util.Calendar
import kotlin.random.Random

/**
 * Top 10 de la semana, igual que Roku y Vega OS: el panel (api/top10.php) manda lo más popular de la semana en TMDB;
 * aquí se cruza con el catálogo por título y año y lo que falte se completa con lo mejor calificado, distinto cada
 * semana (también sin clave de TMDB). Se guarda y se pide otra vez cada 12 h; [rev] cambia cuando llega una lista
 * nueva (las pantallas rehacen sus filas).
 */
object WeekTop {
    data class Entry(val series: Boolean?, val t: String, val o: String, val y: Int)

    private const val AGE = 12 * 3600 * 1000L
    private var prefs: SharedPreferences? = null
    @Volatile private var at = 0L
    @Volatile private var movies = emptyList<Entry>()
    @Volatile private var series = emptyList<Entry>()
    @Volatile private var all = emptyList<Entry>()
    var rev by mutableIntStateOf(0)
        private set

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("week_top", Context.MODE_PRIVATE)
        runCatching { parse(JSONObject(prefs?.getString("data", null) ?: return)) }
        at = prefs?.getLong("at", 0L) ?: 0L
    }

    private fun list(a: JSONArray?): List<Entry> = if (a == null) emptyList() else (0 until minOf(a.length(), 80)).mapNotNull { i ->
        val o = a.optJSONObject(i) ?: return@mapNotNull null
        val k = o.s("k")
        Entry(if (k == "s") true else if (k == "m") false else null, o.s("t"), o.s("o"), o.optInt("y", 0)).takeIf { it.t.isNotEmpty() || it.o.isNotEmpty() }
    }

    private fun parse(j: JSONObject) {
        movies = list(j.optJSONArray("movies"))
        series = list(j.optJSONArray("series"))
        all = list(j.optJSONArray("all"))
    }

    /** Pide la lista si la guardada tiene más de 12 h (no hace nada si es reciente). */
    suspend fun load() {
        if (System.currentTimeMillis() - at < AGE) return
        val url = PanelUrl.api("top10.php").toHttpUrlOrNull()?.newBuilder()?.let { Tenant.tag(it) }?.build()?.toString() ?: return
        val r = runCatching { Net.get(url) }.getOrNull() ?: return
        val j = (if (r.ok) r.json() else null) ?: return
        if (!j.has("movies")) return
        val before = Triple(movies, series, all)
        parse(j)
        at = System.currentTimeMillis()
        prefs?.edit()?.putString("data", j.toString())?.putLong("at", at)?.apply()
        if (before != Triple(movies, series, all)) rev++
    }

    // ---------- títulos comparables (como Roku: sin "| LAT", (2019), [4K], acentos, signos ni etiquetas) ----------
    private val TAGS = setOf("4k", "uhd", "fhd", "hd", "sd", "lat", "latino", "sub", "subt", "esp", "castellano", "dual", "spa", "eng",
        "1080p", "720p", "2160p", "hdr", "cam", "ts", "multi", "vose", "subtitulado", "hevc", "x264", "x265")
    private val BR = Regex("\\([^)]*\\)|\\[[^]]*]|\\{[^}]*}")
    private val PREFIX = Regex("^[A-Z]{2,3}\\s*[-|:]\\s+")
    private val YEAR_IN = Regex("[(\\[]((?:19|20)\\d\\d)[)\\]]")

    fun key(name: String): String {
        var t = PREFIX.replace(name.trim(), "")
        for (sep in listOf("|", " - ", " – ")) { val p = t.indexOf(sep); if (p > 0) t = t.substring(0, p) }
        t = Normalizer.normalize(BR.replace(t, " "), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()
        return t.split(Regex("[^a-z0-9]+")).filter { w ->
            w.isNotEmpty() && w !in TAGS && !(w.length == 4 && (w.startsWith("19") || w.startsWith("20")) && w.all { it.isDigit() })
        }.joinToString(" ")
    }

    private fun yearOf(it: Item): Int =
        it.year.take(4).toIntOrNull()?.takeIf { y -> y > 1900 } ?: YEAR_IN.find(it.name)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    private fun matches(list: List<Entry>, items: List<Item>, n: Int): List<Item> {
        if (list.isEmpty() || items.isEmpty()) return emptyList()
        val idx = HashMap<String, MutableList<Item>>()
        for (it in items) { val k = key(it.name); if (k.isNotEmpty()) idx.getOrPut(k) { ArrayList() }.add(it) }
        val out = LinkedHashSet<Item>()
        for (e in list) {
            val hit = listOf(e.t, e.o).filter { it.isNotEmpty() }.firstNotNullOfOrNull { name ->
                idx[key(name)]?.firstOrNull { c -> c !in out && (e.y == 0 || yearOf(c) == 0 || kotlin.math.abs(e.y - yearOf(c)) <= 1) }
            }
            if (hit != null) out += hit
            if (out.size >= n) break
        }
        return out.toList()
    }

    /** número de semana (año * 100 + semana): el relleno cambia cada semana */
    private fun week(): Int = Calendar.getInstance().let { c -> c.firstDayOfWeek = Calendar.MONDAY; c.minimalDaysInFirstWeek = 4; c.get(Calendar.YEAR) * 100 + c.get(Calendar.WEEK_OF_YEAR) }

    private fun fill(items: List<Item>, skip: Collection<Item>, n: Int, salt: Int): List<Item> {
        if (n <= 0) return emptyList()
        val pool = items.sortedByDescending { it.rating }.filter { it !in skip }.take(40)
        val pick = pool.shuffled(Random(week() * 31 + salt)).take(n).toSet()
        return pool.filter { it in pick }
    }

    /** Top 10 de Películas o de Series: lo de la semana que está en el catálogo y el relleno de la semana. */
    fun top10(items: List<Item>, kind: Kind): List<Item> {
        val got = matches(if (kind == Kind.SERIES) series else movies, items, 10)
        return got + fill(items, got, 10 - got.size, if (kind == Kind.SERIES) 2 else 1)
    }

    /** Top 10 de Inicio: películas y series juntas, alternadas en el orden de la semana. */
    fun top10Home(movieItems: List<Item>, seriesItems: List<Item>): List<Item> {
        val mv = matches(all.filter { it.series != true }, movieItems, 10)
        val sv = matches(all.filter { it.series == true }, seriesItems, 10)
        val out = ArrayList<Item>()
        var a = 0
        var b = 0
        while (out.size < 10 && (a < mv.size || b < sv.size)) {
            if (a < mv.size) out += mv[a++]
            if (out.size < 10 && b < sv.size) out += sv[b++]
        }
        val need = 10 - out.size
        if (need > 0) {
            val f = fill(movieItems, mv, need, 3) + fill(seriesItems, sv, need, 4)
            out += f.shuffled(Random(week() * 31 + 5)).take(need)
        }
        return out
    }
}
