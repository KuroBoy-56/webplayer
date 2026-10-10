package com.latmpx.player.ui.screens

import android.content.Context
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import com.latmpx.player.R
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.EpgEntry
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Net
import com.latmpx.player.data.PanelEpg
import com.latmpx.player.data.Session
import com.latmpx.player.data.Store
import com.latmpx.player.data.Xtream
import com.latmpx.player.player.LivePreview
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.TvFocusable
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Locale

/* paleta oscura "premium" (estilo TiviMate) con el rojo de la web; con un distribuidor que tiene colores se deriva de los suyos */
private fun lv(default: Color, fromBrand: (com.latmpx.player.ui.theme.BrandPalette) -> Color): Color =
    if (com.latmpx.player.data.Tenant.brand?.colors == null) default else fromBrand(com.latmpx.player.ui.theme.brandPalette)
internal val LvBg: Color get() = lv(Color(0xFF0B0B0F)) { androidx.compose.ui.graphics.lerp(it.bg, Color.Black, 0.35f) }
internal val LvPanel: Color get() = lv(Color(0xFF111117)) { androidx.compose.ui.graphics.lerp(it.bg, Color.Black, 0.15f) }
internal val LvFocus: Color get() = lv(Color(0xFF22222C)) { androidx.compose.ui.graphics.lerp(it.surface, it.text, 0.12f) }
internal val LvActive: Color get() = lv(Color(0xFF17171F)) { it.surface }
internal val LvLine: Color get() = lv(Color(0xFF1E1E27)) { androidx.compose.ui.graphics.lerp(it.surface, it.text, 0.06f) }
internal val LvLogo: Color get() = lv(Color(0xFF16161D)) { it.card }
internal val LvDim: Color get() = lv(Color(0xFF8A8A96)) { it.gray }
internal val LvText: Color get() = lv(Color(0xFFEDEDF2)) { it.text }

/**
 * TV en vivo para televisor al estilo TiviMate: categorías a la izquierda, canales con número, logo, programa actual
 * y barra de avance al centro; a la derecha la vista previa en vivo del canal SELECCIONADO y debajo su guía de ayer a pasado mañana
 * (línea de tiempo enfocable: derecha desde un canal entra directo al programa en sintonía, ver TvEpgTimeline.kt).
 * Recorrer la lista no cambia la vista previa: OK sobre un canal lo selecciona y empieza a verse a la derecha;
 * OK otra vez sobre el canal que ya se ve lo abre a pantalla completa (reproductor de siempre).
 * Mantener OK o MENÚ marca favorito; se recuerda el último canal visto y el foco vuelve a él.
 * La vista previa se detiene al salir de TV en vivo, al abrir la pantalla completa y con la app en segundo plano.
 */
