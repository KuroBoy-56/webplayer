package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.latmpx.player.R
import com.latmpx.player.data.MatchCloud
import com.latmpx.player.data.Profiles
import com.latmpx.player.data.Sports
import com.latmpx.player.data.SportsLive
import com.latmpx.player.data.SportsPanel
import com.latmpx.player.data.TvBell
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.theme.NfBg2
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Cuenta › Equipos favoritos en la TV (solo con perfiles): la lista de los elegidos (OK quita uno) y «Agregar equipo»:
 * deporte → liga o selecciones → equipo, de los próximos partidos del panel (api/sports_fixtures.php). Se guardan en la
 * nube (api/alerts.php set_teams): el celular de la misma línea y perfil avisa; en la TV se ven con la campanita.
 */
@Composable
fun TvTeamsDialog(onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(0) } // 0 lista, 1 deporte, 2 liga, 3 equipo
    var sport by remember { mutableStateOf("") }
    var league by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { MatchCloud.refresh(force = true) }
    val fx by produceState<com.latmpx.player.data.Fixtures?>(null, step > 0) {
        if (step > 0 && value == null) value = withContext(Dispatchers.IO) { SportsPanel.fixtures(0) }.fx
    }
    // nombres de las disciplinas como en Deportes (el panel las da todas, también las que no están en CHOICES)
    val labels by produceState<Map<String, String>>(emptyMap(), step > 0) {
        if (step > 0 && value.isEmpty()) value = runCatching { Sports.load()?.sports?.mapValues { it.value.label } }.getOrNull().orEmpty()
    }
    val teams = MatchCloud.teamList
    fun save(list: List<MatchCloud.FavTeam>) = scope.launch { err = if (MatchCloud.setTeams(list)) "" else com.latmpx.player.tr(R.string.tb_save_err) }
    val back = { if (step == 0) onDismiss() else { step--; if (step == 1) league = "" } }
    Dialog(onDismissRequest = back) {
        Column(Modifier.width(520.dp).background(NfBg2, RoundedCornerShape(10.dp)).padding(20.dp)) {
            val f = fx
            val title: String
            val rows: List<Pair<String, () -> Unit>>
            when (step) {
                0 -> {
                    title = stringResource(R.string.tb_teams)
                    rows = listOf(stringResource(R.string.tb_add) to { step = 1 }) +
                        teams.map { t -> "✕  " + t.label.ifBlank { t.name } to { save(teams - t); Unit } }
                }
                1 -> {
                    title = stringResource(R.string.tb_pick_sport)
                    val sports = f?.leagues?.values?.map { it.sport }?.filter { it.isNotBlank() }?.distinct() ?: emptyList()
                    rows = sports.map { sp -> (labels[sp] ?: SportsLive.CHOICES.firstOrNull { it.first == sp }?.second ?: sp) to { sport = sp; step = 2 } }.sortedBy { it.first }
                }
                2 -> {
                    title = stringResource(R.string.tb_pick_league)
                    val ls = f?.leagues?.filter { it.value.sport == sport }?.entries?.sortedBy { it.value.name } ?: emptyList()
                    // primero las selecciones, después ligas y copas (como el celular)
                    rows = (ls.filter { it.value.region == "nat" } + ls.filter { it.value.region != "nat" })
                        .map { e -> (if (e.value.region == "nat") "🏳  " else "") + e.value.name to { league = e.key; step = 3 } }
                }
                else -> {
                    title = stringResource(R.string.tb_pick_team)
                    rows = (f?.let { teamsOf(it, league) } ?: emptyList()).map { t ->
                        t.label.ifBlank { t.name } to { if (teams.none { it.name == t.name }) save(teams + t); step = 0 }
                    }
                }
            }
            Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            if (step == 0) Text(stringResource(R.string.tb_phone_only), color = Color(0xFFF5C518), fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp, bottom = 10.dp))
            if (err.isNotEmpty()) Text(err, color = Color(0xFFFF6B6B), fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp))
            val first = remember(step) { FocusRequester() }
            when {
                step > 0 && f == null -> Text(stringResource(R.string.tb_loading), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp))
                rows.isEmpty() -> Text(stringResource(if (step == 3) R.string.tb_no_teams else R.string.tb_no_data), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp))
                else -> LazyColumn(Modifier.heightIn(max = 380.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    itemsIndexed(rows, key = { i, r -> "$step|$i|${r.first}" }) { i, (label, act) ->
                        FocusBox(onClick = act, modifier = Modifier.fillMaxWidth().then(if (i == 0) Modifier.focusRequester(first) else Modifier), focusScale = 1.02f) { fo ->
                            Text(label, color = if (fo) Color.Black else Color.White, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.fillMaxWidth().background(if (fo) Color.White else Color(0x22FFFFFF), RoundedCornerShape(6.dp)).padding(horizontal = 14.dp, vertical = 9.dp))
                        }
                    }
                }
            }
            LaunchedEffect(step, rows.size) { delay(80); runCatching { first.requestFocus() } }
        }
    }
}

