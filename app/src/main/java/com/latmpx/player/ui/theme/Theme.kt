package com.latmpx.player.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/* mismos colores que la web (assets/nf/app.css) */
val NfRed = Color(0xFFE50914)
val NfBg = Color(0xFF141414)
val NfBg2 = Color(0xFF181818)
val NfCard = Color(0xFF2F2F2F)
val NfText = Color(0xFFE5E5E5)
val NfGray = Color(0xFF808080)
val NfGray2 = Color(0xFFB3B3B3)

private val scheme = darkColorScheme(
    primary = NfRed,
    onPrimary = Color.White,
    secondary = Color.White,
    background = NfBg,
    onBackground = NfText,
    surface = NfBg2,
    onSurface = NfText,
    surfaceVariant = NfCard,
    onSurfaceVariant = NfGray2,
)

@Composable
fun LatMpxTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = Typography(), content = content)
}
