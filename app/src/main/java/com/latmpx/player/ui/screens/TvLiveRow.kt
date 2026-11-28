package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.compose.AsyncImage
import androidx.compose.ui.draw.paint
import androidx.compose.ui.res.painterResource
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.R
import com.latmpx.player.data.Item
import com.latmpx.player.data.MatchCloud
import com.latmpx.player.data.SportEvent
import com.latmpx.player.data.SportMatch
import com.latmpx.player.data.Sports
import com.latmpx.player.data.SportsLive
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.FocusBox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.util.Calendar

/** un partido de «En vivo ahora» con el canal del cliente donde verlo (siempre uno real de su servidor IPTV) */
/** m / chans: todo lo encontrado para el partido y los canales del cliente, para el menú de canales (como en Deportes) */
class TvLiveCard(val e: SportEvent, val best: Item, val sport: String = "", val m: SportMatch? = null, val chans: SpChans? = null) {
    /**
     * sin dos equipos o de una disciplina sin marcador (peleas, boxeo, WWE, carreras, golf): la tarjeta muestra la
     * disciplina, el evento y su póster (también con dos nombres: TheSportsDB pone a veces a los boxeadores como equipos)
     */
    val solo: Boolean get() = e.home.isBlank() || e.away.isBlank() || e.sport.lowercase() in SOLO_SPORTS
    val eventName: String get() = e.title.ifBlank { listOf(e.home, e.away).filter { it.isNotBlank() }.joinToString(" vs ") }.ifBlank { e.league }
}

private val SOLO_SPORTS = setOf("fighting", "boxing", "wrestling", "mma", "motorsport", "golf", "cycling", "athletics")

/**
 * «En vivo ahora» de Inicio en la TV, solo con perfiles (uno elegido que no sea el infantil) y Deportes encendido: los
 * partidos que se juegan y los que empiezan en 5 minutos o menos (api/sports_live.php?soon=1) y, con equipos favoritos
 * (elegidos en el celular o la computadora, en la nube), todos los de hoy de esos equipos. Se pregunta cada ttl
 * (30 s) mientras Inicio se ve. Solo salen los que tienen un canal en la lista del cliente.
 */
