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
import com.latmpx.player.data.Category
import com.latmpx.player.data.SportMatch
import com.latmpx.player.data.SportsPanel
import com.latmpx.player.data.Platforms
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.text.KeyboardActions
import java.util.Calendar

private fun dayKey(t: Long): Int = Calendar.getInstance(Sports.zone).apply { timeInMillis = t }.let { it.get(Calendar.YEAR) * 1000 + it.get(Calendar.DAY_OF_YEAR) }

/** canales del cliente para Deportes: todos (para abrir con su carpeta), los de las carpetas visibles preparados y las carpetas */
private class SpChans(val all: List<Item>, val prepared: List<Sports.Chan>, val cats: List<Category>) {
    val byId: Map<Int, Item> = all.associateBy { it.id }
}

/** opción del menú del partido; green = es un canal que el cliente tiene */
private class MenuOpt(val title: String, val sub: String = "", val green: Boolean = false, val onClick: () -> Unit)

/**
 * Deportes como Roku y Vega OS: Hoy / Mañana con el canal encontrado automáticamente en cada partido y, si el panel los
 * ofrece, Tablas, Selecciones y Equipos. Orden: en vivo, después por hora y al final los terminados. El canal de cada
 * partido: el que lo transmite si el cliente lo tiene, el de la guía del panel (api/sports_epg.php) o el de los equipos;
 * con «Solo los canales del servidor IPTV» (panel) solo se nombran los que el cliente tiene. Solo cuentan los canales
 * de las carpetas que el cliente ve.
 */
