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
import kotlinx.coroutines.launch

/**
 * Ficha de película o serie en la TV igual que Movie_description.php / seriesvideo.php de la web:
 * fondo horizontal grande con degradado desde la izquierda, carátula, título, datos, sinopsis y botones;
 * debajo episodios por temporada, elenco (enfocable) y títulos similares.
 * Arriba desde los botones (aunque no haya nada más que elegir) la ficha vuelve al inicio para ver el fondo completo.
 */
@Composable
fun TvDetailScreen(state: AppState, media: Item) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val conf = LocalConfiguration.current
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
    var season by remember(det) {
        mutableStateOf(
            lastEp?.key?.split(":")?.getOrNull(2)?.toIntOrNull()?.let { eid -> seasons.entries.firstOrNull { e -> e.value.any { it.id == eid } }?.key }
                ?: seasons.keys.firstOrNull() ?: 1,
        )
    }
    fun play() {
        val dd = det ?: return
        if (media.kind == Kind.MOVIE) Play.movie(ctx, dd.item, dd.item.ext)
        else {
            val eid = lastEp?.key?.split(":")?.getOrNull(2)?.toIntOrNull()
            val all = seasons.values.flatten()
            if (all.isNotEmpty()) Play.episode(ctx, media, all, all.indexOfFirst { it.id == eid }.coerceAtLeast(0))
        }
    }
    val backdrop = tmdb?.backdrop?.ifEmpty { null } ?: det?.backdrop?.ifEmpty { null } ?: media.backdrop
    val plot = det?.plot?.ifBlank { null } ?: tmdb?.overview?.ifBlank { null } ?: media.plot
    val heroH = (conf.screenHeightDp * 0.80f).dp

    LazyColumn(Modifier.fillMaxSize().background(NfBg), state = list, contentPadding = PaddingValues(bottom = 48.dp)) {
        item(key = "hero") {
            Box(Modifier.fillMaxWidth().heightIn(min = heroH).background(Color.Black)) {
                if (backdrop.isNotBlank()) AsyncImage(
                    model = backdrop, contentDescription = null, contentScale = ContentScale.Crop, alignment = BiasAlignment(0f, -0.64f),
                    modifier = Modifier.matchParentSize(),
                ) else Box(Modifier.matchParentSize().background(Brush.radialGradient(listOf(Color(0xFF3A0A0D), Color.Black), radius = 1600f)))
                // .nf-detail-hero::before / ::after
                Box(Modifier.matchParentSize().background(Brush.horizontalGradient(0f to Color(0xF2141414), 0.35f to Color(0xB3141414), 0.75f to Color(0x1A141414))))
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(0.6f to Color.Transparent, 1f to NfBg)))
                Row(
                    Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = pad, end = pad, top = 40.dp, bottom = 34.dp),
                    verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(36.dp),
                ) {
                    val posterW = (conf.screenWidthDp * 0.18f).coerceIn(160f, 280f).dp
                    ItemPoster(media.copy(poster = media.poster.ifBlank { tmdb?.poster.orEmpty() }), Modifier.width(posterW).aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp)))
                    Column(Modifier.widthIn(max = 760.dp)) {
                        Text(
                            media.name, color = Color.White, fontSize = (conf.screenWidthDp * 0.04f).coerceIn(28f, 58f).sp, fontWeight = FontWeight.ExtraBold,
                            lineHeight = ((conf.screenWidthDp * 0.04f).coerceIn(28f, 58f) * 1.05f).sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        )
                        DetailMeta(media, det, seasons.size)
                        if (plot.isNotBlank()) Text(plot, color = Color(0xFFDDDDDD), fontSize = 16.sp, lineHeight = 24.sp, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(bottom = 20.dp))
                        Row(
                            Modifier
                                .onFocusChanged { if (it.hasFocus) toTop() }
                                // arriba desde los botones: no hay nada más que elegir, pero la ficha vuelve al inicio
                                .onPreviewKeyEvent { e -> if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionUp) { toTop(); true } else false },
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                        ) {
                            val label = when {
                                media.kind == Kind.MOVIE && progress != null -> stringResource(R.string.resume)
                                lastEp != null -> continueLabel(seasons, lastEp.key)
                                else -> stringResource(R.string.play)
                            }
                            NfButton(label, Icons.Filled.PlayArrow, white = true, modifier = Modifier.focusRequester(playFocus)) { play() }
                            tmdb?.trailer?.takeIf { it.isNotEmpty() }?.let { t -> NfButton(stringResource(R.string.trailer), Icons.Filled.Movie, white = false) { openYoutube(ctx, t) } }
                            CircleAction(if (fav) Icons.Filled.Check else Icons.Filled.Add, fav) { fav = Cloud.toggleFav(media) }
                        }
                        if (media.kind == Kind.MOVIE && progress != null && progress.duration > 0) Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.width(240.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x4DFFFFFF))) {
                                Box(Modifier.fillMaxWidth((progress.position.toFloat() / progress.duration).coerceIn(0f, 1f)).fillMaxHeight().background(NfRed))
                            }
                            Text("  " + stringResource(R.string.time_left, com.latmpx.player.player.fmtTime(progress.duration - progress.position)), color = Color(0xFFB3B3B3), fontSize = 13.sp)
                        }
                        val cast = tmdb?.cast?.take(5)?.joinToString(", ") { it.name }?.ifBlank { null } ?: det?.cast?.split(",")?.take(5)?.joinToString(", ") { it.trim() }.orEmpty()
                        Column(Modifier.padding(top = 16.dp)) {
                            if (cast.isNotBlank()) ExtraLine(stringResource(R.string.cast) + ": ", cast)
                            det?.genre?.takeIf { it.isNotBlank() }?.let { ExtraLine(stringResource(R.string.genres) + ": ", it) }
                            det?.director?.takeIf { it.isNotBlank() }?.let { ExtraLine(stringResource(R.string.director) + ": ", it) }
                        }
                    }
                }
            }
        }
        if (det == null) item(key = "loading") { Text(stringResource(R.string.loading_info), color = Color(0xFFB3B3B3), modifier = Modifier.padding(horizontal = pad, vertical = 12.dp)) }

        if (media.kind == Kind.SERIES && seasons.isNotEmpty()) {
            item(key = "seasons") {
                Column(Modifier.padding(horizontal = pad).padding(top = 10.dp)) {
                    Text(stringResource(R.string.episodes), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    LazyRow(contentPadding = PaddingValues(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(seasons.keys.toList()) { n -> TvChip(stringResource(R.string.season_n, n), n == season, onFocus = { season = n }) { season = n } }
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFF333333)))
                }
            }
            val eps = seasons[season].orEmpty()
            val all = seasons.values.flatten()
            val currentId = lastEp?.key?.split(":")?.getOrNull(2)?.toIntOrNull()
            items(eps, key = { "ep_${it.id}" }) { e ->
                val p = Cloud.progress("series:${media.id}:${e.id}")
                TvEpisodeRow(e, media, if (p != null && p.duration > 0) p.position.toFloat() / p.duration else 0f, e.id == currentId) {
                    Play.episode(ctx, media, all, all.indexOf(e).coerceAtLeast(0))
                }
            }
        }

        val castList = tmdb?.cast.orEmpty()
            .ifEmpty { det?.cast.orEmpty().split(",").map { it.trim() }.filter { it.isNotEmpty() }.map { Tmdb.CastMember(it, "", "") } }
        if (castList.isNotEmpty()) item(key = "cast") {
            Column(Modifier.padding(top = 20.dp)) {
                Text(stringResource(R.string.cast), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = pad))
                LazyRow(contentPadding = PaddingValues(horizontal = pad, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    // OK sobre un actor: sus películas y series disponibles en el servidor
                    items(castList) { c -> CastChip(c.name, c.character, c.profile) { state.push(Route.ActorPage(c.name, c.id, c.profile)) } }
                }
            }
        }
        item(key = "similar") {
            val pool = if (media.kind == Kind.MOVIE) state.movies else state.series
            val similar = remember(pool, media.categoryId, media.id) { pool.filter { it.categoryId == media.categoryId && it.id != media.id }.shuffled().take(24) }
            val w = tvCardWidth()
            TvRow(stringResource(R.string.more_like_this), similar) { _, it -> TvCard(it, w) { state.push(Route.Detail(it)) } }
        }
    }
}

