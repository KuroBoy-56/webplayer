package com.latmpx.player.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.R
import com.latmpx.player.tr
import com.latmpx.player.ui.theme.NfBg2
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.delay

/*
 * Siguiente capítulo como Netflix (igual en todas las apps): en los últimos 15 s aparece el aviso con la cuenta.
 * «Ver ahora» pasa ya; «Cancelar» deja ver el final y, al terminar, la lista pasa sola al siguiente.
 * Atrás en una película o capítulo pregunta antes de salir.
 */
private const val NEXT_PROMPT_MS = 15_000L

/** segundos que faltan para el siguiente capítulo, o 0 si el aviso no va */
fun nextPromptSeconds(m: PlayerUiModel): Int {
    if (m.live || !m.hasNext || m.nextDismissedFor == m.index) return 0
    val left = m.duration - m.position
    if (m.duration <= 120_000 || m.position <= 60_000 || left <= 0 || left > NEXT_PROMPT_MS) return 0
    return ((left + 999) / 1000).toInt()
}

@Composable
fun NextEpisodeCard(m: PlayerUiModel, a: PlayerActions, modifier: Modifier = Modifier) {
    val secs = nextPromptSeconds(m)
    if (secs == 0) return
    val watch = remember { FocusRequester() }
    // control remoto: el foco va a «Ver ahora» al aparecer
    LaunchedEffect(m.index) { delay(100); runCatching { watch.requestFocus() } }
    val name = m.episodes.getOrNull(m.index + 1).orEmpty()
    Column(modifier.widthIn(max = 380.dp).background(Color(0xE6141414), RoundedCornerShape(8.dp)).padding(16.dp)) {
        Text(tr(R.string.next_episode), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        if (name.isNotEmpty()) Text(name, color = Color(0xFFB3B3B3), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(tr(R.string.starts_in, secs), color = Color(0xFFB3B3B3), fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
        Row {
            Focusable(onClick = a.next, modifier = Modifier.focusRequester(watch), shape = RoundedCornerShape(4.dp)) { f ->
                Text(tr(R.string.watch_now), color = if (f) Color.Black else Color.White, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (f) Color.White else NfRed).padding(horizontal = 18.dp, vertical = 10.dp))
            }
            Spacer(Modifier.width(12.dp))
            Focusable(onClick = { m.nextDismissedFor = m.index }, shape = RoundedCornerShape(4.dp)) { f ->
                Text(tr(R.string.cancel), color = if (f) Color.Black else Color.White, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (f) Color.White else Color(0x40FFFFFF)).padding(horizontal = 18.dp, vertical = 10.dp))
            }
        }
    }
}

/** «¿Salir del video?»: Salir cierra el reproductor; Seguir viendo (o Atrás) vuelve al video */
@Composable
fun ExitVideoDialog(m: PlayerUiModel, a: PlayerActions) {
    if (!m.askExit) return
    val stay = remember { FocusRequester() }
    AlertDialog(
        onDismissRequest = { m.askExit = false },
        containerColor = NfBg2,
        title = { Text(tr(R.string.leave_video), color = Color.White, fontWeight = FontWeight.Bold) },
        confirmButton = {
            Focusable(onClick = { m.askExit = false; a.back() }) { f ->
                Text(tr(R.string.exit), color = Color.White, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (f) NfRed else Color(0x40FFFFFF)).padding(horizontal = 16.dp, vertical = 10.dp))
            }
        },
        dismissButton = {
            Focusable(onClick = { m.askExit = false }, modifier = Modifier.focusRequester(stay)) { f ->
                Text(tr(R.string.keep_watching), color = Color.White, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (f) Color(0x80FFFFFF) else Color(0x40FFFFFF)).padding(horizontal = 16.dp, vertical = 10.dp))
            }
        },
    )
    LaunchedEffect(Unit) { delay(100); runCatching { stay.requestFocus() } }
}