@Composable
fun rememberTvLive(state: AppState): List<TvLiveCard> {
    val active = MatchCloud.on && state.session != null
    var data by remember { mutableStateOf<SportsLive.Data?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(active, state.session) {
        SportsLive.reset()
        if (!active) { data = null; return@LaunchedEffect }
        while (true) {
            lifecycle.currentStateFlow.first { it.isAtLeast(Lifecycle.State.RESUMED) }
            runCatching { MatchCloud.refresh() }
            SportsLive.load()?.let { data = it }
            delay((data?.ttl ?: 30) * 1000L)
        }
    }
    // los de hoy de los equipos favoritos (agenda del panel, una vez)
    val agenda by produceState<List<SportEvent>>(emptyList(), active, MatchCloud.teams) {
        if (!active || MatchCloud.teams.isEmpty()) { value = emptyList(); return@produceState }
        value = runCatching { Sports.load()?.events }.getOrNull().orEmpty()
    }
    val d = data
    val pref = remember(SportsLive.prefRev, com.latmpx.player.data.Profiles.current) { com.latmpx.player.data.Store.liveSport }
    // Cuenta › Ligas favoritas: solo esas ligas (vacío = todas)
    val lgs = remember(SportsLive.prefRev, com.latmpx.player.data.Profiles.current) { com.latmpx.player.data.Store.liveLeagues.map { it.id }.toSet() }
    val cards by produceState<List<TvLiveCard>>(emptyList(), d, agenda, state.live, state.liveCats, pref, lgs) {
        if (d == null || !d.enabled || state.live.isEmpty()) { value = emptyList(); return@produceState }
        value = withContext(Dispatchers.Default) {
            val prepared = Sports.prepare(state.live, state.liveCats, d.rules)
            val sc = SpChans(state.live, prepared, state.liveCats)
            val ids = d.events.map { it.id }.toHashSet()
            val now = System.currentTimeMillis()
            val today = Calendar.getInstance().get(Calendar.DAY_OF_YEAR)
            val teams = MatchCloud.teams
            val extra = agenda.filter { e ->
                e.id !in ids && !e.postponed && (e.home in teams || e.away in teams) && now < e.start + 3 * 3600_000L &&
                    Calendar.getInstance().apply { timeInMillis = e.start }.get(Calendar.DAY_OF_YEAR) == today
            }.map { it.copy(homeScore = "", awayScore = "", status = "NS", soon = true) }
            (d.events + extra).filter { (pref.isEmpty() || it.sport.equals(pref, true)) && (lgs.isEmpty() || it.leagueId in lgs) }.mapNotNull { e ->
                val mm = Sports.match(e, prepared, d.rules)
                mm.takeIf { !it.guess }?.best?.let { TvLiveCard(e, it, d.sports[e.sport]?.label ?: e.sport, mm, sc) }
            }
                .sortedWith(compareBy({ it.e.soon }, { it.e.start })).take(20)
        }
    }
    return if (active) cards else emptyList()
}

/** «67'», «Descanso», «Q3 5:21» o la hora de inicio de los que todavía no empiezan */
@Composable
fun tvLiveClock(e: SportEvent): String {
    if (e.soon) return java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(e.start)
    val st = e.status.trim()
    val pr = e.progress.trim()
    return when {
        st.equals("HT", true) || pr.equals("HT", true) -> stringResource(R.string.sl_ht)
        pr.isNotEmpty() && pr.all { it.isDigit() } -> "$pr'"
        pr.isNotEmpty() -> pr
        else -> st
    }
}

/** la tarjeta: la cancha del deporte, los escudos, el marcador (o la hora), el minuto y el canal */
@Composable
fun TvLiveTile(card: TvLiveCard, width: Dp, onFocus: () -> Unit, onClick: () -> Unit) {
    val e = card.e
    val shape = RoundedCornerShape(14.dp)
    // todo a la medida de la tarjeta (alto = 56 % del ancho): con tarjetas chicas los escudos y los textos se achican y el
    // nombre del canal nunca queda cortado abajo
    val h = width * 0.5625f
    val small = (h.value * 0.088f).coerceIn(10f, 13f).sp
    val badge = (h * 0.29f).coerceIn(26.dp, 48.dp)
    val score = (h.value * 0.17f).coerceIn(16f, 26f).sp
    val padV = (h * 0.065f).coerceIn(5.dp, 10.dp)
    FocusBox(onClick = onClick, onFocus = onFocus, shape = shape, focusScale = 1.06f) {
        Box(Modifier.width(width).height(h).clip(shape).border(1.dp, Color(0x26FFFFFF), shape)) {
            SportField(e.sport, Modifier.fillMaxSize())
            competitionTheme(e.league)?.let { Box(Modifier.fillMaxSize().background(Brush.linearGradient(it))) }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x8C000000), Color(0x33000000), Color(0xB3000000)))))
            Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = padV)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(e.league, color = Color(0xE6FFFFFF), fontSize = small, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    // la píldora se ajusta a su texto («Descanso», «Alargue · 105'») y nunca pasa del 60 % de la tarjeta
                    Row(
                        Modifier.widthIn(max = width * 0.6f).background(if (e.soon) Color(0x99000000) else Color(0xFFE50914), RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (!e.soon) { Box(Modifier.size(6.dp).background(Color.White, CircleShape)); Spacer(Modifier.width(5.dp)) }
                        Text(tvLiveClock(e).ifBlank { stringResource(R.string.sl_live) }, color = Color.White, fontSize = small, fontWeight = FontWeight.Bold, maxLines = 1,
                            softWrap = false, overflow = TextOverflow.Ellipsis)
                    }
                }
                Spacer(Modifier.weight(1f))
                if (card.solo) {
                    // sin equipos: el póster del evento en pequeño (si lo tiene), la disciplina y el nombre; sin marcador
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (e.thumb.isNotBlank()) {
                            AsyncImage(model = e.thumb, contentDescription = null, contentScale = ContentScale.Crop,
                                modifier = Modifier.width(width * 0.42f).height(width * 0.42f * 0.5625f).clip(RoundedCornerShape(6.dp)))
                            Spacer(Modifier.width(12.dp))
                        }
                        val al = if (e.thumb.isNotBlank()) TextAlign.Start else TextAlign.Center
                        Column(Modifier.weight(1f)) {
                            Text(card.sport, color = Color.White, fontSize = (h.value * 0.13f).coerceIn(14f, 20f).sp, fontWeight = FontWeight.ExtraBold, maxLines = 1,
                                overflow = TextOverflow.Ellipsis, textAlign = al, modifier = Modifier.fillMaxWidth())
                            Text(card.eventName, color = Color(0xEBFFFFFF), fontSize = small, fontWeight = FontWeight.SemiBold, maxLines = if (h < 130.dp) 2 else 3,
                                overflow = TextOverflow.Ellipsis, textAlign = al, modifier = Modifier.fillMaxWidth().padding(top = 2.dp))
                        }
                    }
                } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    TvTeam(e.home, e.homeBadge, badge, Modifier.weight(1f), small)
                    Text(
                        if (e.soon) "vs" else "${e.homeScore.ifBlank { "0" }} - ${e.awayScore.ifBlank { "0" }}", color = Color.White,
                        fontSize = score, fontWeight = FontWeight.Black, maxLines = 1, modifier = Modifier.padding(horizontal = 6.dp),
                    )
                    TvTeam(e.away, e.awayBadge, badge, Modifier.weight(1f), small)
                }
                Spacer(Modifier.weight(1f))
                Text("▶ " + card.best.name, color = Color(0xFF46D369), fontSize = small, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun TvTeam(name: String, badge: String, size: Dp, modifier: Modifier, text: androidx.compose.ui.unit.TextUnit = 13.sp) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            if (badge.isNotBlank()) AsyncImage(model = badge, contentDescription = name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            else Text(name.take(1).uppercase(), color = Color.White, fontSize = (size.value * 0.45f).sp, fontWeight = FontWeight.Black)
        }
        Text(name, color = Color.White, fontSize = text, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center, modifier = Modifier.padding(top = 3.dp))
    }
}

