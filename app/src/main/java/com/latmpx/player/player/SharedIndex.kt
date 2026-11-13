package com.latmpx.player.player

import android.net.Uri
import android.util.Base64
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Net
import com.latmpx.player.data.PanelUrl
import com.latmpx.player.data.s
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Índice compartido entre los equipos, como Roku y Vega (api/vidx.php del panel; se guarda en la VPS del dueño o en la
 * VDS propia del distribuidor, nunca en el hosting). En un MP4 con el índice (moov) al final, ExoPlayer lee el principio
 * del archivo, salta al moov (3-10 MB del servidor IPTV: 15-35 s con servidores lentos o líneas de una conexión) y
 * vuelve al principio del video. Si otro equipo ya dejó ese moov en la VPS / VDS, ExoPlayer lo recibe de ahí y al
 * servidor IPTV solo se le pide el video. Si no lo tiene, el moov que lee ExoPlayer se le deja (después de arrancar)
 * para los demás. Sin VPS / VDS el panel dice que no y todo sigue como antes. Solo películas y capítulos MP4.
 */
internal object SharedIndex {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val VOD = Regex("""/(movie|series)/[^/]+/[^/]+/\d+\.(mp4|m4v|mov)(\?|$)""", RegexOption.IGNORE_CASE)
    const val MAX = 12 * 1048576 // contenido del moov (16 MB en base64, el tope de la VPS / VDS)
    private const val PART = 1536000 // partes de la subida (la máquina acepta hasta 2 MB por parte)
    private const val WAIT_MS = 8000L // como Vega: leerlo del servidor IPTV son 15-35 s

    class Entry(val url: String) {
        val head = CountDownLatch(1)
        val body = CountDownLatch(1)
        @Volatile var up = ""          // enlace firmado de la máquina para bajarlo / subirlo
        @Volatile var size = 0L        // tamaño del archivo con que se guardó
        @Volatile var textLen = 0
        @Volatile var moov: ByteArray? = null
        @Volatile var missing = false  // la máquina contestó que no lo tiene: este equipo lo deja
        @Volatile var fileSize = 0L    // tamaño del archivo según el servidor IPTV
        @Volatile var sent = false
    }

    // los dos últimos videos (el moov pesa varios MB)
    private val entries = object : LinkedHashMap<String, Entry>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>?) = size > 2
    }

    /** la entrada del video (y la consulta al panel la primera vez); null si no es una película o capítulo MP4 */
    fun entry(url: String): Entry? {
        if (!VOD.containsMatchIn(url)) return null
        val k = url.substringAfter("://")
        synchronized(entries) {
            entries[k]?.let { return it }
            val e = Entry(url)
            entries[k] = e
            io.launch { fetch(e) }
            return e
        }
    }

    private fun b64u(s: String) = Base64.encodeToString(s.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun text(url: String, sec: Long): String? = runCatching {
        Net.client.newCall(Request.Builder().url(url).build()).apply { timeout().timeout(sec, TimeUnit.SECONDS) }
            .execute().use { r -> if (r.isSuccessful) r.body?.string() else null }
    }.getOrNull()

    private suspend fun fetch(e: Entry) {
        try {
            val r = withTimeoutOrNull(4000) {
                Cloud.call { t -> Net.get(PanelUrl.api("vidx.php") + "?token=" + URLEncoder.encode(t, "UTF-8") + "&u=" + b64u(e.url)) }
            }
            val j = r?.json()
            if (j == null || !j.optBoolean("ok", false)) return
            val head = j.s("head")
            e.up = j.s("url")
            if (head.isEmpty() || e.up.isEmpty()) return
            val h = text(head, 3)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
            if (!h.optBoolean("ok", false)) {
                // {"ok": false}: no lo tiene
                e.missing = h.has("ok")
                return
            }
            val len = h.optInt("len")
            if (h.s("kind") != "m" || len <= 0 || len > MAX / 3 * 4 + 4) return
            e.size = h.optLong("size")
            e.textLen = len
            e.head.countDown()
            val b = text(e.up, 25) ?: return
            val nl = b.indexOf('\n')
            val m = if (nl in 1..80) Regex("""^VIDX1 m (\d+) (\d+)$""").find(b.substring(0, nl)) else null
            if (m == null || m.groupValues[1].toLongOrNull() != e.size || m.groupValues[2].toIntOrNull() != b.length - nl - 1) return
            e.moov = runCatching { Base64.decode(b.substring(nl + 1), Base64.DEFAULT) }.getOrNull()?.takeIf { it.size >= 16 }
        } catch (_: Exception) {
            // sin índice: ExoPlayer lo lee del servidor como siempre
        } finally {
            e.head.countDown()
            e.body.countDown()
        }
    }

    /**
     * el moov guardado si [pos] es donde empieza en este archivo. Espera al panel y a la VPS / VDS como mucho 4 s para
     * saber si lo tienen (contestan en menos de 1 s) y [WAIT_MS] en total para bajarlo
     */
    fun moovAt(e: Entry, pos: Long): ByteArray? {
        // solo una lectura en los últimos MB del archivo puede ser el moov: las demás (adelantar, continuar) no esperan
        if (e.fileSize <= 0 || pos < e.fileSize - 8 - MAX) return null
        val t0 = System.currentTimeMillis()
        if (!e.head.await(4000, TimeUnit.MILLISECONDS)) return null
        if (e.size <= 0 || !MoovIndex.near(pos, e.size, e.textLen)) return null
        val left = WAIT_MS - (System.currentTimeMillis() - t0)
        if (left <= 0 || !e.body.await(left, TimeUnit.MILLISECONDS)) return null
        val m = e.moov ?: return null
        // otro tamaño en el servidor (el archivo cambió): no sirve, y este equipo deja el índice nuevo
        if (e.fileSize != e.size) {
            if (e.fileSize > 0) { e.moov = null; e.missing = true }
            return null
        }
        return m.takeIf { pos == MoovIndex.at(e.size, it.size) }
    }

    /** tamaño del archivo según la respuesta del servidor IPTV (Content-Range, o el largo pedido desde el principio) */
    fun learnSize(e: Entry, pos: Long, n: Long, headers: Map<String, List<String>>) {
        val cr = headers.entries.firstOrNull { it.key.equals("Content-Range", true) }?.value?.firstOrNull()
        val s = cr?.substringAfterLast('/')?.trim()?.toLongOrNull() ?: if (pos == 0L && n > 0) n else 0L
        if (s > 0) e.fileSize = s
    }

    fun wantsCopy(e: Entry) = e.missing && !e.sent && e.up.isNotEmpty()

    /** el moov leído del servidor IPTV, a la VPS / VDS: una vez, de a partes y después de que el video ya empezó */
    fun share(e: Entry, body: ByteArray) {
        if (e.sent || e.fileSize <= 0) return
        e.sent = true
        val size = e.fileSize
        io.launch {
            delay(8000)
            val text = Base64.encodeToString(body, Base64.NO_WRAP)
            val n = (text.length + PART - 1) / PART
            if (n > 12) return@launch
            for (i in 0 until n) {
                val part = JSONObject().put("kind", "m").put("size", size).put("len", text.length).put("i", i).put("n", n)
                    .put("part", text.substring(i * PART, minOf(text.length, (i + 1) * PART)))
                val j = Net.postJson(e.up, part).json()
                // no lo aceptó, o ya lo tiene (otro equipo lo dejó mientras tanto)
                if (j == null || !j.optBoolean("ok", false) || j.optBoolean("have", false) || j.optBoolean("saved", false)) return@launch
                delay(400)
            }
        }
    }
}

