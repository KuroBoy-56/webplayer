package com.latmpx.player.data

import org.json.JSONObject

/**
 * Pantalla falsa del panel (Pantalla Falsa, solo el dueño): la manda check_mac a los equipos
 * nuevos de las apps elegidas. type: calculator | carrusel | image | video | web.
 * unlock: código que, escrito en la calculadora y "=", abre el inicio de sesión ("" = sin código).
 */
data class FakeScreen(
    val type: String,
    val url: String,
    val images: List<String>,
    val intervalS: Int,
    val unlock: String,
) {
    companion object {
        fun parse(j: JSONObject?): FakeScreen? {
            val f = j?.optJSONObject("fake_screen") ?: return null
            if (!f.optBoolean("show", false)) return null
            val type = f.s("type").takeIf { it in setOf("calculator", "carrusel", "image", "video", "web") } ?: "calculator"
            val url = f.s("url").takeIf { it.startsWith("http://") || it.startsWith("https://") }.orEmpty()
            val imgs = f.optJSONArray("images")?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.startsWith("http") } }.orEmpty()
            return FakeScreen(type, url, imgs, f.optInt("interval", 5).coerceIn(1, 120), f.s("unlock").filter { it.isDigit() })
        }
    }
}
