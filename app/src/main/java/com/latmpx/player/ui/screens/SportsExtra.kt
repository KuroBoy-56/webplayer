package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.R
import com.latmpx.player.data.Fixtures
import com.latmpx.player.data.League
import com.latmpx.player.data.SportEvent
import com.latmpx.player.data.SportsData
import com.latmpx.player.data.SportsPanel
import com.latmpx.player.data.StandingRow
import com.latmpx.player.data.s
import com.latmpx.player.tr
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.tvTextInput
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Pestañas de Deportes (como Roku y Vega): la agenda y, si el panel las ofrece, Tablas, Selecciones y Equipos */
/** pestañas de Deportes como Roku y Vega: Hoy, Mañana y, si el panel las ofrece, Tablas, Selecciones y Equipos */
enum class SpTab { TODAY, TOMORROW, TABLES, NATIONS, TEAMS }

@Composable
fun SportsTabs(d: SportsData, tab: SpTab, onTab: (SpTab) -> Unit) {
    val tabs = buildList {
        add(SpTab.TODAY to stringResource(R.string.today))
        add(SpTab.TOMORROW to stringResource(R.string.tomorrow))
        if (d.tablesOn) add(SpTab.TABLES to stringResource(R.string.sp_tab_tables))
        if (d.nationsOn) add(SpTab.NATIONS to stringResource(R.string.sp_tab_nations))
        if (d.fixturesOn) add(SpTab.TEAMS to stringResource(R.string.sp_tab_teams))
    }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
        items(tabs, key = { it.first.name }) { (k, label) -> Chip(label, tab == k) { onTab(k) } }
    }
}

// ---------- Tablas ----------

private val REGIONS = listOf("intl", "nat", "eu", "am", "world")
private const val WOMEN = 10

/** América junta Latinoamérica, Norteamérica y Suramérica (paneles anteriores las mandaban aparte) */
private fun regionOf(lg: League): String = when (lg.region) {
    "latam", "na", "sa", "us", "am" -> "am"
    "intl", "nat", "eu" -> lg.region
    else -> "world"
}

private fun divisionOf(lg: League) = if (lg.women) WOMEN else lg.division.coerceAtLeast(1)

private fun tiny(u: String) = if (u.contains("thesportsdb.com/") && !u.endsWith("/tiny")) "$u/tiny" else u

private val ZONES = mapOf("p" to Color(0xFF2EB85C), "s" to Color(0xFF2F80ED), "o" to Color(0xFFF2994A), "r" to Color(0xFFE53935))
private val FORM = mapOf('W' to Color(0xFF2EB85C), 'D' to Color(0xFF808080), 'L' to Color(0xFFE53935))

