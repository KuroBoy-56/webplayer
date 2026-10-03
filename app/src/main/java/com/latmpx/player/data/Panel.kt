package com.latmpx.player.data

import com.latmpx.player.BuildConfig

/**
 * Configuración que la app recibe del panel administrativo.
 *
 * Contrato provisional (se adaptará al panel real):
 *   GET {PANEL_URL}/app_config.php  →
 *   { "name": "LatMpx", "logo": "https://...", "message": "",
 *     "dns": [ { "name": "Servidor 1", "url": "http://dominio:8080" }, ... ] }
 *
 * La última configuración válida se guarda para que la app abra aunque el panel no responda.
 */
object Panel {
    suspend fun load(): PanelConfig? {
        val base = BuildConfig.PANEL_URL.trimEnd('/')
        val j = Net.obj("$base/app_config.php")
        if (j != null) {
            val dns = j.optJSONArray("dns").mapObj { o -> o.s("url").takeIf { it.isNotEmpty() }?.let { (o.s("name").ifEmpty { "Servidor" }) to it } }
            if (dns.isNotEmpty()) {
                val cfg = PanelConfig(j.s("name").ifEmpty { "LatMpx" }, dns, j.s("logo"), j.s("message"), j.s("tmdb_key"))
                Store.savePanel(j.toString())
                return cfg
            }
        }
        return Store.panel()
    }
}
