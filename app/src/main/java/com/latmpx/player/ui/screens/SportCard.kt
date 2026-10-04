package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.SportEvent
import com.latmpx.player.data.SportInfo
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.theme.NfRed
import java.text.SimpleDateFormat
import java.util.Locale

/* mismos colores que .sp de la web */
val SpCard = Color(0xFF1C1C1C)
val SpLine = Color(0x14FFFFFF)
val SpMute = Color(0xFF9A9A9A)

enum class SpStatus { SOON, LIVE, FIN, POSTPONED }

private val FIN = Regex("^(FT|AET|AOT|PEN|Match Finished|Finished|After Over Time|Final)$", RegexOption.IGNORE_CASE)

fun spStatus(e: SportEvent, info: SportInfo?, now: Long): SpStatus {
    val dur = (info?.minutes ?: 120) * 60_000L
    return when {
        e.postponed -> SpStatus.POSTPONED
        FIN.matches(e.status.trim()) -> SpStatus.FIN
        now >= e.start && now < e.start + dur -> SpStatus.LIVE
        now >= e.start + dur -> SpStatus.FIN
        else -> SpStatus.SOON
    }
}

private val hm = SimpleDateFormat("H:mm", Locale("es"))
fun spTime(t: Long): String = synchronized(hm) { hm.format(t) }

@Composable
fun SpDot(size: Dp = 9.dp, color: Color = NfRed) { Box(Modifier.size(size).clip(CircleShape).background(color)) }

@Composable
private fun Pill(st: SpStatus, start: Long) {
    val (bg, fg, text) = when (st) {
        SpStatus.LIVE -> Triple(NfRed, Color.White, "EN VIVO")
        SpStatus.FIN -> Triple(Color(0xFF2B2B2B), SpMute, "FINAL")
        SpStatus.POSTPONED -> Triple(Color(0xFF2B2B2B), SpMute, "APLAZADO")
        SpStatus.SOON -> Triple(Color.White, Color.Black, spTime(start))
    }
    Row(Modifier.background(bg, RoundedCornerShape(4.dp)).padding(horizontal = 9.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        if (st == SpStatus.LIVE) { SpDot(7.dp, Color.White); Box(Modifier.size(6.dp)) }
        Text(text, color = fg, fontSize = if (st == SpStatus.SOON) 13.sp else 12.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
    }
}

/** Escudo del equipo (TheSportsDB "/small") con la inicial de respaldo, como spImg() de la web. */
@Composable
fun TeamBadge(src: String, name: String, size: Dp) {
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Box(Modifier.fillMaxSize().clip(CircleShape).background(Color(0xFF2C2C2C)), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase().ifEmpty { "?" }, color = Color(0xFF888888), fontWeight = FontWeight.ExtraBold, fontSize = (size.value * 0.35f).sp)
        }
        if (src.isNotBlank()) AsyncImage(model = "$src/small", contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
    }
}

@Composable
private fun TeamCol(badge: String, name: String, compact: Boolean, away: Boolean, modifier: Modifier) {
    if (compact) {
        // teléfono: fila compacta, el visitante al revés (como la app de la web en móvil)
        Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (away) Arrangement.End else Arrangement.Start) {
            if (!away) TeamBadge(badge, name, 34.dp)
            Text(name, color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                textAlign = if (away) TextAlign.End else TextAlign.Start, modifier = Modifier.weight(1f, fill = false).padding(horizontal = 8.dp))
            if (away) TeamBadge(badge, name, 34.dp)
        }
    } else {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            TeamBadge(badge, name, 52.dp)
            Text(name, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        }
    }
}

/** Tarjeta .sp-card: liga + estado, equipos con escudos y marcador, sede y botón "TV en vivo". */
@Composable
fun SportCardView(e: SportEvent, info: SportInfo?, now: Long, compact: Boolean, modifier: Modifier = Modifier, onTv: () -> Unit) {
    val st = spStatus(e, info, now)
    val live = st == SpStatus.LIVE
    val shape = RoundedCornerShape(8.dp)
    FocusBox(onClick = onTv, modifier = modifier, shape = shape, focusScale = 1.03f) { f ->
        Column(
            Modifier.fillMaxWidth()
                .background(if (live) Brush.verticalGradient(listOf(Color(0x1FE50914), SpCard)) else Brush.linearGradient(listOf(if (f) Color(0xFF232323) else SpCard, if (f) Color(0xFF232323) else SpCard)), shape)
                .border(1.dp, if (live) Color(0x8CE50914) else SpLine, shape)
                .padding(horizontal = if (compact) 12.dp else 16.dp, vertical = if (compact) 12.dp else 14.dp),
            verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${info?.icon.orEmpty()} ${e.league.ifEmpty { info?.label ?: e.sport }}".trim(), color = SpMute, fontSize = 13.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Pill(st, e.start)
            }
            if (e.home.isNotBlank() && e.away.isNotBlank()) {
                val hasScore = e.homeScore.isNotEmpty() && e.awayScore.isNotEmpty() && st != SpStatus.SOON
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TeamCol(e.homeBadge, e.home, compact, false, Modifier.weight(1f))
                    if (hasScore) Text("${e.homeScore} - ${e.awayScore}", color = Color.White, fontSize = if (compact) 20.sp else 26.sp, fontWeight = FontWeight.ExtraBold,
                        maxLines = 1, modifier = Modifier.padding(horizontal = 10.dp))
                    else Text("VS", color = Color(0xFF666666), fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = 10.dp))
                    TeamCol(e.awayBadge, e.away, compact, true, Modifier.weight(1f))
                }
            } else {
                Text(e.title, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(e.venue.ifEmpty { if (st == SpStatus.SOON) spTime(e.start) else "" }, color = SpMute, fontSize = 12.5.sp, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("TV en vivo", color = Color.White, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (f) NfRed else Color(0x1AFFFFFF), RoundedCornerShape(4.dp)).padding(horizontal = 10.dp, vertical = 5.dp))
            }
        }
    }
}