/** posiciones de las ligas del panel: región, división, liga y la tabla; tocar un equipo abre su ficha */
@Composable
fun SportsTablesView(d: SportsData) {
    var leagues by remember { mutableStateOf(SportsPanel.localTables(d.tablesRev)?.leagues) }
    var loading by remember { mutableStateOf(true) }
    var partial by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(d.tablesRev) {
        if (SportsPanel.localTables(d.tablesRev)?.fresh == true) { loading = false; return@LaunchedEffect }
        // si el panel todavía está armando se ve lo que hay y se vuelve a preguntar cada 20 s
        for (tries in 0 until 12) {
            val r = SportsPanel.fetchTables()
            if (r.leagues.isNotEmpty()) leagues = r.leagues
            partial = r.partial; failed = !r.ok; loading = false
            if (!r.partial) break
            delay(20_000)
        }
    }
    val all = leagues.orEmpty()
    if (all.isEmpty()) {
        when {
            loading || partial -> Loading(stringResource(if (partial) R.string.sp_preparing_tables else R.string.sp_loading_tables))
            else -> Empty(stringResource(if (failed) R.string.sp_tables_failed else R.string.sp_no_tables))
        }
        return
    }
    var region by remember { mutableStateOf("") }
    var division by remember { mutableIntStateOf(1) }
    var pickIdx by remember { mutableIntStateOf(0) }
    val regions = remember(all) { REGIONS.filter { k -> all.any { regionOf(it) == k } }.let { if (it.size > 1) listOf("") + it else listOf("") } }
    val divisions = remember(all) { (1..WOMEN).filter { dv -> all.any { divisionOf(it) == dv } } }
    val div = if (divisions.size < 2) 0 else if (division in divisions) division else divisions.first()
    val list = all.filter { (region.isEmpty() || regionOf(it) == region) && (div == 0 || divisionOf(it) == div) }
    val league = list.getOrNull(pickIdx.coerceIn(0, (list.size - 1).coerceAtLeast(0)))
    var card by remember { mutableStateOf<Pair<String, StandingRow>?>(null) }

    Column(Modifier.fillMaxSize()) {
        if (regions.size > 1) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
            items(regions, key = { "r$it" }) { k -> Chip(regionLabel(k), region == k) { region = k; pickIdx = 0 } }
        }
        if (divisions.size > 1) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
            items(divisions, key = { "d$it" }) { dv ->
                Chip(if (dv == WOMEN) stringResource(R.string.sp_women_league) else stringResource(R.string.sp_division, dv), div == dv) { division = dv; pickIdx = 0 }
            }
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            items(list.size, key = { "l" + list[it].id }) { i -> Chip(list[i].name, league?.id == list[i].id) { pickIdx = i } }
        }
        if (league == null) { Empty(stringResource(R.string.sp_no_tables)); return@Column }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
            if (league.badge.isNotEmpty()) AsyncImage(model = tiny(league.badge), contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(30.dp).padding(end = 6.dp))
            Text(league.name + (if (league.season.isNotEmpty()) " · " + league.season else ""), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
            league.groups.forEachIndexed { gi, g ->
                if (league.groups.size > 1 || g.name.isNotEmpty()) item(key = "g$gi") {
                    Text(g.name, color = SpMute, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
                }
                item(key = "h$gi") { StandingHeader() }
                items(g.rows, key = { "$gi-" + it.rank + it.team }) { r -> StandingLine(r) { if (r.id.isNotEmpty()) card = league.name to r } }
            }
            item(key = "legend") { ZoneLegend(league) }
        }
    }
    card?.let { (_, r) -> TeamCardDialog(r.id, r.team, r.badge) { card = null } }
}

@Composable
private fun regionLabel(k: String): String = when (k) {
    "" -> stringResource(R.string.sp_all)
    "intl" -> stringResource(R.string.sp_reg_intl)
    "nat" -> stringResource(R.string.sp_reg_nat)
    "eu" -> stringResource(R.string.sp_reg_eu)
    "am" -> stringResource(R.string.sp_reg_am)
    else -> stringResource(R.string.sp_reg_world)
}

private val NUM_W = 30.dp

@Composable
private fun StandingHeader() {
    val tv = LocalIsTv.current
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp, horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("#", color = SpMute, fontSize = 12.sp, modifier = Modifier.width(28.dp))
        Spacer(Modifier.weight(1f))
        val cols = if (tv) listOf(R.string.sp_col_p, R.string.sp_col_w, R.string.sp_col_d, R.string.sp_col_l, R.string.sp_col_gf, R.string.sp_col_ga, R.string.sp_col_gd, R.string.sp_col_pts)
        else listOf(R.string.sp_col_p, R.string.sp_col_gd, R.string.sp_col_pts)
        cols.forEach { c -> Text(stringResource(c), color = SpMute, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.width(NUM_W)) }
        if (tv) Spacer(Modifier.width(90.dp))
    }
}