@Composable
fun SportsScreen(state: AppState) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val data by produceState<SportsData?>(null) { value = Sports.load() }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(data) { if (data != null) loaded = true }
    LaunchedEffect(Unit) { delay(15_000); if (data == null) loaded = true }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    var tab by rememberSaveable { mutableStateOf(SpTab.TODAY) }
    var sport by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf<Triple<String, String, List<MenuOpt>>?>(null) }
    var typing by remember { mutableStateOf<String?>(null) }

    val d = data
    // canales del cliente (una vez) y el canal de cada partido de hoy, mañana y en vivo
    val chans by produceState<SpChans?>(null, d) {
        if (d == null) return@produceState
        val all = state.live.ifEmpty { runCatching { Xtream.items(s, Kind.LIVE) }.getOrDefault(emptyList()) }
        val cats = state.liveCats.ifEmpty { runCatching { Xtream.categories(s, Kind.LIVE) }.getOrDefault(emptyList()) }
        value = withContext(Dispatchers.Default) { SpChans(all, Sports.prepare(all, cats, d.rules), cats) }
    }
    val found by produceState<Map<String, SportMatch>?>(null, d, chans) {
        val c = chans ?: return@produceState
        if (d == null) return@produceState
        value = withContext(Dispatchers.Default) {
            val t = System.currentTimeMillis()
            val today = dayKey(t)
            val tomorrow = dayKey(t + 86_400_000)
            d.events.filter { e -> dayKey(e.start) == today || dayKey(e.start) == tomorrow || spStatus(e, d.sports[e.sport], t) == SpStatus.LIVE }
                .associate { e -> e.id to Sports.match(e, c.prepared, d.rules) }
        }
    }
    // además, la guía del panel: el canal que tiene el partido en su programación a esa hora
    val epgMap by produceState<Map<String, List<String>>>(emptyMap(), chans) {
        val c = chans ?: return@produceState
        val list = withContext(Dispatchers.Default) { Sports.epgChannels(c.prepared, c.cats) }
        value = runCatching { SportsPanel.epg(list) }.getOrDefault(emptyMap())
    }

    if (d == null) { if (loaded) Empty(stringResource(R.string.sports_unavailable)) else Loading(stringResource(R.string.loading_matches)); return }
    val todayKey = dayKey(now)
    val tomorrowKey = dayKey(now + 86_400_000)
    fun ending(e: SportEvent) = e.start + (d.sports[e.sport]?.minutes ?: 120) * 60_000L
    fun isLive(e: SportEvent) = spStatus(e, d.sports[e.sport], now) == SpStatus.LIVE

    // los partidos de Equipos / Selecciones buscan su canal al mostrarse (una vez cada uno, mismas reglas)
    val extra = remember(chans) { HashMap<String, SportMatch>() }
    // el canal de un partido: el que lo transmite (si el cliente lo tiene), el de la guía o el de los equipos
    fun resolve(e: SportEvent): SportMatch? {
        val c = chans ?: return null
        val m = found?.get(e.id) ?: extra.getOrPut(e.id + "|" + e.start) { Sports.match(e, c.prepared, d.rules) }
        val epg = epgMap[e.id].orEmpty().mapNotNull { id -> id.toIntOrNull()?.let { c.byId[it] } }
        if (epg.isEmpty()) return m
        return m.copy(epg = epg, best = m.tv.firstOrNull { it.second != null }?.second ?: epg.first())
    }
    val tNoChan = stringResource(R.string.sp_no_channel)
    val tFinding = stringResource(R.string.sp_finding)
    val tTbc = stringResource(R.string.sp_tbc)
    val tOnTv = stringResource(R.string.sp_on_tv)
    fun chanOf(e: SportEvent, withDate: Boolean): Pair<String, Boolean> {
        if (chans == null || found == null) return tFinding to false
        val best = resolve(e)?.best
        return when {
            best != null -> best.name to true
            withDate -> tTbc to false
            else -> tNoChan to false
        }
    }
    // "En TV: ESPN 2 · TUDN · Fox Sports +3": los del partido o, en modo "iptv", solo los que tiene el cliente
    fun tvLine(e: SportEvent): String? {
        val names = if (d.iptvOnly) resolve(e)?.owned()?.map { it.name }.orEmpty() else e.tv.map { it.name }
        if (names.isEmpty()) return if (d.iptvOnly) "" else null
        return "$tOnTv " + names.take(4).joinToString(" · ") + if (names.size > 4) "  +${names.size - 4}" else ""
    }

    fun say(msg: String) = Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
    fun play(ch: Item) { menu = null; chans?.let { playInCategory(ctx, it.all, ch) } }
    // sin canal exacto: la primera carpeta de eventos
    fun folder(prefix: String) {
        val c = chans
        val first = c?.prepared?.firstOrNull { it.isEvent }?.item
        if (c != null && first != null) {
            val name = c.cats.firstOrNull { it.id == first.categoryId }?.name ?: tr(R.string.events)
            say(prefix.ifEmpty { tr(R.string.channel_not_yet_showing, name) })
            playInCategory(ctx, c.all, first)
        } else say(tr(R.string.channel_not_found_event))
    }
    // buscar en la lista del cliente por un nombre (canal, equipo o evento): todos en verde, son del servidor
    fun findChans(q: String) {
        val c = chans ?: return
        val list = searchChannels(q, c)
        if (list.isEmpty()) { say(tr(R.string.sp_no_channels_with, q)); return }
        menu = Triple(tr(R.string.sp_channels_with, q), "", list.map { ch -> MenuOpt(ch.name, green = true) { play(ch) } })
    }
    fun playable(e: SportEvent): Boolean {
        val st = spStatus(e, d.sports[e.sport], now)
        when {
            st == SpStatus.POSTPONED -> say(tr(R.string.sp_postponed))
            st == SpStatus.FIN || now >= ending(e) -> say(tr(R.string.event_over))
            dayKey(e.start) != todayKey && st != SpStatus.LIVE -> say(tr(R.string.event_offline))
            else -> return true
        }
        return false
    }
    // menú del partido: el automático, los canales que lo transmiten, los de la guía y los equipos (en verde los que
    // tiene el cliente), buscar por el nombre de cada equipo y escribir otro nombre
    fun open(e: SportEvent) {
        if (!playable(e)) return
        if (chans == null) { say(tr(R.string.sp_loading_channels)); return }
        val m = resolve(e)
        val best = m?.best
        val opts = ArrayList<MenuOpt>()
        opts += MenuOpt("▶  " + tr(R.string.sp_watch_auto), best?.name ?: tr(R.string.watch_event_desc), best != null) {
            if (best != null) play(best) else { menu = null; folder("") }
        }
        val seen = HashSet<Int>()
        for ((t, ch) in m?.tv.orEmpty()) {
            if (ch != null && ch.id in seen) continue
            if (d.iptvOnly && ch == null) continue
            if (ch != null) seen += ch.id
            val title = if (d.iptvOnly && ch != null) ch.name else t.name + if (t.country.isNotBlank()) " (${t.country})" else ""
            opts += MenuOpt(title, if (ch != null) tr(R.string.sp_in_list, ch.name) else tr(R.string.sp_not_in_list), ch != null) {
                val teams = m?.teams
                when {
                    ch != null -> play(ch)
                    teams != null -> { say(tr(R.string.channel_missing_showing, t.name, teams.name)); play(teams) }
                    else -> { menu = null; folder("") }
                }
            }
        }
        val extra = m?.epg.orEmpty().map { it to tr(R.string.sp_in_guide) } + listOfNotNull(m?.teams?.let { it to tr(R.string.sp_by_teams) })
        for ((c, why) in extra) {
            if (c.id in seen || opts.size > 10) continue
            seen += c.id
            opts += MenuOpt("${c.name} · $why", green = true) { play(c) }
        }
        val names = listOf(e.home, e.away).filter { it.isNotBlank() }.ifEmpty { listOf(e.title).filter { it.isNotBlank() } }
        names.forEach { n -> opts += MenuOpt(tr(R.string.sp_search_x, n)) { menu = null; findChans(n) } }
        opts += MenuOpt(tr(R.string.sp_search_any)) { menu = null; typing = names.firstOrNull().orEmpty() }
        menu = Triple(if (e.home.isNotBlank() && e.away.isNotBlank()) "${e.home} vs ${e.away}" else e.title, tr(R.string.sp_where), opts)
    }
    menu?.let { (title, sub, opts) -> SportMenuDialog(title, sub, opts) { menu = null } }
    typing?.let { start -> SportTypeDialog(start, onDismiss = { typing = null }) { q -> typing = null; findChans(q) } }

    val pad = sidePad()
    val compact = !tv && !com.latmpx.player.Device.isTablet(ctx)
    val title: @Composable () -> Unit = {
        Text(stringResource(R.string.sports), color = Color.White, fontSize = if (tv) 40.sp else 28.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 8.dp))
    }
    if ((tab == SpTab.TABLES && d.tablesOn) || (tab == SpTab.NATIONS && d.nationsOn) || (tab == SpTab.TEAMS && d.fixturesOn)) {
        Column(Modifier.fillMaxSize().background(NfBg).padding(start = pad, end = pad, top = 16.dp)) {
            title()
            SportsTabs(d, tab) { tab = it; sport = "" }
            when (tab) {
                SpTab.TABLES -> SportsTablesView(d)
                else -> SportsTeamsView(d, tab == SpTab.NATIONS, now, compact, chanOf = { e -> chanOf(e, true) }) { e -> open(e) }
            }
        }
        return
    }
    val curTab = if (tab == SpTab.TOMORROW) SpTab.TOMORROW else SpTab.TODAY
    // Hoy: los de hoy y los que siguen en vivo; Mañana: los de mañana. En vivo, después por hora y al final los terminados
    val rows = remember(d, curTab, sport, now) {
        val liveL = ArrayList<SportEvent>()
        val nextL = ArrayList<SportEvent>()
        val doneL = ArrayList<SportEvent>()
        for (e in d.events.filter { sport.isEmpty() || it.sport == sport }.sortedBy { it.start }) {
            val st = spStatus(e, d.sports[e.sport], now)
            val day = dayKey(e.start)
            if (!((curTab == SpTab.TODAY && (day == todayKey || st == SpStatus.LIVE)) || (curTab == SpTab.TOMORROW && day == tomorrowKey))) continue
            when (st) {
                SpStatus.LIVE -> liveL += e
                SpStatus.SOON -> nextL += e
                else -> doneL += e
            }
        }
        liveL + nextL + doneL
    }
    val sportKeys = remember(d) { d.events.map { it.sport }.filter { it.isNotEmpty() }.distinct() }
    val liveCount = remember(d, now) { d.events.count { isLive(it) } }
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
                if (liveCount > 0) {
                    Row(Modifier.background(Color(0x24E50914), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        SpDot(); Box(Modifier.width(8.dp))
                        Text(pluralStringResource(R.plurals.live_matches, liveCount, liveCount), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) { SportsTabs(d, curTab) { tab = it; sport = "" } }
        // disciplinas: Todos y las de la agenda
        item(span = { GridItemSpan(maxLineSpan) }) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                item(key = "all") { Chip(stringResource(R.string.all), sport.isEmpty()) { sport = "" } }
                items(sportKeys, key = { "c$it" }) { k ->
                    val info = d.sports[k]
                    Chip("${info?.icon.orEmpty()} ${info?.label ?: k}".trim(), sport == k) { sport = k }
                }
            }
        }
        items(rows, key = { "e" + it.id }) { e ->
            val c = chanOf(e, false)
            SportCardView(e, d.sports[e.sport], now, compact, chan = c.first, chanFound = c.second, tvLine = tvLine(e)) { open(e) }
        }
        if (rows.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.fillMaxWidth().padding(vertical = 60.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.sp_no_matches), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// palabras que no bastan solas para encontrar un canal (como Vega)
private val SEARCH_NOISE = setOf("club", "united", "city", "real", "deportivo", "atletico", "sporting", "vs")
private val SPORT_CAT = Regex("sport|deport|event|ppv|futbol")

/** Canales de la lista del cliente por nombre (canal, equipo o evento), sin acentos: primero los que tienen todas las
 *  palabras; si ninguno, los que tienen alguna palabra importante (4 letras o más). Dentro de cada grupo, las carpetas
 *  de deportes / eventos primero. Hasta 12 (como Roku y Vega). */
private fun searchChannels(q: String, c: SpChans): List<Item> {
    val words = Sports.norm(q).split(' ').filter { it.length >= 2 }
    if (words.isEmpty()) return emptyList()
    val catName = c.cats.associate { it.id to Platforms.fold(it.name) }
    val groups = List(4) { ArrayList<Item>() }
    for (ch in c.prepared) {
        val n = ch.norm
        var all = true
        var some = false
        for (w in words) {
            if (n.contains(w)) { if (w.length >= 4 && w !in SEARCH_NOISE) some = true } else all = false
        }
        if (!all && !some) continue
        val sp = SPORT_CAT.containsMatchIn(catName[ch.item.categoryId].orEmpty())
        val g = if (all) (if (sp) 0 else 1) else if (sp) 2 else 3
        if (groups[g].size < 12) groups[g] += ch.item
    }
    val last = if (groups[0].size + groups[1].size > 0) 1 else 3
    return groups.take(last + 1).flatten().take(12)
}

/** Abre el canal con su categoría como lista, para cambiar de canal con arriba/abajo. */
private fun playInCategory(ctx: android.content.Context, all: List<Item>, ch: Item) {
    val list = all.filter { it.categoryId == ch.categoryId }.ifEmpty { listOf(ch) }
    Play.live(ctx, list, list.indexOfFirst { it.id == ch.id }.coerceAtLeast(0))
}

/** Menú del partido (o de una búsqueda): las opciones en una lista; en verde los canales que tiene el cliente. */
@Composable
private fun SportMenuDialog(title: String, sub: String, opts: List<MenuOpt>, onDismiss: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(80); runCatching { first.requestFocus() } }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().background(Color(0xFF1C1C1C), RoundedCornerShape(12.dp)).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 2)
            if (sub.isNotBlank()) Text(sub, color = SpMute, fontSize = 13.sp)
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                opts.forEachIndexed { i, o -> PickRow(o.title, o.sub, o.green, if (i == 0) Modifier.focusRequester(first) else Modifier, o.onClick) }
            }
        }
    }
}

