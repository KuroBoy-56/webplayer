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
     * Consulta TMDB por el panel (api/tmdb.php: la clave del distribuidor o del dueño y su caché de 24 h).
     * Solo si el panel no responde se pregunta a TMDB directo, con la llave del panel (Store.tmdbKey) y, si
     * TMDB la rechaza, con la de respaldo. null = sin respuesta válida.
     */
    private suspend fun get(path: String): JSONObject? {
        viaPanel(path)?.let { return it }
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

    /** "search/movie?language=es-MX&query=…" por api/tmdb.php del panel; null si el panel no la pudo dar */
    private suspend fun viaPanel(path: String): JSONObject? {
        val b = PanelUrl.api("tmdb.php").toHttpUrlOrNull()?.newBuilder() ?: return null
        b.addQueryParameter("path", path.substringBefore('?'))
        // los valores ya vienen codificados (URLEncoder)
        for (kv in path.substringAfter('?', "").split('&')) {
            if (kv.isNotEmpty()) b.addEncodedQueryParameter(kv.substringBefore('='), kv.substringAfter('=', ""))
        }
        val r = Net.get(Tenant.tag(b).build().toString())
        val j = (if (r.ok) r.json() else null) ?: return null
        // {"error": "tmdb_key_not_set"} del panel o {"success": false} de TMDB
        return if (j.has("error") || !j.optBoolean("success", true)) null else j
    }

    /**
     * Carátulas del fondo del inicio de sesión y del número de distribuidor: solo con la clave TMDB del
     * panel (la del distribuidor o la del dueño), pedidas por api/tmdb.php. Sin clave el panel responde
     * tmdb_key_not_set y no hay carrusel (nunca con la clave de respaldo de la app).
     */
    suspend fun nowPlaying(pages: Int = 3): List<String> {
        // sin copia en memoria: si el panel ya no entrega la clave, el fondo queda negro (nunca pósters viejos)
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

    // ---------- título para TMDB: la misma regla que el panel (includes/title_clean.php) y Roku (nfTmdbParse) ----------
    private val TC_TAG = Regex("(?iu)^(4k|8k|uhd|fhd|hd|sd|hq|lat|latino|latam|sub|subs|subt|subtitulad[oa]|esp|es|en|eng|spa|mx|us|ar|co|cl|pe|br|pt|fr|de|it|uk|ve|ec|uy|py|bo|cr|pa|gt|hn|sv|do|pr|dual|multi|multi ?audio|dub|dublad[oa]|legendad[oa]|castellano|espa[nñ]ol|ingl[eé]s|vose|vos|vo|cam|ts|hdr|hdr10|dv|hevc|[xh]26[45]|web|web-?dl|webrip|bluray|brrip|dvdrip|hdtv|remux|imax|vip|new|nuevo|nueva|estreno|premiere|netflix|amazon|prime|prime video|disney|disney\\+|hbo|hbo max|max|apple|apple tv\\+?|paramount\\+?|star\\+|\\d{3,4}p|(19|20)\\d\\d|[st]\\d{1,2})$")
    private val TC_JUNK = Regex("(?iu)(?<![\\p{L}\\p{N}])(4k|8k|uhd|fhd|hd|sd|hdr10|hdr|1080p|720p|2160p|480p|hevc|[xh]26[45]|10bit|web-?dl|webrip|bluray|brrip|dvdrip|hdtv|hdcam|remux|lat|latino|castellano|subtitulad[oa]|sub|esp|dual|multi|dublad[oa]|legendad[oa]|vose)(?![\\p{L}\\p{N}])")
    private val TC_SEASON = Regex("(?iu)(?<![\\p{L}\\p{N}])s\\d{1,2}\\s*e\\d{1,3}(?![\\p{L}\\p{N}])|\\s+(s\\d{1,2}|t\\d{1,2}|(temporada|season|saison)\\s*\\d{1,2})\\s*$")
    private val TC_BRACKETS = Regex("\\([^)]*\\)|\\[[^\\]]*\\]|\\{[^}]*\\}")
    private val TC_YEAR_BOX = Regex("[\\(\\[]\\s*((?:19|20)\\d\\d)\\s*[\\)\\]]")
    private val TC_YEAR = Regex("(?<![\\p{L}\\p{N}])((?:19|20)\\d\\d)(?![\\p{L}\\p{N}])")
    private val TC_DECOR = Regex("[^\\p{L}\\p{M}\\p{N}\\s'’&:!?¿¡.,+#\\-–—|/]")
    private val TC_PRE_BAR = Regex("^\\s*\\|?\\s*[\\p{Lu}0-9+]{2,5}\\s*\\|\\s*")
    private val TC_PRE_COLON = Regex("^\\s*\\p{Lu}{2,4}\\s*:\\s+")
    private val TC_EDGES = Regex("^[\\s\\-–—:·,./]+|[\\s\\-–—:·,/]+$")
    private val TC_WORD = Regex("[\\p{L}\\p{N}]")
    private val TC_SPACES = Regex("\\s+")

    /**
     * "ES - Avengers: Endgame (2019) [4K] | LAT" → ("Avengers: Endgame", "2019"): lo que TMDB entiende. Quita etiquetas
     * de idioma, país, calidad y plataforma («NETFLIX - …», «|LAT| …»), temporadas («S01», «T2»), estrellas y emojis;
     * deja un número que es el título («1917», «2012»). Casos en tools/title_clean_vectors.json del panel.
     */
    fun clean(raw: String): Pair<String, String> {
        var s = raw.trim()
        val year = TC_YEAR_BOX.find(s)?.groupValues?.get(1) ?: TC_YEAR.findAll(s).lastOrNull()?.groupValues?.get(1) ?: ""
        // "The.Matrix.1999.1080p" (sin espacios): los puntos y guiones bajos separan palabras
        if (!s.contains(' ') && (s.contains('.') || s.contains('_'))) s = s.replace(Regex("[._]+"), " ")
        var t = s.replace(TC_BRACKETS, " ").replace(TC_DECOR, " ").replace(TC_PRE_BAR, "").replace(TC_PRE_COLON, "")
        for (sep in listOf("|", " - ", " – ", " — ")) {
            if (!t.contains(sep)) continue
            val keep = t.split(sep).map { it.trim() }.filter { it.isNotEmpty() && !TC_TAG.matches(it) }
            if (keep.isNotEmpty()) t = keep.joinToString(if (sep == "|") " " else " - ")
        }
        t = t.replace("|", " ").replace(TC_SEASON, " ").replace(TC_JUNK, " ")
        if (year.isNotEmpty()) {
            val no = t.replace(Regex("(?<![\\p{L}\\p{N}])$year(?![\\p{L}\\p{N}])"), " ").trim()
            if (TC_WORD.containsMatchIn(no)) t = no
        }
        t = t.replace(TC_SPACES, " ").replace(TC_EDGES, "")
        if (t.isEmpty()) t = raw.replace(TC_BRACKETS, " ").replace(TC_SPACES, " ").trim()
        return t to year
    }

    /** la primera parte de «Título - Subtítulo» (o "") */
    fun firstPart(q: String): String = q.split(" - ").let { p -> if (p.size > 1 && p[0].trim().length >= 3) p[0].trim() else "" }

    /** título para comparar con TMDB: minúsculas, sin acentos ni signos, «&» = «y», sin artículo al principio (como el panel) */
    private fun cmp(s: String): String {
        val n = java.text.Normalizer.normalize(s.lowercase().replace("&", " y "), java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
        return n.replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim().replace(Regex("^(the|el|la|los|las|le|les|o|os|as) "), "")
    }

    /** ¿el resultado es ese título? mismo nombre (traducido u original) y, si se sabe, el año ±1 */
    private fun same(r: JSONObject, q: String, y: String): Boolean {
        val want = cmp(q)
        if (want.isEmpty()) return false
        if (listOf("title", "original_title", "name", "original_name").none { f -> r.optString(f).let { it.isNotEmpty() && it != "null" && cmp(it) == want } }) return false
        if (y.length != 4) return true
        val d = r.optString("release_date").ifEmpty { r.optString("first_air_date") }
        val ry = d.take(4).toIntOrNull() ?: return true
        return kotlin.math.abs(ry - (y.toIntOrNull() ?: ry)) <= 1
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
            // como Roku y el panel: con año, sin año, como el otro tipo (película / serie) y sin el subtítulo; primero un
            // resultado con el mismo título (y el año ±1). Si ninguno coincide, el primero de la búsqueda (como antes)
            val y = year.filter { it.isDigit() }.take(4)
            val other = if (type == "tv") "movie" else "tv"
            val tries = ArrayList<Triple<String, String, String>>()
            if (y.length == 4) tries += Triple(type, cleanTitle, y)
            tries += Triple(type, cleanTitle, "")
            tries += Triple(other, cleanTitle, "")
            if (y.length == 4) {
                cleanTitle.substringBefore(':', "").trim().takeIf { it.length >= 3 }?.let { tries += Triple(type, it, "") }
                firstPart(cleanTitle).takeIf { it.isNotEmpty() }?.let { tries += Triple(type, it, y) }
            }
            var firstAny: Pair<String, String>? = null
            for ((t, q, yr) in tries.distinct()) {
                val yp = if (yr.length == 4) (if (t == "tv") "&first_air_date_year=$yr" else "&primary_release_year=$yr") else ""
                val results = get("search/$t?language=es-MX&query=${URLEncoder.encode(q, "UTF-8")}$yp")?.optJSONArray("results") ?: continue
                var hit: JSONObject? = null
                for (i in 0 until results.length()) {
                    val r = results.optJSONObject(i) ?: continue
                    if (firstAny == null && t == type) firstAny = t to r.optInt("id").toString()
                    if (same(r, q, y)) { hit = r; break }
                }
                if (hit != null) { idToFetch = hit.optInt("id").toString(); fetchedType = t; break }
            }
            if (idToFetch.isEmpty()) firstAny?.let { (t, id) -> fetchedType = t; idToFetch = id }
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
