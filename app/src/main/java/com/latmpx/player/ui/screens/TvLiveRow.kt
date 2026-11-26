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
class TvLiveCard(val e: SportEvent, val best: Item)

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
    val cards by produceState<List<TvLiveCard>>(emptyList(), d, agenda, state.live, state.liveCats) {
        if (d == null || !d.enabled || state.live.isEmpty()) { value = emptyList(); return@produceState }
        value = withContext(Dispatchers.Default) {
            val prepared = Sports.prepare(state.live, state.liveCats, d.rules)
            val ids = d.events.map { it.id }.toHashSet()
            val now = System.currentTimeMillis()
            val today = Calendar.getInstance().get(Calendar.DAY_OF_YEAR)
            val teams = MatchCloud.teams
            val extra = agenda.filter { e ->
                e.id !in ids && !e.postponed && (e.home in teams || e.away in teams) && now < e.start + 3 * 3600_000L &&
                    Calendar.getInstance().apply { timeInMillis = e.start }.get(Calendar.DAY_OF_YEAR) == today
            }.map { it.copy(homeScore = "", awayScore = "", status = "NS", soon = true) }
            (d.events + extra).mapNotNull { e -> Sports.match(e, prepared, d.rules).takeIf { !it.guess }?.best?.let { TvLiveCard(e, it) } }
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
    FocusBox(onClick = onClick, onFocus = onFocus, shape = shape, focusScale = 1.06f) {
        Box(Modifier.width(width).height(width * 0.5625f).clip(shape).border(1.dp, Color(0x26FFFFFF), shape)) {
            SportField(e.sport, Modifier.fillMaxSize())
            competitionTheme(e.league)?.let { Box(Modifier.fillMaxSize().background(Brush.linearGradient(it))) }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x8C000000), Color(0x33000000), Color(0xB3000000)))))
            Column(Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(e.league, color = Color(0xE6FFFFFF), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Row(
                        Modifier.background(if (e.soon) Color(0x99000000) else Color(0xFFE50914), RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (!e.soon) { Box(Modifier.size(6.dp).background(Color.White, CircleShape)); Spacer(Modifier.width(5.dp)) }
                        Text(tvLiveClock(e).ifBlank { stringResource(R.string.sl_live) }, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                    }
                }
                Spacer(Modifier.weight(1f))
                if (e.home.isBlank() && e.away.isBlank()) {
                    Text(e.title.ifBlank { e.league }, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, maxLines = 2,
                        overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    TvTeam(e.home, e.homeBadge, 48.dp, Modifier.weight(1f))
                    Text(
                        if (e.soon) "vs" else "${e.homeScore.ifBlank { "0" }} - ${e.awayScore.ifBlank { "0" }}", color = Color.White,
                        fontSize = 26.sp, fontWeight = FontWeight.Black, maxLines = 1, modifier = Modifier.padding(horizontal = 6.dp),
                    )
                    TvTeam(e.away, e.awayBadge, 48.dp, Modifier.weight(1f))
                }
                Spacer(Modifier.weight(1f))
                Text("▶ " + card.best.name, color = Color(0xFF46D369), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun TvTeam(name: String, badge: String, size: Dp, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            if (badge.isNotBlank()) AsyncImage(model = badge, contentDescription = name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            else Text(name.take(1).uppercase(), color = Color.White, fontSize = (size.value * 0.45f).sp, fontWeight = FontWeight.Black)
        }
        Text(name, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
    }
}

/** al final de la fila: toda la agenda en Deportes (el estadio con el color de la app) */
@Composable
fun TvGoSportsTile(width: Dp, onFocus: () -> Unit, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    FocusBox(onClick = onClick, onFocus = onFocus, shape = shape, focusScale = 1.06f) {
        Box(Modifier.width(width * 0.62f).height(width * 0.5625f).clip(shape).border(1.dp, Color(0x26FFFFFF), shape)) {
            androidx.compose.foundation.Image(painterResource(R.drawable.sports_bg), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(com.latmpx.player.ui.theme.NfRed.copy(alpha = 0.75f), NfBg.copy(alpha = 0.9f)))))
            Column(Modifier.fillMaxSize().padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("🏟️", fontSize = 40.sp)
                Text(stringResource(R.string.sl_go_sports), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                Text(stringResource(R.string.sl_go_sports_sub), color = Color(0xD9FFFFFF), fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
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

/** fondo de Deportes con perfiles: estadio de noche sin personas (drawable sports_bg) bajo el color de la app */
@Composable
fun Modifier.sportsStadium(): Modifier = if (!MatchCloud.on) this else this
    .paint(painterResource(R.drawable.sports_bg), contentScale = ContentScale.Crop)
    .background(Brush.verticalGradient(0f to NfBg.copy(alpha = 0.6f), 0.4f to NfBg.copy(alpha = 0.8f), 0.75f to NfBg.copy(alpha = 0.93f), 1f to NfBg))
