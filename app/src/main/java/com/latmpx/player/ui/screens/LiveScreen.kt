package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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

internal const val FAVS = "__favs"
internal const val ALL = "__all"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveScreen(state: AppState) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    // canales guardados en el equipo (AppState.live); si aún no hay copia se piden al servidor
    val fetched by produceState<List<Item>?>(null, s, state.live.isEmpty()) { if (state.live.isEmpty()) value = Xtream.items(s, Kind.LIVE) }
    var cat by rememberSaveable { mutableStateOf(ALL) }
    var favTick by remember { mutableIntStateOf(0) }
    val all = state.live.ifEmpty { null } ?: fetched
    if (all == null) { Loading(stringResource(R.string.loading_channels)); return }
    val cats = remember(state.liveCats) { listOf(FAVS to "★ " + tr(R.string.favorites), ALL to tr(R.string.all)) + state.liveCats.filter { it.id !in com.latmpx.player.data.Store.blockedCats }.map { it.id to it.name } }
    // celular: diseño de tvguide.php de la web (ver LivePhone.kt)
    if (!tv) { PhoneLive(state, all, cats); return }
    
    // TV: estilo TiviMate (TvLive.kt)
    TvLive(state, all, cats)
}

@Composable
private fun ChannelRow(ch: Item, num: Int, onClick: () -> Unit, onLong: () -> Unit, onFocus: (() -> Unit)? = null) {
    val f = Cloud.isFav(ch.key)
    FocusBox(onClick = onClick, onLongClick = onLong, onFocus = onFocus, focusScale = 1.02f, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) { foc ->
        Row(Modifier.fillMaxWidth().background(if (foc) Color(0x33FFFFFF) else Color.Transparent).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("", color = NfGray2, fontSize = 14.sp, modifier = Modifier.width(36.dp))
            AsyncImage(model = ch.poster, contentDescription = null, modifier = Modifier.size(50.dp, 36.dp), placeholder = androidx.compose.ui.res.painterResource(R.drawable.logo))
            Spacer(Modifier.width(12.dp))
            Text(ch.name, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(if (f) Icons.Filled.Star else Icons.Filled.StarBorder, null, tint = if (f) NfRed else Color(0x80FFFFFF), modifier = Modifier.size(20.dp).clickable { onLong() }.padding(2.dp))
        }
    }
}

@Composable
private fun EpgPanel(state: AppState, focus: Item?, shown: List<Item>, modifier: Modifier) {
    val s = state.session ?: return
    var epg by remember { mutableStateOf<List<EpgEntry>?>(null) }
    var epgCh by remember { mutableIntStateOf(-1) }
    val ch = focus ?: shown.firstOrNull()
    
    LaunchedEffect(ch?.id) {
        if (ch == null) return@LaunchedEffect
        epg = emptyList()
        epg = PanelEpg.guide(ch, shown)
        epgCh = ch.id
    }
    
    Column(modifier.background(Color(0xFF161616)).padding(16.dp)) {
        if (ch == null) return
        AsyncImage(model = ch.poster, contentDescription = null, modifier = Modifier.height(60.dp).fillMaxWidth().padding(bottom = 12.dp))
        Text(ch.name, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 16.dp))
        if (epgCh == ch.id) {
            val now = System.currentTimeMillis()
            val valid = epg?.filter { it.end > now - 3600_000 }?.take(15) ?: emptyList()
            if (valid.isEmpty()) {
                Text(stringResource(R.string.guide_unavailable), color = NfGray2)
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    items(valid) { e ->
                        val isNow = now in e.start..e.end
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(tf(e.start) + " - " + tf(e.end), color = if (isNow) NfRed else NfGray2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                if (isNow) {
                                    Spacer(Modifier.width(8.dp))
                                    com.latmpx.player.ui.components.Chip(stringResource(R.string.now_badge), true) {}
                                }
                            }
                            Text(e.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 2.dp))
                            if (isNow && e.desc.isNotEmpty()) {
                                Text(e.desc, color = NfGray2, fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                }
            }
        } else {
            Text(stringResource(R.string.loading_guide), color = NfGray2)
        }
    }
}
private val tf = SimpleDateFormat("HH:mm", Locale.US)
private fun tf(ms: Long) = tf.format(ms)
