package com.latmpx.player.data
import com.latmpx.player.Lang

import org.json.JSONObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URLEncoder

object Tmdb {
    private const val FALLBACK_KEY = "0c23c3f0458f0f9e4d0a35048d3a199a"
    /** la llave del panel respondió 401 (vencida o mal copiada): se usa la de respaldo */
    @Volatile private var panelKeyBad = false


    /**
     * Consulta TMDB con la llave del panel (Store.tmdbKey) y, si TMDB la rechaza, con la de respaldo.
     * null = sin respuesta válida (sin conexión, error del servidor o llave rechazada).
     */
    private suspend fun get(path: String): JSONObject? {
        val panel = Store.tmdbKey.takeIf { it.isNotBlank() && !panelKeyBad }
        val keys = listOfNotNull(panel, FALLBACK_KEY).distinct()
        for (k in keys) {
            val sep = if (path.contains('?')) "&" else "?"
            val r = Net.get("https://api.themoviedb.org/3/$path${sep}api_key=${URLEncoder.encode(k, "UTF-8")}")
            if (r.code == 401) {
                if (k == panel) panelKeyBad = true
                continue
            }
            return if (r.ok) r.json() else null
        }
        return null
    }

    /**
     * Carátulas del fondo del inicio de sesión y del número de distribuidor: solo con la clave TMDB del
     * panel (la del distribuidor o la del dueño), pedidas por api/tmdb.php. Sin clave el panel responde
     * tmdb_key_not_set y no hay carrusel (nunca con la clave de respaldo de la app).
     */
    suspend fun nowPlaying(pages: Int = 3): List<String> {
        // siempre se pregunta al panel (sin copia guardada): si quitaron la clave, el fondo queda negro
        val lang = Lang.tmdb
        val out = ArrayList<String>()
        for (p in 1..pages) {
            // ?path= (no tmdb.php/movie/now_playing): muchos hostings no pasan PATH_INFO
            val url = PanelUrl.api("tmdb.php").toHttpUrlOrNull()?.newBuilder()
                ?.addQueryParameter("path", "movie/now_playing")
                ?.let { Tenant.tag(it) }
                ?.addQueryParameter("language", lang)?.addQueryParameter("page", p.toString())
                ?.build()?.toString() ?: break
            val r = Net.get(url)
            val j = (if (r.ok) r.json() else null) ?: break
            if (j.has("error")) break
            j.optJSONArray("results")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i)
                    val pp = o?.optString("poster_path") ?: ""
                    if (pp.isNotEmpty() && pp != "null") out += "https://image.tmdb.org/t/p/w342$pp"
                }
            }
        }
        return out.distinct().take(48)
    }

    /** "ES - Avengers: Endgame (2019) [4K] LAT" → ("Avengers: Endgame", "2019"): lo que TMDB entiende */
    fun clean(raw: String): Pair<String, String> {
        var t = raw.trim()
        val year = Regex("[\\(\\[]((19|20)\\d{2})[\\)\\]]").find(t)?.groupValues?.get(1)
            ?: Regex("\\b((19|20)\\d{2})\\s*$").find(t)?.groupValues?.get(1) ?: ""
        t = t.replace(Regex("^\\s*[A-Z]{2,4}\\s*[-|:]\\s+"), "")                     // prefijos de país: "ES - ", "LAT | "
        t = t.replace(Regex("[\\(\\[][^\\)\\]]*[\\)\\]]"), " ")                       // (2019) [4K] (Latino)
        t = t.replace(Regex("(?i)\\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|hdr|dual|latino|lat|castellano|subtitulad[oa]|sub|esp|eng|vose|cam|ts|hevc|x265|x264)\\b"), " ")
        if (year.isNotEmpty()) t = t.replace(Regex("\\b$year\\s*$"), " ")
        t = t.replace(Regex("[_.]+"), " ").replace(Regex("\\s*[-|]\\s*$"), "").replace(Regex("\\s+"), " ").trim()
        return t to year
    }

    /**
     * Póster de TMDB (w342) para una película o serie, buscando por nombre y año (igual que la web:
     * con año, sin año, título antes de ":" o " - " y por último el otro tipo).
     * "" = TMDB no lo tiene; null = no hubo respuesta (se vuelve a intentar más tarde).
     */
    suspend fun findPoster(type: String, rawTitle: String, rawYear: String = ""): String? {
        val (title, y0) = clean(rawTitle)
        if (title.length < 2) return ""
        val y = rawYear.filter { it.isDigit() }.take(4).ifEmpty { y0 }
        val tries = ArrayList<Triple<String, String, String>>()
        if (y.length == 4) tries += Triple(type, title, y)
        tries += Triple(type, title, "")
        listOf(":", " - ", " – ").forEach { sep ->
            if (title.contains(sep)) title.substringBefore(sep).trim().takeIf { it.length >= 3 }?.let { tries += Triple(type, it, y) }
        }
        tries += Triple(if (type == "tv") "movie" else "tv", title, "")
        var answered = false
        for ((t, q, yr) in tries.distinct()) {
            val yp = if (yr.length == 4) (if (t == "tv") "&first_air_date_year=$yr" else "&year=$yr") else ""
            val res = get("search/$t?language=es-MX&include_adult=false&query=${URLEncoder.encode(q, "UTF-8")}$yp") ?: continue
            answered = true
            val arr = res.optJSONArray("results") ?: continue
            for (i in 0 until arr.length()) {
                val pp = arr.optJSONObject(i)?.optString("poster_path").orEmpty()
                if (pp.isNotEmpty() && pp != "null") return "https://image.tmdb.org/t/p/w342$pp"
            }
        }
        return if (answered) "" else null
    }

    /**
     * Id de TMDB de una persona buscada por nombre (prefiere a quien actúa).
     * 0 = TMDB no la conoce; null = sin respuesta.
     */
    suspend fun searchPersonId(name: String): Int? {
        val q = name.trim()
        if (q.length < 2) return 0
        val res = get("search/person?language=es-MX&include_adult=false&query=${URLEncoder.encode(q, "UTF-8")}") ?: return null
        val arr = res.optJSONArray("results") ?: return 0
        var first = 0
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optInt("id")
            if (id <= 0) continue
            if (first == 0) first = id
            if (o.optString("known_for_department") == "Acting") return id
        }
        return first
    }

    /** Persona con su filmografía completa (películas y series) en un solo pedido. null = sin respuesta. */
    suspend fun person(id: Int): JSONObject? = get("person/$id?language=es-MX&append_to_response=combined_credits")

    /** Biografía en inglés cuando no hay traducción al español. */
    suspend fun personBioEn(id: Int): String = get("person/$id?language=en-US")?.optString("biography").orEmpty()

    data class Details(
        val id: Int,
        val poster: String,
        val backdrop: String,
        val overview: String,
        val cast: List<CastMember>,
        val trailer: String
    )

    /**
     * Sinopsis a mostrar: en español queda la de siempre (server); en otro idioma, el resumen de la ficha
     * de TMDB (pedida en ese idioma) y, si TMDB no lo tiene o no hubo coincidencia, la del servidor.
     */
    fun localPlot(server: String, overview: String?): String =
        if (Lang.current == "es") server else overview?.ifBlank { null } ?: server

    data class CastMember(val name: String, val character: String, val profile: String, val id: Int = 0)

    private val cache = mutableMapOf<String, Details>()

    suspend fun getDetails(type: String, title: String, year: String, tmdbId: String = ""): Details? {
        val cleanTitle = clean(title).first.ifEmpty { title.trim() }
        val year = year.ifEmpty { clean(title).second }
        val lang = Lang.tmdb // la búsqueda sigue en es-MX; la ficha (resumen, elenco, videos) en el idioma de la app
        val cacheKey = "$type|$cleanTitle|$year|$tmdbId|$lang"
        cache[cacheKey]?.let { return it }

        var idToFetch = tmdbId.filter { it.isDigit() }
        var fetchedType = type

        if (idToFetch.isEmpty()) {
            val q = URLEncoder.encode(cleanTitle, "UTF-8")
            val yParam = if (year.isNotEmpty()) {
                val y = year.filter { it.isDigit() }.take(4)
                if (type == "tv") "&first_air_date_year=$y" else "&primary_release_year=$y"
            } else ""
            
            var res = get("search/$type?language=es-MX&query=$q$yParam")
            
            if (res == null || res.optJSONArray("results")?.length() == 0) {
                res = get("search/$type?language=es-MX&query=$q")
            }

            val results = res?.optJSONArray("results")
            if (results != null && results.length() > 0) {
                idToFetch = results.optJSONObject(0)?.optInt("id").toString()
            }
        }

        if (idToFetch.isEmpty() || idToFetch == "null") return null

        val d = get("$fetchedType/$idToFetch?language=$lang&append_to_response=credits,aggregate_credits,videos") ?: return null

        val poster = d.optString("poster_path").let { if (it.isNotEmpty() && it != "null") "https://image.tmdb.org/t/p/w500$it" else "" }
        val backdrop = d.optString("backdrop_path").let { if (it.isNotEmpty() && it != "null") "https://image.tmdb.org/t/p/w1280$it" else "" }
        val overview = d.optString("overview")

        val cast = mutableListOf<CastMember>()
        val credits = d.optJSONObject("credits") ?: d.optJSONObject("aggregate_credits")
        credits?.optJSONArray("cast")?.let { arr ->
            for (i in 0 until Math.min(arr.length(), 15)) {
                val c = arr.optJSONObject(i)
                val profile = c?.optString("profile_path")?.let { if (it.isNotEmpty() && it != "null") "https://image.tmdb.org/t/p/w185$it" else "" } ?: ""
                cast.add(CastMember(c?.optString("name") ?: "", c?.optString("character") ?: "", profile, c?.optInt("id") ?: 0))
            }
        }

        var trailer = ""
        d.optJSONObject("videos")?.optJSONArray("results")?.let { arr ->
            for (i in 0 until arr.length()) {
                val v = arr.optJSONObject(i)
                if (v?.optString("site") == "YouTube" && v?.optString("type") == "Trailer") {
                    trailer = v.optString("key")
                    break
                }
            }
        }

        val details = Details(idToFetch.toInt(), poster, backdrop, overview, cast, trailer)
        cache[cacheKey] = details
        return details
    }
}
