package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Details
import com.latmpx.player.data.Episode
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Tmdb
import com.latmpx.player.data.Xtream
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.ItemPoster
import com.latmpx.player.ui.components.TvCard
import com.latmpx.player.ui.components.TvChip
import com.latmpx.player.ui.components.TvFocusable
import com.latmpx.player.ui.components.TvRow
import com.latmpx.player.ui.components.tvCardWidth
import com.latmpx.player.ui.components.tvPad
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfRed
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.alpha
import androidx.compose.material.icons.filled.Replay
import kotlinx.coroutines.launch

/**
 * Ficha de película o serie en la TV igual que Roku y Vega OS: la imagen queda fija arriba a la derecha (1440×810 en
 * 1920×1080) con color liso a la izquierda y degradados, y por encima se mueven título, datos, sinopsis, botones,
 * temporadas con sus episodios, reparto y "Más títulos como este". La imagen nunca cambia de lugar.
 * Película vista: «Continuar  1:23:45» y «Desde el inicio»; serie vista: «Continuar T1 E3».
 * Arriba desde los botones la ficha vuelve al inicio.
 */
@Composable
fun TvDetailScreen(state: AppState, media: Item) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val pad = tvPad()
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val toTop: () -> Unit = { scope.launch { list.animateScrollToItem(0) } }

    val d by produceState<Details?>(null, media.key) {
        value = runCatching { if (media.kind == Kind.SERIES) Xtream.seriesDetails(s, media) else Xtream.movieDetails(s, media) }.getOrNull()
    }
    val tmdb by produceState<Tmdb.Details?>(null, d) {
        val det = d ?: return@produceState
        value = runCatching { Tmdb.getDetails(if (media.kind == Kind.SERIES) "tv" else "movie", media.name, media.year, det.tmdbId) }.getOrNull()
    }
    var fav by remember(media.key, Cloud.rev) { mutableStateOf(Cloud.isFav(media.key)) }
    val progress = remember(state.refresh, Cloud.rev, media.key) { Cloud.progress(media.key) }
    val lastEp = remember(state.refresh, Cloud.rev, media.key) { if (media.kind == Kind.SERIES) Cloud.seriesProgress(media.id) else null }
    val playFocus = remember { FocusRequester() }
    val onTop = com.latmpx.player.ui.LocalLayerOnTop.current
    LaunchedEffect(media.key, d != null) { if (onTop) runCatching { playFocus.requestFocus() } }

    val det = d
    val seasons = det?.seasons.orEmpty()
    val lastEpId = lastEp?.key?.split(":")?.getOrNull(2)?.toIntOrNull()
    var season by remember(det) {
        mutableStateOf(lastEpId?.let { eid -> seasons.entries.firstOrNull { e -> e.value.any { it.id == eid } }?.key } ?: seasons.keys.firstOrNull() ?: 1)
    }
    // como Roku y Vega: con más de 5 s vistos (y hasta el 95 %) se puede continuar o empezar de nuevo
    val canResume = media.kind == Kind.MOVIE && progress != null && progress.position > 5_000 &&
        (progress.duration <= 0 || progress.position < progress.duration * 0.95)
    fun play(fromStart: Boolean = false) {
        val dd = det ?: return
        if (media.kind == Kind.MOVIE) Play.movie(ctx, dd.item, dd.item.ext, fromStart)
        else {
            val all = seasons.values.flatten()
            if (all.isNotEmpty()) Play.episode(ctx, media, all, all.indexOfFirst { it.id == lastEpId }.coerceAtLeast(0))
        }
    }
    // fondo horizontal: el de TMDB, el del servidor, el que ya encontró la portada o, si no hay, la carátula difuminada
    val wide = tmdb?.backdrop?.ifEmpty { null } ?: det?.backdrop?.ifEmpty { null } ?: media.backdrop.ifEmpty { null } ?: FocusArt.map[media.key]?.backdrop.orEmpty()
    val plot = Tmdb.localPlot(det?.plot?.ifBlank { null } ?: tmdb?.overview?.ifBlank { null } ?: media.plot, tmdb?.overview)
    val castList = tmdb?.cast.orEmpty()

    BoxWithConstraints(Modifier.fillMaxSize().background(NfBg)) {
        val k = maxHeight.value / 1080f
        val px: (Float) -> androidx.compose.ui.unit.Dp = { (it * k).dp }
        // la imagen fija (medidas de Roku, DetailView.xml): no se mueve al recorrer la ficha
        Box(Modifier.offset(x = px(480f)).width(px(1440f)).height(px(810f))) {
            if (wide.isNotBlank()) com.latmpx.player.ui.components.ChainImage(
                remember(wide) { com.latmpx.player.data.PanelImg.backdropSources(wide) }, Modifier.fillMaxSize(), alignment = BiasAlignment(0f, -0.6f),
            ) else ItemPoster(media.copy(poster = media.poster.ifBlank { tmdb?.poster.orEmpty() }), Modifier.fillMaxSize().blur(18.dp).alpha(0.6f))
        }
        Box(Modifier.offset(x = px(480f)).width(px(900f)).height(px(810f)).background(Brush.horizontalGradient(listOf(NfBg, NfBg.copy(alpha = 0.6f), Color.Transparent))))
        Box(Modifier.width(px(481f)).height(px(810f)).background(NfBg))
        Box(Modifier.offset(y = px(400f)).fillMaxWidth().height(px(420f)).background(Brush.verticalGradient(listOf(Color.Transparent, NfBg.copy(alpha = 0.7f), NfBg))))
        Box(Modifier.offset(y = px(810f)).fillMaxWidth().height(px(400f)).background(NfBg))

        LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = 48.dp)) {
            item(key = "head") {
                Column(Modifier.padding(start = pad, top = px(110f)).width(px(1300f))) {
                    Text(
                        media.name, color = Color.White, fontSize = (72 * k).sp, lineHeight = (80 * k).sp, fontWeight = FontWeight.Black,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                    DetailMeta(media, det, seasons.size, k)
                    det?.genre?.takeIf { it.isNotBlank() }?.let { Text(it, color = Color(0xFFB3B3B3), fontSize = (26 * k).sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = px(8f))) }
                    Text(
                        plot.ifBlank { if (det == null) stringResource(R.string.loading_info) else "" }, color = Color.White, fontSize = (30 * k).sp,
                        lineHeight = (42 * k).sp, maxLines = 5, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = px(18f)),
                    )
                    if (castList.isEmpty()) det?.cast?.takeIf { it.isNotBlank() }?.let { ExtraLine(stringResource(R.string.cast) + ": ", it, k) }
                    det?.director?.takeIf { it.isNotBlank() }?.let { ExtraLine(stringResource(R.string.director) + ": ", it, k) }
                    Row(
                        Modifier.padding(top = px(34f))
                            .onFocusChanged { if (it.hasFocus) toTop() }
                            // arriba desde los botones: no hay nada más que elegir, pero la ficha vuelve al inicio
                            .onPreviewKeyEvent { e -> if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionUp) { toTop(); true } else false },
                        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val label = when {
                            canResume -> stringResource(R.string.resume) + "  " + com.latmpx.player.player.fmtTime(progress!!.position)
                            media.kind == Kind.SERIES && lastEp != null -> continueLabel(seasons, lastEp.key)
                            else -> stringResource(R.string.play)
                        }
                        NfButton(label, Icons.Filled.PlayArrow, white = true, modifier = Modifier.focusRequester(playFocus)) { play() }
                        if (canResume) NfButton(stringResource(R.string.from_start), Icons.Filled.Replay, white = false) { play(fromStart = true) }
                        NfButton(stringResource(if (fav) R.string.in_my_list else R.string.my_list), if (fav) Icons.Filled.Check else Icons.Filled.Add, white = false) { fav = Cloud.toggleFav(media) }
                    }
                }
            }

            if (media.kind == Kind.SERIES && seasons.isNotEmpty()) {
                item(key = "seasons") {
                    LazyRow(Modifier.padding(top = px(30f)), contentPadding = PaddingValues(horizontal = pad, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(seasons.keys.toList()) { n -> TvChip(stringResource(R.string.season_n, n), n == season, onFocus = { season = n }) { season = n } }
                    }
                }
                item(key = "eps_$season") {
                    val eps = seasons[season].orEmpty()
                    val all = seasons.values.flatten()
                    LazyRow(contentPadding = PaddingValues(start = pad, end = pad, top = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(px(22f))) {
                        items(eps, key = { "ep_${it.id}" }) { e ->
                            val p = Cloud.progress("series:${media.id}:${e.id}")
                            TvEpisodeCard(e, media, if (p != null && p.duration > 0) p.position.toFloat() / p.duration else 0f, e.id == lastEpId, k) {
                                Play.episode(ctx, media, all, all.indexOf(e).coerceAtLeast(0))
                            }
                        }
                    }
                }
            }

            if (castList.isNotEmpty()) item(key = "cast") {
                Column(Modifier.padding(top = px(30f))) {
                    Text(stringResource(R.string.cast), color = Color.White, fontSize = (34 * k).sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = pad))
                    LazyRow(contentPadding = PaddingValues(start = pad, end = pad, top = 14.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(px(26f))) {
                        // OK sobre un actor: su biografía y sus películas y series en el servidor
                        items(castList) { c -> CastChip(c.name, c.character, c.profile, k) { state.push(Route.ActorPage(c.name, c.id, c.profile)) } }
                    }
                }
            }
            item(key = "similar") {
                val pool = if (media.kind == Kind.MOVIE) state.movies else state.series
                val similar = remember(pool, media.categoryId, media.id) { pool.filter { it.categoryId == media.categoryId && it.id != media.id }.take(30) }
                val w = tvCardWidth()
                Box(Modifier.padding(top = px(10f))) { TvRow(stringResource(R.string.more_like_this), similar) { _, it -> TvCard(it, w) { state.push(Route.Detail(it)) } } }
            }
        }
    }
}

