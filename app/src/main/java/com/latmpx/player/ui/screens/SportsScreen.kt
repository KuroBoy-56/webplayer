package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.SportEvent
import com.latmpx.player.ui.theme.NfRed
import com.latmpx.player.data.TvChannel
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.heightIn
import com.latmpx.player.data.Sports
import com.latmpx.player.data.SportsData
import com.latmpx.player.data.Xtream
import com.latmpx.player.player.Play
import com.latmpx.player.ui.components.tvTextInput
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.theme.NfBg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar

private fun dayKey(t: Long): Int = Calendar.getInstance(Sports.zone).apply { timeInMillis = t }.let { it.get(Calendar.YEAR) * 1000 + it.get(Calendar.DAY_OF_YEAR) }

/** Deportes: misma agenda y mismo diseño que sportsschedule.php de la web, con los datos de api/sports.php. */
@Composable
fun SportsScreen(state: AppState) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    val data by produceState<SportsData?>(null, reload) { value = Sports.load() }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(data) { if (data != null) loaded = true }
    LaunchedEffect(reload) { delay(15_000); if (data == null) loaded = true }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    var day by rememberSaveable { mutableIntStateOf(-1) }
    var sport by rememberSaveable { mutableStateOf("") }
    var q by rememberSaveable { mutableStateOf("") }

    val d = data
    if (d == null) { if (loaded) Empty(stringResource(R.string.sports_unavailable)) else Loading(stringResource(R.string.loading_matches)); return }
    val keys = remember(now / 3_600_000) { listOf(dayKey(System.currentTimeMillis()), dayKey(System.currentTimeMillis() + 86_400_000)) }
    // si hoy no queda nada, se abre mañana
    val curDay = if (day >= 0) day else if (d.events.any { dayKey(it.start) == keys[0] }) 0 else 1
    val ofDay = d.events.filter { dayKey(it.start) == keys[curDay] }
    val counts = ofDay.groupingBy { it.sport }.eachCount()
    val ql = q.trim().lowercase()
    val visible = ofDay.filter { e ->
        (sport.isEmpty() || e.sport == sport) &&
            (ql.isEmpty() || Sports.matches(e, d.sports[e.sport]?.label.orEmpty(), ql))
    }
    val live = d.events.filter { spStatus(it, d.sports[it.sport], now) == SpStatus.LIVE && (sport.isEmpty() || it.sport == sport) }
    val showLive = live.isNotEmpty() && curDay == 0 && ql.isEmpty()
    val groups = visible.filter { !(showLive && spStatus(it, d.sports[it.sport], now) == SpStatus.LIVE) }
        .groupBy { it.league.ifEmpty { d.sports[it.sport]?.label ?: it.sport } }

    // menú del evento: ver (búsqueda automática), cada canal que lo transmite o buscar por equipos
    var pick by remember { mutableStateOf<SportEvent?>(null) }

    /** channel = canal elegido del menú; byEvent = buscar solo por equipos / nombre del evento */
    fun watch(e: SportEvent, channel: TvChannel? = null, byEvent: Boolean = false) {
        val st = spStatus(e, d.sports[e.sport], now)
        if (dayKey(e.start) != keys[0] || st == SpStatus.FIN || st == SpStatus.POSTPONED) {
            Toast.makeText(ctx, tr(if (st == SpStatus.FIN && dayKey(e.start) == keys[0]) R.string.event_over else R.string.event_offline), Toast.LENGTH_SHORT).show()
            return
        }
        Toast.makeText(ctx, if (channel != null) tr(R.string.searching_x, channel.name) else tr(R.string.searching_channel), Toast.LENGTH_SHORT).show()
        scope.launch {
            val channels = Xtream.items(s, Kind.LIVE)
            val cats = state.liveCats.ifEmpty { Xtream.categories(s, Kind.LIVE) }
            val (match, chans) = withContext(Dispatchers.Default) {
                val prepared = Sports.prepare(channels, cats, d.rules)
                val m = when {
                    channel != null -> Sports.findByChannel(channel.name, prepared).firstOrNull()
                    byEvent -> Sports.find(e, prepared, d.rules)
                    else -> Sports.best(e, prepared, d.rules)
                }
                m to prepared
            }
            if (match != null) {
                playInCategory(ctx, channels, match)
                return@launch
            }
            // el canal elegido no está en la lista del cliente: se busca el evento (equipos / nombre) en las carpetas de eventos
            if (channel != null) {
                val ev = withContext(Dispatchers.Default) { Sports.find(e, chans, d.rules) }
                if (ev != null) {
                    Toast.makeText(ctx, tr(R.string.channel_missing_showing, channel.name, ev.name), Toast.LENGTH_LONG).show()
                    playInCategory(ctx, channels, ev)
                    return@launch
                }
            }
            // sin canal exacto: se abre la primera carpeta de eventos, como la web
            val firstEvent = chans.firstOrNull { it.isEvent }?.item
            if (firstEvent != null) {
                val name = cats.firstOrNull { it.id == firstEvent.categoryId }?.name ?: tr(R.string.events)
                Toast.makeText(ctx, tr(R.string.channel_not_yet_showing, name), Toast.LENGTH_LONG).show()
                playInCategory(ctx, channels, firstEvent)
            } else {
                Toast.makeText(ctx, if (channel != null) tr(R.string.channel_not_found_x, channel.name) else tr(R.string.channel_not_found_event), Toast.LENGTH_SHORT).show()
            }
        }
    }
    fun openTv(e: SportEvent) { if (e.tv.isEmpty()) watch(e) else pick = e }
    pick?.let { e -> EventChannelsDialog(e, onDismiss = { pick = null }) { ch, byEvent -> pick = null; watch(e, ch, byEvent) } }

    val pad = sidePad()
    val compact = !tv && !com.latmpx.player.Device.isTablet(ctx)
    LazyVerticalGrid(
        columns = if (compact) GridCells.Fixed(1) else GridCells.Adaptive(330.dp),
        contentPadding = PaddingValues(start = pad, end = pad, top = 16.dp, bottom = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 10.dp),
        modifier = Modifier.fillMaxSize().background(NfBg),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(bottom = 6.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.sports), color = Color.White, fontSize = if (tv) 40.sp else 28.sp, fontWeight = FontWeight.ExtraBold)
                    Text(stringResource(R.string.sports_subtitle), color = SpMute, fontSize = if (compact) 13.5.sp else 15.sp)
                }
                if (live.isNotEmpty()) {
                    Row(Modifier.background(Color(0x24E50914), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        SpDot(); Box(Modifier.width(8.dp))
                        Text(pluralStringResource(R.plurals.live_matches, live.size, live.size), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            FilterBar(curDay, { day = it; sport = "" }, sport, { sport = it }, counts, ofDay.size, d, q, { q = it })
        }
        if (showLive) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(bottom = 16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
                        SpDot(); Box(Modifier.width(10.dp))
                        Text(stringResource(R.string.live_now), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    }
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(live, key = { "l" + it.id }) { e ->
                            SportCardView(e, d.sports[e.sport], now, compact, Modifier.width(if (compact) 300.dp else 360.dp)) { openTv(e) }
                        }
                    }
                }
            }
        }
        groups.forEach { (league, list) ->
            item(span = { GridItemSpan(maxLineSpan) }, key = "h_$league") {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
                    val lb = list.firstOrNull { it.leagueBadge.isNotBlank() }?.leagueBadge
                    if (lb != null) AsyncImage(model = "$lb/tiny", contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(28.dp).padding(end = 4.dp))
                    Text(league, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 6.dp))
                    Text("${list.size}", color = SpMute, fontSize = 13.sp, modifier = Modifier.padding(start = 10.dp))
                }
            }
            items(list, key = { "e" + it.id }) { e -> SportCardView(e, d.sports[e.sport], now, compact) { openTv(e) } }
        }
        if (groups.isEmpty() && !showLive) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.fillMaxWidth().padding(vertical = 60.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.no_matches_filters), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.try_other_day), color = SpMute)
                }
            }
        }
    }
}