/** equipos de una liga: los de sus próximos partidos y los de su tabla (si el panel la tiene), como el celular */
private fun teamsOf(f: com.latmpx.player.data.Fixtures, league: String): List<MatchCloud.FavTeam> {
    val sp = f.leagues[league]?.sport.orEmpty()
    val out = LinkedHashMap<String, MatchCloud.FavTeam>()
    f.events.filter { it.leagueId == league }.forEach { e ->
        if (e.home.isNotBlank()) out.getOrPut(e.home) { MatchCloud.FavTeam(e.home, e.homeLabel, e.homeBadge, league, sp) }
        if (e.away.isNotBlank()) out.getOrPut(e.away) { MatchCloud.FavTeam(e.away, e.awayLabel, e.awayBadge, league, sp) }
    }
    SportsPanel.localTables(0)?.leagues?.firstOrNull { it.id == league }?.groups?.flatMap { it.rows }?.forEach { r ->
        if (r.team.isNotBlank()) out.getOrPut(r.team) { MatchCloud.FavTeam(r.team, "", r.badge, league, sp) }
    }
    return out.values.sortedBy { it.label.ifBlank { it.name }.lowercase() }
}

/** la campanita vive fuera del botón: el menú se desmonta al bajar por las filas y al pasar a otra sección */
private object BellHub {
    var msgs by mutableStateOf<List<TvBell.Msg>>(emptyList())
    /** los avisos que todavía no se vieron: los que hacen bajar el cartel */
    var fresh by mutableStateOf<List<TvBell.Msg>>(emptyList())
    var prof: String? = null
    var loadedAt = 0L
    // cada aviso sale una vez por fase (el mismo partido vuelve a avisar al empezar y al terminar), por perfil y mientras la app está abierta
    private val seen = HashSet<String>()
    private fun tag(prof: String, m: TvBell.Msg) = prof + "|" + m.key + ":" + m.order
    fun markSeen(prof: String, l: List<TvBell.Msg>) { l.forEach { seen += tag(prof, it) }; fresh = emptyList() }
    suspend fun load(prof: String) {
        loadedAt = System.currentTimeMillis(); this.prof = prof
        MatchCloud.refresh(force = true)
        val agenda = runCatching { Sports.load() }.getOrNull()
        val live = runCatching { SportsLive.load() }.getOrNull()
        val m = TvBell.messages(agenda, live)
        if (this.prof != prof) return
        msgs = m
        fresh = m.filter { tag(prof, it) !in seen }
    }
}

/**
 * La campanita de la barra de la TV (solo con perfiles). Al entrar a la app, al volver del reproductor y al pasar de una
 * página a otra, si hay un aviso nuevo de hoy de un equipo favorito o de un partido marcado («¡En vivo! Real Madrid 1-0
 * Barcelona», «Hoy 20:00: …», «Final: …») baja desde la campanita un cartelito con el foco en OK; con OK (o Atrás) se va
 * y el foco sigue donde estaba (el menú o el contenido). Con OK sobre la campanita se abre la lista de hoy, o «No hay
 * notificaciones.». Se vuelve a mirar cada 10 minutos y al cambiar de página (como mucho cada minuto).
 */
