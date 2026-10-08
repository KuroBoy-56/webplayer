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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.size
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
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Share
import androidx.compose.foundation.border
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
import androidx.compose.ui.draw.clip
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
import com.latmpx.player.data.Tmdb
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.Poster
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

@Composable
fun DetailScreen(state: AppState, media: Item) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    // TV: ficha igual que la web (TvDetail.kt)
    if (tv) { TvDetailScreen(state, media); return }
    val d by produceState<Details?>(null, media.key) {
        value = if (media.kind == Kind.SERIES) Xtream.seriesDetails(s, media) else Xtream.movieDetails(s, media)
    }
    val tmdb by produceState<Tmdb.Details?>(null, d) {
        val det = d ?: return@produceState
        value = Tmdb.getDetails(
            type = if (media.kind == Kind.SERIES) "tv" else "movie",
            title = media.name,
            year = media.year,
            tmdbId = det.tmdbId
        )
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
            Box(Modifier.fillMaxWidth().then(if (tv) Modifier.height(300.dp) else Modifier.aspectRatio(16f / 10f))) {
                AsyncImage(model = tmdb?.backdrop?.ifEmpty { null } ?: det?.backdrop?.ifEmpty { null } ?: media.backdrop.ifEmpty { media.poster }, contentDescription = null,
                    contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x33000000), Color(0x99141414), NfBg))))
            }
        }
        if (!tv) item {
            // celular: como la app de Netflix (título, datos, botones a todo el ancho)
            Column(Modifier.padding(horizontal = sidePad())) {
                Text(media.name, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Black, lineHeight = 30.sp)
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (media.rating > 0) Text("★ " + String.format(java.util.Locale.US, "%.1f", media.rating), color = Color(0xFF46D369), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    if (media.year.isNotBlank()) Text(media.year.take(4), color = NfGray2, fontSize = 14.sp)
                    det?.duration?.takeIf { it.isNotBlank() }?.let { Text(it, color = NfGray2, fontSize = 14.sp) }
                    if (media.kind == Kind.SERIES && seasons.isNotEmpty()) Text("${seasons.size} temporada" + if (seasons.size > 1) "s" else "", color = NfGray2, fontSize = 14.sp)
                    Text("HD", color = NfGray2, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.border(1.dp, NfGray2, RoundedCornerShape(3.dp)).padding(horizontal = 4.dp, vertical = 1.dp))
                }
                det?.genre?.takeIf { it.isNotBlank() }?.let { Text(it, color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
                Spacer(Modifier.height(14.dp))
                val label = when {
                    media.kind == Kind.MOVIE && progress != null -> "Continuar"
                    lastEp != null -> lastEpLabel(seasons, lastEp.key)
                    else -> "Reproducir"
                }
                WideButton(label, Icons.Filled.PlayArrow, true) { play() }
                if (media.kind == Kind.MOVIE && progress != null && progress.duration > 0) {
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        LinearProgressIndicator(progress = { progress.position.toFloat() / progress.duration }, color = NfRed, trackColor = Color(0x44FFFFFF), modifier = Modifier.weight(1f).height(3.dp))
                        Text("  Quedan " + com.latmpx.player.player.fmtTime(progress.duration - progress.position), color = NfGray2, fontSize = 12.sp)
                    }
                }
                tmdb?.trailer?.takeIf { it.isNotEmpty() }?.let { trailerId ->
                    Spacer(Modifier.height(8.dp))
                    WideButton("Ver tráiler", Icons.Filled.Movie, false) { openTrailer(ctx, trailerId) }
                }
                val plot = tmdb?.overview?.ifBlank { null } ?: det?.plot?.ifBlank { null } ?: media.plot
                if (plot.isNotBlank()) Text(plot, color = Color(0xFFE5E5E5), fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 14.dp))
                val castLine = tmdb?.cast?.take(4)?.joinToString(", ") { it.name }?.ifBlank { null } ?: det?.cast?.split(",")?.take(4)?.joinToString(", ") { it.trim() }.orEmpty()
                if (castLine.isNotBlank()) Text("Elenco: $castLine", color = NfGray2, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
                det?.director?.takeIf { it.isNotBlank() }?.let { Text("Dirección: $it", color = NfGray2, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp)) }
                Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    IconAction(if (fav) Icons.Filled.Check else Icons.Filled.Add, "Mi lista") { fav = Cloud.toggleFav(media) }
                    tmdb?.trailer?.takeIf { it.isNotEmpty() }?.let { t -> IconAction(Icons.Filled.Movie, "Tráiler") { openTrailer(ctx, t) } }
                    IconAction(Icons.Filled.Share, "Compartir") {
                        val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, "Mira \"${media.name}\" en LatMpx")
                        runCatching { ctx.startActivity(android.content.Intent.createChooser(send, "Compartir")) }
                    }
                }
            }
        }
        if (tv) item {
            Row(Modifier.padding(horizontal = sidePad()).padding(top = 0.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Poster(tmdb?.poster?.ifEmpty { null } ?: media.poster, media.name, Modifier.width(if (tv) 150.dp else 110.dp).aspectRatio(2f / 3f).background(Color.Black, RoundedCornerShape(6.dp)))
                Column(Modifier.weight(1f)) {
                    Text(media.name, color = Color.White, fontSize = if (tv) 30.sp else 22.sp, fontWeight = FontWeight.Black)
                    val meta = listOfNotNull(
                        media.year.takeIf { it.isNotBlank() }, det?.duration?.takeIf { it.isNotBlank() },
                        media.rating.takeIf { it > 0 }?.let { "★ %.1f".format(it) }, det?.genre?.takeIf { it.isNotBlank() },
                    ).joinToString("  ·  ")
                    if (meta.isNotEmpty()) Text(meta, color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState())) {
                        val label = when {
                            media.kind == Kind.MOVIE && progress != null -> "Continuar"
                            lastEp != null -> lastEpLabel(seasons, lastEp.key)
                            else -> "Reproducir"
                        }
                        HeroButton(label, Icons.Filled.PlayArrow, true, Modifier.focusRequester(playFocus)) { play() }
                        tmdb?.trailer?.takeIf { it.isNotEmpty() }?.let { trailerId ->
                            HeroButton("Tráiler", Icons.Filled.PlayArrow, false) {
                                try {
                                    ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("vnd.youtube:" + trailerId)))
                                } catch (e: Exception) {
                                    ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/watch?v=" + trailerId)))
                                }
                            }
                        }
                        HeroButton(if (fav) "En mi lista" else "Mi lista", if (fav) Icons.Filled.Check else Icons.Filled.Add, false) { fav = Cloud.toggleFav(media) }
                    }
                    if (media.kind == Kind.MOVIE && progress != null && progress.duration > 0) {
                        LinearProgressIndicator(progress = { progress.position.toFloat() / progress.duration }, color = NfRed, trackColor = Color(0x44FFFFFF),
                            modifier = Modifier.padding(top = 10.dp).width(220.dp).height(3.dp))
                    }
                }
            }
        }
        if (tv || det == null) item {
            Column(Modifier.padding(horizontal = sidePad(), vertical = 14.dp)) {
                if (det == null) Text("Cargando información…", color = NfGray2)
                val plot = tmdb?.overview?.ifBlank { null } ?: det?.plot?.ifBlank { null } ?: media.plot
                if (tv && plot.isNotBlank()) Text(plot, color = Color(0xFFDDDDDD), fontSize = 15.sp, lineHeight = 21.sp)
                if (tv) det?.director?.takeIf { it.isNotBlank() }?.let { Text("Dirección: $it", color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp)) }
            }
        }
        
        if (tmdb?.cast?.isNotEmpty() == true) {
            item {
                Text("Elenco", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = sidePad(), vertical = 8.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = sidePad()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(tmdb!!.cast) { actor ->
                        FocusBox(onClick = { state.push(Route.ActorPage(actor.name, actor.id, actor.profile)) }, focusScale = 1.05f, shape = RoundedCornerShape(8.dp)) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(80.dp).padding(vertical = 4.dp)) {
                            val url = actor.profile.ifEmpty { "https://ui-avatars.com/api/?name=${java.net.URLEncoder.encode(actor.name, "UTF-8")}&background=333&color=fff" }
                            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(60.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color(0xFF333333)))
                            Text(actor.name, color = Color.White, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                            if (actor.character.isNotEmpty()) {
                                Text(actor.character, color = NfGray2, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                            }
                        }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        } else if (det?.cast?.isNotBlank() == true) {
            item {
                Text("Elenco", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = sidePad(), vertical = 8.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = sidePad()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val actors = det.cast.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                    items(actors) { actor ->
                        FocusBox(onClick = { state.push(Route.ActorPage(actor)) }, focusScale = 1.05f, shape = RoundedCornerShape(8.dp)) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(80.dp).padding(vertical = 4.dp)) {
                            val url = "https://ui-avatars.com/api/?name=${java.net.URLEncoder.encode(actor, "UTF-8")}&background=333&color=fff"
                            AsyncImage(model = url, contentDescription = null, modifier = Modifier.size(60.dp).clip(androidx.compose.foundation.shape.CircleShape))
                            Text(actor, color = NfGray2, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                        }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
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
        item {
            val all = if (media.kind == Kind.MOVIE) state.movies else state.series
            val similar = remember(all, media.categoryId, media.id) {
                all.filter { it.categoryId == media.categoryId && it.id != media.id }.shuffled().take(24)
            }
            if (similar.isNotEmpty()) {
                Spacer(Modifier.height(24.dp))
                Text("Sugerencias", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = sidePad()).padding(bottom = 12.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = sidePad()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(similar) { it ->
                        PosterCard(it, if (tv) 150.dp else 110.dp, onClick = { state.push(Route.Detail(it)) })
                    }
                }
            }
        }
        item { Spacer(Modifier.height(40.dp)) }
    }
}

private fun openTrailer(ctx: android.content.Context, id: String) {
    try { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("vnd.youtube:$id"))) }
    catch (e: Exception) { runCatching { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/watch?v=$id"))) } }
}

@Composable
private fun WideButton(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, primary: Boolean, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(5.dp), focusScale = 1.02f) { f ->
        Row(
            Modifier.fillMaxWidth().background(if (primary) Color.White else if (f) Color(0x80FFFFFF) else Color(0xFF2E2E2E)).padding(vertical = 11.dp),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
        ) {
            val c = if (primary) Color.Black else Color.White
            androidx.compose.material3.Icon(icon, null, tint = c, modifier = Modifier.size(24.dp))
            Text(text, color = c, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.padding(start = 6.dp))
        }
    }
}

@Composable
private fun IconAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    FocusBox(onClick = onClick, shape = RoundedCornerShape(8.dp), focusScale = 1.05f) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            androidx.compose.material3.Icon(icon, label, tint = Color.White, modifier = Modifier.size(26.dp))
            Text(label, color = NfGray2, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
        }
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
