package com.latmpx.player.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import java.security.MessageDigest

/**
 * Carátulas y fondos por la caché del panel (igual que Roku, Vega y la web): una sola copia de cada imagen en el panel.
 * Orden de una carátula: la copia pública (api/imgc/<sha1>.jpg, la sirve el servidor web sin PHP) → api/img.php (la
 * achica la primera vez y, con el título, busca el póster en TMDB si el servidor IPTV no tiene) → la dirección original.
 * Fondos de TMDB en Full HD hechos por el panel (img.php w=1920). Si el dueño apaga la caché ("img": false de
 * progress.php ?v=2) todo va directo al servidor IPTV y a TMDB, sin pasar por el panel.
 */
object PanelImg {
    private var prefs: SharedPreferences? = null

    fun init(ctx: Context) { prefs = ctx.getSharedPreferences("panel_img", Context.MODE_PRIVATE) }

    /** el dueño tiene la caché de imágenes encendida (vale desde las próximas carátulas) */
    var on: Boolean
        get() = prefs?.getBoolean("on", true) ?: true
        set(v) { if (v != on) prefs?.edit()?.putBoolean("on", v)?.apply() }

    private fun b64u(s: String): String =
        Base64.encodeToString(s.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun sha1(s: String): String =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** "https://panel/api/" o "" (caché apagada o sin token del panel) */
    private fun base(): String = if (!on || Store.cloudToken.isNullOrEmpty()) "" else PanelUrl.apiBase

    private fun token(): String = java.net.URLEncoder.encode(Store.cloudToken.orEmpty(), "UTF-8")

    private val tmdbFile = Regex("image\\.tmdb\\.org/t/p/[^/]+/([A-Za-z0-9_\\-]+\\.(?:jpe?g|png|webp))", RegexOption.IGNORE_CASE)

    private fun isTmdb(u: String) = u.contains("image.tmdb.org/")

    /**
     * Nombre de la copia del panel (igual que img_key / img_idkey de api/img.php): con el id de TMDB
     * "500|tmdbid:<tipo>:<id>"; si no, la imagen sin http/https y con el servidor en minúsculas, y las de TMDB por su archivo.
     */
    private fun canonKey(poster: String, k: String, tm: String): String {
        if (tm.isNotEmpty()) return "500|tmdbid:$k:$tm"
        tmdbFile.find(poster)?.let { return "500|tmdb:" + it.groupValues[1] }
        val u = poster.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        val slash = u.indexOf('/')
        return "500|" + if (slash < 0) u.lowercase() else u.substring(0, slash).lowercase() + u.substring(slash)
    }

    /** direcciones de la carátula de un título, en orden (la tarjeta pasa a la siguiente si una no carga) */
    fun posterSources(item: Item): List<String> {
        val out = ArrayList<String>(3)
        val poster = item.poster
        val b = base()
        if (b.isNotEmpty() && item.kind != Kind.LIVE && !isTmdb(poster) && (poster.isNotEmpty() || item.name.isNotEmpty())) {
            val k = if (item.kind == Kind.SERIES) "series" else "vod"
            val y = item.year.takeIf { Regex("^(19|20)\\d\\d$").matches(it) }.orEmpty()
            val key = if (poster.isNotEmpty() || item.tm.isNotEmpty()) canonKey(poster, k, item.tm) else "500|n|$k|${item.name.trim()}|$y"
            // ?v=2: el panel vació la caché (los pósteres de TMDB de antes podían ser de otra película)
            out.add(b + "imgc/" + sha1(key) + ".jpg?v=2")
            val u = StringBuilder(b + "img.php?w=500&v=2&token=" + token())
            if (poster.isNotEmpty()) u.append("&u=").append(b64u(poster))
            u.append("&k=").append(k)
            if (item.name.isNotEmpty()) { u.append("&n=").append(b64u(item.name.trim())); if (y.isNotEmpty()) u.append("&y=").append(y) }
            if (item.tm.isNotEmpty()) u.append("&t=").append(item.tm)
            out.add(u.toString())
        }
        if (poster.isNotEmpty() && poster !in out) out.add(poster)
        return out
    }

    /** fondo: el de TMDB en Full HD hecho por el panel y, si falla, el de siempre */
    fun backdropSources(url: String): List<String> {
        if (url.isEmpty()) return emptyList()
        val b = base()
        if (b.isEmpty() || !isTmdb(url)) return listOf(url)
        val orig = url.replace(Regex("(image\\.tmdb\\.org/t/p/)[^/]+/"), "$1original/")
        return listOf(b + "img.php?w=1920&token=" + token() + "&u=" + b64u(orig), url)
    }
}