/** Abre el canal con su categoría como lista, para cambiar de canal con arriba/abajo. */
private fun playInCategory(ctx: android.content.Context, all: List<Item>, ch: Item) {
    val list = all.filter { it.categoryId == ch.categoryId }.ifEmpty { listOf(ch) }
    Play.live(ctx, list, list.indexOfFirst { it.id == ch.id }.coerceAtLeast(0))
}

/** .sp-bar: Hoy/Mañana, buscador y chips de deporte con emoji y cantidad. */
@Composable
private fun FilterBar(
    day: Int, onDay: (Int) -> Unit, sport: String, onSport: (String) -> Unit, counts: Map<String, Int>, total: Int,
    d: SportsData, q: String, onQ: (String) -> Unit,
) {
    Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.background(Color(0xFF2A2A2A), RoundedCornerShape(6.dp)).padding(3.dp)) {
                listOf(stringResource(R.string.today), stringResource(R.string.tomorrow)).forEachIndexed { i, label ->
                    FocusBox(onClick = { onDay(i) }, shape = RoundedCornerShape(4.dp), focusScale = 1.05f) { f ->
                        Text(label, color = if (day == i) Color.Black else if (f) Color.White else Color(0xFFCCCCCC), fontWeight = FontWeight.Bold, fontSize = 14.sp,
                            modifier = Modifier.background(if (day == i) Color.White else if (f) Color(0x33FFFFFF) else Color.Transparent, RoundedCornerShape(4.dp))
                                .padding(horizontal = 16.dp, vertical = 8.dp))
                    }
                }
            }
            OutlinedTextField(
                value = q, onValueChange = onQ, singleLine = true, placeholder = { Text(stringResource(R.string.search_team_league), fontSize = 14.sp) },
                leadingIcon = { Icon(Icons.Filled.Search, null) }, keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(imeAction = ImeAction.Search)),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                    focusedContainerColor = Color.Black, unfocusedContainerColor = Color.Black, unfocusedPlaceholderColor = SpMute, focusedPlaceholderColor = SpMute,
                ),
                modifier = Modifier.weight(1f).padding(start = 12.dp).then(Modifier.tvTextInput()),
            )
        }
        val chips = listOf("" to stringResource(R.string.all) + " $total") + d.sports.entries.filter { (counts[it.key] ?: 0) > 0 }
            .map { it.key to "${it.value.icon} ${it.value.label} ${counts[it.key]}" } +
            counts.keys.filter { it !in d.sports }.map { it to "$it ${counts[it]}" }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(chips, key = { "c" + it.first }) { (k, label) -> Chip(label, sport == k) { onSport(k) } }
        }
    }
}

