package com.latmpx.player.player

import androidx.compose.animation.AnimatedVisibility
import com.latmpx.player.ui.theme.NfRed
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import kotlinx.coroutines.delay
import java.util.Locale

/** color del distribuidor (rojo sin distribuidor) */
private val Red: Color get() = NfRed
private val Dim = Color(0xFFB3B3B3)

enum class PlayerPanel { TRACKS, SPEED, EPISODES }

/** Estado de la interfaz del reproductor (lo actualiza PlayerActivity desde ExoPlayer). */
class PlayerUiModel(val player: ExoPlayer, val live: Boolean, val tv: Boolean) {
    var title by mutableStateOf("")
    var subtitle by mutableStateOf("")
    var visible by mutableStateOf(true)
    var playing by mutableStateOf(false)
    var buffering by mutableStateOf(true)
    var position by mutableLongStateOf(0L)
    var duration by mutableLongStateOf(0L)
    var buffered by mutableLongStateOf(0L)
    var tracksRev by mutableIntStateOf(0)
    var panel by mutableStateOf<PlayerPanel?>(null)
    var toast by mutableStateOf<String?>(null)
    var resize by mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT)
    var locked by mutableStateOf(false)
    var speed by mutableFloatStateOf(1f)
    var hasNext by mutableStateOf(false)
    var episodes by mutableStateOf<List<String>>(emptyList())
    var index by mutableIntStateOf(0)
    var seekHint by mutableStateOf<String?>(null)
    var quality by mutableStateOf("")
    var lastTouch by mutableLongStateOf(System.currentTimeMillis())
    /** aumenta cada vez que se pide mostrar los controles con el control remoto (para dar el foco al botón de reproducir) */
    var focusTick by mutableIntStateOf(0)

    fun poke() { visible = true; lastTouch = System.currentTimeMillis() }
    fun toggle() { if (player.isPlaying) player.pause() else { if (player.playbackState == Player.STATE_ENDED) player.seekTo(0); player.play() }; poke() }
}

/** Acciones que resuelve la actividad (cerrar, siguiente, cambiar de canal...). */
class PlayerActions(
    val back: () -> Unit,
    val next: () -> Unit,
    val pickEpisode: (Int) -> Unit,
    val zap: (Int) -> Unit,
    val resize: (Int) -> Unit,
)

data class TrackOption(val label: String, val selected: Boolean, val apply: () -> Unit)

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
fun audioOptions(p: ExoPlayer): List<TrackOption> {
    val out = ArrayList<TrackOption>()
    for (g in p.currentTracks.groups) {
        if (g.type != C.TRACK_TYPE_AUDIO) continue
        for (i in 0 until g.length) {
            if (!g.isTrackSupported(i, true)) continue
            val f = g.getTrackFormat(i)
            out += TrackOption(audioLabel(f, out.size), g.isTrackSelected(i)) {
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                    .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, i)).build()
            }
        }
    }
    return out
}

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
fun textOptions(p: ExoPlayer): List<TrackOption> {
    val out = ArrayList<TrackOption>()
    val disabled = p.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
    var any = false
    for (g in p.currentTracks.groups) {
        if (g.type != C.TRACK_TYPE_TEXT) continue
        for (i in 0 until g.length) {
            if (!g.isTrackSupported(i, true)) continue
            val f = g.getTrackFormat(i)
            val sel = !disabled && g.isTrackSelected(i)
            if (sel) any = true
            out += TrackOption(langName(f.language, f.label) + if ((f.selectionFlags and C.SELECTION_FLAG_FORCED) != 0) " (forzados)" else "", sel) {
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                    .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, i)).build()
            }
        }
    }
    out.add(0, TrackOption("Desactivados", !any) {
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
    })
    return out
}

