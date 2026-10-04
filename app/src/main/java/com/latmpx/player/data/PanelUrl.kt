package com.latmpx.player.data

import android.util.Base64
import com.latmpx.player.BuildConfig

/**
 * Dirección del panel. No va en texto plano: XOR con "KURO" -> base64 -> hex.
 * Si se compila con panel.url (secreto PANEL_URL), esa dirección tiene prioridad.
 */
object PanelUrl {
    private const val ENC =
        "4979456d507a6876665741734e4341715053773850796f374e794d34657a3475507a67694e32553250534a6b4f444d38507a41675944733050436f6e656a4d2f496e6f6949796f734e7a30554e43496d5a53553650773d3d"
    private const val XOR_KEY = "KURO"

    private fun decode(): String = try {
        val b64 = ByteArray(ENC.length / 2) { i -> ENC.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
        val raw = Base64.decode(String(b64, Charsets.US_ASCII), Base64.DEFAULT)
        val k = XOR_KEY.toByteArray(Charsets.US_ASCII)
        String(ByteArray(raw.size) { i -> (raw[i].toInt() xor k[i % k.size].toInt()).toByte() }, Charsets.UTF_8)
    } catch (e: Exception) {
        ""
    }

    /** Dirección completa (…/master/panel/api/player_api.php o la del secreto PANEL_URL). */
    private val source: String by lazy { BuildConfig.PANEL_URL.trim().ifEmpty { decode() } }

    /** Carpeta api del panel, terminada en "/": …/master/panel/api/ */
    val apiBase: String by lazy {
        val u = source.trim()
        when {
            u.isEmpty() -> ""
            u.substringAfterLast('/').endsWith(".php", true) -> u.substringBeforeLast('/') + "/"
            u.trimEnd('/').endsWith("/api", true) -> u.trimEnd('/') + "/"
            else -> u.trimEnd('/') + "/api/"
        }
    }

    fun api(file: String): String = apiBase + file
}
