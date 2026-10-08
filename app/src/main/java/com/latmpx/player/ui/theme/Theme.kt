package com.latmpx.player.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import com.latmpx.player.data.Tenant

/**
 * Colores de la app. Por defecto los mismos que la web (assets/nf/app.css, "Rojo clásico");
 * con un distribuidor que tiene paleta {accent, bg, surface, text} se derivan de ella.
 */
@Immutable
data class BrandPalette(
    val accent: Color,
    val onAccent: Color,
    val bg: Color,
    val surface: Color,
    val card: Color,
    val text: Color,
    val gray: Color,
    val textMuted: Color,
)

val DefaultPalette = BrandPalette(
    accent = Color(0xFFE50914),
    onAccent = Color.White,
    bg = Color(0xFF141414),
    surface = Color(0xFF181818),
    card = Color(0xFF2F2F2F),
    text = Color(0xFFE5E5E5),
    gray = Color(0xFF808080),
    textMuted = Color(0xFFB3B3B3),
)

private fun hex(h: String): Color = Color(("FF" + h.removePrefix("#")).toLong(16))

/** onAccent negro o blanco según la luminancia; textMuted = texto al 65 %; card = superficie 8 % hacia el texto */
fun paletteOf(c: Tenant.Colors): BrandPalette? = runCatching {
    val accent = hex(c.accent)
    val bg = hex(c.bg)
    val surface = hex(c.surface)
    val text = hex(c.text)
    BrandPalette(
        accent = accent,
        onAccent = if (accent.luminance() > 0.179f) Color.Black else Color.White,
        bg = bg,
        surface = surface,
        card = lerp(surface, text, 0.08f),
        text = text,
        gray = lerp(bg, text, 0.45f),
        textMuted = lerp(bg, text, 0.65f),
    )
}.getOrNull()

/** paleta vigente: cambia sola cuando cambia la marca del distribuidor (Tenant.brand es estado observable) */
private val current: State<BrandPalette> = derivedStateOf { Tenant.brand?.colors?.let { paletteOf(it) } ?: DefaultPalette }

val brandPalette: BrandPalette get() = current.value

val LocalBrandPalette = staticCompositionLocalOf { DefaultPalette }

/* nombres de siempre: ahora siguen la paleta del distribuidor */
val NfRed: Color get() = current.value.accent
val NfOnRed: Color get() = current.value.onAccent
val NfBg: Color get() = current.value.bg
val NfBg2: Color get() = current.value.surface
val NfCard: Color get() = current.value.card
val NfText: Color get() = current.value.text
val NfGray: Color get() = current.value.gray
val NfGray2: Color get() = current.value.textMuted

@Composable
fun LatMpxTheme(content: @Composable () -> Unit) {
    val p = current.value
    val scheme = remember(p) {
        darkColorScheme(
            primary = p.accent,
            onPrimary = p.onAccent,
            secondary = Color.White,
            background = p.bg,
            onBackground = p.text,
            surface = p.surface,
            onSurface = p.text,
            surfaceVariant = p.card,
            onSurfaceVariant = p.textMuted,
        )
    }
    CompositionLocalProvider(LocalBrandPalette provides p) {
        MaterialTheme(colorScheme = scheme, typography = Typography(), content = content)
    }
}
