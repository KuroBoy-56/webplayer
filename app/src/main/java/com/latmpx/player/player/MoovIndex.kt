package com.latmpx.player.player

/**
 * Partes del índice compartido que no dependen de Android (ver [SharedIndex]). El índice guardado en la VPS / VDS es el
 * contenido del moov sin su cabecera (lo mismo que dejan Roku y Vega). ExoPlayer lo lee como una caja más del archivo:
 * cuando el moov es la última caja (lo normal cuando va al final), empieza en tamaño del archivo − 8 − su largo.
 */
internal object MoovIndex {
    /** dónde empieza el moov de [bodyLen] bytes si es la última caja del archivo */
    fun at(fileSize: Long, bodyLen: Int): Long = fileSize - 8 - bodyLen

    /** ¿[pos] puede ser el moov? Con solo el largo del texto base64 (antes de bajarlo): el relleno son 0 a 2 bytes */
    fun near(pos: Long, fileSize: Long, textLen: Int): Boolean = kotlin.math.abs(pos - at(fileSize, textLen / 4 * 3)) <= 2

    /** cabecera de 8 bytes de una caja moov con [bodyLen] bytes de contenido */
    fun header(bodyLen: Int): ByteArray {
        val n = bodyLen + 8
        return byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte(), 'm'.code.toByte(), 'o'.code.toByte(), 'o'.code.toByte(), 'v'.code.toByte())
    }

    /** copia a [dst] desde [pos] de cabecera + contenido (sin armar una copia entera de varios MB); bytes copiados */
    fun read(head: ByteArray, body: ByteArray, pos: Long, dst: ByteArray, off: Int, len: Int): Int {
        var p = pos
        var o = off
        var n = len
        if (p < 8 && n > 0) {
            val k = minOf(8 - p.toInt(), n)
            System.arraycopy(head, p.toInt(), dst, o, k)
            p += k; o += k; n -= k
        }
        if (n > 0) {
            val k = minOf(body.size - (p - 8).toInt(), n)
            if (k > 0) {
                System.arraycopy(body, (p - 8).toInt(), dst, o, k)
                o += k
            }
        }
        return o - off
    }
}

/**
 * Copia el moov que ExoPlayer lee del servidor IPTV: una lectura que empieza en una caja «moov» de hasta [max] bytes.
 * Devuelve su contenido (sin cabecera) la vez que se termina de leer; cualquier otra cosa la deja de mirar ([dead]).
 */
internal class MoovCapture(private val max: Int) {
    private val head = ByteArray(8)
    private var headLen = 0
    private var body: ByteArray? = null
    private var got = 0
    var dead = false
        private set

    fun feed(b: ByteArray, off: Int, len: Int): ByteArray? {
        if (dead) return null
        var o = off
        var n = len
        if (headLen < 8) {
            val k = minOf(8 - headLen, n)
            System.arraycopy(b, o, head, headLen, k)
            headLen += k; o += k; n -= k
            if (headLen < 8) return null
            val size = ((head[0].toLong() and 0xFF) shl 24) or ((head[1].toLong() and 0xFF) shl 16) or ((head[2].toLong() and 0xFF) shl 8) or (head[3].toLong() and 0xFF)
            val moov = head[4] == 'm'.code.toByte() && head[5] == 'o'.code.toByte() && head[6] == 'o'.code.toByte() && head[7] == 'v'.code.toByte()
            // (tamaño 0 = hasta el final y 1 = tamaño de 64 bits: no se copian)
            if (!moov || size < 16 || size - 8 > max) { dead = true; return null }
            body = ByteArray((size - 8).toInt())
        }
        val dst = body ?: return null
        val k = minOf(dst.size - got, n)
        System.arraycopy(b, o, dst, got, k)
        got += k
        if (got < dst.size) return null
        dead = true
        return dst
    }
}