private fun audioLabel(f: Format, i: Int): String {
    val ch = when {
        f.channelCount >= 8 -> " 7.1"
        f.channelCount >= 6 -> " 5.1"
        f.channelCount == 2 -> " Estéreo"
        else -> ""
    }
    val codec = when (f.sampleMimeType) {
        "audio/eac3", "audio/eac3-joc" -> " · Dolby Digital Plus"
        "audio/ac3" -> " · Dolby Digital"
        "audio/true-hd" -> " · Dolby TrueHD"
        "audio/vnd.dts", "audio/vnd.dts.hd" -> " · DTS"
        else -> ""
    }
    val name = langName(f.language, f.label).ifBlank { "Audio ${i + 1}" }
    return name + ch + codec
}

private val LANGS = mapOf(
    "es" to "Español", "spa" to "Español", "en" to "Inglés", "eng" to "Inglés", "pt" to "Portugués", "por" to "Portugués",
    "fr" to "Francés", "fre" to "Francés", "fra" to "Francés", "de" to "Alemán", "ger" to "Alemán", "deu" to "Alemán",
    "it" to "Italiano", "ita" to "Italiano", "ja" to "Japonés", "jpn" to "Japonés", "ko" to "Coreano", "kor" to "Coreano",
    "zh" to "Chino", "chi" to "Chino", "zho" to "Chino", "ru" to "Ruso", "rus" to "Ruso",
)

fun langName(lang: String?, label: String?): String {
    val l = (lang ?: "").lowercase(Locale.ROOT).substringBefore('-')
    val base = LANGS[l] ?: if (l.isNotEmpty() && l != "und") Locale(l).getDisplayLanguage(Locale("es")).replaceFirstChar { it.uppercase() } else ""
    val lb = label?.trim().orEmpty()
    if (lb.isNotEmpty() && !lb.equals(base, true) && !lb.equals(l, true)) {
        val latino = Regex("lat|latino|latam|mx", RegexOption.IGNORE_CASE).containsMatchIn(lb)
        return when {
            base.isEmpty() -> lb
            base == "Español" && latino -> "Español (Latinoamérica)"
            else -> "$base · $lb"
        }
    }
    return base.ifEmpty { lb }
}

fun fmtTime(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s % 3600 / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

/* ------------------------------------------------------------------------------------------------ */

@Composable
fun PlayerOverlay(m: PlayerUiModel, a: PlayerActions) {
    // posición y búfer cada medio segundo
    LaunchedEffect(m) {
        while (true) {
            val p = m.player
            m.position = p.currentPosition.coerceAtLeast(0)
            m.duration = p.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
            m.buffered = p.bufferedPosition
            val h = p.videoFormat?.height ?: 0
            m.quality = when { h >= 2000 -> "4K"; h >= 1400 -> "2K"; h >= 1000 -> "Full HD"; h >= 700 -> "HD"; h > 0 -> "SD"; else -> "" }
            delay(500)
        }
    }
    // se esconden solos a los 4 s mientras reproduce (no si hay un panel abierto)
    LaunchedEffect(m.visible, m.lastTouch, m.playing, m.panel) {
        if (m.visible && m.playing && m.panel == null) { delay(4000); if (System.currentTimeMillis() - m.lastTouch >= 3900) m.visible = false }
    }
    LaunchedEffect(m.toast) { if (m.toast != null) { delay(2600); m.toast = null } }
    LaunchedEffect(m.seekHint) { if (m.seekHint != null) { delay(700); m.seekHint = null } }

    Box(
        Modifier.fillMaxSize().pointerInput(m.locked) {
            detectTapGestures(
                onTap = { if (m.panel == null) { if (m.visible) m.visible = false else m.poke() } },
                onDoubleTap = { o ->
                    if (m.locked || m.live) return@detectTapGestures
                    val left = o.x < size.width / 2f
                    if (left) m.player.seekBack() else m.player.seekForward()
                    m.seekHint = if (left) "« 10 s" else "10 s »"
                },
            )
        },
    ) {
        if (m.buffering) CircularProgressIndicator(color = Red, strokeWidth = 4.dp, modifier = Modifier.size(64.dp).align(Alignment.Center))
        m.seekHint?.let { Text(it, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.Center).background(Color(0x99000000), RoundedCornerShape(30.dp)).padding(horizontal = 20.dp, vertical = 10.dp)) }

        AnimatedVisibility(m.visible && m.panel == null, enter = fadeIn(), exit = fadeOut()) {
            if (m.locked) LockedLayer(m) else Controls(m, a)
        }
        m.panel?.let { Panel(m, a, it) }
        m.toast?.let { t ->
            Text(t, color = Color.White, fontSize = 15.sp, modifier = Modifier.align(Alignment.TopCenter).padding(top = 28.dp)
                .background(Color(0xE6141414), RoundedCornerShape(8.dp)).border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(8.dp)).padding(horizontal = 18.dp, vertical = 10.dp))
        }
    }
}

