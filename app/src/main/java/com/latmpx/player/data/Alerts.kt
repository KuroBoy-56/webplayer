package com.latmpx.player.data

import com.latmpx.player.tr
import com.latmpx.player.R
import com.latmpx.player.Lang
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Aviso del panel al abrir la app (Alertas / admin_alertas.php → api/alerta.php?format=json):
 *  - bienvenida: texto general + imagen opcional (más de 3 días, sin fecha o sin respuesta del servidor IPTV)
 *  - vencimiento: texto del día (3, 2, 1) o el de 0 días si ya venció; sin imagen
 * Se muestra una vez cada vez que se abre la app (y otra vez tras iniciar sesión).
 */
object Alerts {
    /** [images]: todas las imágenes de Alertas del panel, en orden (la primera es [image]); cambian cada [interval] s */
    data class Alert(
        val expiry: Boolean, val title: String, val message: String, val image: String, val button: String,
        val images: List<String> = listOfNotNull(image.takeIf { it.isNotEmpty() }), val interval: Int = 3,
    )

    /** línea a la que ya se le mostró el aviso en este arranque de la app */
    private var shownFor: String? = null

    fun reset() { shownFor = null }

    /** Aviso para la sesión, o null si ya se mostró en este arranque o el panel no respondió. */
    suspend fun forLaunch(s: Session): Alert? {
        val key = "${s.user}@${s.base}"
        if (shownFor == key) return null
        // el distribuidor desactivó los avisos
        if (!Tenant.alertsEnabled) return null
        val url = PanelUrl.api("alerta.php").toHttpUrlOrNull()?.newBuilder()
            ?.let { Tenant.tag(it) } // ?t=<número>&app=<app>: textos del distribuidor (nada con Omitir)
            ?.addQueryParameter("format", "json")
            ?.addQueryParameter("lang", Lang.current) // título y botón del aviso en el idioma de la app
            ?.addQueryParameter("user", s.user)
            ?.addQueryParameter("pass", s.pass)
            ?.addQueryParameter("dns", s.base)
            ?.addQueryParameter("title", s.dnsName)
            ?.build()?.toString() ?: return null
        val j = Net.get(url).takeIf { it.ok }?.json() ?: return null
        val type = j.s("type")
        if (type != "welcome" && type != "expiry") return null
        shownFor = key
        val path = j.s("image_path")
        val image = when {
            type != "welcome" -> ""
            path.matches(Regex("img/alertas/[A-Za-z0-9._-]+")) -> PanelUrl.apiBase.removeSuffix("api/") + path
            else -> j.s("image").takeIf { it.startsWith("http") }.orEmpty()
        }
        // todas las imágenes del registro del panel (Alertas), en orden; sin la lista (panel anterior), la de siempre
        val list = if (type != "welcome") emptyList() else j.optJSONArray("images")
            ?.let { a -> (0 until a.length()).map { a.optString(it).trim() }.filter { it.startsWith("http") } }.orEmpty()
        val images = list.ifEmpty { listOfNotNull(image.takeIf { it.isNotEmpty() }) }
        val interval = j.optInt("interval", 3).takeIf { it >= 1 } ?: 3
        return Alert(type == "expiry", j.s("title"), j.s("message"), images.firstOrNull().orEmpty(), j.s("button").ifEmpty { tr(R.string.got_it) }, images, interval)
    }
}