@Composable
private fun StandingLine(r: StandingRow, onClick: () -> Unit) {
    val tv = LocalIsTv.current
    FocusBox(onClick = onClick, focusScale = 1.02f, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(Modifier.fillMaxWidth().background(Color(0x14FFFFFF), RoundedCornerShape(6.dp)).padding(vertical = 6.dp, horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(4.dp).heightIn(min = 22.dp).background(ZONES[r.zone] ?: Color.Transparent, RoundedCornerShape(2.dp)))
            Text("${r.rank}", color = Color.White, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.width(24.dp))
            if (r.badge.isNotEmpty()) AsyncImage(model = tiny(r.badge), contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(22.dp))
            Text(r.team, color = Color.White, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
            val nums = if (tv) listOf(r.played, r.won, r.drawn, r.lost, r.gf, r.ga, r.gd, r.pts) else listOf(r.played, r.gd, r.pts)
            nums.forEachIndexed { i, n ->
                Text("$n", color = Color.White, fontSize = 13.sp, fontWeight = if (i == nums.lastIndex) FontWeight.Bold else FontWeight.Normal, textAlign = TextAlign.Center, modifier = Modifier.width(NUM_W))
            }
            if (tv) Row(Modifier.width(90.dp).padding(start = 8.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                r.form.forEach { c -> Box(Modifier.size(12.dp).background(FORM[c] ?: Color.Gray, CircleShape)) }
            }
        }
    }
}

// en un celular en vertical no entran las cuatro zonas en una línea: pasan a la siguiente (antes se cortaban)
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ZoneLegend(lg: League) {
    val used = lg.groups.flatMap { g -> g.rows.map { it.zone } }.toSet()
    val names = mapOf("p" to R.string.sp_zone_p, "s" to R.string.sp_zone_s, "o" to R.string.sp_zone_o, "r" to R.string.sp_zone_r)
    FlowRow(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        names.filterKeys { it in used }.forEach { (k, res) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).background(ZONES[k] ?: Color.Gray, CircleShape))
                Text(stringResource(res), color = SpMute, fontSize = 12.sp, modifier = Modifier.padding(start = 5.dp))
            }
        }
    }
}

/** ficha del equipo (api/sports_team.php): fundación, estadio, liga, títulos y descripción; «Más detalles» = todo */
@Composable
private fun TeamCardDialog(id: String, name: String, badge: String, onClose: () -> Unit) {
    var j by remember { mutableStateOf<org.json.JSONObject?>(null) }
    var done by remember { mutableStateOf(false) }
    var full by remember { mutableStateOf(false) }
    LaunchedEffect(id) { j = SportsPanel.team(id); done = true }
    val ctx = LocalContext.current
    LaunchedEffect(done) {
        if (done && j == null) {
            android.widget.Toast.makeText(ctx, tr(R.string.sp_no_team_info), android.widget.Toast.LENGTH_SHORT).show()
            onClose()
        }
    }
    val t = j
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Color(0xFF1F1F1F),
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val b = t?.s("b")?.ifEmpty { null } ?: badge
                if (b.isNotEmpty()) AsyncImage(model = tiny(b), contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(40.dp).padding(end = 10.dp))
                Text(t?.s("n")?.ifEmpty { null } ?: name, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        },
        text = {
            if (t == null) Text(stringResource(R.string.loading), color = SpMute)
            else Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                val place = listOf(t.s("loc"), t.s("c")).filter { it.isNotEmpty() }.joinToString(", ")
                val facts = buildList {
                    if (t.s("y").isNotEmpty()) add(tr(R.string.sp_founded, t.s("y")) + if (place.isNotEmpty()) " · $place" else "")
                    else if (place.isNotEmpty()) add(place)
                    if (t.s("st").isNotEmpty()) add(tr(R.string.sp_stadium, t.s("st")) + if (t.optInt("cap", 0) > 0) " (${t.optInt("cap")})" else "")
                    if (t.s("lg").isNotEmpty()) add(tr(R.string.sp_league, t.s("lg")))
                }
                val hon = t.optJSONArray("hon")
                val named = (0 until (hon?.length() ?: 0)).mapNotNull { hon?.optJSONObject(it) }.map { it.s("t") + " ×" + it.optInt("n") }
                val total = (0 until (hon?.length() ?: 0)).sumOf { hon?.optJSONObject(it)?.optInt("n") ?: 0 }
                val desc = t.s("d")
                facts.forEach { Text(it, color = Color.White, fontSize = 14.sp) }
                if (total > 0) {
                    Spacer(Modifier.size(8.dp))
                    if (full) {
                        Text(tr(R.string.sp_titles_head, total), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        named.forEach { Text("  • $it", color = SpMute, fontSize = 13.sp) }
                    } else Text(tr(R.string.sp_titles, total, named.take(5).joinToString(" · ")), color = SpMute, fontSize = 13.sp)
                }
                if (desc.isNotEmpty()) {
                    Spacer(Modifier.size(8.dp))
                    Text(desc, color = SpMute, fontSize = 13.sp, maxLines = if (full) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis)
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.sp_understood), color = Color.White, fontWeight = FontWeight.Bold) } },
        dismissButton = { if (t != null && !full) TextButton(onClick = { full = true }) { Text(stringResource(R.string.sp_more_details), color = SpMute) } },
    )
}

