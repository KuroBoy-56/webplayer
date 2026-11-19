package com.latmpx.player.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.latmpx.player.Lang
import com.latmpx.player.R
import com.latmpx.player.tr
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Perfiles como Netflix (docs/PERFILES.md del panel): api/profiles.php y el perfil elegido. Cada llamada a
 * api/progress.php lleva «profile» con el elegido (Cloud.kt); sin perfil elegido todo va al principal, como siempre.
 * El PIN nunca se guarda en el equipo: se comprueba en el panel (pin_check) cada vez.
 */
object Profiles {
    data class Profile(val id: String, val name: String, val avatar: String, val locked: Boolean, val main: Boolean, val kids: Boolean)

    data class State(val enabled: Boolean, val max: Int, val profiles: List<Profile>, val canCreate: Boolean, val avatars: List<String>)

    sealed class Result {
        data class Ok(val state: State) : Result()
        data class Fail(val message: String, val code: String) : Result()
    }

    /** fondo de la pantalla de perfiles: lo más destacado de la semana en TMDB (solo nombre y calificación) */
    data class Featured(val image: String, val name: String, val rating: String)

    /** perfil elegido (null = sin perfiles: todo va al principal) */
    var current by mutableStateOf<Profile?>(null)
        private set

    /** sube cuando el panel contesta 410 (el perfil elegido ya no existe): la interfaz vuelve a la pantalla de perfiles */
    var gone by mutableIntStateOf(0)
        private set

    /** «profile» para api/progress.php ("" = el principal, no se manda) */
    fun param(): String = current?.id?.takeIf { it.isNotEmpty() && it != "main" }.orEmpty()

    /** ¿el perfil elegido es infantil? (el principal nunca lo es) */
    val kids: Boolean get() = current?.let { it.kids && !it.main && it.id != "main" } == true

    fun choose(p: Profile?) {
        current = p
        if (p != null) Store.lastProfile = p.id
    }

    /** 410 de progress.php para el perfil «sent» (solo si sigue siendo el de ahora: no un envío viejo) */
    internal fun onGone(sent: String) {
        if (sent.isEmpty() || sent != param()) return
        android.os.Handler(android.os.Looper.getMainLooper()).post { gone++ }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun url() = PanelUrl.api("profiles.php")

    /** la lista (max = las conexiones de la línea que ya se saben por player_api.php) */
    suspend fun load(max: Int): Result {
        val r = Cloud.call { t -> Net.get(url() + "?token=" + enc(t) + "&lang=" + enc(Lang.current) + (if (max > 0) "&max=$max" else "")) }
        return parse(r)
    }

    /** create, update, delete, pin_set, pin_clear, pin_check, pin_reset (sección 3 de docs/PERFILES.md) */
    suspend fun act(action: String, fields: JSONObject = JSONObject()): Result {
        val r = Cloud.call { t ->
            Net.postJson(url(), JSONObject(fields.toString()).put("action", action).put("lang", Lang.current).put("token", t))
        }
        return parse(r)
    }

    private fun parse(r: Net.Resp?): Result {
        val j = r?.json() ?: return Result.Fail(tr(R.string.prof_no_panel), "")
        if (!j.optBoolean("success", false)) {
            return Result.Fail(j.optString("error").ifEmpty { tr(R.string.prof_failed) }, j.optString("code"))
        }
        val list = ArrayList<Profile>()
        j.optJSONArray("profiles")?.let { a ->
            for (i in 0 until a.length()) {
                val o = a.optJSONObject(i) ?: continue
                val id = o.optString("id")
                if (id.isNotEmpty()) list += Profile(id, o.optString("name"), o.optString("avatar"), o.optBoolean("locked"), o.optBoolean("main"), o.optBoolean("kids"))
            }
        }
        val avatars = ArrayList<String>()
        j.optJSONArray("avatars")?.let { a -> for (i in 0 until a.length()) a.optString(i).takeIf { it.isNotEmpty() }?.let { avatars += it } }
        // reglas del perfil infantil (solo llegan si algún perfil es infantil): las mismas en todas las apps
        j.optJSONObject("kidsRules")?.let { Kids.saveRules(it) }
        return Result.Ok(State(j.optBoolean("enabled"), j.optInt("max"), list, j.optBoolean("canCreate"), avatars))
    }

    private var featCache: Triple<String, Long, List<Featured>>? = null

    /**
     * Fondo de «¿Quién está viendo?» (docs/PERFILES.md del panel, sección 6): lo más destacado de la semana en TMDB
     * (trending de películas y series por api/tmdb.php del panel, con la clave del distribuidor), 15 a 20 títulos con
     * fondo: página 1 y, si no llegan a 15, la 2. ProfileBackdrops pasa de uno a otro cada 10 s y vuelve al primero.
     * 6 h en memoria por idioma y distribuidor.
     */
    suspend fun featuredList(): List<Featured> {
        val key = Lang.tmdb + "|" + Tenant.code
        featCache?.let { (k, at, l) -> if (k == key && System.currentTimeMillis() - at < 6 * 3600_000L) return l }
        val out = ArrayList<Featured>()
        val seen = HashSet<String>()
        var ok = false
        for (page in 1..2) {
            if (out.size >= 15) break
            val b = PanelUrl.api("tmdb.php").toHttpUrlOrNull()?.newBuilder() ?: break
            b.addQueryParameter("path", "trending/all/week")
            Tenant.tag(b)
            b.addQueryParameter("language", Lang.tmdb)
            b.addQueryParameter("page", page.toString())
            val r = Net.get(b.build().toString())
            val j = (if (r.ok) r.json() else null) ?: break
            val arr = j.optJSONArray("results") ?: break
            ok = true
            for (i in 0 until arr.length()) {
                if (out.size >= 20) break
                val o = arr.optJSONObject(i) ?: continue
                val bd = o.optString("backdrop_path")
                val kind = o.optString("media_type")
                if (bd.isEmpty() || bd == "null" || (kind != "movie" && kind != "tv")) continue
                val name = o.optString("title").ifEmpty { o.optString("name") }
                if (name.isEmpty() || !seen.add(kind + ":" + o.optString("id"))) continue
                val v = o.optDouble("vote_average", 0.0)
                out += Featured("https://image.tmdb.org/t/p/original$bd", name, if (v > 0) String.format(java.util.Locale.US, "%.1f", v) else "")
            }
        }
        if (ok) featCache = Triple(key, System.currentTimeMillis(), out)
        return out
    }
}