/** Menú del evento: "Ver el evento" (automático), los canales que lo transmiten y la búsqueda por equipos. */
@Composable
private fun EventChannelsDialog(e: SportEvent, onDismiss: () -> Unit, onPick: (TvChannel?, Boolean) -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().background(Color(0xFF1C1C1C), RoundedCornerShape(12.dp)).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(if (e.home.isNotBlank() && e.away.isNotBlank()) "${e.home} vs ${e.away}" else e.title, color = Color.White, fontSize = 18.sp,
                fontWeight = FontWeight.Bold, maxLines = 2)
            Text(stringResource(R.string.choose_where), color = SpMute, fontSize = 13.sp)
            Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PickRow("▶  " + stringResource(R.string.watch_event), stringResource(R.string.watch_event_desc), true) { onPick(null, false) }
                e.tv.forEach { t -> PickRow("📺  ${t.name}", t.country) { onPick(t, false) } }
                PickRow("🔎  " + stringResource(R.string.search_by_teams), stringResource(R.string.search_by_teams_desc)) { onPick(null, true) }
            }
        }
    }
}

@Composable
private fun PickRow(title: String, sub: String, primary: Boolean = false, onClick: () -> Unit) {
    FocusBox(onClick = onClick, shape = RoundedCornerShape(8.dp), focusScale = 1.02f) { f ->
        Column(
            Modifier.fillMaxWidth().background(if (f) NfRed else if (primary) Color(0x33E50914) else Color(0x14FFFFFF), RoundedCornerShape(8.dp))
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub.isNotBlank()) Text(sub, color = if (f) Color.White else SpMute, fontSize = 12.sp, maxLines = 1)
        }
    }
}
