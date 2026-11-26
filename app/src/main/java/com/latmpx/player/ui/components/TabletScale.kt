package com.latmpx.player.ui.components

import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import kotlin.math.roundToInt

/**
 * Tableta (lado corto de 600 dp o más, nunca la TV): toda la app un 25–40 % más grande (textos, carátulas, botones,
 * barras, avatares), así nada se ve diminuto en la pantalla grande. Se agranda la densidad y la configuración que leen las
 * pantallas (ancho y alto en dp) se ajusta igual, para que las medidas sigan cuadrando. El celular queda como siempre.
 */
@Composable
fun TabletScale(enabled: Boolean = true, content: @Composable () -> Unit) {
    val conf = LocalConfiguration.current
    val sw = conf.smallestScreenWidthDp
    if (!enabled || sw < 600 || LocalIsTv.current) {
        content()
    } else {
        // 7" (600 dp) ≈ 1.25×, 10" (800 dp o más) 1.4×
        val f = (sw / 480f).coerceIn(1.2f, 1.4f)
        val d = LocalDensity.current
        val scaled = remember(conf, f) {
            Configuration(conf).apply {
                screenWidthDp = (conf.screenWidthDp / f).roundToInt()
                screenHeightDp = (conf.screenHeightDp / f).roundToInt()
                smallestScreenWidthDp = (sw / f).roundToInt()
            }
        }
        CompositionLocalProvider(LocalDensity provides Density(d.density * f, d.fontScale), LocalConfiguration provides scaled, content = content)
    }
}