@Composable
private fun LockedLayer(m: PlayerUiModel) {
    Box(Modifier.fillMaxSize()) {
        CtrlButton(Icons.Filled.Lock, "Desbloquear", Modifier.align(Alignment.BottomCenter).padding(bottom = 36.dp), big = false, label = "Pantalla bloqueada · toca para desbloquear") {
            m.locked = false; m.poke()
        }
    }
}

@Composable
private fun Controls(m: PlayerUiModel, a: PlayerActions) {
    val playFocus = remember { FocusRequester() }
    LaunchedEffect(m.focusTick) { if (m.tv) runCatching { playFocus.requestFocus() } }
    Box(Modifier.fillMaxSize()) {
        // sombras arriba y abajo para leer los textos sobre cualquier imagen
        Box(Modifier.fillMaxWidth().height(150.dp).background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent))))
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(220.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000)))))

        // arriba: atrás, título, calidad
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            CtrlButton(Icons.AutoMirrored.Filled.ArrowBack, "Atrás", big = false) { a.back() }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(m.title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (m.subtitle.isNotBlank()) Text(m.subtitle, color = Dim, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (m.live) Badge("EN VIVO", Red)
            if (m.quality.isNotEmpty()) { Spacer(Modifier.width(8.dp)); Badge(m.quality, Color(0x33FFFFFF)) }
        }

        // centro: -10, reproducir/pausa, +10 (en vivo: canal anterior/siguiente)
        Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (m.tv) 36.dp else 48.dp)) {
            if (m.live) CtrlButton(Icons.Filled.KeyboardArrowUp, "Canal anterior", big = false) { a.zap(-1); m.poke() }
            else CtrlButton(Icons.Filled.Replay10, "Retroceder 10 s") { m.player.seekBack(); m.poke() }
            CtrlButton(if (m.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (m.playing) "Pausa" else "Reproducir", Modifier.focusRequester(playFocus), huge = true) { m.toggle() }
            if (m.live) CtrlButton(Icons.Filled.KeyboardArrowDown, "Canal siguiente", big = false) { a.zap(1); m.poke() }
            else CtrlButton(Icons.Filled.Forward10, "Adelantar 10 s") { m.player.seekForward(); m.poke() }
        }

        // abajo: barra de progreso y opciones
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 22.dp, vertical = 14.dp)) {
            if (!m.live && m.duration > 0) SeekBar(m)
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                if (!m.live) Pill(Icons.Filled.Speed, "Velocidad (${speedLabel(m.speed)})") { m.panel = PlayerPanel.SPEED }
                if (!m.tv) Pill(Icons.Filled.LockOpen, "Bloquear") { m.locked = true; m.poke() }
                if (m.episodes.size > 1 && !m.live) Pill(Icons.Filled.VideoLibrary, "Episodios") { m.panel = PlayerPanel.EPISODES }
                Pill(Icons.Filled.Subtitles, "Audio y subtítulos") { m.panel = PlayerPanel.TRACKS }
                Pill(Icons.Filled.AspectRatio, resizeLabel(m.resize)) {
                    val next = when (m.resize) {
                        AspectRatioFrameLayout.RESIZE_MODE_FIT -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                        else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                    }
                    a.resize(next); m.poke()
                }
                if (m.hasNext && !m.live) Pill(Icons.Filled.SkipNext, "Siguiente episodio") { a.next() }
            }
        }
    }
}

