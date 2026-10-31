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
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.border
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.foundation.lazy.items
import kotlinx.coroutines.delay

/**
 * Actor en la TV como Roku y Vega OS: foto, nombre, nacimiento y el comienzo de la biografía de TMDB con el botón
 * «Leer biografía» (la completa en una ventana que se recorre con el control) y debajo «Disponible en el servidor»: las
 * películas y series del servidor en las que actúa. OK abre la ficha.
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
    val bioBtn = remember { FocusRequester() }
    var bioOpen by remember { mutableStateOf(false) }
    val bio = person?.bio.orEmpty()
    val hasBioBtn = bio.length > 180
    val onTop = com.latmpx.player.ui.LocalLayerOnTop.current
    // el foco entra a «Leer biografía» (si la hay) o al primer título, en cuanto hay datos
    LaunchedEffect(p != null) {
        if (p == null || !onTop) return@LaunchedEffect
        delay(80)
        runCatching { if (hasBioBtn) bioBtn.requestFocus() else if (p.items.isNotEmpty()) first.requestFocus() }
    }
    if (bioOpen) BioDialog(person?.name ?: actor.name, bio) { bioOpen = false }

    BoxWithConstraints(Modifier.fillMaxSize().background(NfBg)) {
        val k = maxHeight.value / 1080f
        LazyVerticalGrid(
            columns = GridCells.Adaptive(w), contentPadding = PaddingValues(start = pad, end = pad, top = (60 * k).dp, bottom = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(key = "head", span = { GridItemSpan(maxLineSpan) }) {
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(bottom = (30 * k).dp)) {
                    val photo = person?.photo?.ifEmpty { null } ?: actor.photo.ifEmpty { null }
                    Box(Modifier.width((240 * k).dp).height((360 * k).dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFF262626)), contentAlignment = Alignment.Center) {
                        Text(actor.name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }, color = Color(0xFF888888), fontSize = 40.sp, fontWeight = FontWeight.Bold)
                        if (photo != null) AsyncImage(model = photo, contentDescription = actor.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    }
                    Spacer(Modifier.width((40 * k).dp))
                    Column(Modifier.weight(1f).widthIn(max = (1300 * k).dp)) {
                        Text(person?.name ?: actor.name, color = Color.White, fontSize = (60 * k).sp, fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val facts = listOfNotNull(person?.birthday?.ifBlank { null }?.let { tr(R.string.born, it) }, person?.place?.ifBlank { null }).joinToString(" · ")
                        if (facts.isNotEmpty()) Text(facts, color = Color(0xFFB3B3B3), fontSize = (26 * k).sp, modifier = Modifier.padding(top = (8 * k).dp))
                        // la biografía tiene su espacio (3 líneas) y la completa se lee aparte: nunca tapa la filmografía
                        if (bio.isNotBlank()) Text(bio, color = Color.White, fontSize = (26 * k).sp, lineHeight = (38 * k).sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = (16 * k).dp))
                        if (hasBioBtn) Box(Modifier.padding(top = (12 * k).dp)) {
                            NfButton(stringResource(R.string.read_bio), Icons.Filled.Info, white = false, modifier = Modifier.focusRequester(bioBtn)) { bioOpen = true }
                        }
                        Text(
                            when {
                                p == null -> stringResource(R.string.actor_searching)
                                p.items.isEmpty() -> if (person == null) stringResource(R.string.actor_none) else stringResource(R.string.actor_none_name, person.name)
                                else -> stringResource(R.string.actor_available, p.items.size)
                            },
                            color = if (p != null && p.items.isNotEmpty()) Color.White else Color(0xFFB3B3B3),
                            fontSize = (if (p != null && p.items.isNotEmpty()) 36 * k else 26 * k).sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = (26 * k).dp),
                        )
                        if (p == null) CircularProgressIndicator(color = NfRed, strokeWidth = 3.dp, modifier = Modifier.padding(top = 10.dp).size(28.dp))
                    }
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
}

/** trozos de la biografía para recorrerla con el control (cada uno toma el foco y la lista baja), como Vega */
private fun bioChunks(bio: String): List<String> {
    val out = ArrayList<String>()
    for (par in bio.split(Regex("\n+")).map { it.trim() }.filter { it.isNotEmpty() }) {
        var cur = StringBuilder()
        for (sen in Regex("[^.!?]+[.!?]*\\s*").findAll(par).map { it.value }.ifEmpty { sequenceOf(par) }) {
            if (cur.isNotEmpty() && cur.length + sen.length > 320) { out += cur.toString().trim(); cur = StringBuilder() }
            cur.append(sen)
        }
        if (cur.isNotBlank()) out += cur.toString().trim()
    }
    return out
}

/** la biografía completa: se recorre trozo a trozo con arriba / abajo; Cerrar (o Atrás) vuelve */
@Composable
private fun BioDialog(name: String, bio: String, onClose: () -> Unit) {
    val close = remember { FocusRequester() }
    val chunks = remember(bio) { bioChunks(bio) }
    LaunchedEffect(Unit) { delay(80); runCatching { close.requestFocus() } }
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xD9000000)), contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 640.dp).background(Color(0xFF1C1C1C), RoundedCornerShape(16.dp)).padding(28.dp)) {
                Text(name, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(bottom = 12.dp))
                androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 330.dp)) {
                    items(chunks.size) { i ->
                        com.latmpx.player.ui.components.FocusBox(onClick = {}, shape = RoundedCornerShape(8.dp), focusScale = 1f) { f ->
                            Text(
                                chunks[i], color = Color.White, fontSize = 16.sp, lineHeight = 24.sp,
                                modifier = Modifier.fillMaxWidth().border(2.dp, if (f) Color(0xFFB3B3B3) else Color.Transparent, RoundedCornerShape(8.dp)).padding(8.dp),
                            )
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.End) {
                    com.latmpx.player.ui.components.AppButton(stringResource(R.string.close), Modifier.focusRequester(close), primary = true, onClick = onClose)
                }
            }
        }
    }
}
