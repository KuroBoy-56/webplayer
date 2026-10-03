package com.latmpx.player

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration

/** Detecta si la app corre en un televisor (Android TV / Google TV / TV Box) o en un teléfono / tablet. */
object Device {
    fun isTv(ctx: Context): Boolean {
        val ui = ctx.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        val pm = ctx.packageManager
        if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true
        // TV Box chinos: sin pantalla táctil y sin batería de teléfono
        return !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN) && !pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    }

    fun isTablet(ctx: Context): Boolean = ctx.resources.configuration.smallestScreenWidthDp >= 600
}
