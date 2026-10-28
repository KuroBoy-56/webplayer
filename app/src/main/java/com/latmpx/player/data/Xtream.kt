package com.latmpx.player.data

import com.latmpx.player.tr
import com.latmpx.player.R
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Cliente del API de Xtream Codes (player_api.php), igual que el reproductor web. */
object Xtream {
    private val cache = HashMap<String, Any>()
    private val lock = Mutex()

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun api(s: Session, action: String = "", extra: String = "") =
        "${s.base}/player_api.php?username=${enc(s.user)}&password=${enc(s.pass)}" + (if (action.isNotEmpty()) "&action=$action" else "") + extra

    sealed class LoginResult {
        data class Ok(val session: Session) : LoginResult()
        data class Fail(val message: String) : LoginResult()
    }

    /** Prueba el usuario en cada DNS del panel (en orden) y se queda con el primero que responda. */
    suspend fun login(dns: List<Pair<String, String>>, user: String, pass: String): LoginResult {
        val noServer = tr(R.string.err_server_offline)
        var lastMsg = noServer
        for ((name, rawUrl) in dns) {
            // el panel (https) cambia http:// por https:// en las direcciones de los servidores IPTV; muchos
            // solo responden en http (p. ej. el puerto 8080). Si no contesta, se prueba el otro protocolo.
            var probe = Session(name, normalize(rawUrl), user, pass, "")
            var r = Net.get(api(probe))
            var j = r.json()
            log(probe.base, r, j)
            if (j == null) {
                val alt = probe.copy(base = otherScheme(probe.base))
                val r2 = Net.get(api(alt))
                val j2 = r2.json()
                log(alt.base, r2, j2)
                if (j2 != null || (r.code == 0 && r2.code > 0)) { probe = alt; r = r2; j = j2 }
            }
            if (j == null) {
                // el servidor respondió pero no con la cuenta: XUI dice el motivo; si no, el código HTTP
                val xui = xuiError(r.body)
                if (xui != null) { lastMsg = xuiMessage(xui); android.util.Log.i("LatMpx", "login rechazado por XUI: $xui"); continue }
                if (r.code > 0 && lastMsg == noServer) lastMsg = tr(R.string.err_server_refused, r.code)
                continue
            }
            val ui = j.optJSONObject("user_info")
            if (ui == null || ui.i("auth") != 1) { lastMsg = tr(R.string.err_bad_credentials); continue }
            val status = ui.s("status")
            if (status.isNotEmpty() && !status.equals("Active", true)) { lastMsg = tr(R.string.err_account_status, status); continue }
            val exp = ui.s("exp_date").toLongOrNull()?.let { java.text.SimpleDateFormat("dd/MM/yyyy", java.util.Locale.US).format(it * 1000) } ?: tr(R.string.unlimited)
            val c = ui.s("created_at")
            val created = c.toLongOrNull()?.let { java.text.SimpleDateFormat("dd/MM/yyyy", java.util.Locale.US).format(it * 1000) } ?: c.takeIf { it.isNotBlank() } ?: tr(R.string.unknown)
            val active = ui.s("active_cons").takeIf { it.isNotBlank() } ?: "0"
            val max = ui.s("max_connections").takeIf { it.isNotBlank() } ?: "0"
            return LoginResult.Ok(probe.copy(expires = exp, createdAt = created, activeCons = active, maxCons = max, expTs = ui.s("exp_date").toLongOrNull() ?: 0L))
        }
        return LoginResult.Fail(lastMsg)
    }

