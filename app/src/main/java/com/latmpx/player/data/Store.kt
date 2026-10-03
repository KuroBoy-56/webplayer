package com.latmpx.player.data

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** Datos guardados en el equipo: sesión, continuar viendo, mi lista e idioma preferido. */
object Store {
    private lateinit var p: SharedPreferences

    fun init(ctx: Context) { p = ctx.getSharedPreferences("latmpx", Context.MODE_PRIVATE) }

    /* ---------- panel ---------- */
    fun savePanel(json: String) = p.edit().putString("panel", json).apply()
    fun panel(): PanelConfig? = p.getString("panel", null)?.let { raw ->
        runCatching {
            val j = JSONObject(raw)
            PanelConfig(j.s("name").ifEmpty { "LatMpx" }, j.optJSONArray("dns").mapObj { o -> o.s("name") to o.s("url") }, j.s("logo"), j.s("message"), j.s("tmdb_key"))
        }.getOrNull()
    }

    /* ---------- sesión ---------- */
    fun saveSession(s: Session) = p.edit().putString("session", JSONObject().apply {
        put("dns", s.dnsName); put("base", s.base); put("user", s.user); put("pass", s.pass); put("exp", s.expires)
    }.toString()).apply()

    fun session(): Session? = p.getString("session", null)?.let { raw ->
        runCatching { JSONObject(raw).let { Session(it.s("dns"), it.s("base"), it.s("user"), it.s("pass"), it.s("exp")) } }.getOrNull()
    }

    fun logout() = p.edit().remove("session").apply()

    private fun scope(): String = session()?.let { "${it.user}@${it.base}" } ?: "-"

    /* ---------- continuar viendo ---------- */
    fun saveProgress(pr: Progress) {
        val all = progressMap()
        if (pr.duration > 0 && pr.position > pr.duration * 0.95) all.remove(pr.key) // terminado
        else all.put(pr.key, JSONObject().apply {
            put("title", pr.title); put("poster", pr.poster); put("pos", pr.position); put("dur", pr.duration)
            put("upd", pr.updated); put("url", pr.url); put("extra", pr.extra)
        })
        p.edit().putString("progress|" + scope(), all.toString()).apply()
    }

    private fun progressMap(): JSONObject = runCatching { JSONObject(p.getString("progress|" + scope(), "{}")!!) }.getOrDefault(JSONObject())

    fun progress(key: String): Progress? = progressMap().optJSONObject(key)?.let { toProgress(key, it) }

    fun progressList(): List<Progress> {
        val m = progressMap()
        return m.keys().asSequence().mapNotNull { k -> m.optJSONObject(k)?.let { toProgress(k, it) } }
            .filter { it.position > 30_000 }.sortedByDescending { it.updated }.take(30).toList()
    }

    private fun toProgress(k: String, o: JSONObject) = Progress(k, o.s("title"), o.s("poster"), o.optLong("pos"), o.optLong("dur"), o.optLong("upd"), o.s("url"), o.s("extra"))

    /* ---------- mi lista ---------- */
    fun isFav(key: String): Boolean = favs().has(key)

    fun toggleFav(item: Item): Boolean {
        val f = favs()
        val on = if (f.has(item.key)) { f.remove(item.key); false } else {
            f.put(item.key, JSONObject().apply { put("id", item.id); put("name", item.name); put("poster", item.poster); put("kind", item.kind.name); put("ext", item.ext); put("t", System.currentTimeMillis()) })
            true
        }
        p.edit().putString("favs|" + scope(), f.toString()).apply()
        return on
    }

    fun favList(): List<Item> {
        val f = favs()
        return f.keys().asSequence().mapNotNull { k -> f.optJSONObject(k) }.sortedByDescending { it.optLong("t") }.map { o ->
            Item(o.optInt("id"), o.s("name"), o.s("poster"), runCatching { Kind.valueOf(o.s("kind")) }.getOrDefault(Kind.MOVIE), ext = o.s("ext"))
        }.toList()
    }

    private fun favs(): JSONObject = runCatching { JSONObject(p.getString("favs|" + scope(), "{}")!!) }.getOrDefault(JSONObject())

    /* ---------- idioma de audio elegido a mano ---------- */
    var audioLang: String?
        get() = p.getString("audio_lang", null)
        set(v) = p.edit().putString("audio_lang", v).apply()

    var subLang: String?
        get() = p.getString("sub_lang", null)
        set(v) = p.edit().putString("sub_lang", v).apply()

    /* ---------- últimos canales ---------- */
    fun lastChannel(): Int = p.getInt("last_ch|" + scope(), 0)
    fun setLastChannel(id: Int) = p.edit().putInt("last_ch|" + scope(), id).apply()

    @Suppress("unused")
    private fun JSONArray.strings(): List<String> = (0 until length()).map { optString(it) }
}