@Composable
fun TvBellButton(state: com.latmpx.player.ui.AppState) {
    val msgs = BellHub.msgs
    var open by remember { mutableStateOf(false) }
    val prof = Profiles.current?.id.orEmpty()
    LaunchedEffect(prof, state.tab, state.stack.size, state.refresh) {
        while (true) {
            if (BellHub.prof != prof || System.currentTimeMillis() - BellHub.loadedAt > 60_000) runCatching { BellHub.load(prof) }
            delay(600_000L)
        }
    }
    val banner = BellHub.fresh.isNotEmpty() && BellHub.prof == prof && !open && state.stack.isEmpty() && !state.immersive && !state.alertOpen && state.entering == null
    val below = with(androidx.compose.ui.platform.LocalDensity.current) { 50.dp.roundToPx() }
    Box {
        FocusBox(onClick = { BellHub.markSeen(prof, msgs); open = true }, shape = CircleShape, focusScale = 1.12f) { f ->
            Box(Modifier.size(40.dp).background(if (f) Color.White else Color.Transparent, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Notifications, stringResource(R.string.tb_bell), tint = if (f) Color.Black else Color.White, modifier = Modifier.size(24.dp))
                if (msgs.isNotEmpty()) Box(Modifier.align(Alignment.TopEnd).offset((-6).dp, 6.dp).size(9.dp).background(NfRed, CircleShape))
            }
        }
        // el cartel baja de la campanita y toma el foco (OK); al cerrarse, la ventana de la app vuelve a tener el foco
        // donde lo había dejado el usuario
        if (banner) {
            val fresh = BellHub.fresh
            val close = { BellHub.markSeen(prof, fresh) }
            Popup(alignment = Alignment.TopEnd, offset = IntOffset(0, below), onDismissRequest = close, properties = PopupProperties(focusable = true)) {
                val ok = remember { FocusRequester() }
                Box {
                    // la puntita que señala la campanita (40 dp: su centro a 20 dp del borde derecho)
                    Box(Modifier.align(Alignment.TopEnd).padding(end = 13.dp).size(14.dp).rotate(45f).background(BellBg))
                    Column(Modifier.padding(top = 7.dp).width(400.dp).background(BellBg, RoundedCornerShape(10.dp)).padding(horizontal = 16.dp, vertical = 14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
                            Icon(Icons.Filled.Notifications, null, tint = NfRed, modifier = Modifier.size(20.dp))
                            Text(stringResource(R.string.tb_bell), color = NfGray2, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
                        }
                        fresh.take(3).forEach { m ->
                            Text(m.text, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(bottom = 6.dp))
                        }
                        if (fresh.size > 3) Text(stringResource(R.string.tb_more, fresh.size - 3), color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(bottom = 4.dp))
                        Box(Modifier.fillMaxWidth().padding(top = 6.dp), contentAlignment = Alignment.CenterEnd) {
                            FocusBox(onClick = close, modifier = Modifier.focusRequester(ok), focusScale = 1.05f) { fo ->
                                Text("OK", color = if (fo) Color.Black else Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                                    modifier = Modifier.width(110.dp).background(if (fo) Color.White else NfRed, RoundedCornerShape(6.dp)).padding(vertical = 9.dp),
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                            }
                        }
                    }
                }
                LaunchedEffect(Unit) { delay(60); runCatching { ok.requestFocus() } }
            }
        }
        if (open) Popup(alignment = Alignment.TopEnd, offset = IntOffset(0, below), onDismissRequest = { open = false }, properties = PopupProperties(focusable = true)) {
            val first = remember { FocusRequester() }
            Column(Modifier.width(420.dp).background(Color(0xF5181818), RoundedCornerShape(10.dp)).padding(14.dp)) {
                Text(stringResource(R.string.tb_bell), color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 8.dp))
                if (msgs.isEmpty()) FocusBox(onClick = { open = false }, modifier = Modifier.focusRequester(first)) { _ ->
                    Text(stringResource(R.string.tb_bell_empty), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(8.dp))
                }
                else msgs.take(12).forEachIndexed { i, m ->
                    FocusBox(onClick = { open = false }, modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp).then(if (i == 0) Modifier.focusRequester(first) else Modifier), focusScale = 1.02f) { f ->
                        Row(Modifier.fillMaxWidth().background(if (f) Color.White else Color(0x22FFFFFF), RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(m.text, color = if (f) Color.Black else Color.White, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            LaunchedEffect(Unit) { delay(60); runCatching { first.requestFocus() } }
        }
    }
}

private val BellBg = Color(0xFF1E1E1E)

/**
 * Cuenta › Deporte favorito (solo con perfiles): «Todos los deportes» o una de las disciplinas que da el panel
 * (api/sports.php: las de la agenda y todas las encendidas). Con una elegida, Inicio › «En vivo ahora» muestra solo esa.
 */
@Composable
fun TvSportPrefDialog(onDismiss: () -> Unit) {
    val list by produceState<List<Pair<String, String>>?>(null) {
        value = runCatching { Sports.load()?.sports?.map { (k, v) -> k to "${v.icon} ${v.label}".trim() } }.getOrNull().orEmpty().sortedBy { it.second.substringAfter(' ') }
    }
    val cur = remember { com.latmpx.player.data.Store.liveSport }
    fun pick(sp: String, name: String) {
        com.latmpx.player.data.Store.liveSport = sp
        com.latmpx.player.data.Store.liveSportName = name
        // las ligas favoritas de otra disciplina ya no tienen sentido
        if (sp.isNotEmpty()) com.latmpx.player.data.Store.liveLeagues = com.latmpx.player.data.Store.liveLeagues.filter { it.sport.equals(sp, true) }
        SportsLive.prefRev++
        onDismiss()
    }
    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.width(520.dp).background(NfBg2, RoundedCornerShape(10.dp)).padding(20.dp)) {
            Text(stringResource(R.string.sl_fav), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            Text(stringResource(R.string.sl_fav_msg), color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp, bottom = 6.dp))
            val l = list
            val first = remember { FocusRequester() }
            if (l == null) Text(stringResource(R.string.tb_loading), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp))
            else {
                val rows = listOf("" to stringResource(R.string.sl_all)) + l
                // el foco empieza en el elegido
                val at = rows.indexOfFirst { it.first.equals(cur, true) }.coerceAtLeast(0)
                LazyColumn(Modifier.heightIn(max = 380.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
                    state = androidx.compose.foundation.lazy.rememberLazyListState(at)) {
                    itemsIndexed(rows, key = { _, r -> r.first }) { i, (sp, label) ->
                        FocusBox(onClick = { pick(sp, if (sp.isEmpty()) "" else label) }, modifier = Modifier.fillMaxWidth().then(if (i == at) Modifier.focusRequester(first) else Modifier), focusScale = 1.02f) { fo ->
                            Text((if (sp.equals(cur, true)) "✓  " else "") + label, color = if (fo) Color.Black else Color.White, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.fillMaxWidth().background(if (fo) Color.White else Color(0x22FFFFFF), RoundedCornerShape(6.dp)).padding(horizontal = 14.dp, vertical = 9.dp))
                        }
                    }
                }
                LaunchedEffect(Unit) { delay(80); runCatching { first.requestFocus() } }
            }
        }
    }
}

/**
 * Cuenta › Eventos favoritos (ligas y copas internacionales, solo con perfiles): varios a la vez, de la agenda y de los próximos 21 días (primero las que
 * juegan hoy, con cuántos partidos). Con alguna elegida, Inicio › «En vivo ahora» solo muestra partidos de esas ligas.
 */
@Composable
fun TvLeaguePrefDialog(onDismiss: () -> Unit) {
    val list by produceState<List<com.latmpx.player.data.FavLeague>?>(null) {
        value = runCatching { SportsLive.leagueChoices() }.getOrNull().orEmpty()
    }
    var sel by remember { mutableStateOf(com.latmpx.player.data.Store.liveLeagues) }
    val sp = remember { com.latmpx.player.data.Store.liveSport }
    fun save(v: List<com.latmpx.player.data.FavLeague>) {
        sel = v
        com.latmpx.player.data.Store.liveLeagues = v
        SportsLive.prefRev++
    }
    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.width(560.dp).background(NfBg2, RoundedCornerShape(10.dp)).padding(20.dp)) {
            Text(stringResource(R.string.sl_lg), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            // sin deporte favorito no hay eventos que elegir: primero el deporte
            if (sp.isEmpty()) {
                val ok = remember { FocusRequester() }
                Text(stringResource(R.string.sl_lg_pick), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(vertical = 14.dp))
                FocusBox(onClick = onDismiss, modifier = Modifier.fillMaxWidth().focusRequester(ok), focusScale = 1.02f) { fo ->
                    Text(stringResource(R.string.ok), color = if (fo) Color.Black else Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.fillMaxWidth().background(if (fo) Color.White else NfRed, RoundedCornerShape(6.dp)).padding(horizontal = 14.dp, vertical = 9.dp))
                }
                LaunchedEffect(Unit) { delay(80); runCatching { ok.requestFocus() } }
                return@Column
            }
            val spName = com.latmpx.player.data.Store.liveSportName.ifEmpty { sp }
            Text(stringResource(R.string.sl_lg_msg) + if (sp.isNotEmpty()) "  " + stringResource(R.string.sl_lg_only, spName) else "",
                color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp, bottom = 6.dp))
            val l = list
            val first = remember { FocusRequester() }
            if (l == null) Text(stringResource(R.string.tb_loading), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp))
            else {
                if (l.isEmpty()) Text(stringResource(R.string.sl_lg_none), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(vertical = 8.dp))
                val ids = sel.map { it.id }.toSet()
                val today = stringResource(R.string.sl_lg_today)
                LazyColumn(Modifier.heightIn(max = 380.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item(key = "_all") {
                        LeagueRow(stringResource(R.string.sl_lg_all), ids.isEmpty(), Modifier.focusRequester(first)) { save(emptyList()) }
                    }
                    items(l, key = { it.id }) { x ->
                        val label = x.name + (if (sp.isEmpty()) "  ·  " + x.sportLabel.ifEmpty { x.sport } else "") +
                            (if (x.today > 0) "  ·  " + today.format(x.today) else "")
                        LeagueRow(label, x.id in ids, Modifier) {
                            save(if (x.id in ids) sel.filter { it.id != x.id } else sel + x.copy(today = 0, sportLabel = ""))
                        }
                    }
                    item(key = "_done") {
                        FocusBox(onClick = onDismiss, modifier = Modifier.fillMaxWidth().padding(top = 6.dp), focusScale = 1.02f) { fo ->
                            Text(stringResource(R.string.ok), color = if (fo) Color.Black else Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                                modifier = Modifier.fillMaxWidth().background(if (fo) Color.White else NfRed, RoundedCornerShape(6.dp)).padding(horizontal = 14.dp, vertical = 9.dp))
                        }
                    }
                }
                LaunchedEffect(Unit) { delay(80); runCatching { first.requestFocus() } }
            }
        }
    }
}

@Composable
private fun LeagueRow(label: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = Modifier.fillMaxWidth().then(modifier), focusScale = 1.02f) { fo ->
        Text((if (on) "✓  " else "") + label, color = if (fo) Color.Black else if (on) Color(0xFF46D369) else Color.White, fontSize = 15.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().background(if (fo) Color.White else Color(0x22FFFFFF), RoundedCornerShape(6.dp)).padding(horizontal = 14.dp, vertical = 9.dp))
    }
}