    /** registro (adb logcat -s LatMpx): servidor, código HTTP y si llegó la cuenta; nunca usuario ni contraseña */
    private fun log(base: String, r: Net.Resp, j: org.json.JSONObject?) {
        val ui = j?.optJSONObject("user_info")
        android.util.Log.i("LatMpx", "login ${base.substringAfter("://")} -> http ${r.code}" + if (ui != null) " auth=${ui.s("auth")} status=${ui.s("status")}" else " sin JSON")
    }

    /** http://… <-> https://… */
    fun otherScheme(base: String): String =
        if (base.startsWith("https://", true)) "http://" + base.substring(8).replace(Regex("^([^/]+):443(?=/|$)"), "$1")
        else "https://" + base.substringAfter("://").replace(Regex("^([^/]+):80(?=/|$)"), "$1")

    /**
     * XUI.one en «Debug Mode» no responde {"user_info":{"auth":0}} sino una página HTML (200) con el motivo:
     * «XUI.ONE INVALID_CREDENTIALS Username or password is invalid.». Devuelve el código (o null).
     */
    fun xuiError(body: String): String? {
        val text = body.replace(Regex("(?is)<(style|script)[^>]*>.*?</\\1>"), " ").replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ")
        return Regex("XUI\\.(?:ONE|one)\\s+([A-Z][A-Z_]{2,})").find(text)?.groupValues?.get(1)
    }

    /** mensaje en español para el código de XUI */
    fun xuiMessage(code: String): String = when (code) {
        "INVALID_CREDENTIALS" -> tr(R.string.err_xui_credentials)
        "EXPIRED" -> tr(R.string.err_xui_expired)
        "BANNED", "DISABLED" -> tr(R.string.err_xui_disabled)
        else -> tr(R.string.err_xui_other, code)
    }

    fun normalize(u: String): String {
        var x = u.trim().trimEnd('/')
        if (!x.startsWith("http://", true) && !x.startsWith("https://", true)) x = "http://$x"
        return x
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun <T> memo(key: String, load: suspend () -> T): T {
        lock.withLock { cache[key]?.let { return it as T } }
        val v = load()
        if (v is List<*> && v.isEmpty()) return v
        lock.withLock { cache[key] = v as Any }
        return v
    }

    fun clearCache() { cache.clear() }

    /** Categorías: memoria → copia del equipo → servidor. */
    suspend fun categories(s: Session, kind: Kind): List<Category> = memo("cat|${kind.name}") {
        CatalogCache.categories(s, kind) ?: fetchCategories(s, kind)
    }

    /** Todas las películas / series / canales (una sola consulta, igual que la web): memoria → equipo → servidor. */
    suspend fun items(s: Session, kind: Kind): List<Item> = memo("all|${kind.name}") {
        CatalogCache.items(s, kind) ?: fetchItems(s, kind).also { list ->
            if (list.isNotEmpty()) CatalogCache.save(s, kind, lock.withLock { cache["cat|${kind.name}"] as? List<Category> }.orEmpty(), list)
        }
    }

    private suspend fun fetchCategories(s: Session, kind: Kind): List<Category> {
        val action = when (kind) { Kind.MOVIE -> "get_vod_categories"; Kind.SERIES -> "get_series_categories"; Kind.LIVE -> "get_live_categories" }
        return Net.arr(api(s, action)).mapObj { o -> Category(o.s("category_id"), o.s("category_name"), kind) }
    }

    private suspend fun fetchItems(s: Session, kind: Kind): List<Item> {
        val action = when (kind) { Kind.MOVIE -> "get_vod_streams"; Kind.SERIES -> "get_series"; Kind.LIVE -> "get_live_streams" }
        return withContext(Dispatchers.Default) {
            Net.arr(api(s, action)).mapObj { o -> parseItem(o, kind) }.distinctBy { it.id }
        }
    }

    /** Solo lo guardado en el equipo (sin red); también queda en memoria. null si no hay copia. */
    suspend fun cached(s: Session, kind: Kind): Pair<List<Category>, List<Item>>? {
        val items = CatalogCache.items(s, kind) ?: return null
        val cats = CatalogCache.categories(s, kind).orEmpty()
        lock.withLock {
            cache["all|${kind.name}"] = items
            if (cats.isNotEmpty()) cache["cat|${kind.name}"] = cats
        }
        return cats to items
    }

    /**
     * Vuelve a pedir el catálogo al servidor y actualiza memoria y equipo.
     * Si el servidor no responde (o llega vacío) se conserva lo anterior y devuelve null.
     */
    suspend fun refresh(s: Session, kind: Kind): Pair<List<Category>, List<Item>>? = coroutineScope {
        val c = async { fetchCategories(s, kind) }
        val i = async { fetchItems(s, kind) }
        val items = i.await()
        val cats = c.await()
        if (items.isEmpty()) return@coroutineScope null
        val finalCats = lock.withLock {
            cache["all|${kind.name}"] = items
            if (cats.isNotEmpty()) cache["cat|${kind.name}"] = cats
            val known = cache["cat|${kind.name}"] as? List<Category>
            known.orEmpty()
        }
        CatalogCache.save(s, kind, finalCats, items)
        finalCats to items
    }

    private fun parseItem(o: org.json.JSONObject, kind: Kind): Item? {
        val id = if (kind == Kind.SERIES) o.i("series_id") else o.i("stream_id")
        if (id <= 0) return null
        val poster = Posters.clean(when (kind) { Kind.SERIES -> o.s("cover"); Kind.LIVE -> o.s("stream_icon"); else -> o.s("stream_icon") })
        val year = o.s("year").ifEmpty { o.s("releaseDate").take(4) }.ifEmpty { o.s("release_date").take(4) }
        return Item(
            id = id,
            name = o.s("name"),
            poster = poster,
            kind = kind,
            categoryId = o.s("category_id"),
            ext = o.s("container_extension"),
            rating = o.d("rating").let { if (it > 10) it / 10 else it },
            year = year,
            added = (if (kind == Kind.SERIES) o.s("last_modified") else o.s("added")).toLongOrNull() ?: 0,
            plot = o.s("plot"),
            epgId = o.s("epg_channel_id"),
            backdrop = Posters.clean(o.optJSONArray("backdrop_path")?.optString(0).orEmpty()),
            cast = if (kind == Kind.LIVE) "" else o.s("cast").ifEmpty { o.s("actors") },
            tm = if (kind == Kind.LIVE) "" else o.s("tmdb").ifEmpty { o.s("tmdb_id") }.filter(Char::isDigit).takeIf { it.isNotEmpty() && it != "0" }.orEmpty(),
        )
    }

    suspend fun movieDetails(s: Session, item: Item): Details = memo("vod|${item.id}") {
        val j = Net.obj(api(s, "get_vod_info", "&vod_id=${item.id}"))
        val info = j?.optJSONObject("info")
        val md = j?.optJSONObject("movie_data")
        val ext = md?.s("container_extension")?.ifEmpty { null } ?: item.ext
        Details(
            item = item.copy(ext = ext, poster = item.poster.ifEmpty { Posters.clean(info?.s("movie_image").orEmpty()) }),
            plot = info?.let { it.s("plot").ifEmpty { it.s("description") } } ?: item.plot,
            cast = info?.let { it.s("cast").ifEmpty { it.s("actors") } }.orEmpty(),
            director = info?.s("director").orEmpty(),
            genre = info?.s("genre").orEmpty(),
            duration = info?.s("duration").orEmpty(),
            backdrop = Posters.clean(info?.optJSONArray("backdrop_path")?.optString(0).orEmpty()).ifEmpty { item.backdrop },
            trailer = info?.s("youtube_trailer").orEmpty(),
            tmdbId = info?.s("tmdb_id").orEmpty()
        )
    }

    suspend fun seriesDetails(s: Session, item: Item): Details = memo("ser|${item.id}") {
        val j = Net.obj(api(s, "get_series_info", "&series_id=${item.id}"))
        val info = j?.optJSONObject("info")
        val seasons = sortedMapOf<Int, List<Episode>>()
        val eps = j?.opt("episodes")
        if (eps is org.json.JSONObject) {
            eps.keys().forEach { k ->
                val list = eps.optJSONArray(k).mapObj { e ->
                    val ei = e.optJSONObject("info")
                    Episode(
                        id = e.i("id"),
                        num = e.i("episode_num"),
                        season = e.i("season").takeIf { it > 0 } ?: (k.toIntOrNull() ?: 1),
                        title = e.s("title"),
                        ext = e.s("container_extension").ifEmpty { "mp4" },
                        plot = ei?.s("plot").orEmpty(),
                        image = ei?.s("movie_image").orEmpty(),
                        duration = ei?.s("duration").orEmpty(),
                    )
                }.sortedBy { it.num }
                if (list.isNotEmpty()) seasons[k.toIntOrNull() ?: list.first().season] = list
            }
        } else if (eps is org.json.JSONArray) {
            // algunos paneles envían una lista de temporadas
            for (n in 0 until eps.length()) {
                val list = eps.optJSONArray(n).mapObj { e ->
                    Episode(e.i("id"), e.i("episode_num"), e.i("season"), e.s("title"), e.s("container_extension").ifEmpty { "mp4" },
                        e.optJSONObject("info")?.s("plot").orEmpty(), e.optJSONObject("info")?.s("movie_image").orEmpty(), e.optJSONObject("info")?.s("duration").orEmpty())
                }
                if (list.isNotEmpty()) seasons[list.first().season.takeIf { it > 0 } ?: (n + 1)] = list
            }
        }
        Details(
            item = item,
            plot = info?.s("plot") ?: item.plot,
            cast = info?.s("cast").orEmpty(),
            director = info?.s("director").orEmpty(),
            genre = info?.s("genre").orEmpty(),
            duration = info?.s("episode_run_time").orEmpty(),
            backdrop = Posters.clean(info?.optJSONArray("backdrop_path")?.optString(0).orEmpty()).ifEmpty { item.backdrop },
            trailer = info?.s("youtube_trailer").orEmpty(),
            tmdbId = info?.s("tmdb_id").orEmpty(),
            seasons = seasons,
        )
    }

    /** Guía corta del canal (ahora / siguiente). Los títulos llegan en base64. */
    suspend fun shortEpg(s: Session, streamId: Int, limit: Int = 6): List<EpgEntry> {
        val j = Net.obj(api(s, "get_short_epg", "&stream_id=$streamId&limit=$limit")) ?: return emptyList()
        return listings(j).filter { it.end > System.currentTimeMillis() }
    }

    /**
     * Guía completa del canal (get_simple_data_table): todo lo que guarda el servidor, también lo ya emitido
     * (la TV la usa para la línea de tiempo de ayer a pasado mañana).
     */
    suspend fun fullEpg(s: Session, streamId: Int): List<EpgEntry> {
        val j = Net.obj(api(s, "get_simple_data_table", "&stream_id=$streamId")) ?: return emptyList()
        return listings(j)
    }

    private fun listings(j: JSONObject): List<EpgEntry> {
        val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return j.optJSONArray("epg_listings").mapObj { e ->
            val start = e.s("start_timestamp").toLongOrNull()?.times(1000) ?: runCatching { fmt.parse(e.s("start"))?.time }.getOrNull() ?: return@mapObj null
            val end = e.s("stop_timestamp").toLongOrNull()?.times(1000) ?: runCatching { fmt.parse(e.s("end"))?.time }.getOrNull() ?: start
            if (end <= start) null else EpgEntry(b64(e.s("title")), b64(e.s("description")), start, end)
        }.sortedBy { it.start }.distinctBy { it.start }
    }

    private fun b64(x: String): String {
        if (x.isEmpty()) return ""
        return try {
            val t = String(Base64.decode(x.replace("\\s".toRegex(), ""), Base64.DEFAULT), Charsets.UTF_8)
            if (t.any { it.code < 9 || it == '�' }) x else t
        } catch (e: Exception) { x }
    }

    /* ---------- direcciones de reproducción ---------- */

    fun movieUrl(s: Session, id: Int, ext: String) = "${s.base}/movie/${enc(s.user)}/${enc(s.pass)}/$id.${ext.ifEmpty { "mp4" }}"
    fun episodeUrl(s: Session, id: Int, ext: String) = "${s.base}/series/${enc(s.user)}/${enc(s.pass)}/$id.${ext.ifEmpty { "mp4" }}"

    /** canales: primero HLS (m3u8) y si el servidor no lo ofrece, MPEG-TS (o al revés según el ajuste) */
    fun liveUrls(s: Session, id: Int): List<String> {
        val base = "${s.base}/live/${enc(s.user)}/${enc(s.pass)}/$id"
        return when (Store.streamFormat) {
            "ts" -> listOf("$base.ts", "$base.m3u8", base)
            "m3u8" -> listOf("$base.m3u8", "$base.ts", base)
            else -> listOf("$base.m3u8", "$base.ts", base)
        }
    }

    /** Precarga en paralelo lo necesario para el inicio. */
    suspend fun warmUp(s: Session) = coroutineScope {
        listOf(
            async { categories(s, Kind.MOVIE) }, async { categories(s, Kind.SERIES) }, async { categories(s, Kind.LIVE) },
            async { items(s, Kind.MOVIE) }, async { items(s, Kind.SERIES) },
        ).awaitAll()
    }
}
