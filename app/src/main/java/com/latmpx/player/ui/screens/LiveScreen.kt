package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.R
import com.latmpx.player.data.EpgEntry
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.PanelEpg
import com.latmpx.player.data.Store
import com.latmpx.player.data.Xtream
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed
import java.text.SimpleDateFormat
import java.util.Locale

private const val FAVS = "__favs"
private const val ALL = "__all"

@Composable
fun LiveScreen(state: AppState) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val channels by produceState<List<Item>?>(null, s) { value = Xtream.items(s, Kind.LIVE) }
    var cat by rememberSaveable { mutableStateOf(ALL) }
    var favTick by remember { mutableIntStateOf(0) }
    val all = channels
    if (all == null) { Loading("Cargando canales…"); return }
    val cats = remember(state.liveCats) { listOf(FAVS to "★ Favoritos", ALL to "Todos") + state.liveCats.map { it.id to it.name } }
    val shown = remember(all, cat, favTick, state.refresh, Cloud.rev) {
        when (cat) {
            ALL -> all
            FAVS -> all.filter { Cloud.isFav(it.key) }
            else -> all.filter { it.categoryId == cat }
        }
    }
    var focused by remember { mutableStateOf<Item?>(null) }
    val play: (Int) -> Unit = { i -> Store.setLastChannel(shown[i].id); Play.live(ctx, shown, i) }
    val fav: (Item) -> Unit = { ch -> Cloud.toggleFav(ch.copy(kind = Kind.LIVE)); favTick++ }

    if (tv) {
        // TV: categorías | canales | guía del canal seleccionado
        Row(Modifier.fillMaxSize().background(NfBg)) {
            LazyColumn(Modifier.width(230.dp).fillMaxHeight().background(Color(0xFF101010)), contentPadding = PaddingValues(vertical = 12.dp)) {
                items(cats, key = { it.first }) { (id, name) ->
                    FocusBox(onClick = { cat = id }, onFocus = { cat = id }, focusScale = 1.03f, shape = RoundedCornerShape(6.dp),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp).fillMaxWidth()) { f ->
                        Text(name, color = if (cat == id || f) Color.White else NfGray2, fontWeight = if (cat == id) FontWeight.Bold else FontWeight.Normal,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.fillMaxWidth().background(if (f) Color(0x33FFFFFF) else if (cat == id) Color(0x1AFFFFFF) else Color.Transparent).padding(horizontal = 12.dp, vertical = 10.dp))
                    }
                }
            }
            LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = PaddingValues(12.dp)) {
                if (shown.isEmpty()) item { Text(if (cat == FAVS) "Mantén presionado OK sobre un canal para agregarlo a favoritos" else "Sin canales", color = NfGray2, modifier = Modifier.padding(20.dp)) }
                itemsIndexed(shown, key = { _, c -> c.id }) { i, ch ->
                    ChannelRow(ch, i + 1, onClick = { play(i) }, onLong = { fav(ch) }, onFocus = { focused = ch })
                }
            }
            EpgPanel(state, focused, shown, Modifier.width(320.dp).fillMaxHeight())
        }
    } else {
        Column(Modifier.fillMaxSize().background(NfBg)) {
            Text("TV en vivo", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = sidePad(), top = 16.dp, bottom = 6.dp))
            LazyRow(contentPadding = PaddingValues(horizontal = sidePad(), vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(cats, key = { it.first }) { (id, name) -> Chip(name, cat == id) { cat = id } }
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                if (shown.isEmpty()) item { Empty(if (cat == FAVS) "Mantén presionado un canal para agregarlo a favoritos" else "Sin canales") }
                itemsIndexed(shown, key = { _, c -> c.id }) { i, ch -> ChannelRow(ch, i + 1, onClick = { play(i) }, onLong = { fav(ch) }) }
            }
        }
    }
}

@Composable
private fun ChannelRow(ch: Item, num: Int, onClick: () -> Unit, onLong: () -> Unit, onFocus: (() -> Unit)? = null) {
    val isFav = Cloud.isFav(ch.key)
    FocusBox(onClick = onClick, onLongClick = onLong, onFocus = onFocus, focusScale = 1.02f, modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) { f ->
        Row(
            Modifier.fillMaxWidth().background(if (f) Color(0xFF2E2E2E) else Color(0xFF1A1A1A)).padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("$num", color = NfGray2, fontSize = 13.sp, modifier = Modifier.width(38.dp))
            Box(Modifier.size(width = 64.dp, height = 40.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFF0E0E0E)), contentAlignment = Alignment.Center) {
                AsyncImage(model = ch.poster.ifBlank { R.drawable.logo }, contentDescription = null, contentScale = ContentScale.Fit,
                    error = androidx.compose.ui.res.painterResource(R.drawable.logo), modifier = Modifier.fillMaxSize().padding(3.dp))
            }
            Text(ch.name, color = Color.White, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 12.dp))
            if (isFav) Icon(Icons.Filled.Star, null, tint = Color(0xFFFFC107), modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun EpgPanel(state: AppState, ch: Item?, shown: List<Item>, modifier: Modifier) {
    val s = state.session
    val epg by produceState<List<EpgEntry>>(emptyList(), ch?.id) {
        value = emptyList()
        if (ch != null && s != null) {
            kotlinx.coroutines.delay(350) // espera a que el foco se detenga en un canal
            // primero la guía del proveedor; si no trae, la de respaldo del panel (lote con los canales vecinos)
            value = Xtream.shortEpg(s, ch.id).ifEmpty {
                val i = shown.indexOfFirst { it.id == ch.id }.coerceAtLeast(0)
                PanelEpg.guide(ch, shown.subList((i - 50).coerceAtLeast(0), (i + 350).coerceAtMost(shown.size)))
            }
        }
    }
    val hm = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }
    Column(modifier.background(Color(0xFF101010)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (ch == null) { Text("Elige un canal para ver su programación", color = NfGray2); return@Column }
        Text(ch.name, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 2)
        if (epg.isEmpty()) Text("Sin guía disponible para este canal", color = NfGray2, fontSize = 13.sp)
        epg.forEachIndexed { i, e ->
            Column {
                Text("${hm.format(e.start)} - ${hm.format(e.end)}" + if (i == 0 && e.start <= System.currentTimeMillis()) "  ·  AHORA" else "",
                    color = if (i == 0) NfRed else NfGray2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(e.title, color = Color.White, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (i == 0 && e.desc.isNotBlank()) Text(e.desc, color = NfGray2, fontSize = 12.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
