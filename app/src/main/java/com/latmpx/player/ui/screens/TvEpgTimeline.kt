package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.EpgEntry
import com.latmpx.player.data.Item
import com.latmpx.player.ui.components.TvFocusable
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import kotlin.math.roundToInt

private const val DAY_MS = 86_400_000L

/** 00:00 del día de [t] (hora local) */
internal fun epgDayStart(t: Long): Long = Calendar.getInstance().apply {
    timeInMillis = t
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
}.timeInMillis

/** ventana de la guía: desde las 00:00 de ayer hasta el final de pasado mañana */
internal fun epgWindow(now: Long): Pair<Long, Long> {
    val c = Calendar.getInstance().apply { timeInMillis = epgDayStart(now) }
    c.add(Calendar.DAY_OF_YEAR, -1)
    val from = c.timeInMillis
    c.add(Calendar.DAY_OF_YEAR, 4)
    return from to c.timeInMillis
}

private val hmFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
private fun hm(t: Long) = synchronized(hmFmt) { hmFmt.format(t) }

/** Ayer / Hoy / Mañana / "sáb 11" */
internal fun epgDayLabel(t: Long, now: Long): String = when (((epgDayStart(t) - epgDayStart(now)).toDouble() / DAY_MS).roundToInt()) {
    -1 -> tr(R.string.yesterday)
    0 -> tr(R.string.today)
    1 -> tr(R.string.tomorrow)
    else -> SimpleDateFormat("EEE d", Locale.getDefault()).format(t).replace(".", "").replaceFirstChar { it.uppercase() }
}

/**
 * Guía del canal que se ve en la miniatura, justo debajo de ella: días (ayer, hoy, mañana y pasado mañana),
 * datos del programa elegido y la línea de tiempo deslizable con el control. El programa en emisión va marcado
 * "EN SINTONÍA"; al entrar a la línea de tiempo el foco cae en él. OK sobre él abre la pantalla completa.
 */
@Composable
internal fun TvEpgTimeline(ch: Item?, guide: List<EpgEntry>?, now: Long, entry: FocusRequester, onWatch: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxWidth().padding(top = 12.dp)) {
        when {
            ch == null -> Text(stringResource(R.string.epg_pick_channel), color = LvDim, fontSize = 14.sp)
            guide == null -> Text(stringResource(R.string.loading_guide), color = LvDim, fontSize = 14.sp)
            guide.isEmpty() -> Text(stringResource(R.string.no_guide_for, ch.name), color = LvDim, fontSize = 14.sp)
            else -> key(ch.id) { TimelineBody(guide, now, entry, onWatch) }
        }
    }
}

@Composable
private fun TimelineBody(guide: List<EpgEntry>, now: Long, entry: FocusRequester, onWatch: () -> Unit) {
    val nowIdx = guide.indexOfFirst { it.start <= now && it.end > now }
    // sin programa en emisión: el foco entra al próximo (o al último si todo ya pasó)
    val enterIdx = if (nowIdx >= 0) nowIdx else guide.indexOfFirst { it.start > now }.let { if (it >= 0) it else guide.lastIndex }
    val days = remember(guide) { guide.map { epgDayStart(it.start) }.distinct() }
    val firstOfDay = remember(guide) { days.associateWith { d -> guide.indexOfFirst { epgDayStart(it.start) == d } } }
    val dayReq = remember(guide) { days.associateWith { FocusRequester() } }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var focused by remember { mutableStateOf<EpgEntry?>(null) }
    LaunchedEffect(Unit) { list.scrollToItem((enterIdx - 1).coerceAtLeast(0)) }
    val shown = focused ?: guide.getOrNull(enterIdx)

    // días: OK lleva la línea de tiempo al primer programa de ese día
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        days.forEach { d ->
            val sel = shown != null && epgDayStart(shown.start) == d
            TvFocusable(
                onClick = {
                    val i = firstOfDay[d] ?: return@TvFocusable
                    scope.launch {
                        list.scrollToItem(i)
                        delay(40)
                        runCatching { dayReq.getValue(d).requestFocus() }
                    }
                },
                scale = 1.05f, border = false, shape = RoundedCornerShape(50),
            ) { f ->
                Text(
                    epgDayLabel(d, now), fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                    color = if (f) Color.Black else if (sel) Color.White else LvDim,
                    modifier = Modifier.background(if (f) Color.White else if (sel) LvFocus else Color.Transparent, RoundedCornerShape(50))
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                )
            }
        }
    }

    ProgramInfo(shown, now, Modifier.padding(top = 8.dp))

    LazyRow(
        state = list,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).onFocusChanged { if (!it.hasFocus) focused = null },
        contentPadding = PaddingValues(vertical = 4.dp, horizontal = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        itemsIndexed(guide) { i, p ->
            val d = epgDayStart(p.start)
            var mod: Modifier = Modifier
            if (i == enterIdx) mod = mod.focusRequester(entry)
            if (firstOfDay[d] == i && i != enterIdx) mod = mod.focusRequester(dayReq.getValue(d))
            ProgramBlock(
                p, now, live = i == nowIdx, newDay = i == 0 || epgDayStart(guide[i - 1].start) != d, dayLabel = epgDayLabel(p.start, now),
                modifier = mod, onFocus = { focused = p }, onClick = { if (i == nowIdx) onWatch() },
            )
        }
    }
}

