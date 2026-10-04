package com.latmpx.player.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Continuar viendo y favoritos guardados en el panel (api/progress.php), por usuario IPTV.
 * Se pide un token una vez con usuario + contraseña; después solo se usa el token.
 * Mismo formato que la web: películas por nombre (type "movie"), series una entrada por serie (type "episode").
 */
object Cloud {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Any()
    private val progress = LinkedHashMap<String, Progress>()   // por título (clave del panel)
    private val favs = LinkedHashMap<String, Item>()           // por "movie:12" / "series:5" / "live:9"
    private val lastSent = HashMap<String, Long>()

    /** cambia cada vez que llegan o se modifican datos (la interfaz lo observa) */
    var rev by mutableIntStateOf(0)
        private set

    private fun bump() { io.launch(Dispatchers.Main) { rev++ } }

    private fun api() = PanelUrl.api("progress.php")
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /* ---------- token ---------- */

    private suspend fun token(s: Session): String? {
        Store.cloudToken?.takeIf { it.isNotEmpty() }?.let { return it }
        val r = Net.postJson(api(), JSONObject().put("action", "auth").put("user", s.user).put("pass", s.pass))
        val t = r.json()?.s("token").orEmpty()
        if (t.isEmpty()) return null
        Store.cloudToken = t
        return t
    }

    /** Llama a un endpoint del panel con el token; si venció, pide otro una vez. */
    suspend fun call(block: suspend (String) -> Net.Resp): Net.Resp? {
        val s = Store.session() ?: return null
        var tok = token(s) ?: return null
        var r = block(tok)
        if (r.code == 401) {
            Store.cloudToken = null
            tok = token(s) ?: return null
            r = block(tok)
        }
        r.json()?.s("token")?.takeIf { it.isNotEmpty() }?.let { Store.cloudToken = it }
        return r
    }

    /* ---------- carga ---------- */

    suspend fun load() {
        val r = call { t -> Net.get(api() + "?v=2&token=" + enc(t)) } ?: return
        val j = r.json() ?: return
        val pm = LinkedHashMap<String, Progress>()
        j.optJSONObject("progress")?.let { po ->
            po.keys().forEach { title -> po.optJSONObject(title)?.let { o -> parseProgress(title, o)?.let { pm[title] = it } } }
        }
        val fm = LinkedHashMap<String, Item>()
        j.optJSONArray("favorites").mapObj { o -> parseFav(o)?.let { it to o.s("addedAt") } }
            .sortedByDescending { it.second }.forEach { (item, _) -> fm[item.key] = item }
        withContext(Dispatchers.Main) {
            synchronized(lock) { progress.clear(); progress.putAll(pm); favs.clear(); favs.putAll(fm) }
            rev++
        }
    }

    fun clear() {
        synchronized(lock) { progress.clear(); favs.clear(); lastSent.clear() }
        bump()
    }

    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    private fun parseTime(s: String): Long = runCatching { synchronized(iso) { iso.parse(s)?.time } }.getOrNull() ?: 0L

    private fun parseProgress(title: String, o: JSONObject): Progress? {
        val id = o.s("id")
        val sid = o.s("seriesId")
        val key = when (o.s("type")) {
            "movie" -> if (id.isNotEmpty()) "movie:$id" else return null
            "episode", "series" -> when {
                sid.isNotEmpty() && id.isNotEmpty() -> "series:$sid:$id"
                sid.isNotEmpty() -> "series:$sid"
                id.isNotEmpty() -> "series:$id"
                else -> return null
            }
            else -> return null
        }
        return Progress(
            key = key, title = title, label = title, poster = o.s("poster"),
            position = (o.d("position") * 1000).toLong(), duration = (o.d("duration") * 1000).toLong(),
            updated = parseTime(o.s("updatedAt")), url = o.s("url"), categoryId = o.s("categoryId"),
        )
    }

    private fun parseFav(o: JSONObject): Item? {
        val id = o.s("id").toIntOrNull() ?: return null
        val kind = when (o.s("type")) { "movie" -> Kind.MOVIE; "series" -> Kind.SERIES; "live" -> Kind.LIVE; else -> return null }
        return Item(id, o.s("title"), o.s("poster"), kind, categoryId = o.s("categoryId"))
    }