@Composable
fun TvLive(state: AppState, all: List<Item>, cats: List<Pair<String, String>>) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    var favTick by remember { mutableIntStateOf(0) }
    val lastId = remember(state.refresh) { Store.lastChannel() }
    var cat by rememberSaveable {
        val last = all.firstOrNull { it.id == lastId }
        mutableStateOf(
            when {
                last != null && Cloud.isFav(last.key) -> FAVS
                last == null && Cloud.favList(Kind.LIVE).isNotEmpty() -> FAVS
                else -> ALL
            },
        )
    }
    var focusedId by rememberSaveable { mutableIntStateOf(lastId) }
    // canal seleccionado con OK: el que se ve en la vista previa (no cambia al recorrer la lista)
    var selectedId by rememberSaveable { mutableIntStateOf(lastId) }
    // al volver de la pantalla completa (donde se pudo cambiar de canal) queda seleccionado el último visto
    LaunchedEffect(lastId) { if (lastId != 0 && all.any { it.id == lastId }) selectedId = lastId }
    val now by produceState(System.currentTimeMillis()) { while (true) { delay(30_000); value = System.currentTimeMillis() } }

    // número de canal: su posición en la lista completa (igual en todas las categorías)
    val numbers = remember(all) { all.withIndex().associate { (i, c) -> c.id to i + 1 } }
    val counts = remember(all, favTick, Cloud.rev) {
        all.groupingBy { it.categoryId }.eachCount() + mapOf(ALL to all.size, FAVS to all.count { Cloud.isFav(it.key) })
    }
    val shown = remember(all, cat, favTick, Cloud.rev) {
        when (cat) {
            ALL -> all
            FAVS -> all.filter { Cloud.isFav(it.key) }
            else -> all.filter { it.categoryId == cat }
        }
    }
    val selected = remember(all, selectedId) { all.firstOrNull { it.id == selectedId } }
    // guía del servidor IPTV (get_short_epg) ya consultada; si no tiene, la del panel (epg.php)
    val providerEpg = remember { mutableStateMapOf<Int, List<EpgEntry>>() }
    // guía bajo la miniatura: la del canal seleccionado, de ayer a pasado mañana.
    // Primero la completa del servidor IPTV (get_simple_data_table), si no la corta (get_short_epg) y si tampoco, la del panel (epg.php)
    val guide by produceState<List<EpgEntry>?>(null, selected?.id) {
        val ch = selected ?: run { value = emptyList(); return@produceState }
        val (from, to) = epgWindow(System.currentTimeMillis())
        val inWindow: (List<EpgEntry>) -> List<EpgEntry> = { l -> l.filter { it.end > from && it.start < to } }
        value = GuideCache.get(ch.id)
        if (value != null) return@produceState
        var g = inWindow(runCatching { Xtream.fullEpg(s, ch.id) }.getOrDefault(emptyList()))
        if (g.none { it.end > System.currentTimeMillis() }) {
            val short = runCatching { Xtream.shortEpg(s, ch.id, 60) }.getOrDefault(emptyList())
            g = inWindow((g + short).sortedBy { it.start }.distinctBy { it.start })
        }
        if (g.isEmpty()) {
            val i = shown.indexOfFirst { it.id == ch.id }.coerceAtLeast(0)
            g = inWindow(PanelEpg.full(ch, shown.subList(i, minOf(shown.size, i + 400))))
        }
        if (g.isNotEmpty()) {
            GuideCache.put(ch.id, g)
            providerEpg[ch.id] = g.filter { it.end > System.currentTimeMillis() }
        }
        value = g
    }
    val timelineEntry = remember { FocusRequester() }

    // vista previa en vivo (se suelta antes de abrir la pantalla completa y al salir de la app)
    val preview = remember { LivePreview(ctx) }
    var resumeTick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        resumeTick++
        onPauseOrDispose { preview.release() }
    }
    DisposableEffect(Unit) { onDispose { preview.release() } }
    LaunchedEffect(selected?.id, resumeTick) {
        val ch = selected ?: return@LaunchedEffect
        preview.play(s, ch)
    }

    val play: (Int) -> Unit = { i ->
        shown.getOrNull(i)?.let { ch ->
            focusedId = ch.id
            Store.setLastChannel(ch.id)
            if (ch.id != selectedId) {
                // primer OK: se selecciona y se ve en la vista previa
                selectedId = ch.id
            } else {
                // OK sobre el canal que ya se ve: pantalla completa
                preview.release() // libera la conexión: muchas líneas permiten una sola
                Play.live(ctx, shown, i)
            }
        }
    }
    val toggleFav: (Item) -> Unit = { ch -> Cloud.toggleFav(ch.copy(kind = Kind.LIVE)); favTick++ }

    // el foco vuelve al último canal visto (al entrar y al volver de la pantalla completa)
    val chList = rememberLazyListState()
    val lastReq = remember { FocusRequester() }
    var catInit by remember { mutableStateOf(true) }
    LaunchedEffect(cat) { if (catInit) catInit = false else chList.scrollToItem(0) }
    LaunchedEffect(state.refresh) {
        val i = shown.indexOfFirst { it.id == lastId }
        if (i < 0) return@LaunchedEffect
        chList.scrollToItem((i - 3).coerceAtLeast(0))
        delay(120)
        runCatching { lastReq.requestFocus() }
    }

    Row(Modifier.fillMaxSize().background(LvBg)) {
        /* ---------- categorías ---------- */
        Column(Modifier.width(196.dp).fillMaxHeight().background(LvPanel)) {
            Text("CATEGORÍAS", color = LvDim, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, modifier = Modifier.padding(start = 18.dp, top = 14.dp, bottom = 8.dp))
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 16.dp)) {
                items(cats, key = { it.first }) { (id, name) ->
                    CategoryRow(name, counts[id] ?: 0, id == cat) { cat = id }
                }
            }
        }
        /* ---------- canales ---------- */
        Column(Modifier.width(372.dp).fillMaxHeight().background(LvBg)) {
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(cats.firstOrNull { it.first == cat }?.second ?: "Canales", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("${shown.size} canales", color = LvDim, fontSize = 12.sp)
            }
            if (shown.isEmpty()) {
                Text(
                    if (cat == FAVS) "Aún no tienes favoritos.\nMantén presionado OK (o MENÚ) sobre un canal para agregarlo." else "No hay canales en esta categoría.",
                    color = LvDim, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp),
                )
            }
            LazyColumn(Modifier.fillMaxSize(), state = chList, contentPadding = PaddingValues(start = 6.dp, end = 6.dp, bottom = 20.dp)) {
                itemsIndexed(shown, key = { _, c -> c.id }) { i, ch ->
                    LvChannelRow(
                        ch, numbers[ch.id] ?: (i + 1), i, shown, now,
                        playing = ch.id == selectedId, fav = Cloud.isFav(ch.key), provider = providerEpg[ch.id],
                        modifier = if (ch.id == lastId) Modifier.focusRequester(lastReq) else Modifier,
                        onFocus = { focusedId = ch.id }, onClick = { play(i) }, onFav = { toggleFav(ch) },
                        onRight = { guide.orEmpty().isNotEmpty() && runCatching { timelineEntry.requestFocus() }.isSuccess },
                    )
                }
            }
        }
        /* ---------- vista previa y guía ---------- */
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.weight(1f).fillMaxHeight().background(Brush.verticalGradient(listOf(LvPanel, LvBg))).padding(16.dp)) {
          // la miniatura deja sitio a la guía: a lo sumo 46 % del alto
          val previewH = minOf(maxWidth * (9f / 16f), maxHeight * 0.46f)
          Column(Modifier.fillMaxSize()) {
            PreviewBox(preview, selected, selected?.let { numbers[it.id] } ?: 0, Modifier.fillMaxWidth().height(previewH))
            // debajo de la miniatura: la guía del canal (antes aquí iban las instrucciones de las teclas)
            TvEpgTimeline(
                selected, guide, now, timelineEntry,
                onWatch = {
                    val i = shown.indexOfFirst { it.id == selectedId }
                    if (i >= 0) play(i)
                    else all.indexOfFirst { it.id == selectedId }.takeIf { it >= 0 }?.let { preview.release(); Play.live(ctx, all, it) }
                },
                modifier = Modifier.weight(1f),
            )
          }
        }
    }
}

