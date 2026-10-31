package com.latmpx.player.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.R
import com.latmpx.player.data.EpgEntry
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun hm(t: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(t))

/**
 * Canal en vivo en la TV, como Roku y Vega: sin botones de pausa ni flechas en pantalla. OK muestra este panel
 * transparente: a la izquierda los canales de la carpeta (el que suena marcado; se elige con el control) y abajo el
 * canal, la hora y la guía (lo que se ve ahora con su avance y sinopsis, y lo que sigue). Arriba / abajo con el panel
 * cerrado cambian de canal (PlayerActivity); izquierda / derecha no hacen nada.
 */
@Composable
fun LiveTvOverlay(m: PlayerUiModel, a: PlayerActions) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(15_000) } }
    val current = remember { FocusRequester() }
    val list = rememberLazyListState()
    LaunchedEffect(m.focusTick) {
        list.scrollToItem((m.index - 3).coerceAtLeast(0))
        delay(60)
        runCatching { current.requestFocus() }
    }
    Box(Modifier.fillMaxSize()) {
        // lista de canales de la carpeta
        Column(
            Modifier.fillMaxHeight().width(330.dp).background(Brush.horizontalGradient(listOf(Color(0xE6000000), Color(0x99000000)))).padding(vertical = 20.dp),
        ) {
            Text(stringResource(R.string.channels), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 20.dp, bottom = 10.dp))
            LazyColumn(state = list, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                itemsIndexed(m.channels) { i, name ->
                    ChannelRow(i + 1, name, i == m.index, if (i == m.index) Modifier.focusRequester(current) else Modifier, onFocus = { m.poke() }) {
                        if (i != m.index) a.pickEpisode(i)
                        m.visible = false
                    }
                }
            }
        }
        // abajo: canal, hora y guía
        Column(
            Modifier.align(Alignment.BottomEnd).padding(start = 330.dp).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000)))).padding(start = 28.dp, end = 32.dp, top = 40.dp, bottom = 24.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${m.index + 1}", color = Color(0xFFB3B3B3), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(12.dp))
                Text(m.title, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (m.quality.isNotEmpty()) Text(m.quality, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(Color(0x33FFFFFF), RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                Spacer(Modifier.width(14.dp))
                Text(hm(now), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            val cur = m.epg.firstOrNull { it.start <= now && it.end > now }
            val next = m.epg.firstOrNull { it.start >= (cur?.end ?: now) }
            if (cur == null) Text(stringResource(R.string.no_guide_for, m.title), color = Color(0xFFB3B3B3), fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
            else NowProgram(cur, now)
            if (next != null) Text("${stringResource(R.string.upcoming_badge)}  ${hm(next.start)}  ${next.title}", color = Color(0xFFB3B3B3), fontSize = 13.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun NowProgram(p: EpgEntry, now: Long) {
    Column(Modifier.padding(top = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(NfRed, CircleShape))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.on_now_badge), color = NfRed, fontSize = 12.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.width(10.dp))
            Text(p.title, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${hm(p.start)} – ${hm(p.end)}", color = Color(0xFFCFCFD8), fontSize = 13.sp)
            Spacer(Modifier.width(10.dp))
            val pct = if (p.end > p.start) ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) else 0f
            Box(Modifier.weight(1f).height(4.dp).background(Color(0x55FFFFFF), RoundedCornerShape(2.dp))) {
                Box(Modifier.fillMaxWidth(pct).fillMaxHeight().background(NfRed, RoundedCornerShape(2.dp)))
            }
            Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.min_left, ((p.end - now) / 60_000).coerceAtLeast(1).toInt()), color = Color(0xFFCFCFD8), fontSize = 13.sp)
        }
        if (p.desc.isNotBlank()) Text(p.desc, color = Color(0xFFB4B4BE), fontSize = 13.sp, lineHeight = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun ChannelRow(n: Int, name: String, playing: Boolean, modifier: Modifier, onFocus: () -> Unit, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val f by src.collectIsFocusedAsState()
    LaunchedEffect(f) { if (f) onFocus() }
    Row(
        modifier.fillMaxWidth().padding(horizontal = 10.dp).clickable(interactionSource = src, indication = null, onClick = onClick)
            .background(if (f) Color.White else if (playing) Color(0x40E50914) else Color.Transparent, RoundedCornerShape(6.dp))
            .then(if (playing && !f) Modifier.border(1.dp, NfRed, RoundedCornerShape(6.dp)) else Modifier)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("$n", color = if (f) Color(0xFF555555) else Color(0xFF9A9A9A), fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(40.dp))
        Text(name, color = if (f) Color.Black else Color.White, fontSize = 15.sp, fontWeight = if (f || playing) FontWeight.Bold else FontWeight.Normal,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (playing) Box(Modifier.size(8.dp).background(NfRed, CircleShape))
    }
}
