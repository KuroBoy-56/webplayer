package com.latmpx.player.player

import com.latmpx.player.data.Net
import com.latmpx.player.data.Xtream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request

/**
 * Qué entrega de verdad el servidor cuando el reproductor dice que no puede leer el archivo («None of the available
 * extractors could read the stream»): se piden los primeros 4 KB, como lo haría el reproductor. XUI.one contesta muchas
 * veces 200 con una página (vacía mientras todavía cuenta la conexión anterior, o con el motivo: EXPIRED, MAX_CONNECTIONS…)
 * en lugar del video, y ningún reproductor la puede abrir. Igual que StreamProbe de iOS y src/lib/xui.ts de Vega.
 */
object StreamProbe {
    data class Result(
        val code: Int,
        val type: String,
        val size: Int,
        /** comienzo de lo que llegó (texto), para el reporte del panel */
        val head: String,
        /** código del motivo de XUI («EXPIRED», «MAX_CONNECTIONS»…) o null */
        val xui: String?,
        /** llegó un contenedor de video (MP4, MKV, TS, AVI, FLV): el problema es el formato, no el servidor */
        val video: Boolean,
    ) {
        fun describe(): String = "servidor=$code tipo=${type.ifEmpty { "?" }} bytes=$size" + (xui?.let { " xui=$it" } ?: "") +
            (if (video) " video=sí" else "") + (if (head.isNotEmpty()) " inicio=«$head»" else "")
    }

    /** motivos de XUI que pasan solos (la conexión anterior todavía cuenta): vale la pena esperar y volver a pedir */
    fun transient(code: String?): Boolean = code == null || Regex("CONNECT|LIMIT|FLOOD|SESSION").containsMatchIn(code)

    suspend fun check(url: String): Result? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url(url).header("User-Agent", Net.UA).header("Range", "bytes=0-4095").build()
            Net.client.newCall(req).execute().use { r ->
                val buf = ByteArray(4096)
                var n = 0
                r.body?.byteStream()?.use { s ->
                    while (n < buf.size) {
                        val k = s.read(buf, n, buf.size - n)
                        if (k <= 0) break
                        n += k
                    }
                }
                val b = buf.copyOf(n)
                val text = String(b, Charsets.ISO_8859_1)
                Result(
                    code = r.code,
                    type = r.header("Content-Type").orEmpty(),
                    size = n,
                    head = text.replace(Regex("<[^>]+>"), " ").replace(Regex("[^\\x20-\\x7E]+"), " ").replace(Regex("\\s+"), " ").trim().take(80),
                    xui = if (Regex("<html|<!doctype|XUI", RegexOption.IGNORE_CASE).containsMatchIn(text)) Xtream.xuiError(text) else null,
                    video = isVideo(b),
                )
            }
        }.getOrNull()
    }

    private fun isVideo(b: ByteArray): Boolean {
        if (b.size < 12) return false
        fun at(i: Int, s: String) = s.indices.all { j -> i + j < b.size && b[i + j] == s[j].code.toByte() }
        return at(4, "ftyp") || at(4, "moov") || at(4, "free") || at(4, "mdat") || // MP4 / MOV
            (b[0] == 0x1A.toByte() && b[1] == 0x45.toByte() && b[2] == 0xDF.toByte() && b[3] == 0xA3.toByte()) || // MKV / WebM
            (b[0] == 0x47.toByte() && (b.size < 189 || b[188] == 0x47.toByte())) || // MPEG-TS
            at(0, "RIFF") || at(0, "FLV")
    }
}
