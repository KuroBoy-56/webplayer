package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Details
import com.latmpx.player.data.Episode
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Xtream
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.Poster
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

@Composable
fun DetailScreen(state: AppState, media: Item) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val d by produceState<Details?>(null, media.key) {
        value = if (media.kind == Kind.SERIES) Xtream.seriesDetails(s, media) else Xtream.movieDetails(s, media)
    }
    var fav by remember(media.key, Cloud.rev) { mutableStateOf(Cloud.isFav(media.key)) }
    val progress = remember(state.refresh, Cloud.rev, media.key) { Cloud.progress(media.key) }
    val lastEp = remember(state.refresh, Cloud.rev, media.key) {
        // último episodio visto de esta serie (una entrada por serie en el panel, igual que la web)
        if (media.kind == Kind.SERIES) Cloud.seriesProgress(media.id) else null
    }
    val playFocus = remember { FocusRequester() }
    if (tv) LaunchedEffect(d != null) { runCatching { playFocus.requestFocus() } }

    val det = d
    val seasons = det?.seasons.orEmpty()
    var season by remember(det) { mutableStateOf(lastEp?.key?.split(":")?.getOrNull(2)?.toIntOrNull()?.let { eid -> seasons.entries.firstOrNull { e -> e.value.any { it.id == eid } }?.key } ?: seasons.keys.firstOrNull() ?: 1) }

    fun play() {
        val dd = det ?: return
        if (media.kind == Kind.MOVIE) Play.movie(ctx, dd.item, dd.item.ext)
        else {
            val eid = lastEp?.key?.split(":")?.getOrNull(2)?.toIntOrNull()
            val all = seasons.values.flatten()
            val idx = all.indexOfFirst { it.id == eid }.coerceAtLeast(0)
            if (all.isNotEmpty()) Play.episode(ctx, media, all, idx)
        }
    }

    LazyColumn(Modifier.fillMaxSize().background(NfBg)) {
        item {
            Box(Modifier.fillMaxWidth().height(if (tv) 300.dp else 260.dp)) {
                AsyncImage(model = det?.backdrop?.ifEmpty { null } ?: media.backdrop.ifEmpty { media.poster }, contentDescription = null,
                    contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x33000000), Color(0x99141414), NfBg))))
            }
        }
        item {
            Row(Modifier.padding(horizontal = sidePad()).padding(top = 0.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Poster(media.poster, media.name, Modifier.width(if (tv) 150.dp else 110.dp).aspectRatio(2f / 3f).background(Color.Black, RoundedCornerShape(6.dp)))
                Column(Modifier.weight(1f)) {
                    Text(media.name, color = Color.White, fontSize = if (tv) 30.sp else 22.sp, fontWeight = FontWeight.Black)
                    val meta = listOfNotNull(
                        media.year.takeIf { it.isNotBlank() }, det?.duration?.takeIf { it.isNotBlank() },
                        media.rating.takeIf { it > 0 }?.let { "★ %.1f".format(it) }, det?.genre?.takeIf { it.isNotBlank() },
                    ).joinToString("  ·  ")
                    if (meta.isNotEmpty()) Text(meta, color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        val label = when {
                            media.kind == Kind.MOVIE && progress != null -> "Continuar"
                            lastEp != null -> lastEpLabel(seasons, lastEp.key)
                            else -> "Reproducir"
                        }
                        HeroButton(label, Icons.Filled.PlayArrow, true, Modifier.focusRequester(playFocus)) { play() }
                        HeroButton(if (fav) "En mi lista" else "Mi lista", if (fav) Icons.Filled.Check else Icons.Filled.Add, false) { fav = Cloud.toggleFav(media) }
                    }
                    if (media.kind == Kind.MOVIE && progress != null && progress.duration > 0) {
                        LinearProgressIndicator(progress = { progress.position.toFloat() / progress.duration }, color = NfRed, trackColor = Color(0x44FFFFFF),
                            modifier = Modifier.padding(top = 10.dp).width(220.dp).height(3.dp))
                    }
                }
            }
        }
        item {
            Column(Modifier.padding(horizontal = sidePad(), vertical = 14.dp)) {
                if (det == null) Text("Cargando información…", color = NfGray2)
                val plot = det?.plot?.ifBlank { null } ?: media.plot
                if (plot.isNotBlank()) Text(plot, color = Color(0xFFDDDDDD), fontSize = 15.sp, lineHeight = 21.sp)
                det?.cast?.takeIf { it.isNotBlank() }?.let { Text("Elenco: $it", color = NfGray2, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp)) }
                det?.director?.takeIf { it.isNotBlank() }?.let { Text("Dirección: $it", color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
            }
        }
        if (media.kind == Kind.SERIES && seasons.isNotEmpty()) {
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = sidePad()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(seasons.keys.toList()) { n -> Chip("Temporada $n", n == season) { season = n } }
                }
            }
            val eps = seasons[season].orEmpty()
            val all = seasons.values.flatten()
            itemsIndexed(eps, key = { _, e -> e.id }) { _, e ->
                EpisodeRow(e, media, Cloud.progress("series:${media.id}:${e.id}")?.let { if (it.duration > 0) it.position.toFloat() / it.duration else 0f } ?: 0f) {
                    Play.episode(ctx, media, all, all.indexOf(e).coerceAtLeast(0))
                }
            }
        }
        item { Spacer(Modifier.height(40.dp)) }
    }
}

@Composable
private fun EpisodeRow(e: Episode, series: Item, progress: Float, onClick: () -> Unit) {
    FocusBox(onClick = onClick, focusScale = 1.02f, modifier = Modifier.padding(horizontal = sidePad(), vertical = 6.dp).fillMaxWidth()) { f ->
        Row(Modifier.background(if (f) Color(0xFF2A2A2A) else Color.Transparent).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(150.dp).aspectRatio(16f / 9f)) {
                Poster(e.image.ifEmpty { series.poster }, "E${e.num}", Modifier.fillMaxSize())
                if (progress > 0f) LinearProgressIndicator(progress = { progress }, color = NfRed, trackColor = Color(0x66FFFFFF),
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp))
            }
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text("${e.num}. " + e.title.ifBlank { "Episodio ${e.num}" }, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (e.duration.isNotBlank()) Text(e.duration, color = NfGray2, fontSize = 12.sp)
                if (e.plot.isNotBlank()) Text(e.plot, color = NfGray2, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** "Continuar T1 E3" a partir de la clave "series:5:301" */
private fun lastEpLabel(seasons: Map<Int, List<Episode>>, key: String): String {
    val eid = key.split(":").getOrNull(2)?.toIntOrNull() ?: return "Continuar"
    val e = seasons.values.flatten().firstOrNull { it.id == eid } ?: return "Continuar"
    return "Continuar T${e.season} E${e.num}"
}
