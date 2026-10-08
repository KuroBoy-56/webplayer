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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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
import com.latmpx.player.ui.components.TvCard
import com.latmpx.player.ui.components.tvCardWidth
import com.latmpx.player.ui.components.tvPad
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.delay

/**
 * Actor en la TV (como la página de actor de la app de Windows): foto, datos y biografía de TMDB a la izquierda
 * y debajo la rejilla con las películas y series del servidor en las que actúa. OK abre la ficha.
 */
@Composable
fun TvActorScreen(state: AppState, actor: Route.ActorPage) {
    val page by produceState<Actor.Page?>(null, actor, state.movies.size, state.series.size) {
        value = Actor.load(actor.name, actor.tmdbId, state.movies, state.series)
    }
    val p = page
    val person = p?.person
    val w = tvCardWidth()
    val pad = tvPad()
    val progress = remember(state.refresh, Cloud.rev) { Cloud.progressList().associateBy { it.key.split(":").take(2).joinToString(":") } }
    val first = remember { FocusRequester() }
    // el foco entra al primer título en cuanto hay resultados
    LaunchedEffect(p?.items?.isNotEmpty()) {
        if (p?.items?.isNotEmpty() == true) { delay(80); runCatching { first.requestFocus() } }
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(w), contentPadding = PaddingValues(start = pad, end = pad, top = 20.dp, bottom = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier.fillMaxSize().background(NfBg),
    ) {
        item(key = "head", span = { GridItemSpan(maxLineSpan) }) {
            Row(verticalAlignment = Alignment.Top) {
                val photo = person?.photo?.ifEmpty { null } ?: actor.photo.ifEmpty { null }
                Box(Modifier.width(150.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp)).background(Color(0xFF262626)), contentAlignment = Alignment.Center) {
                    Text(actor.name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }, color = Color(0xFF888888), fontSize = 40.sp, fontWeight = FontWeight.Bold)
                    if (photo != null) AsyncImage(model = photo, contentDescription = actor.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                Spacer(Modifier.width(28.dp))
                Column(Modifier.weight(1f)) {
                    Text(person?.name ?: actor.name, color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 40.sp)
                    val facts = listOfNotNull(person?.birthday?.ifBlank { null }?.let { "Nació: $it" }, person?.place?.ifBlank { null }).joinToString("  •  ")
                    if (facts.isNotEmpty()) Text(facts, color = Color(0xFFB3B3B3), fontSize = 15.sp, modifier = Modifier.padding(top = 6.dp))
                    val bio = person?.bio.orEmpty()
                    if (bio.isNotBlank()) Text(bio, color = Color(0xFFDDDDDD), fontSize = 16.sp, lineHeight = 23.sp, maxLines = 7, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp))
                }
            }
        }
        item(key = "title", span = { GridItemSpan(maxLineSpan) }) {
            when {
                p == null -> Row(Modifier.fillMaxWidth().padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(color = NfRed, strokeWidth = 3.dp, modifier = Modifier.size(28.dp))
                    Text("   Buscando sus títulos en el servidor…", color = Color(0xFFB3B3B3), fontSize = 16.sp)
                }
                p.items.isEmpty() -> Text(
                    if (person == null) "No se pudo consultar la filmografía y el servidor no tiene títulos con este actor."
                    else "El servidor no tiene títulos de ${person.name} por ahora.",
                    color = Color(0xFFB3B3B3), fontSize = 17.sp, modifier = Modifier.padding(top = 20.dp),
                )
                else -> Text("Disponible en el servidor (${p.items.size})", color = Color(0xFFE5E5E5), fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))
            }
        }
        itemsIndexed(p?.items.orEmpty(), key = { _, it -> it.key }) { i, it ->
            val pr = progress[it.key]
            Box(if (i == 0) Modifier.focusRequester(first) else Modifier) {
                TvCard(it, w, progress = if (pr != null && pr.duration > 0) pr.position.toFloat() / pr.duration else 0f) { state.push(Route.Detail(it)) }
            }
        }
    }
}
