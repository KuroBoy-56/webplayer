package com.latmpx.player.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Tmdb
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.delay

/**
 * Cartelera principal de la TV, igual que la del reproductor web: fondo grande del contenido,
 * datos a la izquierda (tipo, título, año, nota, sinopsis) y los botones Reproducir / Más información / Mi lista.
 * Cambia sola cada pocos segundos mientras el foco no está en sus botones.
 */
@Composable
fun TvBillboard(state: AppState, items: List<Item>) {
    if (items.isEmpty()) return
    val ctx = LocalContext.current
    val height = (LocalConfiguration.current.screenHeightDp * 0.66f).dp
    var index by remember(items) { mutableIntStateOf(0) }
    var holding by remember { mutableStateOf(false) }
    val play = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        // el foco entra a la cartelera una sola vez por visita a la sección
        if (state.billboardFocusedTab != state.tab) {
            state.billboardFocusedTab = state.tab
            runCatching { play.requestFocus() }
        }
    }
    LaunchedEffect(items, holding) {
        while (!holding && items.size > 1) {
            delay(9000)
            index = (index + 1) % items.size
        }
    }
    val item = items[index.coerceIn(0, items.lastIndex)]
    // fondo y sinopsis de TMDB cuando el servidor no los trae
    var art by remember(item.key) { mutableStateOf(item.backdrop) }
    var plot by remember(item.key) { mutableStateOf(item.plot) }
    LaunchedEffect(item.key) {
        if (art.isNotBlank() && plot.isNotBlank()) return@LaunchedEffect
        val d = runCatching { Tmdb.getDetails(if (item.kind == Kind.SERIES) "tv" else "movie", item.name, item.year) }.getOrNull()
        if (d != null) {
            if (art.isBlank()) art = d.backdrop
            if (plot.isBlank()) plot = d.overview
        }
    }

    Box(Modifier.fillMaxWidth().height(height).background(Color.Black)) {
        Crossfade(targetState = art.ifBlank { item.poster }, animationSpec = tween(900), label = "fondo") { url ->
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Color(0xE6000000), 0.42f to Color(0x80000000), 0.75f to Color.Transparent)))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 0.85f to Color(0x99141414), 1f to NfBg)))

        Column(
            Modifier.align(Alignment.BottomStart).padding(start = 36.dp, bottom = 34.dp).width((LocalConfiguration.current.screenWidthDp * 0.46f).dp)
                .onFocusChanged { holding = it.hasFocus },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("N", color = NfRed, fontSize = 26.sp, fontWeight = FontWeight.Black)
                Text(
                    if (item.kind == Kind.SERIES) "S E R I E" else "P E L Í C U L A",
                    color = Color(0xFFDDDDDD), fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp),
                )
            }
            Text(
                item.name, color = Color.White, fontSize = 42.sp, fontWeight = FontWeight.Black, lineHeight = 44.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp),
            )
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (item.rating > 0) Text("${(item.rating * 10).toInt().coerceAtMost(99)}% para ti", color = Color(0xFF46D369), fontWeight = FontWeight.Bold, fontSize = 15.sp)
                if (item.year.isNotBlank()) Text(item.year.take(4), color = Color(0xFFDDDDDD), fontSize = 15.sp)
                Text(
                    "HD", color = Color(0xFFDDDDDD), fontSize = 11.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.border(1.dp, Color(0x66FFFFFF), RoundedCornerShape(3.dp)).padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
            if (plot.isNotBlank()) Text(
                plot, color = Color.White, fontSize = 15.sp, lineHeight = 21.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 10.dp),
            )
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HeroButton("Reproducir", Icons.Filled.PlayArrow, true, Modifier.focusRequester(play)) {
                    if (item.kind == Kind.MOVIE) Play.movie(ctx, item, item.ext) else state.push(Route.Detail(item))
                }
                HeroButton("Más información", Icons.Filled.Info, false) { state.push(Route.Detail(item)) }
                var fav by remember(item.key, Cloud.rev) { mutableStateOf(Cloud.isFav(item.key)) }
                HeroButton(if (fav) "En mi lista" else "Mi lista", if (fav) Icons.Filled.Check else Icons.Filled.Add, false) { fav = Cloud.toggleFav(item) }
            }
        }
        if (items.size > 1) Row(
            Modifier.align(Alignment.BottomEnd).padding(end = 36.dp, bottom = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items.indices.forEach { i ->
                Box(Modifier.size(if (i == index) 22.dp else 8.dp, 8.dp).clip(CircleShape).background(if (i == index) Color.White else Color(0x59FFFFFF)))
            }
        }
    }
}
