package com.latmpx.player.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.util.concurrent.ConcurrentHashMap

/**
 * Carátula garantizada: si el servidor IPTV no trae póster (o el enlace está roto),
 * se busca en TMDB con la llave del panel y se recuerda en el equipo.
 */
object Posters {
    private val mem = ConcurrentHashMap<String, String>()
    private val gate = Semaphore(4) // pocas búsquedas a la vez para no saturar TMDB
    private var prefs: SharedPreferences? = null

    fun init(ctx: Context) { prefs = ctx.getSharedPreferences("posters", Context.MODE_PRIVATE) }

    /** borrado de caché remoto: se olvidan las carátulas encontradas en TMDB */
    fun clear() { mem.clear(); prefs?.edit()?.clear()?.commit() }

    private fun keyOf(item: Item) = item.kind.name + "|" + item.name.lowercase()

    /** póster ya conocido (sin red) o null */
    fun cached(item: Item): String? = mem[keyOf(item)] ?: prefs?.getString(keyOf(item), null)?.also { mem[keyOf(item)] = it }

    suspend fun resolve(item: Item): String {
        if (item.kind == Kind.LIVE) return ""
        cached(item)?.let { return it }
        val k = keyOf(item)
        return gate.withPermit {
            mem[k]?.let { return@withPermit it }
            val url = runCatching { Tmdb.findPoster(if (item.kind == Kind.SERIES) "tv" else "movie", item.name, item.year) }.getOrNull()
                ?: return@withPermit "" // sin respuesta de TMDB: no se recuerda, se intenta de nuevo más tarde
            mem[k] = url
            if (url.isNotEmpty()) prefs?.edit()?.putString(k, url)?.apply()
            url
        }
    }

    /**
     * Enlace de imagen tal como lo usa la web (wp_img): vacío si no es http(s) o es el marcador
     * de TMDB sin archivo que mandan muchos servidores; espacios y acentos codificados.
     */
    fun clean(raw: String): String {
        val u = raw.trim()
        if (u.isEmpty() || !(u.startsWith("http://", true) || u.startsWith("https://", true))) return ""
        val tail = u.substringAfter("image.tmdb.org/t/p/", "x/x")
        if (!tail.contains('/') || tail.endsWith("/")) return "" // ".../t/p/w600_and_h900_bestv2" sin póster
        if (u.all { it.code in 0x21..0x7e }) return u
        return Regex("[^\\x21-\\x7e]+").replace(u) { m -> java.net.URLEncoder.encode(m.value, "UTF-8").replace("+", "%20") }
    }
}