@Composable
private fun SeekBar(m: PlayerUiModel) {
    var dragging by remember { mutableStateOf(false) }
    var drag by remember { mutableFloatStateOf(0f) }
    val dur = m.duration.toFloat().coerceAtLeast(1f)
    val shown = if (dragging) drag else m.position.toFloat()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            Slider(
                value = shown.coerceIn(0f, dur), valueRange = 0f..dur,
                onValueChange = { dragging = true; drag = it; m.poke() },
                onValueChangeFinished = { m.player.seekTo(drag.toLong()); dragging = false; m.poke() },
                colors = SliderDefaults.colors(thumbColor = Red, activeTrackColor = Red, inactiveTrackColor = Color(0x40FFFFFF)),
            )
        }
        Text(
            if (dragging) fmtTime(drag.toLong()) else "-" + fmtTime(m.duration - m.position),
            color = Color.White, fontSize = 13.sp, modifier = Modifier.padding(start = 10.dp).widthIn(min = 56.dp),
        )
    }
}

@Composable
private fun Panel(m: PlayerUiModel, a: PlayerActions, p: PlayerPanel) {
    val first = remember { FocusRequester() }
    LaunchedEffect(p) { if (m.tv) { delay(80); runCatching { first.requestFocus() } } }
    Box(Modifier.fillMaxSize().background(Color(0xF0000000)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { }) {
        CtrlButton(Icons.Filled.Close, "Cerrar", Modifier.align(Alignment.TopEnd).padding(18.dp), big = false) { m.panel = null; m.poke() }
        when (p) {
            PlayerPanel.TRACKS -> {
                val rev = m.tracksRev
                val audio = remember(rev) { audioOptions(m.player) }
                val subs = remember(rev) { textOptions(m.player) }
                Row(Modifier.fillMaxSize().padding(start = 40.dp, end = 40.dp, top = 60.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                    TrackColumn("Audio", if (audio.isEmpty()) listOf(TrackOption("Predeterminado", true) {}) else audio, Modifier.weight(1f), first) { it.apply(); m.tracksRev++ }
                    TrackColumn("Subtítulos", subs, Modifier.weight(1f), null) { it.apply(); m.tracksRev++ }
                }
            }
            PlayerPanel.SPEED -> {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Velocidad de reproducción", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(28.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f).forEachIndexed { i, s ->
                            val sel = m.speed == s
                            Focusable(onClick = { m.player.setPlaybackSpeed(s); m.speed = s; m.panel = null; m.poke() }, modifier = if (i == 2) Modifier.focusRequester(first) else Modifier, shape = CircleShape) { f ->
                                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(8.dp)) {
                                    Box(Modifier.size(if (sel) 22.dp else 16.dp).background(if (sel) Color.White else if (f) Color(0xCCFFFFFF) else Color(0x66FFFFFF), CircleShape))
                                    Text(speedLabel(s), color = if (sel || f) Color.White else Dim, fontSize = 15.sp, fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.padding(top = 10.dp))
                                }
                            }
                        }
                    }
                }
            }
            PlayerPanel.EPISODES -> {
                val st = rememberLazyListState(initialFirstVisibleItemIndex = (m.index - 1).coerceAtLeast(0))
                Column(Modifier.fillMaxSize().padding(start = 40.dp, end = 40.dp, top = 24.dp)) {
                    Text("Episodios", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    LazyColumn(state = st, contentPadding = PaddingValues(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        itemsIndexed(m.episodes) { i, t ->
                            val cur = i == m.index
                            Focusable(onClick = { m.panel = null; a.pickEpisode(i) }, modifier = (if (cur) Modifier.focusRequester(first) else Modifier).fillMaxWidth(), shape = RoundedCornerShape(6.dp)) { f ->
                                Row(Modifier.fillMaxWidth().background(if (f) Color(0x33FFFFFF) else if (cur) Color(0x1AFFFFFF) else Color.Transparent).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    if (cur) Icon(Icons.Filled.PlayArrow, null, tint = Red, modifier = Modifier.size(20.dp)) else Spacer(Modifier.width(20.dp))
                                    Text(t, color = if (cur || f) Color.White else Dim, fontSize = 15.sp, fontWeight = if (cur) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 10.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TrackColumn(title: String, items: List<TrackOption>, modifier: Modifier, first: FocusRequester?, onPick: (TrackOption) -> Unit) {
    Column(modifier) {
        Text(title, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 14.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            itemsIndexed(items) { i, t ->
                Focusable(onClick = { onPick(t) }, modifier = (if (i == 0 && first != null) Modifier.focusRequester(first) else Modifier).fillMaxWidth(), shape = RoundedCornerShape(6.dp)) { f ->
                    Row(Modifier.fillMaxWidth().background(if (f) Color(0x33FFFFFF) else Color.Transparent).padding(horizontal = 10.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(28.dp)) { if (t.selected) Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
                        Text(t.label, color = if (t.selected || f) Color.White else Dim, fontSize = 16.sp, fontWeight = if (t.selected) FontWeight.Bold else FontWeight.Normal)
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------------------------------------ */

/** Botón que responde al dedo y al control remoto (borde blanco y un poco más grande con el foco). */
@Composable
fun Focusable(onClick: () -> Unit, modifier: Modifier = Modifier, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(8.dp), content: @Composable BoxScope.(Boolean) -> Unit) {
    val src = remember { MutableInteractionSource() }
    val f by src.collectIsFocusedAsState()
    Box(
        modifier.scale(if (f) 1.06f else 1f).clip(shape)
            .then(if (f) Modifier.border(2.dp, Color.White, shape) else Modifier)
            .clickable(interactionSource = src, indication = null, onClick = onClick),
    ) { content(f) }
}

@Composable
private fun CtrlButton(icon: ImageVector, desc: String, modifier: Modifier = Modifier, big: Boolean = true, huge: Boolean = false, label: String? = null, onClick: () -> Unit) {
    Focusable(onClick = onClick, modifier = modifier, shape = if (label != null) RoundedCornerShape(30.dp) else CircleShape) { f ->
        Row(
            Modifier.background(if (f) Color(0x40FFFFFF) else if (huge) Color(0x26FFFFFF) else Color.Transparent, if (label != null) RoundedCornerShape(30.dp) else CircleShape)
                .padding(if (huge) 14.dp else 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, desc, tint = Color.White, modifier = Modifier.size(if (huge) 62.dp else if (big) 46.dp else 30.dp))
            if (label != null) Text(label, color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(start = 8.dp, end = 6.dp))
        }
    }
}

@Composable
private fun Pill(icon: ImageVector, text: String, onClick: () -> Unit) {
    Focusable(onClick = onClick, shape = RoundedCornerShape(20.dp)) { f ->
        Row(Modifier.background(if (f) Color(0x40FFFFFF) else Color.Transparent).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
            Text(text, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.padding(start = 6.dp))
        }
    }
}

@Composable
private fun Badge(t: String, bg: Color) {
    Text(t, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Black, modifier = Modifier.background(bg, RoundedCornerShape(3.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
}

private fun speedLabel(s: Float) = if (s == 1f) "1x" else (if (s % 1f == 0f) "${s.toInt()}x" else "${s}x")

private fun resizeLabel(r: Int) = when (r) {
    AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> "Zoom"
    AspectRatioFrameLayout.RESIZE_MODE_FILL -> "Estirar"
    else -> "Ajustar"
}
