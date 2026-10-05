package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
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

@OptIn(ExperimentalMaterial3Api::class)
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
    
    var searchQuery by remember { mutableStateOf("") }
    
    val shown = remember(all, cat, favTick, state.refresh, Cloud.rev, searchQuery) {
        val filtered = when (cat) {
            ALL -> all
            FAVS -> all.filter { Cloud.isFav(it.key) }
            else -> all.filter { it.categoryId == cat }
        }
        if (searchQuery.isBlank()) filtered else filtered.filter { it.name.contains(searchQuery, ignoreCase = true) }
    }
    
    var focused by remember { mutableStateOf<Item?>(null) }
    var playingItem by remember { mutableStateOf<Item?>(null) }
    
    val play: (Int) -> Unit = { i -> 
        Store.setLastChannel(shown[i].id)
        if (tv) Play.live(ctx, shown, i) else playingItem = shown[i]
    }
    val fav: (Item) -> Unit = { ch -> Cloud.toggleFav(ch.copy(kind = Kind.LIVE)); favTick++ }

    if (tv) {
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
        var dropdownExpanded by remember { mutableStateOf(false) }
        val catName = cats.firstOrNull { it.first == cat }?.second ?: "Categorías"
        
        Column(Modifier.fillMaxSize().background(NfBg)) {
            // Player Area
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black)) {
                if (playingItem != null) {
                    val p = playingItem!!
                    val exoPlayer = remember { ExoPlayer.Builder(ctx).build() }
                    DisposableEffect(p) {
                        val urls = Xtream.liveUrls(s, p.id)
                        val url = urls.firstOrNull() ?: ""
                        val mediaItem = MediaItem.Builder().setUri(url).build()
                        exoPlayer.setMediaItem(mediaItem)
                        exoPlayer.prepare()
                        exoPlayer.playWhenReady = true
                        onDispose { exoPlayer.release() }
                    }
                    AndroidView(factory = {
                        PlayerView(ctx).apply {
                            player = exoPlayer
                            useController = true
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        }
                    }, modifier = Modifier.fillMaxSize())
                    
                    // Fullscreen button
                    IconButton(onClick = { 
                        val idx = shown.indexOf(p).coerceAtLeast(0)
                        Play.live(ctx, shown, idx) 
                    }, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)) {
                        Icon(Icons.Filled.Fullscreen, "Pantalla completa", tint = Color.White)
                    }
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Selecciona un canal", color = NfGray2)
                    }
                }
            }
            
            // Search & Filter
            Column(Modifier.padding(horizontal = sidePad(), vertical = 8.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        Row(Modifier.clickable { dropdownExpanded = true }.padding(4.dp).background(Color(0xFF222222), RoundedCornerShape(4.dp)).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(catName, color = Color.White)
                            Icon(Icons.Filled.ArrowDropDown, null, tint = Color.White)
                        }
                        DropdownMenu(expanded = dropdownExpanded, onDismissRequest = { dropdownExpanded = false }) {
                            cats.forEach { (k, n) -> DropdownMenuItem(text = { Text(n) }, onClick = { cat = k; dropdownExpanded = false }) }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    Text(" Canales", color = NfGray2, fontSize = 14.sp)
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = searchQuery, onValueChange = { searchQuery = it },
                    placeholder = { Text("Buscar canal...") },
                    leadingIcon = { Icon(Icons.Filled.Search, null) },
                    singleLine = true, modifier = Modifier.fillMaxWidth().height(50.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = Color(0xFF1A1A1A), unfocusedContainerColor = Color(0xFF1A1A1A),
                        focusedBorderColor = Color.Transparent, unfocusedBorderColor = Color.Transparent,
                        focusedTextColor = Color.White, unfocusedTextColor = Color.White
                    ),
                    shape = RoundedCornerShape(25.dp)
                )
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
            Text("", color = NfGray2, fontSize = 13.sp, modifier = Modifier.width(38.dp))
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
                Text(" - " + if (i == 0 && e.start <= System.currentTimeMillis()) "  ·  AHORA" else "",
                    color = if (i == 0) NfRed else NfGray2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(e.title, color = Color.White, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (i == 0 && e.desc.isNotBlank()) Text(e.desc, color = NfGray2, fontSize = 12.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
