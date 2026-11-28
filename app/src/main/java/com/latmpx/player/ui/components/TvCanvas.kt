package com.latmpx.player.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import kotlin.math.roundToInt

/** el lienzo de la TV en dp: el de un televisor 1080p de Android TV (960 × 540) */
private const val TV_W = 960f
private const val TV_H = 540f

/** cuántos píxeles por dp usa la TV con esa pantalla: 480p ≈ 0,89, 720p ≈ 1,33, 1080p = 2, 4K = 4 */
fun tvScale(widthPx: Int, heightPx: Int): Float =
    if (widthPx <= 0 || heightPx <= 0) 0f else minOf(widthPx / TV_W, heightPx / TV_H)

/**
 * TV: toda la interfaz se dibuja sobre el mismo lienzo de 960 × 540 dp, cualquiera sea la resolución y la densidad que
 * informe el equipo. Antes un televisor de 480p (o un TV Box con una densidad rara) tenía menos espacio y todo se
 * desbordaba (tarjetas cortadas, textos encimados); un 4K se ve igual de ordenado y con todo el detalle (cada dp son 4
 * píxeles: pósters y textos nítidos). Los textos no se agrandan con la letra del sistema (en la TV desbordaban).
 * En el celular y la tablet no cambia nada.
 */
@Composable
fun TvCanvas(tv: Boolean, content: @Composable () -> Unit) {
    if (!tv) { content(); return }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = if (constraints.hasBoundedWidth) constraints.maxWidth else 0
        val h = if (constraints.hasBoundedHeight) constraints.maxHeight else 0
        val s = tvScale(w, h)
        if (s <= 0f) { content(); return@BoxWithConstraints }
        val cfg = LocalConfiguration.current
        val conf = remember(cfg, w, h, s) {
            Configuration(cfg).apply {
                screenWidthDp = (w / s).roundToInt()
                screenHeightDp = (h / s).roundToInt()
                smallestScreenWidthDp = minOf(screenWidthDp, screenHeightDp)
                densityDpi = (s * 160f).roundToInt()
            }
        }
        CompositionLocalProvider(LocalDensity provides Density(s, 1f), LocalConfiguration provides conf) { content() }
    }
}
