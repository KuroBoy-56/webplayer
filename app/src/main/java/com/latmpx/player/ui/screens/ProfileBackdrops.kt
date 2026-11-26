package com.latmpx.player.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
 * los degradados del color del tema: en horizontal la imagen a pantalla completa (como Netflix en el televisor) con el
 * color entrando suave desde el borde izquierdo (los perfiles se leen y la imagen se sigue viendo detrás) y un
 * sombreado leve abajo y arriba; en vertical (celular, como la app de Netflix) a pantalla completa el póster sin textos
 * del título ([Profiles.art]; si no hay, el fondo horizontal) y el logo, el nombre y la sección de perfiles los dibuja
 * ProfilesScreen con [onShown]. En horizontal el nombre y la calificación de abajo a la derecha cambian con la imagen.
 */
@Composable
fun ProfileBackdrops(items: List<Profiles.Featured>, wide: Boolean, modifier: Modifier, onShown: (Int) -> Unit = {}) {
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
    LaunchedEffect(shown, items) { onShown(shown) }

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
        // el degradado del color del distribuidor o, con Omitir, del que guardó el dueño en el panel
        val bg = com.latmpx.player.data.Tenant.profileColors?.let { com.latmpx.player.ui.theme.paletteOf(it)?.bg } ?: NfBg
        // horizontal: a pantalla completa, como Netflix en el televisor; vertical: lo que le da ProfilesScreen (todo el
        // ancho, arriba)
        Box(Modifier.fillMaxSize()) {
            BdLayer(items.getOrNull(aIdx), aIdx, !wide, Modifier.graphicsLayer { alpha = aAlpha.value }) { r -> aRes = r }
            BdLayer(items.getOrNull(bIdx), bIdx, !wide, Modifier.graphicsLayer { alpha = bAlpha.value }) { r -> bRes = r }
            if (wide) {
                // el color del tema desde el borde izquierdo hasta el 65 % del ancho (más oscuro en el borde: detrás de los
                // perfiles la imagen se sigue viendo, más oscura) y abajo / arriba solo un sombreado leve
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(
                    0f to bg.copy(alpha = 0.97f), 0.1f to bg.copy(alpha = 0.9f), 0.22f to bg.copy(alpha = 0.74f), 0.36f to bg.copy(alpha = 0.5f),
                    0.5f to bg.copy(alpha = 0.26f), 0.6f to bg.copy(alpha = 0.08f), 0.66f to Color.Transparent,
                )))
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                    0f to bg.copy(alpha = 0.45f), 0.18f to Color.Transparent, 0.7f to Color.Transparent, 0.86f to bg.copy(alpha = 0.4f), 1f to bg.copy(alpha = 0.8f),
                )))
            } else {
                // vertical: solo un sombreado arriba (hora y batería); abajo funde ProfilesScreen hacia los perfiles
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.45f), 0.16f to Color.Transparent)))
            }
        }
        // horizontal: solo su nombre y su calificación, abajo a la derecha, sin tapar nada
        if (wide) Crossfade(targetState = shown, animationSpec = tween(400), modifier = Modifier.align(Alignment.BottomEnd), label = "feat") { i ->
            val f = items.getOrNull(i) ?: return@Crossfade
            Column(Modifier.padding(horizontal = 24.dp, vertical = if (wide) 22.dp else 10.dp), horizontalAlignment = Alignment.End) {
                Text(f.name, color = Color.White, fontSize = if (wide) 20.sp else 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (f.rating.isNotEmpty()) Text("★ ${f.rating}", color = Color(0xFFF5C518), fontSize = if (wide) 15.sp else 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** una capa: Full HD del panel → TMDB (vertical: antes el póster sin textos); avisa si cargó (o si no cargó ninguna dirección) */
@Composable
private fun BdLayer(item: Profiles.Featured?, idx: Int, portrait: Boolean, modifier: Modifier, onResult: (Pair<Int, Boolean>) -> Unit) {
    if (item == null) return
    // vertical: se espera a saber si TMDB tiene el póster sin textos (si no, el fondo horizontal recortado)
    var art by remember(item, portrait) { mutableStateOf(if (portrait) null else Profiles.Art("", "")) }
    if (portrait) LaunchedEffect(item) { art = Profiles.art(item) }
    val a = art ?: return
    val sources = remember(item.image, a.poster) { listOfNotNull(a.poster.takeIf { it.isNotEmpty() }) + PanelImg.backdropSources(item.image) }
    var s by remember(item.image, a.poster) { mutableIntStateOf(0) }
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
