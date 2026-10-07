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

    private fun keyOf(item: Item) = item.kind.name + "|" + item.name.lowercase()

    /** póster ya conocido (sin red) o null */
    fun cached(item: Item): String? = mem[keyOf(item)] ?: prefs?.getString(keyOf(item), null)?.also { mem[keyOf(item)] = it }

    suspend fun resolve(item: Item): String {
        if (item.kind == Kind.LIVE) return ""
        cached(item)?.let { return it }
        val k = keyOf(item)
        return gate.withPermit {
            mem[k]?.let { return@withPermit it }
            val url = runCatching { Tmdb.findPoster(if (item.kind == Kind.SERIES) "tv" else "movie", item.name, item.year) }.getOrDefault("")
            mem[k] = url
            if (url.isNotEmpty()) prefs?.edit()?.putString(k, url)?.apply()
            url
        }
    }
}