@Composable
private fun PickRow(title: String, sub: String, green: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(8.dp), focusScale = 1.02f) { f ->
        Column(
            Modifier.fillMaxWidth().background(if (f) NfRed else Color(0x14FFFFFF), RoundedCornerShape(8.dp))
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(title, color = if (green && !f) Color(0xFF46D369) else Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub.isNotBlank()) Text(sub, color = if (f) Color.White else SpMute, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** «Buscar canal, equipo o evento…»: escribir un nombre y buscarlo en la lista del cliente */
@Composable
private fun SportTypeDialog(start: String, onDismiss: () -> Unit, onSearch: (String) -> Unit) {
    var q by remember { mutableStateOf(start) }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().background(Color(0xFF1C1C1C), RoundedCornerShape(12.dp)).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.sp_type_hint), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = q, onValueChange = { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(imeAction = ImeAction.Search)),
                keyboardActions = KeyboardActions(onSearch = { if (q.isNotBlank()) onSearch(q.trim()) }),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                    focusedContainerColor = Color.Black, unfocusedContainerColor = Color.Black,
                ),
                modifier = Modifier.fillMaxWidth().then(Modifier.tvTextInput()),
            )
            com.latmpx.player.ui.components.AppButton(stringResource(R.string.sp_search_go), Modifier, primary = true, icon = Icons.Filled.Search, onClick = { if (q.isNotBlank()) onSearch(q.trim()) })
        }
    }
}