    /* ---------- continuar viendo ---------- */

    fun progress(key: String): Progress? = synchronized(lock) { progress.values.firstOrNull { it.key == key } }

    /** último episodio visto de una serie */
    fun seriesProgress(seriesId: Int): Progress? = synchronized(lock) {
        progress.values.filter { it.key == "series:$seriesId" || it.key.startsWith("series:$seriesId:") }.maxByOrNull { it.updated }
    }

    fun progressList(): List<Progress> = synchronized(lock) {
        progress.values.filter { it.position > 30_000 }.sortedByDescending { it.updated }.take(30)
    }

    /**
     * Guarda la posición. Se envía al panel como máximo cada 30 s por título salvo con force
     * (pausa, salida del reproductor). Al 95 % se borra, igual que la web.
     */
    fun saveProgress(p: Progress, force: Boolean = false) {
        val parts = p.key.split(":")
        val isSeries = parts[0] == "series"
        val done = p.duration > 0 && p.position >= p.duration * 0.95
        val now = System.currentTimeMillis()
        val send = synchronized(lock) {
            // otra entrada de la misma película/serie con otro título: se reemplaza
            val stale = progress.values.filter { it.title != p.title && sameMedia(it.key, p.key) }.map { it.title }
            stale.forEach { progress.remove(it); deleteRemote(it) }
            progress.remove(p.title)
            if (!done) progress[p.title] = p.copy(updated = now)
            val go = done || force || now - (lastSent[p.title] ?: 0L) >= 30_000
            if (go) lastSent[p.title] = now
            go
        }
        bump()
        if (!send) return
        if (done) { deleteRemote(p.title); return }
        val body = JSONObject()
            .put("action", "save").put("title", p.title)
            .put("position", p.position / 1000.0).put("duration", p.duration / 1000.0)
            .put("url", p.url).put("poster", p.poster)
            .put("type", if (isSeries) "episode" else "movie")
            .put("id", if (isSeries) parts.getOrElse(2) { "" } else parts.getOrElse(1) { "" })
            .put("seriesId", if (isSeries) parts.getOrElse(1) { "" } else "")
            .put("categoryId", p.categoryId)
        post(body)
    }

    private fun sameMedia(a: String, b: String): Boolean {
        val pa = a.split(":"); val pb = b.split(":")
        return pa.size >= 2 && pb.size >= 2 && pa[0] == pb[0] && pa[1] == pb[1]
    }

    private fun deleteRemote(title: String) = post(JSONObject().put("action", "delete").put("title", title))

    private fun post(body: JSONObject) {
        io.launch { call { t -> Net.postJson(api(), JSONObject(body.toString()).put("token", t)) } }
    }

    /* ---------- favoritos (Mi lista y canales favoritos) ---------- */

    fun isFav(key: String): Boolean = synchronized(lock) { favs.containsKey(key) }

    fun favList(kind: Kind? = null): List<Item> = synchronized(lock) { favs.values.filter { kind == null || it.kind == kind } }

    private fun typeOf(k: Kind) = when (k) { Kind.MOVIE -> "movie"; Kind.SERIES -> "series"; Kind.LIVE -> "live" }

    /** Agrega o quita; devuelve true si quedó en favoritos. */
    fun toggleFav(item: Item): Boolean {
        val on = synchronized(lock) {
            if (favs.containsKey(item.key)) {
                favs.remove(item.key)
                false
            } else {
                val copy = LinkedHashMap<String, Item>()
                copy[item.key] = item
                copy.putAll(favs)
                favs.clear(); favs.putAll(copy)
                true
            }
        }
        bump()
        val body = if (on) {
            JSONObject().put("action", "fav_add").put("item", JSONObject()
                .put("id", item.id.toString()).put("type", typeOf(item.kind)).put("title", item.name)
                .put("poster", item.poster).put("categoryId", item.categoryId))
        } else {
            JSONObject().put("action", "fav_remove").put("id", item.id.toString()).put("type", typeOf(item.kind))
        }
        post(body)
        return on
    }
}