// ---------- Equipos y Selecciones ----------

private var lastQuery = ""
private var lastComp = ""

/**
 * Equipos: «Buscar equipo» y los últimos 5 buscados; los próximos partidos de un equipo (también en español) o de un país.
 * Selecciones: «Todas», cada competición y «Selección femenina». Del JSON de 21 días del panel guardado en el equipo.
 */
@Composable
fun SportsTeamsView(
    d: SportsData, nationsMode: Boolean, now: Long, compact: Boolean,
    chanOf: ((SportEvent) -> Pair<String, Boolean>?)? = null, onOpen: (SportEvent) -> Unit,
) {
    var fx by remember { mutableStateOf<Fixtures?>(null) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(d.fixturesRev) {
        for (tries in 0 until 12) {
            val r = SportsPanel.fixtures(d.fixturesRev)
            r.fx?.let { fx = it }
            loading = false
            if (!r.partial) break
            delay(25_000)
        }
    }
    var query by remember { mutableStateOf(lastQuery) }
    var comp by remember { mutableStateOf(lastComp) }
    var ask by remember { mutableStateOf(!nationsMode && lastQuery.isEmpty()) }
    var recents by remember { mutableStateOf(SportsPanel.recentTeams()) }
    val minutes: (String) -> Int = { sp -> d.sports[sp]?.minutes ?: 120 }
    val f = fx
    val list = remember(f, query, comp, nationsMode) {
        when {
            f == null -> emptyList()
            !nationsMode -> if (query.isEmpty()) emptyList() else SportsPanel.searchTeam(f, query, d.rules.alias, minutes)
            else -> SportsPanel.nations(f, comp, minutes).first
        }
    }
    val nat = remember(f, nationsMode) { if (f != null && nationsMode) SportsPanel.nations(f, "", minutes) else null }
    val searchLabel = stringResource(R.string.sp_search_team)
    val chips = if (!nationsMode) listOf("?" to "🔎 $searchLabel") + recents.map { it to it }
    else listOf("" to stringResource(R.string.sp_all)) + nat?.second.orEmpty() + (if (nat?.third == true) listOf("w" to stringResource(R.string.sp_women_nat)) else emptyList())

    Column(Modifier.fillMaxSize()) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            items(chips, key = { "c" + it.first }) { (k, label) ->
                Chip(label, if (nationsMode) comp == k else query == k) {
                    if (nationsMode) { lastComp = k; comp = k }
                    else if (k == "?") { ask = true }
                    else { lastQuery = k; query = k; recents = SportsPanel.rememberTeam(k) }
                }
            }
        }
        when {
            f == null && loading -> Loading(stringResource(R.string.loading_matches))
            list.isNotEmpty() -> LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
                items(list, key = { "f" + it.id + it.start }) { e ->
                    val c = chanOf?.invoke(e)
                    SportCardView(e, d.sports[e.sport], now, compact, chan = c?.first, chanFound = c?.second == true) { onOpen(e) }
                }
            }
            f == null -> Empty(stringResource(R.string.sp_fx_failed))
            nationsMode -> Empty(stringResource(R.string.sp_no_nat_matches))
            query.isEmpty() -> Empty(stringResource(R.string.sp_type_team))
            else -> Empty(stringResource(R.string.sp_no_team_matches, query))
        }
    }
    if (ask) TeamSearchDialog(query, onClose = { ask = false }) { q ->
        ask = false
        if (q.isNotBlank()) { lastQuery = q.trim(); query = q.trim(); recents = SportsPanel.rememberTeam(q.trim()) }
    }
}

@Composable
private fun TeamSearchDialog(initial: String, onClose: () -> Unit, onSubmit: (String) -> Unit) {
    var q by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Color(0xFF1F1F1F),
        title = { Text(stringResource(R.string.sp_team_name), color = Color.White) },
        text = {
            OutlinedTextField(
                value = q, onValueChange = { q = it }, singleLine = true,
                keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(imeAction = ImeAction.Search)),
                keyboardActions = KeyboardActions(onSearch = { onSubmit(q) }),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White),
                modifier = Modifier.fillMaxWidth().tvTextInput(),
            )
        },
        confirmButton = { TextButton(onClick = { onSubmit(q) }) { Text(stringResource(R.string.search), color = Color.White, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.close), color = SpMute) } },
    )
}
