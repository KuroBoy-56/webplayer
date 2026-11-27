package com.latmpx.player.ui.screens

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
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
import com.latmpx.player.R
import com.latmpx.player.data.Item
import com.latmpx.player.data.Profiles
import com.latmpx.player.data.SportEvent
import com.latmpx.player.data.SportMatch
import com.latmpx.player.data.Sports
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfRed
import com.latmpx.player.data.SportsLive
import com.latmpx.player.data.SportsPanel
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.tr
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/** tarjetas de la fila: en vivo primero, después los próximos por hora; al final va «Ir a Deportes» */
private const val LIVE_ROW_MAX = 20

/** un partido en vivo de la fila con su canal: m.best siempre existe (solo salen los que el cliente puede ver) */
internal class LiveCard(val e: SportEvent, val m: SportMatch)

/**
 * Partidos EN VIVO de Inicio (en el lugar de «Plataformas»), solo con perfiles activos (nunca en un perfil infantil), con
 * Deportes del distribuidor encendido y con una clave de pago de TheSportsDB en el panel (api/sports_live.php). Se pide
 * cada 30 s mientras Inicio se ve. Solo salen los partidos con al menos un canal que el cliente tiene: el que lo
 * transmite, el de la guía del panel (api/sports_epg.php) o el de los equipos / nombre del evento, siempre un canal real
 * de su servidor IPTV. Con «Deporte preferido» (Ajustes), solo ese deporte.
 * enabled = false: la fila no existe y vuelve «Plataformas».
 */
/** hidesPlats: Inicio no muestra las plataformas (perfiles + partidos en vivo del panel, sin el ajuste); antes de la
 *  primera respuesta vale lo de la última vez para esta línea, así no aparecen y se van */
internal class LiveSports(val enabled: Boolean, val cards: List<LiveCard>, val chans: SpChans?, val hidesPlats: Boolean = false)