/** año   ★ nota   duración   temporadas, en verde (como Roku y Vega) */
@Composable
private fun DetailMeta(media: Item, det: Details?, seasons: Int, k: Float) {
    val parts = listOfNotNull(
        media.year.takeIf { it.isNotBlank() }?.take(4),
        if (media.rating > 0) "★ " + String.format(java.util.Locale.US, "%.1f", media.rating) else null,
        det?.duration?.takeIf { it.isNotBlank() },
        if (media.kind == Kind.SERIES && seasons > 0) pluralStringResource(R.plurals.seasons, seasons, seasons) else null,
    )
    if (parts.isNotEmpty()) Text(parts.joinToString("   "), color = Color(0xFF46D369), fontSize = (28 * k).sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = (12 * k).dp))
}

@Composable
private fun ExtraLine(label: String, value: String, k: Float) {
    Row(Modifier.padding(top = (10 * k).dp)) {
        Text(label, color = Color(0xFF808080), fontSize = (24 * k).sp)
        Text(value, color = Color(0xFFB3B3B3), fontSize = (24 * k).sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** reparto: foto redonda, nombre y personaje (como Roku y Vega); OK abre la página del actor */
@Composable
private fun CastChip(name: String, character: String, photo: String, k: Float, onClick: () -> Unit) {
    val size = (140 * k).dp
    TvFocusable(onClick = onClick, shape = RoundedCornerShape(10.dp), scale = 1.08f, border = false, modifier = Modifier.width((170 * k).dp)) { f ->
        Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(size).clip(CircleShape).background(Color(0xFF262626)).border(if (f) 3.dp else 0.dp, if (f) Color.White else Color.Transparent, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(name.take(1).uppercase(), color = Color.White, fontSize = (56 * k).sp, fontWeight = FontWeight.ExtraBold)
                if (photo.isNotBlank()) AsyncImage(model = photo, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Text(
                name, color = if (f) Color.White else Color(0xFFB3B3B3), fontSize = (22 * k).sp, fontWeight = FontWeight.Bold,
                maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.padding(top = (10 * k).dp),
            )
            if (character.isNotBlank()) Text(character, color = Color(0xFF808080), fontSize = (20 * k).sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        }
    }
}

/** episodio como Roku y Vega: miniatura 16:9 con avance, "N. Título" y sinopsis; el que se está viendo resaltado */
@Composable
private fun TvEpisodeCard(e: Episode, series: Item, progress: Float, current: Boolean, k: Float, onClick: () -> Unit) {
    val w = (400 * k).dp
    TvFocusable(onClick = onClick, scale = 1.05f, shape = RoundedCornerShape(8.dp), modifier = Modifier.width(w)) { f ->
        Column(Modifier.fillMaxWidth().background(if (f) Color(0xFF2A2A2A) else if (current) Color(0xFF222222) else Color.Transparent).padding((4 * k).dp)) {
            Box(Modifier.fillMaxWidth().height((220 * k).dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF333333))) {
                AsyncImage(model = e.image.ifEmpty { series.poster }, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                if (progress > 0f) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height((7 * k).dp).background(Color(0x59FFFFFF))) {
                    Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).fillMaxHeight().background(NfRed))
                }
            }
            Text(
                "${e.num}. " + e.title.ifBlank { stringResource(R.string.episode_n, e.num) }, color = Color.White, fontSize = (26 * k).sp,
                fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = (10 * k).dp),
            )
            if (e.plot.isNotBlank()) Text(e.plot, color = Color(0xFFB3B3B3), fontSize = (22 * k).sp, lineHeight = (30 * k).sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = (4 * k).dp))
        }
    }
}

/** "Continuar T1 E3" a partir de la clave "series:5:301" */
private fun continueLabel(seasons: Map<Int, List<Episode>>, key: String): String {
    val eid = key.split(":").getOrNull(2)?.toIntOrNull() ?: return tr(R.string.resume)
    val e = seasons.values.flatten().firstOrNull { it.id == eid } ?: return tr(R.string.resume)
    return tr(R.string.resume_ep, e.season, e.num)
}
