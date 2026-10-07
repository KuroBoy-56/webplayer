package com.latmpx.player

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.provider.Settings
import com.latmpx.player.data.Store

/** Detecta si la app corre en un televisor (Android TV / Google TV / TV Box) o en un teléfono / tablet. */
object Device {
    /** Esta rama (android) es la app para celular y tablet: siempre interfaz táctil. La de TV vive en la rama android-tv. */
    const val TV_APP = false

    fun isTv(ctx: Context): Boolean = TV_APP

    /** detección real del equipo (solo informativa) */
    fun looksLikeTv(ctx: Context): Boolean {
        val ui = ctx.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        val pm = ctx.packageManager
        if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true
        // TV Box chinos: sin pantalla táctil y sin batería de teléfono
        return !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN) && !pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    }

    fun isTablet(ctx: Context): Boolean = ctx.resources.configuration.smallestScreenWidthDp >= 600

    /**
     * Identificador del equipo en formato MAC del panel: Android ID en 16 hex mayúsculas, 8 pares con ":"
     * (ej. "A1:B2:C3:D4:E5:F6:07:18"). Se quita el "00:" inicial igual que normalise_mac() del panel,
     * así lo que se muestra en pantalla es exactamente lo que el panel guarda.
     */
    fun id(ctx: Context): String {
        val raw = runCatching { Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) }.getOrNull().orEmpty()
        val hex = raw.uppercase().filter { it in '0'..'9' || it in 'A'..'F' }
        // equipos sin Android ID (o con uno vacío / de ceros): uno aleatorio que se guarda en el equipo
        if (hex.isEmpty() || hex.all { it == '0' }) return Store.fallbackDeviceId()
        return normalize(hex)
    }

    fun normalize(raw: String): String {
        val hex = raw.trim().uppercase().filter { it in '0'..'9' || it in 'A'..'F' }.takeLast(16).padStart(16, '0')
        val pairs = hex.chunked(2).toMutableList()
        // normalise_mac() quita un "00:" inicial; se repite aquí (dejando al menos 6 pares) para que el panel no lo cambie
        while (pairs.size > 6 && pairs.first() == "00") pairs.removeAt(0)
        return pairs.joinToString(":")
    }
}
