package com.latmpx.player.data

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.coroutines.coroutineContext

/**
 * Descargas para ver sin internet (solo celular). Todo queda dentro de la app: los archivos van a su
 * carpeta privada (filesDir/downloads, nadie más los ve ni se pueden abrir desde fuera) y la dirección
 * del servidor nunca se muestra. Una descarga a la vez; si la conexión se corta se reanuda donde iba
 * (Range) y al abrir la app sigue lo que quedó pendiente. DownloadService mantiene la descarga con la
 * app en segundo plano (notificación con el progreso).
 */
object Downloads {
    enum class State { QUEUED, RUNNING, DONE, FAILED }

    /** kind: MOVIE (película) o SERIES (episodio de seriesId) */
    data class Entry(
        val key: String, val kind: Kind, val id: Int, val title: String, val ext: String,
        val url: String, val posterUrl: String, val poster: String = "",
        val seriesId: Int = 0, val seriesName: String = "", val seriesPosterUrl: String = "", val seriesPoster: String = "",
        val season: Int = 0, val episode: Int = 0,
        val file: String, val size: Long = 0, val total: Long = 0,
        val state: State = State.QUEUED, val error: String = "",
        val position: Long = 0, val duration: Long = 0, val added: Long = System.currentTimeMillis(),
    ) {
        val percent: Int get() = if (total > 0) ((size * 100) / total).toInt().coerceIn(0, 100) else 0
    }

    /** cambia con cada novedad: las pantallas lo leen para redibujarse */
    var rev by mutableIntStateOf(0)
        private set

    private lateinit var app: Context
    private lateinit var dir: File
    private val list = ArrayList<Entry>()
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    /** la descarga en curso (borrarla la cancela sin parar la cola) */
    @Volatile private var running: Job? = null
    private var lastSaved = 0L
    @Volatile private var current: String? = null

    fun init(ctx: Context) {
        app = ctx.applicationContext
        dir = File(app.filesDir, "downloads").apply { mkdirs() }
        load()
        // lo que se estaba bajando cuando se cerró la app sigue al abrirla
        synchronized(lock) { for (i in list.indices) if (list[i].state == State.RUNNING) list[i] = list[i].copy(state = State.QUEUED) }
        if (synchronized(lock) { list.any { it.state == State.QUEUED } }) pump()
    }

    /* ---------- consulta ---------- */

    fun all(): List<Entry> = synchronized(lock) { list.toList() }
    fun get(key: String): Entry? = synchronized(lock) { list.firstOrNull { it.key == key } }
    fun movies(): List<Entry> = all().filter { it.kind == Kind.MOVIE }.sortedByDescending { it.added }
    fun episodes(seriesId: Int): List<Entry> = all().filter { it.kind == Kind.SERIES && it.seriesId == seriesId }.sortedWith(compareBy({ it.season }, { it.episode }))
    /** series con algún episodio descargado o bajando: (primer episodio para el nombre y la carátula, cantidad) */
    fun series(): List<Pair<Entry, Int>> = all().filter { it.kind == Kind.SERIES }.groupBy { it.seriesId }
        .map { (_, eps) -> eps.maxBy { it.added } to eps.size }.sortedByDescending { it.first.added }

    fun file(e: Entry): File = File(dir, e.file)

    /* ---------- agregar / borrar ---------- */