@Composable
internal fun rememberLiveSports(state: AppState): LiveSports {
    val active = Profiles.current != null && !Profiles.kids && Tenant.sportsEnabled && !LocalIsTv.current && state.session != null
    var data by remember { mutableStateOf<SportsLive.Data?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(active, state.session) {
        if (!active) { data = null; return@LaunchedEffect }
        while (true) {
            // solo con Inicio a la vista (en segundo plano o en el reproductor no se pregunta)
            lifecycle.currentStateFlow.first { it.isAtLeast(Lifecycle.State.RESUMED) }
            SportsLive.load()?.let { data = it }
            delay((data?.ttl ?: 30) * 1000L)
        }
    }
    val d = data
    val on = active && d?.enabled == true
    // canales del cliente preparados una vez (las carpetas ocultas con el PIN no cuentan)
    val rules = remember(on) { d?.rules }
    val chans by produceState<SpChans?>(null, on, state.live, state.liveCats) {
        val r = rules
        value = if (!on || r == null || state.live.isEmpty()) null
        else withContext(Dispatchers.Default) { SpChans(state.live, Sports.prepare(state.live, state.liveCats, r), state.liveCats) }
    }
    // la guía del panel: qué canal deportivo tiene cada partido en su programación (cada 5 min; el panel guarda 10)
    val epgMap by produceState<Map<String, List<String>>>(emptyMap(), chans) {
        val c = chans ?: return@produceState
        while (true) {
            val list = withContext(Dispatchers.Default) { Sports.epgChannels(c.prepared, c.cats) }
            runCatching { SportsPanel.epg(list) }.getOrNull()?.let { value = it }
            delay(300_000L)
        }
    }
    val pref = remember(Profiles.current, SportsLive.available) { Store.preferredSport }
    val cards by produceState<List<LiveCard>>(emptyList(), d, chans, epgMap, pref) {
        val c = chans
        if (d == null || c == null || !on) { value = emptyList(); return@produceState }
        value = withContext(Dispatchers.Default) {
            d.events.filter { pref.isEmpty() || it.sport == pref }.mapNotNull { e ->
                val m = Sports.match(e, c.prepared, d.rules)
                val epg = epgMap[e.id].orEmpty().mapNotNull { id -> id.toIntOrNull()?.let { c.byId[it] } }
                val full = m.withEpg(epg)
                // siempre un canal real del servidor IPTV del cliente; sin ninguno, el partido no sale
                if (full.best == null || full.guess) null else LiveCard(e, full)
            }.sortedWith(compareBy({ it.e.soon }, { it.e.start })).take(LIVE_ROW_MAX)
        }
    }
    return LiveSports(on, cards, chans, active && !Store.platformCards && (d?.enabled ?: Store.liveAvail))
}

/** fila «En vivo ahora»: tarjetas que se deslizan; al tocar, el menú de canales de Deportes y Atrás vuelve a Inicio */
@Composable
internal fun LiveSportsRow(live: LiveSports, pad: Dp, onSports: () -> Unit) {
    if (live.cards.isEmpty()) return
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    var menu by remember { mutableStateOf<Triple<String, String, List<MenuOpt>>?>(null) }
    var typing by remember { mutableStateOf<String?>(null) }
    val tHt = stringResource(R.string.sl_ht)
    val tStarts = stringResource(R.string.sl_starts)
    val c = live.chans
    fun say(msg: String) = android.widget.Toast.makeText(ctx, msg, android.widget.Toast.LENGTH_LONG).show()
    fun play(ch: Item) { menu = null; c?.let { playInCategory(ctx, it.all, ch) } }
    fun findChans(q: String) {
        val cc = c ?: return
        val list = searchChannels(q, cc)
        if (list.isEmpty()) { say(tr(R.string.sp_no_channels_with, q)); return }
        menu = Triple(tr(R.string.sp_channels_with, q), "", list.map { ch -> MenuOpt(ch.name, green = true) { play(ch) } })
    }
    // el menú del partido: el automático y los demás canales que el cliente tiene (todos en verde), y buscar por equipo
    fun open(card: LiveCard) {
        val e = card.e
        val m = card.m
        val opts = ArrayList<MenuOpt>()
        val best = m.best ?: return
        opts += MenuOpt("▶  " + tr(R.string.sp_watch_auto), best.name, true) { play(best) }
        val seen = hashSetOf(best.id)
        for ((t, ch) in m.tv) {
            if (ch == null || ch.id in seen) continue
            seen += ch.id
            opts += MenuOpt(ch.name, tr(R.string.sp_in_list, t.name), true) { play(ch) }
        }
        val extra = m.epg.map { it to tr(R.string.sp_in_guide) } + listOfNotNull(m.teams?.let { it to tr(R.string.sp_by_teams) })
        for ((ch, why) in extra) {
            if (ch.id in seen || opts.size > 10) continue
            seen += ch.id
            opts += MenuOpt("${ch.name} · $why", green = true) { play(ch) }
        }
        val names = listOf(e.home, e.away).filter { it.isNotBlank() }.ifEmpty { listOf(e.title).filter { it.isNotBlank() } }
        names.forEach { n -> opts += MenuOpt(tr(R.string.sp_search_x, n)) { menu = null; findChans(n) } }
        opts += MenuOpt(tr(R.string.sp_search_any)) { menu = null; typing = names.firstOrNull().orEmpty() }
        val title = if (e.home.isNotBlank() && e.away.isNotBlank()) {
            if (e.soon) "${e.home} vs ${e.away}" else "${e.home} ${e.homeScore.ifBlank { "0" }} - ${e.awayScore.ifBlank { "0" }} ${e.away}"
        } else e.title.ifBlank { e.league }
        menu = Triple(title, (if (e.soon) tStarts + " " + hhmm(e.start) else clockText(e, tHt)) + if (e.league.isNotBlank()) "  ·  ${e.league}" else "", opts)
    }

    Column(Modifier.fillMaxWidth().padding(top = 14.dp)) {
        Row(Modifier.padding(start = pad, end = pad, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            LiveDot()
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.sl_title), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
        LazyRow(contentPadding = PaddingValues(horizontal = pad), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(live.cards, key = { it.e.id }) { card -> LiveSportCard(card) { open(card) } }
            item(key = "go") { GoSportsCard(onSports) }
        }
    }
    menu?.let { (title, sub, opts) -> SportMenuDialog(title, sub, opts, tv) { menu = null } }
    typing?.let { start -> SportTypeDialog(start, onDismiss = { typing = null }) { q -> typing = null; findChans(q) } }
}

/** hora de inicio de un próximo, en la zona del panel (como Deportes) */
private fun hhmm(t: Long): String = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).apply { timeZone = Sports.zone }.format(t)

/** al final de la fila: toda la agenda en Deportes, con el color de la app */
@Composable
private fun GoSportsCard(onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    FocusBox(onClick = onClick, shape = shape, focusScale = 1.04f) {
        Column(
            Modifier.width(200.dp).height(172.dp).clip(shape).border(1.dp, Color(0x26FFFFFF), shape)
                .background(Brush.linearGradient(listOf(NfRed, NfBg))).padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
        ) {
            Text("🏟️", fontSize = 34.sp)
            Text(stringResource(R.string.sl_go_sports), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
            Text(stringResource(R.string.sl_go_sports_sub), color = Color(0xD9FFFFFF), fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/** «67'», «Descanso», «Q3 5:21»… lo que dice TheSportsDB del momento del partido */
@Composable
fun liveClock(e: SportEvent): String = clockText(e, stringResource(R.string.sl_ht))

private fun clockText(e: SportEvent, halfTime: String): String {
    val st = e.status.trim()
    val pr = e.progress.trim()
    return when {
        st.equals("HT", true) || pr.equals("HT", true) -> halfTime
        pr.isNotEmpty() && pr.all { it.isDigit() } -> "$pr'"
        pr.isNotEmpty() -> pr
        else -> st
    }
}

@Composable
private fun LiveDot() {
    val t = rememberInfiniteTransition(label = "live")
    val a by t.animateFloat(1f, 0.25f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "liveA")
    Box(Modifier.size(10.dp).alpha(a).background(Color(0xFFE50914), CircleShape))
}

/** la tarjeta: la cancha del deporte de fondo (con el color del torneo si es uno grande), los escudos, el marcador y el canal */
@Composable
private fun LiveSportCard(card: LiveCard, onClick: () -> Unit) {
    val e = card.e
    val shape = RoundedCornerShape(16.dp)
    FocusBox(onClick = onClick, shape = shape, focusScale = 1.04f) {
        Box(Modifier.width(300.dp).height(172.dp).clip(shape).border(1.dp, Color(0x26FFFFFF), shape)) {
            SportField(e.sport, Modifier.fillMaxSize())
            val theme = competitionTheme(e.league)
            if (theme != null) Box(Modifier.fillMaxSize().background(Brush.linearGradient(theme)))
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x8C000000), Color(0x33000000), Color(0xB3000000)))))
            Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(e.league, color = Color(0xE6FFFFFF), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    // la píldora se ajusta a su texto («Descanso», «Alargue · 105'») y nunca pasa de 180 dp (60 % de la tarjeta)
                    Row(
                        Modifier.widthIn(max = 180.dp).background(if (e.soon) Color(0x99000000) else Color(0xFFE50914), RoundedCornerShape(50))
                            .then(if (e.soon) Modifier.border(1.dp, Color(0x8CFFFFFF), RoundedCornerShape(50)) else Modifier)
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (!e.soon) { Box(Modifier.size(6.dp).background(Color.White, CircleShape)); Spacer(Modifier.width(5.dp)) }
                        Text(
                            if (e.soon) stringResource(R.string.sl_starts) + " " + hhmm(e.start) else liveClock(e).ifBlank { stringResource(R.string.sl_live) },
                            color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                if (e.home.isBlank() && e.away.isBlank()) {
                    // carrera, golf…: sin equipos ni marcador, el nombre del evento
                    Text(
                        e.title.ifBlank { e.league }, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, maxLines = 2,
                        overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                    )
                } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    TeamSide(e.home, e.homeBadge, Modifier.weight(1f))
                    Text(
                        if (e.soon) "vs" else "${e.homeScore.ifBlank { "0" }}  -  ${e.awayScore.ifBlank { "0" }}", color = Color.White, fontSize = if (e.soon) 24.sp else 28.sp,
                        fontWeight = FontWeight.Black, maxLines = 1, modifier = Modifier.padding(horizontal = 6.dp),
                    )
                    TeamSide(e.away, e.awayBadge, Modifier.weight(1f))
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "▶ " + (card.m.best?.name ?: ""), color = Color(0xFF46D369), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun TeamSide(name: String, badge: String, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(46.dp), contentAlignment = Alignment.Center) {
            if (badge.isNotBlank()) AsyncImage(model = badge, contentDescription = name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            else Text(name.take(1).uppercase(), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black)
        }
        Text(name, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center, lineHeight = 14.sp, modifier = Modifier.padding(top = 4.dp))
    }
}