/** estado, horario, título y sinopsis del programa elegido en la línea de tiempo */
@Composable
private fun ProgramInfo(p: EpgEntry?, now: Long, modifier: Modifier) {
    Column(modifier.fillMaxWidth().height(86.dp)) {
        if (p == null) return@Column
        val live = p.start <= now && p.end > now
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (live) {
                Box(Modifier.size(7.dp).background(NfRed, CircleShape))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.on_now_badge), color = NfRed, fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 1.5.sp)
                Text("  ·  " + stringResource(R.string.min_left, ((p.end - now) / 60_000).coerceAtLeast(1).toInt()), color = LvDim, fontSize = 12.sp)
            } else {
                Text(stringResource(if (p.end <= now) R.string.aired_badge else R.string.upcoming_badge), color = LvDim, fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 1.5.sp)
                Text("  ·  ${epgDayLabel(p.start, now)} ${hm(p.start)} – ${hm(p.end)}", color = LvDim, fontSize = 12.sp)
            }
        }
        Text(p.title, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        if (live) Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${hm(p.start)} – ${hm(p.end)}", color = Color(0xFFCFCFD8), fontSize = 12.sp)
            Spacer(Modifier.width(8.dp))
            Bar(p, now, Modifier.weight(1f))
        }
        if (p.desc.isNotBlank()) Text(
            p.desc, color = Color(0xFFB4B4BE), fontSize = 12.sp, lineHeight = 16.sp, maxLines = if (live) 2 else 3, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 3.dp),
        )
    }
}

/** bloque de la línea de tiempo: ancho según la duración; el de ahora en rojo con su avance, lo emitido atenuado */
@Composable
private fun ProgramBlock(
    p: EpgEntry, now: Long, live: Boolean, newDay: Boolean, dayLabel: String,
    modifier: Modifier, onFocus: () -> Unit, onClick: () -> Unit,
) {
    val minutes = ((p.end - p.start) / 60_000f).coerceAtLeast(1f)
    val w = (minutes * 1.6f).coerceIn(96f, 260f).dp
    val past = p.end <= now
    TvFocusable(onClick = onClick, onFocus = onFocus, scale = 1.04f, shape = RoundedCornerShape(6.dp), modifier = modifier.width(w).height(66.dp)) { f ->
        Box(
            Modifier.fillMaxSize().background(
                when {
                    f -> Brush.verticalGradient(listOf(Color(0xFF34343F), LvFocus))
                    live -> Brush.verticalGradient(listOf(Color(0x66E50914), Color(0x33E50914)))
                    else -> Brush.verticalGradient(listOf(if (past) Color(0xFF121218) else LvActive, if (past) Color(0xFF121218) else LvActive))
                },
            ),
        ) {
            if (newDay) Box(Modifier.width(3.dp).fillMaxHeight().background(Color(0x55FFFFFF)))
            Column(Modifier.fillMaxSize().padding(start = 9.dp, end = 8.dp, top = 6.dp, bottom = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (newDay) Text("$dayLabel ", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Black, maxLines = 1)
                    Text(hm(p.start), color = if (live) Color.White else if (past && !f) Color(0xFF6A6A74) else Color(0xFFCFCFD8), fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                    if (live) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            stringResource(R.string.now_badge), color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Black, maxLines = 1,
                            modifier = Modifier.background(NfRed, RoundedCornerShape(3.dp)).padding(horizontal = 4.dp),
                        )
                    }
                }
                Text(
                    p.title, color = if (f || live) Color.White else if (past) Color(0xFF8A8A96) else LvText, fontSize = 12.sp, lineHeight = 14.sp,
                    fontWeight = if (f || live) FontWeight.Bold else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (live) Bar(p, now, Modifier.align(Alignment.BottomStart).fillMaxWidth())
        }
    }
}

@Composable
private fun Bar(p: EpgEntry, now: Long, modifier: Modifier) {
    val pct = if (p.end > p.start) ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) else 0f
    Box(modifier.height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color(0xFF34343F))) {
        Box(Modifier.fillMaxWidth(pct).fillMaxHeight().background(NfRed))
    }
}
