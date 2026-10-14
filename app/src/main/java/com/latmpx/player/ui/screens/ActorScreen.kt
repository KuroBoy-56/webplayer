package com.latmpx.player.ui.screens

import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Actor
import com.latmpx.player.data.Cloud
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/**
 * Actor del elenco: foto y biografía de TMDB y, debajo, las películas y series del servidor en las que actúa
 * (filmografía de TMDB cruzada con el catálogo; ver data/Actor.kt).
 */
@Composable
fun ActorScreen(state: AppState, actor: Route.ActorPage) {
    // TV: diseño de la web a escala de televisor (TvActor.kt)
    if (com.latmpx.player.ui.components.LocalIsTv.current) { TvActorScreen(state, actor); return }
    val page by produceState<Actor.Page?>(null, actor, state.movies.size, state.series.size) {
        value = Actor.load(actor.name, actor.tmdbId, state.movies, state.series)
    }
    val p = page
    val person = p?.person
    val progress = remember(state.refresh, Cloud.rev) { Cloud.progressList().associateBy { it.key.split(":").take(2).joinToString(":") } }
    val pw = posterWidth()
    var bioOpen by remember(actor) { mutableStateOf(false) }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(pw), contentPadding = PaddingValues(start = sidePad(), end = sidePad(), top = 16.dp, bottom = 60.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier.fillMaxSize().background(NfBg),
    ) {
        item(key = "head", span = { GridItemSpan(maxLineSpan) }) {
            Row(verticalAlignment = Alignment.Top) {
                val photo = person?.photo?.ifEmpty { null } ?: actor.photo.ifEmpty { null }
                Box(Modifier.width(110.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)).background(Color(0xFF2A2A2A)), contentAlignment = Alignment.Center) {
                    Text(actor.name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }, color = NfGray2, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                    if (photo != null) AsyncImage(model = photo, contentDescription = actor.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(person?.name ?: actor.name, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black, lineHeight = 28.sp)
                    val facts = listOfNotNull(person?.birthday?.ifBlank { null }?.let { tr(R.string.born, it) }, person?.place?.ifBlank { null }).joinToString(" · ")
                    if (facts.isNotEmpty()) Text(facts, color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                    val bio = person?.bio.orEmpty()
                    if (bio.isNotBlank()) {
                        FocusBox(onClick = { bioOpen = !bioOpen }, focusScale = 1f, shape = RoundedCornerShape(4.dp), modifier = Modifier.padding(top = 8.dp)) {
                            Column {
                                Text(bio, color = Color(0xFFDDDDDD), fontSize = 14.sp, lineHeight = 20.sp, maxLines = if (bioOpen) Int.MAX_VALUE else 5, overflow = TextOverflow.Ellipsis)
                                Text(stringResource(if (bioOpen) R.string.see_less else R.string.see_more), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                }
            }
        }
        item(key = "title", span = { GridItemSpan(maxLineSpan) }) {
            when {
                p == null -> Row(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(color = NfRed, modifier = Modifier.width(26.dp).height(26.dp), strokeWidth = 3.dp)
                    Text("  " + stringResource(R.string.actor_searching), color = NfGray2, fontSize = 14.sp)
                }
                p.items.isEmpty() -> Text(
                    if (person == null) stringResource(R.string.actor_none)
                    else stringResource(R.string.actor_none_name, person.name),
                    color = NfGray2, fontSize = 15.sp, modifier = Modifier.padding(top = 24.dp),
                )
                else -> Text(stringResource(R.string.actor_available, p.items.size), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 18.dp))
            }
        }
        items(p?.items.orEmpty(), key = { it.key }) { it ->
            val pr = progress[it.key]
            PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, progress = if (pr != null && pr.duration > 0) pr.position.toFloat() / pr.duration else 0f)
        }
    }
}
