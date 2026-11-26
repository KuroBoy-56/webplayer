package com.latmpx.player.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.lerp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Profiles
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfRed
import kotlin.math.roundToInt

/** dónde está el avatar de cada perfil en «¿Quién está viendo?» (para salir desde ahí hacia el centro) */
internal val profileBounds = HashMap<String, Rect>()

/**
 * Al elegir un perfil, como Netflix: el avatar va desde su lugar al centro de la pantalla y debajo gira el circulito
 * mientras en segundo plano se arma el catálogo (y en el perfil infantil se filtra). AppRoot la quita cuando Inicio
 * está listo, así nunca se ve una pantalla a medio cargar.
 */
@Composable
fun ProfileEnterOverlay(p: Profiles.Profile) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(p.id) { t.animateTo(1f, tween(480, easing = FastOutSlowInEasing)) }
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = constraints.maxWidth.toFloat()
        val h = constraints.maxHeight.toFloat()
        val side = with(density) { (if (maxWidth < 600.dp) 128.dp else 168.dp).toPx() }
        val end = Rect(Offset(w / 2 - side / 2, h / 2 - side * 0.8f), Size(side, side))
        // sin su lugar (TV o se abrió desde otra pantalla): aparece en el centro, creciendo un poco
        val start = profileBounds[p.id] ?: Rect(end.center - Offset(side * 0.35f, side * 0.35f), Size(side * 0.7f, side * 0.7f))
        val r = lerp(start, end, t.value)
        val after = ((t.value - 0.55f) / 0.45f).coerceIn(0f, 1f)
        Box(Modifier.fillMaxSize().background(NfBg.copy(alpha = t.value.coerceAtMost(1f))))
        Box(Modifier.offset { IntOffset(r.left.roundToInt(), r.top.roundToInt()) }) {
            ProfileAvatar(p, with(density) { r.width.toDp() }, badge = null)
        }
        Column(
            Modifier.fillMaxWidth().offset { IntOffset(0, (end.bottom + with(density) { 18.dp.toPx() }).roundToInt()) }.alpha(after),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(p.name, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(22.dp))
            CircularProgressIndicator(color = NfRed, strokeWidth = 3.dp, modifier = Modifier.size(40.dp))
        }
    }
}