/** año • duración • ★ nota • temporadas • HD (.nf-detail-meta) */
@Composable
private fun DetailMeta(media: Item, det: Details?, seasons: Int) {
    Row(Modifier.padding(top = 4.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val parts = listOfNotNull(
            media.year.takeIf { it.isNotBlank() }?.take(4),
            det?.duration?.takeIf { it.isNotBlank() },
            if (media.kind == Kind.SERIES && seasons > 0) pluralStringResource(R.plurals.seasons, seasons, seasons) else null,
        )
        if (media.rating > 0) Text(stringResource(R.string.match_pct, (media.rating * 10).toInt().coerceAtMost(99)), color = Color(0xFF46D369), fontWeight = FontWeight.Bold, fontSize = 15.sp)
        parts.forEachIndexed { i, p ->
            if (i > 0 || media.rating > 0) Text("•", color = Color(0xFF777777), fontSize = 15.sp)
            Text(p, color = Color(0xFFCCCCCC), fontSize = 15.sp)
        }
        Text("HD", color = Color(0xFFCCCCCC), fontSize = 12.sp, modifier = Modifier.border(1.dp, Color(0x66FFFFFF), RoundedCornerShape(3.dp)).padding(horizontal = 6.dp))
    }
}

@Composable
private fun ExtraLine(label: String, value: String) {
    Row(Modifier.padding(top = 2.dp)) {
        Text(label, color = Color(0xFF777777), fontSize = 14.sp)
        Text(value, color = Color(0xFFB3B3B3), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** .nf-btn-circle (Mi lista): con el foco o activo se vuelve blanco */
@Composable
private fun CircleAction(icon: ImageVector, on: Boolean, onClick: () -> Unit) {
    TvFocusable(onClick = onClick, shape = CircleShape, scale = 1.12f, border = false) { f ->
        Box(
            Modifier.size(46.dp).background(if (f || on) Color.White else Color(0x992A2A2A), CircleShape)
                .border(2.dp, if (f || on) Color.White else Color(0x99FFFFFF), CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, stringResource(R.string.my_list), tint = if (f || on) Color.Black else Color.White, modifier = Modifier.size(24.dp)) }
    }
}

/** .nf-actor: foto redonda, nombre y personaje; enfocable con el control (anillo blanco y crece) */
@Composable
private fun CastChip(name: String, character: String, photo: String, onClick: () -> Unit) {
    TvFocusable(onClick = onClick, shape = RoundedCornerShape(10.dp), scale = 1.08f, border = false, modifier = Modifier.width(110.dp)) { f ->
        Column(
            Modifier.fillMaxWidth().background(if (f) Color(0xFF262626) else Color.Transparent).padding(vertical = 8.dp, horizontal = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val url = photo.ifEmpty { "https://ui-avatars.com/api/?name=${java.net.URLEncoder.encode(name, "UTF-8")}&background=333&color=fff&size=168" }
            AsyncImage(
                model = url, contentDescription = name, contentScale = ContentScale.Crop,
                modifier = Modifier.size(84.dp).clip(CircleShape).background(Color(0xFF333333))
                    .border(if (f) 3.dp else 0.dp, if (f) Color.White else Color.Transparent, CircleShape),
            )
            Text(
                name, color = if (f) Color.White else Color(0xFFEEEEEE), fontSize = 13.sp, fontWeight = FontWeight.Bold, lineHeight = 16.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp),
            )
            if (character.isNotBlank()) Text(character, color = Color(0xFF999999), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        }
    }
}

/** .nf-ep: número, miniatura 16:9 con avance, título, duración y sinopsis; el que se está viendo resaltado */
@Composable
private fun TvEpisodeRow(e: Episode, series: Item, progress: Float, current: Boolean, onClick: () -> Unit) {
    val pad = tvPad()
    TvFocusable(onClick = onClick, scale = 1.02f, shape = RoundedCornerShape(6.dp), modifier = Modifier.padding(horizontal = pad, vertical = 3.dp).fillMaxWidth()) { f ->
        Row(
            Modifier.fillMaxWidth().background(if (f) Color(0xFF2A2A2A) else if (current) Color(0xFF262626) else Color.Transparent).padding(horizontal = 12.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${e.num}", color = Color(0xFFD2D2D2), fontSize = 22.sp, textAlign = TextAlign.Center, modifier = Modifier.width(40.dp))
            Spacer(Modifier.width(14.dp))
            Box(Modifier.width(180.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(4.dp)).background(Color(0xFF333333))) {
                AsyncImage(model = e.image.ifEmpty { series.poster }, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                if (f) Box(Modifier.fillMaxSize().background(Color(0x59000000)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(40.dp).border(2.dp, Color.White, CircleShape).padding(6.dp))
                }
                if (progress > 0f) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp).background(Color(0x4DFFFFFF))) {
                    Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).fillMaxHeight().background(NfRed))
                }
            }
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(e.title.ifBlank { stringResource(R.string.episode_n, e.num) }, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (e.duration.isNotBlank()) Text(e.duration, color = Color(0xFFCCCCCC), fontSize = 14.sp, modifier = Modifier.padding(start = 10.dp))
                }
                if (e.plot.isNotBlank()) Text(e.plot, color = Color(0xFFA3A3A3), fontSize = 14.sp, lineHeight = 20.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            }
        }
    }
}

/** "Continuar T1 E3" a partir de la clave "series:5:301" */
private fun continueLabel(seasons: Map<Int, List<Episode>>, key: String): String {
    val eid = key.split(":").getOrNull(2)?.toIntOrNull() ?: return tr(R.string.resume)
    val e = seasons.values.flatten().firstOrNull { it.id == eid } ?: return tr(R.string.resume)
    return tr(R.string.resume_ep, e.season, e.num)
}

private fun openYoutube(ctx: Context, id: String) {
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:$id"))) }
    catch (e: Exception) { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=$id"))) } }
}
