package com.latmpx.player.data

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
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
        var lastMsg = "No se pudo conectar con el servidor"
        for ((name, rawUrl) in dns) {
            val base = normalize(rawUrl)
            val probe = Session(name, base, user, pass, "")
            val j = Net.obj(api(probe)) ?: continue
            val ui = j.optJSONObject("user_info")
            if (ui == null || ui.i("auth") != 1) { lastMsg = "Usuario o contraseña incorrectos"; continue }
            val status = ui.s("status")
            if (status.isNotEmpty() && !status.equals("Active", true)) { lastMsg = "Tu cuenta está $status"; continue }
            val exp = ui.s("exp_date").toLongOrNull()?.let { java.text.SimpleDateFormat("dd/MM/yyyy", java.util.Locale.US).format(it * 1000) } ?: "Ilimitado"
            val c = ui.s("created_at")
            val created = c.toLongOrNull()?.let { java.text.SimpleDateFormat("dd/MM/yyyy", java.util.Locale.US).format(it * 1000) } ?: c.takeIf { it.isNotBlank() } ?: "Desconocido"
            val active = ui.s("active_cons").takeIf { it.isNotBlank() } ?: "0"
            val max = ui.s("max_connections").takeIf { it.isNotBlank() } ?: "0"
            return LoginResult.Ok(probe.copy(expires = exp, createdAt = created, activeCons = active, maxCons = max))
        }
        return LoginResult.Fail(lastMsg)
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
        val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return j.optJSONArray("epg_listings").mapObj { e ->
            val start = e.s("start_timestamp").toLongOrNull()?.times(1000) ?: runCatching { fmt.parse(e.s("start"))?.time }.getOrNull() ?: return@mapObj null
            val end = e.s("stop_timestamp").toLongOrNull()?.times(1000) ?: runCatching { fmt.parse(e.s("end"))?.time }.getOrNull() ?: start
            EpgEntry(b64(e.s("title")), b64(e.s("description")), start, end)
        }.filter { it.end > System.currentTimeMillis() }
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