    private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9_-]"), "_")

    /** ext que se puede guardar como archivo (HLS .m3u8 no es un solo archivo) */
    fun canDownload(ext: String) = ext.isBlank() || !ext.equals("m3u8", true)

    fun addMovie(s: Session, item: Item, ext: String) {
        val e = ext.ifBlank { item.ext }.ifBlank { "mp4" }
        add(Entry(key = "movie:${item.id}", kind = Kind.MOVIE, id = item.id, title = item.name, ext = e, url = Xtream.movieUrl(s, item.id, e),
            posterUrl = item.poster, file = safe("movie_${item.id}") + "." + safe(e)))
    }

    fun addEpisode(s: Session, series: Item, ep: Episode) {
        val e = ep.ext.ifBlank { "mp4" }
        add(Entry(key = "series:${series.id}:${ep.id}", kind = Kind.SERIES, id = ep.id,
            title = ep.title.ifBlank { "Episodio ${ep.num}" }, ext = e, url = Xtream.episodeUrl(s, ep.id, e),
            posterUrl = ep.image.ifBlank { series.poster }, seriesId = series.id, seriesName = series.name, seriesPosterUrl = series.poster,
            season = ep.season, episode = ep.num, file = safe("ep_${series.id}_${ep.id}") + "." + safe(e)))
    }

    private fun add(e: Entry) {
        synchronized(lock) {
            val old = list.indexOfFirst { it.key == e.key }
            if (old >= 0) {
                // ya existe: si falló se vuelve a intentar, si no, nada
                if (list[old].state != State.FAILED) return
                list[old] = list[old].copy(state = State.QUEUED, error = "", url = e.url)
            } else list.add(e)
        }
        changed(save = true)
        pump()
    }

    /** quita la descarga y su archivo (también la que se está bajando) */
    fun delete(key: String) {
        val e = synchronized(lock) { list.firstOrNull { it.key == key }?.also { list.remove(it) } } ?: return
        if (current == key) running?.cancel()
        File(dir, e.file).delete(); File(dir, e.file + ".part").delete()
        if (e.poster.isNotEmpty()) File(e.poster).delete()
        // la carátula de la serie se borra con su último episodio
        if (e.kind == Kind.SERIES && e.seriesPoster.isNotEmpty() && all().none { it.seriesId == e.seriesId }) File(e.seriesPoster).delete()
        changed(save = true)
    }

    /** una descarga que falló se vuelve a poner en la cola (sigue donde se quedó) */
    fun retry(key: String) {
        synchronized(lock) {
            val i = list.indexOfFirst { it.key == key }
            if (i < 0 || list[i].state != State.FAILED) return
            list[i] = list[i].copy(state = State.QUEUED, error = "")
        }
        changed(save = true)
        pump()
    }

    fun deleteSeries(seriesId: Int) = all().filter { it.kind == Kind.SERIES && it.seriesId == seriesId }.forEach { delete(it.key) }

    /** donde se dejó (para seguir viendo sin internet) */
    fun savePosition(key: String, pos: Long, dur: Long) {
        synchronized(lock) {
            val i = list.indexOfFirst { it.key == key }
            if (i < 0) return
            list[i] = list[i].copy(position = pos, duration = dur)
        }
        changed(save = true)
    }

    /* ---------- motor ---------- */

    private fun pump() {
        if (job?.isActive == true) return
        job = scope.launch {
            DownloadService.start(app)
            try {
                while (true) {
                    val e = synchronized(lock) { list.firstOrNull { it.state == State.QUEUED } } ?: break
                    val j = launch { run(e) }
                    running = j
                    j.join()
                    running = null
                }
            } finally {
                current = null
                DownloadService.stop(app)
            }
        }
    }

    private suspend fun run(e: Entry) {
        current = e.key
        update(e.key) { it.copy(state = State.RUNNING, error = "") }
        try {
            posters(e)
            var tries = 0
            while (true) {
                try {
                    transfer(e)
                    break
                } catch (x: IOException) {
                    // corte de conexión: se reanuda donde iba (hasta 6 veces, cada vez esperando un poco más)
                    if (++tries >= 6 || x is NoSpace) throw x
                    delay(3_000L * tries)
                }
            }
            update(e.key) { it.copy(state = State.DONE, size = File(dir, it.file).length(), total = File(dir, it.file).length()) }
        } catch (x: kotlinx.coroutines.CancellationException) {
            throw x
        } catch (x: Exception) {
            update(e.key) { it.copy(state = State.FAILED, error = x.message ?: "No se pudo descargar") }
            ErrorReport.report("error", "Descarga fallida", "${e.kind} ${e.id} · ${x.message}")
        } finally {
            if (current == e.key) current = null
        }
    }

    private class NoSpace : IOException("No hay espacio suficiente en el equipo")

    private suspend fun transfer(e: Entry) {
        val part = File(dir, e.file + ".part")
        var have = if (part.exists()) part.length() else 0L
        val req = Request.Builder().url(e.url).apply { if (have > 0) header("Range", "bytes=$have-") }.build()
        Net.client.newCall(req).execute().use { r ->
            if (r.code == 416 && have > 0) { part.renameTo(File(dir, e.file)); return } // ya estaba completo
            if (!r.isSuccessful) throw IOException(if (r.code == 401 || r.code == 403) "El servidor no permitió la descarga (${r.code})" else "Error del servidor (${r.code})")
            val body = r.body ?: throw IOException("El servidor no envió el archivo")
            val append = r.code == 206 && have > 0
            if (!append) have = 0
            val len = body.contentLength()
            val total = if (len > 0) have + len else 0L
            if (len > 0 && dir.usableSpace < len + 200L * 1024 * 1024) throw NoSpace()
            update(e.key) { it.copy(size = have, total = total) }
            FileOutputStream(part, append).use { out ->
                body.byteStream().use { inp ->
                    val buf = ByteArray(256 * 1024)
                    var last = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        have += n
                        val now = System.currentTimeMillis()
                        if (now - last > 700) {
                            last = now
                            val h = have
                            update(e.key, save = false) { it.copy(size = h) }
                        }
                    }
                }
            }
            if (total > 0 && have < total) throw IOException("La descarga se cortó")
        }
        if (!part.renameTo(File(dir, e.file))) throw IOException("No se pudo guardar el archivo")
    }

    /** carátulas guardadas en el equipo (sin internet no se pueden pedir) */
    private fun posters(e: Entry) {
        fun fetch(url: String, name: String): String {
            if (url.isBlank()) return ""
            val f = File(dir, name)
            if (f.exists() && f.length() > 0) return f.absolutePath
            return runCatching {
                Net.imageClient.newCall(Request.Builder().url(url).build()).execute().use { r ->
                    if (!r.isSuccessful) return@use ""
                    r.body?.byteStream()?.use { inp -> FileOutputStream(f).use { inp.copyTo(it) } }
                    if (f.length() > 0) f.absolutePath else ""
                }
            }.getOrDefault("")
        }
        val p = fetch(e.posterUrl, safe("img_" + e.key) + ".jpg")
        val sp = if (e.kind == Kind.SERIES) fetch(e.seriesPosterUrl, "series_${e.seriesId}.jpg") else ""
        update(e.key) { it.copy(poster = p, seriesPoster = sp) }
    }

    /* ---------- estado ---------- */

    private fun update(key: String, save: Boolean = true, f: (Entry) -> Entry) {
        synchronized(lock) {
            val i = list.indexOfFirst { it.key == key }
            if (i < 0) return
            list[i] = f(list[i])
        }
        changed(save)
        DownloadService.progress(app)
    }

    private fun changed(save: Boolean) {
        val now = System.currentTimeMillis()
        if (save || now - lastSaved > 5_000) { lastSaved = now; persist() }
        main.post { rev++ }
    }

    private fun index() = File(dir, "index.json")

    private fun persist() {
        val arr = JSONArray()
        all().forEach { e ->
            arr.put(JSONObject().apply {
                put("key", e.key); put("kind", e.kind.name); put("id", e.id); put("title", e.title); put("ext", e.ext)
                put("url", e.url); put("posterUrl", e.posterUrl); put("poster", e.poster)
                put("seriesId", e.seriesId); put("seriesName", e.seriesName); put("seriesPosterUrl", e.seriesPosterUrl); put("seriesPoster", e.seriesPoster)
                put("season", e.season); put("episode", e.episode); put("file", e.file); put("size", e.size); put("total", e.total)
                put("state", e.state.name); put("error", e.error); put("position", e.position); put("duration", e.duration); put("added", e.added)
            })
        }
        runCatching {
            val tmp = File(dir, "index.json.tmp")
            tmp.writeText(arr.toString())
            tmp.renameTo(index())
        }
    }

    private fun load() {
        val arr = runCatching { JSONArray(index().readText()) }.getOrNull() ?: return
        synchronized(lock) {
            list.clear()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val e = runCatching {
                    Entry(
                        key = o.getString("key"), kind = Kind.valueOf(o.getString("kind")), id = o.optInt("id"), title = o.optString("title"),
                        ext = o.optString("ext"), url = o.optString("url"), posterUrl = o.optString("posterUrl"), poster = o.optString("poster"),
                        seriesId = o.optInt("seriesId"), seriesName = o.optString("seriesName"), seriesPosterUrl = o.optString("seriesPosterUrl"),
                        seriesPoster = o.optString("seriesPoster"), season = o.optInt("season"), episode = o.optInt("episode"),
                        file = o.getString("file"), size = o.optLong("size"), total = o.optLong("total"),
                        state = runCatching { State.valueOf(o.optString("state")) }.getOrDefault(State.FAILED), error = o.optString("error"),
                        position = o.optLong("position"), duration = o.optLong("duration"), added = o.optLong("added"),
                    )
                }.getOrNull() ?: continue
                // un archivo terminado que ya no está (borrado por el sistema) no se muestra
                if (e.state == State.DONE && !File(dir, e.file).exists()) continue
                list.add(e)
            }
        }
    }
}
