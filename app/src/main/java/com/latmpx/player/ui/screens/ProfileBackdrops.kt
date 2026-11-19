package com.latmpx.player.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.compose.AsyncImage
import com.latmpx.player.data.PanelImg
import com.latmpx.player.data.Profiles
import com.latmpx.player.ui.theme.NfBg
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

/** cada fondo se ve 10 s */
private const val SLIDE_MS = 10000L
private const val FADE_MS = 700

/**
 * Fondo de «¿Quién está viendo?» (docs/PERFILES.md del panel, sección 6): lo más destacado de la semana (15 a 20,
 * [Profiles.featuredList]), 10 s cada uno, y después del último vuelve al primero. Dos capas: la siguiente se carga
 * antes en la que no se ve y aparece con un fundido recién cuando cargó (nunca un hueco); si no carga se salta. Encima,
 * los degradados del color del tema: en horizontal la imagen va en una caja 16:9 arriba a la derecha con el color
 * entrando por su borde izquierdo y por abajo (los perfiles, la versión y el nombre quedan sobre el color liso); en
 * vertical (celular) arriba, con la parte de abajo que se funde con el fondo. El nombre y la calificación de abajo a
 * la derecha cambian con la imagen.
 */
@Composable
fun ProfileBackdrops(items: List<Profiles.Featured>, wide: Boolean, modifier: Modifier) {
    if (items.isEmpty()) return
    // capa A (abajo) y capa B (arriba, con su opacidad): qué título tiene cada una y qué pasó al cargarlo
    var aIdx by remember(items) { mutableIntStateOf(0) }
    var bIdx by remember(items) { mutableIntStateOf(-1) }
    var aRes by remember(items) { mutableStateOf<Pair<Int, Boolean>?>(null) }
    var bRes by remember(items) { mutableStateOf<Pair<Int, Boolean>?>(null) }
    var shown by remember(items) { mutableIntStateOf(0) }
    val aAlpha = remember(items) { Animatable(0f) }
    val bAlpha = remember(items) { Animatable(0f) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    LaunchedEffect(items) {
        // el primero, con su fundido
        val r0 = snapshotFlow { aRes }.first { it?.first == 0 }
        if (r0?.second == true) aAlpha.animateTo(1f, tween(500))
        if (items.size < 2) return@LaunchedEffect
        var topB = false
        var fails = 0
        while (true) {
            val start = System.currentTimeMillis()
            val target = (shown + 1) % items.size
            // la que no se ve: B (transparente) si se ve A, o A (tapada por B) si se ve B
            if (!topB) bIdx = target else aIdx = target
            val ok = (if (!topB) snapshotFlow { bRes } else snapshotFlow { aRes }).first { it?.first == target }?.second == true
            if (!ok) {
                // no carga: se salta; sin red, después de probar todos queda la que se ve
                shown = target
                if (++fails >= items.size) return@LaunchedEffect
                continue
            }
            fails = 0
            delay((SLIDE_MS - (System.currentTimeMillis() - start)).coerceAtLeast(0L))
            // con la app en segundo plano no se cambia: sigue al volver
            lifecycle.currentStateFlow.first { it.isAtLeast(Lifecycle.State.STARTED) }
            if (!topB) {
                bAlpha.animateTo(1f, tween(FADE_MS))
            } else {
                aAlpha.snapTo(1f)
                bAlpha.animateTo(0f, tween(FADE_MS))
            }
            topB = !topB
            shown = target
        }
    }

    Box(modifier) {
        val bg = NfBg
        // horizontal: una caja 16:9 arriba a la derecha (69 % del ancho, como 1320×742 en 1920×1080; como mucho 80 % del
        // alto), no toda la pantalla; vertical: lo que le da ProfilesScreen (todo el ancho, arriba)
        val conf = LocalConfiguration.current
        val bw = (conf.screenWidthDp * 0.69f).dp
        val bh = minOf(bw * (9f / 16f), (conf.screenHeightDp * 0.8f).dp)
        Box(if (wide) Modifier.align(Alignment.TopEnd).width(bw).height(bh) else Modifier.fillMaxSize()) {
            BdLayer(items.getOrNull(aIdx), aIdx, Modifier.graphicsLayer { alpha = aAlpha.value }) { r -> aRes = r }
            BdLayer(items.getOrNull(bIdx), bIdx, Modifier.graphicsLayer { alpha = bAlpha.value }) { r -> bRes = r }
            if (wide) {
                // el color del tema entra suave por el borde izquierdo de la imagen (donde están los perfiles), por abajo
                // y un poco por arriba, opaco justo en sus bordes: nunca se ve un borde recto
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(
                    0f to bg, 0.08f to bg.copy(alpha = 0.95f), 0.2f to bg.copy(alpha = 0.8f), 0.34f to bg.copy(alpha = 0.52f),
                    0.46f to bg.copy(alpha = 0.24f), 0.56f to bg.copy(alpha = 0.07f), 0.64f to Color.Transparent,
                )))
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                    0f to bg.copy(alpha = 0.5f), 0.22f to Color.Transparent, 0.44f to Color.Transparent, 0.6f to bg.copy(alpha = 0.24f),
                    0.76f to bg.copy(alpha = 0.58f), 0.9f to bg.copy(alpha = 0.88f), 1f to bg,
                )))
            } else {
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(bg.copy(alpha = 0.5f), Color.Transparent, bg.copy(alpha = 0.55f), bg))))
            }
        }
        // solo su nombre y su calificación, abajo a la derecha, sin tapar nada
        Crossfade(targetState = shown, animationSpec = tween(400), modifier = Modifier.align(Alignment.BottomEnd), label = "feat") { i ->
            val f = items.getOrNull(i) ?: return@Crossfade
            Column(Modifier.padding(horizontal = 24.dp, vertical = if (wide) 22.dp else 10.dp), horizontalAlignment = Alignment.End) {
                Text(f.name, color = Color.White, fontSize = if (wide) 20.sp else 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (f.rating.isNotEmpty()) Text("★ ${f.rating}", color = Color(0xFFF5C518), fontSize = if (wide) 15.sp else 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** una capa: Full HD del panel → TMDB; avisa si cargó (o si no cargó ninguna dirección) */
@Composable
private fun BdLayer(item: Profiles.Featured?, idx: Int, modifier: Modifier, onResult: (Pair<Int, Boolean>) -> Unit) {
    if (item == null) return
    val sources = remember(item.image) { PanelImg.backdropSources(item.image) }
    var s by remember(item.image) { mutableIntStateOf(0) }
    val url = sources.getOrNull(s)
    if (url == null) {
        LaunchedEffect(item.image) { onResult(idx to false) }
        return
    }
    AsyncImage(
        model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier.fillMaxSize(),
        onSuccess = { onResult(idx to true) },
        onError = { if (s + 1 < sources.size) s++ else onResult(idx to false) },
    )
}