@Composable
private fun CategoryRow(name: String, count: Int, selected: Boolean, onSelect: () -> Unit) {
    TvFocusable(onClick = onSelect, onFocus = onSelect, scale = 1f, border = false, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp)) { f ->
        Row(
            Modifier.fillMaxWidth().background(if (f) Color.White else if (selected) LvFocus else Color.Transparent).padding(horizontal = 10.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(3.dp).height(16.dp).background(if (selected && !f) NfRed else Color.Transparent, RoundedCornerShape(2.dp)))
            Spacer(Modifier.width(8.dp))
            Text(
                name, color = if (f) Color.Black else if (selected) Color.White else LvText.copy(alpha = 0.8f), fontSize = 14.sp,
                fontWeight = if (f || selected) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            Text("$count", color = if (f) Color(0xFF555555) else LvDim, fontSize = 12.sp)
        }
    }
}

@Composable
private fun LvChannelRow(
    ch: Item, number: Int, index: Int, shown: List<Item>, now: Long, playing: Boolean, fav: Boolean, provider: List<EpgEntry>?,
    modifier: Modifier, onFocus: () -> Unit, onClick: () -> Unit, onFav: () -> Unit, onRight: () -> Boolean,
) {
    // guía del panel por lotes: la primera fila visible pide también las siguientes (hasta 400)
    val panel by produceState(PanelEpg.cached(ch.id), ch.id) {
        if (value == null) value = PanelEpg.guide(ch, shown.subList(index, minOf(shown.size, index + 400)))
    }
    val cur = (provider ?: panel)?.firstOrNull { it.start <= now && it.end > now }
    TvFocusable(
        onClick = onClick, onLongClick = onFav, onFocus = onFocus, scale = 1f, border = false, shape = RoundedCornerShape(8.dp),
        modifier = modifier.fillMaxWidth().padding(vertical = 2.dp)
            .onPreviewKeyEvent { e ->
                when {
                    e.type == KeyEventType.KeyDown && e.key == Key.Menu -> { onFav(); true }
                    // derecha: a la guía bajo la miniatura, directo al programa en sintonía
                    e.type == KeyEventType.KeyDown && e.key == Key.DirectionRight -> onRight()
                    else -> false
                }
            },
    ) { f ->
        Row(
            Modifier.fillMaxWidth()
                .background(if (f) Brush.horizontalGradient(listOf(Color(0x40E50914), LvFocus)) else Brush.horizontalGradient(listOf(if (playing) LvActive else Color.Transparent, if (playing) LvActive else Color.Transparent)))
                .padding(end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(4.dp).height(58.dp).background(if (f) NfRed else Color.Transparent))
            Text("$number", color = if (f) Color.White else LvDim, fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.End, modifier = Modifier.width(42.dp))
            Spacer(Modifier.width(10.dp))
            ChannelLogoBox(ch.poster, Modifier.size(62.dp, 40.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (playing) Box(Modifier.size(7.dp).background(NfRed, CircleShape))
                    if (playing) Spacer(Modifier.width(6.dp))
                    Text(ch.name, color = if (f) Color.White else LvText, fontSize = 15.sp, fontWeight = if (f) FontWeight.Bold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (cur != null) {
                    Text(cur.title, color = if (f) Color(0xFFCFCFD8) else LvDim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
                    Spacer(Modifier.height(4.dp))
                    EpgBar(cur, now, Modifier.fillMaxWidth(0.9f))
                }
            }
            if (fav) Icon(Icons.Filled.Star, "Favorito", tint = NfRed, modifier = Modifier.padding(start = 6.dp).size(16.dp))
        }
    }
}

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@Composable
private fun PreviewBox(preview: LivePreview, ch: Item?, number: Int, modifier: Modifier) {
    val shape = RoundedCornerShape(10.dp)
    Box(modifier.clip(shape).background(Color.Black).border(1.dp, Color(0x22FFFFFF), shape)) {
        val player = preview.player
        if (player != null) AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    useController = false
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShutterBackgroundColor(android.graphics.Color.BLACK)
                    isFocusable = false
                    isFocusableInTouchMode = false
                    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                }
            },
            update = { v -> if (v.player !== player) v.player = player },
            onRelease = { v -> v.player = null },
            modifier = Modifier.fillMaxSize(),
        )
        // logo del canal mientras la vista previa arranca (o si el canal no se puede previsualizar)
        if (ch != null && (preview.showingId != ch.id)) {
            Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xFF1D1D27), Color.Black), radius = 900f)), contentAlignment = Alignment.Center) {
                ChannelLogoBox(ch.poster, Modifier.fillMaxWidth(0.42f).aspectRatio(16f / 9f), transparent = true)
            }
        } else if (ch == null) {
            Icon(Icons.Filled.LiveTv, null, tint = LvDim, modifier = Modifier.align(Alignment.Center).size(54.dp))
        }
        if (ch != null) {
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(70.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD9000000)))))
            Row(Modifier.align(Alignment.BottomStart).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("$number", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.width(10.dp))
                Text(ch.name, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(
                "EN VIVO", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopStart).padding(10.dp).background(NfRed, RoundedCornerShape(3.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
    }
}

@Composable
private fun EpgBar(p: EpgEntry, now: Long, modifier: Modifier) {
    val pct = if (p.end > p.start) ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) else 0f
    Box(modifier.height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color(0xFF34343F))) {
        Box(Modifier.fillMaxWidth(pct).fillMaxHeight().background(NfRed))
    }
}

@Composable
private fun ChannelLogoBox(url: String, modifier: Modifier, transparent: Boolean = false) {
    Box(modifier.clip(RoundedCornerShape(5.dp)).background(if (transparent) Color.Transparent else LvLogo), contentAlignment = Alignment.Center) {
        AsyncImage(
            model = url.ifBlank { null }, contentDescription = null, contentScale = ContentScale.Fit,
            placeholder = painterResource(R.drawable.logo), error = painterResource(R.drawable.logo), fallback = painterResource(R.drawable.logo),
            modifier = Modifier.fillMaxSize().padding(3.dp),
        )
    }
}

/** guías ya armadas para la línea de tiempo (10 min), así volver a un canal no la vuelve a pedir */
private object GuideCache {
    private val map = java.util.concurrent.ConcurrentHashMap<Int, Pair<Long, List<EpgEntry>>>()
    fun get(id: Int): List<EpgEntry>? = map[id]?.takeIf { System.currentTimeMillis() - it.first < 600_000 }?.second
    fun put(id: Int, g: List<EpgEntry>) { map[id] = System.currentTimeMillis() to g }
}