/** al final de la fila: toda la agenda en Deportes (el estadio con el color de la app) */
@Composable
fun TvGoSportsTile(width: Dp, onFocus: () -> Unit, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    FocusBox(onClick = onClick, onFocus = onFocus, shape = shape, focusScale = 1.06f) {
        Box(Modifier.width(width * 0.62f).height(width * 0.5625f).clip(shape).border(1.dp, Color(0x26FFFFFF), shape)) {
            // el estadio de Deportes en miniatura, translúcido; el texto se lee encima
            androidx.compose.foundation.Image(painterResource(R.drawable.sports_bg), null, contentScale = ContentScale.Crop, alpha = 0.5f, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Color(0x4D000000)))
            val h = (width * 0.5625f).value
            Column(Modifier.fillMaxSize().padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("🏟️", fontSize = (h * 0.22f).coerceIn(22f, 40f).sp)
                Text(stringResource(R.string.sl_go_sports), color = Color.White, fontSize = (h * 0.12f).coerceIn(14f, 20f).sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp),
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = androidx.compose.ui.text.TextStyle(shadow = androidx.compose.ui.graphics.Shadow(Color(0xCC000000), blurRadius = 8f)))
                Text(stringResource(R.string.sl_go_sports_sub), color = Color(0xD9FFFFFF), fontSize = (h * 0.085f).coerceIn(10f, 13f).sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 3.dp),
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/**
 * el fondo grande de la portada con el foco en un partido: la imagen del evento (TheSportsDB) o el estadio sin personas
 * con los dos escudos grandes (nunca en negro ni con el último póster de una película)
 */
@Composable
fun TvLiveStage(e: SportEvent) {
    if (e.thumb.isNotBlank()) {
        AsyncImage(model = e.thumb, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        return
    }
    Box(Modifier.fillMaxSize()) {
        androidx.compose.foundation.Image(painterResource(R.drawable.sports_bg), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Color(0x59000000)))
        // sin equipos (pelea, carrera): el estadio solo, sin escudos ni «VS»
        if (e.home.isBlank() || e.away.isBlank() || e.sport.lowercase() in SOLO_SPORTS) return@Box
        Row(Modifier.align(Alignment.CenterEnd).padding(end = 90.dp), horizontalArrangement = Arrangement.spacedBy(40.dp), verticalAlignment = Alignment.CenterVertically) {
            TvBigBadge(e.home, e.homeBadge)
            Text("VS", color = Color.White, fontSize = 54.sp, fontWeight = FontWeight.Black)
            TvBigBadge(e.away, e.awayBadge)
        }
    }
}

@Composable
private fun TvBigBadge(name: String, badge: String) {
    Box(Modifier.size(200.dp), contentAlignment = Alignment.Center) {
        if (badge.isNotBlank()) AsyncImage(model = badge, contentDescription = name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        else Box(Modifier.size(170.dp).background(Color(0x33FFFFFF), CircleShape), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase(), color = Color.White, fontSize = 80.sp, fontWeight = FontWeight.Black)
        }
    }
}

/** ¿Deportes lleva el estadio de fondo? (con perfiles) */
fun sportsStadiumOn(): Boolean = MatchCloud.on

/**
 * fondo de la pantalla de Deportes: en la TV con el estadio lo pinta TvShell detrás de todo (también del menú) y la
 * pantalla queda transparente; en el celular y sin perfiles, como siempre
 */
@Composable
fun Modifier.sportsScreenBg(tv: Boolean): Modifier = if (tv && sportsStadiumOn()) this else this.background(NfBg).sportsStadium()

/** fondo de Deportes con perfiles: estadio de noche sin personas (drawable sports_bg) bajo el color de la app */
@Composable
fun Modifier.sportsStadium(): Modifier = if (!MatchCloud.on) this else this
    .paint(painterResource(R.drawable.sports_bg), contentScale = ContentScale.Crop)
    .background(Brush.verticalGradient(0f to NfBg.copy(alpha = 0.6f), 0.4f to NfBg.copy(alpha = 0.8f), 0.75f to NfBg.copy(alpha = 0.93f), 1f to NfBg))

/**
 * Menú de canales de un partido de «En vivo ahora» (Inicio): el mismo de Deportes. El automático, los canales que lo
 * transmiten (en verde los que tiene el cliente), los de la guía y el de los equipos, buscar por el nombre de cada
 * equipo y escribir otro nombre. Antes la tarjeta abría solo la primera coincidencia y, si no andaba, no había más.
 */
@Composable
fun TvLiveMenu(card: TvLiveCard, onDismiss: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val c = card.chans
    val m = card.m
    val e = card.e
    var found by remember { mutableStateOf<Pair<String, List<Item>>?>(null) }
    var typing by remember { mutableStateOf<String?>(null) }
    fun play(ch: Item) {
        onDismiss()
        if (c != null) playInCategory(ctx, c.all, ch) else com.latmpx.player.player.Play.live(ctx, listOf(ch), 0)
    }
    fun find(q: String) {
        typing = null
        val list = if (c != null && q.isNotBlank()) searchChannels(q, c) else emptyList()
        if (list.isEmpty()) android.widget.Toast.makeText(ctx, com.latmpx.player.tr(R.string.sp_no_channels_with, q), android.widget.Toast.LENGTH_LONG).show()
        else found = q to list
    }
    typing?.let { start -> SportTypeDialog(start, onDismiss = { typing = null }) { q -> find(q) }; return }
    found?.let { (q, list) ->
        SportMenuDialog(com.latmpx.player.tr(R.string.sp_channels_with, q), "", list.map { ch -> MenuOpt(ch.name, green = true) { play(ch) } }) { found = null }
        return
    }
    val best = m?.best ?: card.best
    val opts = ArrayList<MenuOpt>()
    opts += MenuOpt("▶  " + stringResource(R.string.sp_watch_auto), best.name, true) { play(best) }
    val seen = hashSetOf(best.id)
    val inList = stringResource(R.string.sp_in_list, "%s")
    val notInList = stringResource(R.string.sp_not_in_list)
    val usual = stringResource(R.string.sp_usual)
    for ((t, ch) in m?.tv.orEmpty()) {
        if (ch != null && ch.id in seen) continue
        if (ch != null) seen += ch.id
        val where = if (ch != null) inList.replace("%s", ch.name) else notInList
        opts += MenuOpt(t.name + if (t.country.isNotBlank()) " (${t.country})" else "", if (t.usual) "$usual · $where" else where, ch != null) {
            val alt = ch ?: m?.teams
            if (alt != null) play(alt) else find(if (card.solo) card.eventName else e.home)
        }
    }
    val extra = m?.epg.orEmpty().map { it to stringResource(R.string.sp_in_guide) } + listOfNotNull(m?.teams?.let { it to stringResource(R.string.sp_by_teams) })
    for ((ch, why) in extra) {
        if (ch.id in seen || opts.size > 10) continue
        seen += ch.id
        opts += MenuOpt("${ch.name} · $why", green = true) { play(ch) }
    }
    val names = if (card.solo) listOf(card.eventName) else listOf(e.home, e.away).filter { it.isNotBlank() }
    names.forEach { n -> opts += MenuOpt(stringResource(R.string.sp_search_x, n)) { find(n) } }
    opts += MenuOpt(stringResource(R.string.sp_search_any)) { typing = names.firstOrNull().orEmpty() }
    SportMenuDialog(if (card.solo) card.eventName else "${e.home} vs ${e.away}", stringResource(R.string.sp_where), opts, onDismiss)
}
