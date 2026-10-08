package com.latmpx.player.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Aviso del panel al abrir la app (Alertas / admin_alertas.php → api/alerta.php?format=json):
 *  - bienvenida: texto general + imagen opcional (más de 3 días, sin fecha o sin respuesta del servidor IPTV)
 *  - vencimiento: texto del día (3, 2, 1) o el de 0 días si ya venció; sin imagen
 * Se muestra una vez cada vez que se abre la app (y otra vez tras iniciar sesión).
 */
object Alerts {
    data class Alert(val expiry: Boolean, val title: String, val message: String, val image: String, val button: String)

    /** línea a la que ya se le mostró el aviso en este arranque de la app */
    private var shownFor: String? = null

    fun reset() { shownFor = null }

    /** Aviso para la sesión, o null si ya se mostró en este arranque o el panel no respondió. */
    suspend fun forLaunch(s: Session): Alert? {
        val key = "${s.user}@${s.base}"
        if (shownFor == key) return null
        val url = PanelUrl.api("alerta.php").toHttpUrlOrNull()?.newBuilder()
            ?.addQueryParameter("format", "json")
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
        return Alert(type == "expiry", j.s("title"), j.s("message"), image, j.s("button").ifEmpty { "Entendido" })
    }
}
