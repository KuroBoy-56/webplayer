package com.latmpx.player.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * Guía de respaldo del panel (api/epg.php) para canales sin get_short_epg.
 * Se pide en lotes (hasta 400 canales) igual que la web y se guarda en memoria.
 */
object PanelEpg {
    private const val MAX_BATCH = 400
    private val cache = java.util.concurrent.ConcurrentHashMap<Int, List<EpgEntry>>()
    @Volatile private var failedAt = 0L
    private val mutex = Mutex()
    /** una consulta al panel a la vez: las filas visibles piden juntas y las demás usan lo que ya llegó */
    private val fetching = Mutex()

    private fun current(list: List<EpgEntry>): List<EpgEntry> {
        val now = System.currentTimeMillis()
        return list.filter { it.end > now }.take(8)
    }

    /** Guía del canal; en la misma consulta se piden los canales vecinos que aún no se consultaron. */
    suspend fun guide(ch: Item, neighbors: List<Item>): List<EpgEntry> {
        mutex.withLock { cache[ch.id]?.let { return current(it) } }
        return fetching.withLock { load(ch, neighbors) }
    }

    /** guía ya descargada (sin red) o null */
    fun cached(id: Int): List<EpgEntry>? = cache[id]?.let { current(it) }

    private suspend fun load(ch: Item, neighbors: List<Item>): List<EpgEntry> {
        mutex.withLock { cache[ch.id]?.let { return current(it) } }
        // el panel no respondió hace poco: no se insiste con cada fila
        if (System.currentTimeMillis() - failedAt < 60_000) return emptyList()
        val pending = mutex.withLock { (listOf(ch) + neighbors).distinctBy { it.id }.filter { !cache.containsKey(it.id) }.take(MAX_BATCH) }
        val arr = JSONArray()
        pending.forEach { c -> arr.put(JSONObject().put("id", c.id.toString()).put("epg", c.epgId).put("name", c.name)) }
        val r = Cloud.call { t -> Net.postJson(PanelUrl.api("epg.php"), JSONObject().put("token", t).put("channels", arr)) }
        if (r == null || !r.ok) { failedAt = System.currentTimeMillis(); return emptyList() }
        val epg = r.json()?.optJSONObject("epg")
        mutex.withLock {
            pending.forEach { c ->
                cache[c.id] = epg?.optJSONArray(c.id.toString()).mapObj { e ->
                    val s = e.optLong("s") * 1000
                    val en = e.optLong("e") * 1000
                    if (s <= 0 || en <= 0) null else EpgEntry(e.s("t"), e.s("d"), s, en)
                }.sortedBy { it.start }
            }
            return current(cache[ch.id].orEmpty())
        }
    }

    fun clear() { cache.clear(); failedAt = 0L }
}