/** El lector HTTP de ExoPlayer con el índice compartido ([SharedIndex]) para películas y capítulos MP4. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class SharedIndexDataSource(private val up: DataSource) : DataSource {
    class Factory(private val up: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = SharedIndexDataSource(up.createDataSource())
    }

    private var moov: ByteArray? = null
    private var moovHead = ByteArray(0)
    private var moovUri: Uri? = null
    private var pos = 0L
    private var end = 0L
    private var copy: MoovCapture? = null
    private var copyOf: SharedIndex.Entry? = null

    override fun addTransferListener(transferListener: TransferListener) = up.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        val e = SharedIndex.entry(dataSpec.uri.toString())
        if (e != null && dataSpec.position > 0) SharedIndex.moovAt(e, dataSpec.position)?.let { m ->
            moov = m
            moovHead = MoovIndex.header(m.size)
            moovUri = dataSpec.uri
            pos = 0
            val total = m.size + 8L
            end = if (dataSpec.length == C.LENGTH_UNSET.toLong()) total else minOf(dataSpec.length, total)
            return end
        }
        val n = up.open(dataSpec)
        if (e != null) {
            SharedIndex.learnSize(e, dataSpec.position, n, up.responseHeaders)
            if (dataSpec.position > 0 && SharedIndex.wantsCopy(e)) { copy = MoovCapture(SharedIndex.MAX); copyOf = e }
        }
        return n
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        moov?.let { m ->
            if (pos >= end) return C.RESULT_END_OF_INPUT
            val k = MoovIndex.read(moovHead, m, pos, buffer, offset, minOf(length.toLong(), end - pos).toInt())
            pos += k
            return k
        }
        val n = up.read(buffer, offset, length)
        val c = copy
        if (n > 0 && c != null) {
            c.feed(buffer, offset, n)?.let { body -> copyOf?.let { SharedIndex.share(it, body) } }
            if (c.dead) { copy = null; copyOf = null }
        }
        return n
    }

    override fun getUri(): Uri? = if (moov != null) moovUri else up.uri

    override fun getResponseHeaders(): Map<String, List<String>> = if (moov != null) emptyMap() else up.responseHeaders

    override fun close() {
        copy = null
        copyOf = null
        if (moov != null) { moov = null; moovUri = null; return }
        up.close()
    }
}
