package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Platform
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.TvCard
import com.latmpx.player.ui.components.TvChipRow
import com.latmpx.player.ui.components.TvPlatformTile
import com.latmpx.player.ui.components.TvRow
import com.latmpx.player.ui.components.TvTop10Card
import com.latmpx.player.ui.components.tvPad
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Una fila de Inicio / Películas / Series. */
sealed class BrowseRow(val key: String, val title: String) {
    class Posters(key: String, title: String, val items: List<Item>, val progress: Map<String, Float> = emptyMap(), val onViewAll: (() -> Unit)? = null) : BrowseRow(key, title)
    class Top10(key: String, title: String, val items: List<Item>) : BrowseRow(key, title)
    class Plats(key: String, title: String, val list: List<Platform>) : BrowseRow(key, title)
    class Chips(key: String, title: String, val chips: List<String>, val onChip: (Int) -> Unit) : BrowseRow(key, title)
}

// dónde empiezan las filas (en 1920×1080, como Roku y Vega): con los botones de la portada asoman abajo; recorriéndolas,
// la fila enfocada queda siempre en el mismo lugar y es la única que se ve (la de arriba sube y desaparece, la de abajo
// sube a su lugar)
private const val ROWS_HERO = 818f
private const val ROWS_IN = 560f
private const val BUTTONS_TOP = 700f

/**
 * Inicio, Series y Películas de la TV como Roku y Vega OS: la portada grande queda fija detrás y solo se mueven las filas.
 * Con el foco en Reproducir / Más información las filas asoman abajo y la portada muestra los destacados (cambian cada 8 s);
 * al bajar a las filas, la portada muestra el título enfocado y se ve una sola fila. Arriba desde la primera fila vuelve a
 * los botones; desde las demás, a la fila de arriba.
 */
@Composable
fun TvBrowse(state: AppState, pool: List<Item>, cacheKey: String, rows: List<BrowseRow>) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val (heroes, done) = rememberHeroes(state, pool, cacheKey)
    var heroIdx by remember(cacheKey) { mutableIntStateOf(0) }
    var inRows by remember { mutableStateOf(false) }
    var rowIdx by remember { mutableIntStateOf(0) }
    var info by remember { mutableStateOf(StageInfo(null)) }
    val list = rememberLazyListState()
    val play = remember { FocusRequester() }
    var infoJob by remember { mutableStateOf<Job?>(null) }

    val hero = heroes.getOrNull(heroIdx % heroes.size.coerceAtLeast(1))
    // sin destacados con fondo (todavía o nunca): el primero de la lista, con su carátula
    val heroItem = hero?.item ?: if (done) pool.firstOrNull() else null

    // el menú de arriba se oculta recorriendo las filas (y vuelve con los botones de la portada)
    LaunchedEffect(inRows) { state.tvHeaderHidden = inRows }
    DisposableEffect(Unit) { onDispose { state.tvHeaderHidden = false } }
    // cambia de destacado cada 8 s solo con la portada a la vista
    LaunchedEffect(inRows, heroes.size) {
        while (!inRows && heroes.size > 1) { delay(8000); heroIdx = (heroIdx + 1) % heroes.size }
    }
    // el foco entra a Reproducir una sola vez por visita a la sección
    val onTop = com.latmpx.player.ui.LocalLayerOnTop.current
    LaunchedEffect(heroItem != null) {
        if (onTop && heroItem != null && state.billboardFocusedTab != state.tab) {
            state.billboardFocusedTab = state.tab
            delay(60)
            runCatching { play.requestFocus() }
        }
    }
    fun toHero() {
        infoJob?.cancel()
        inRows = false
        rowIdx = 0
        scope.launch { list.scrollToItem(0) }
    }
    // Atrás desde las filas (TvShell): la sección vuelve a la portada y el foco sube al menú
    LaunchedEffect(state.tvScrollTop) { if (state.tvScrollTop > 0) toHero() }

    // foco en una fila: queda arriba (la única visible); la portada cambia cuando el foco se detiene en un título
    fun focusRow(i: Int) {
        // al bajar desde los botones, la portada sigue con el destacado hasta que el foco se detiene en un título
        if (!inRows) info = StageInfo(heroItem, hero)
        inRows = true
        rowIdx = i
        scope.launch { delay(40); list.animateScrollToItem(i) }
    }
    fun focusItem(x: Item) {
        infoJob?.cancel()
        infoJob = scope.launch {
            delay(120)
            val known = FocusArt.map[x.key]
            info = StageInfo(x, known)
            if (known != null || x.backdrop.isNotBlank() || x.key in FocusArt.none || (x.kind != Kind.MOVIE && x.kind != Kind.SERIES)) return@launch
            // sin fondo propio: se busca (servidor y luego TMDB) tras una pausa breve; lo encontrado queda guardado
            delay(350)
            val s = state.session ?: return@launch
            val got = runCatching { resolveHero(s, x) }.getOrNull()
            if (got != null) FocusArt.map[x.key] = got else FocusArt.none += x.key
            if (got != null && info.item?.key == x.key) info = StageInfo(x, got)
        }
    }
    fun focusLabel(title: String, plot: String) {
        infoJob?.cancel()
        info = StageInfo(null, title = title, plot = plot)
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val h = maxHeight
        val w = maxWidth
        val k = h.value / 1080f
        val pad = tvPad()
        val stage = if (inRows) info else StageInfo(heroItem, hero)
        TvStageView(stage, compact = inRows, h = h, w = w, pad = pad)

        // puntos de los destacados
        if (!inRows && heroes.size > 1) Row(Modifier.align(Alignment.TopEnd).padding(end = pad, top = (738 * k).dp)) {
            heroes.indices.forEach { i ->
                Box(Modifier.padding(start = 10.dp).size(width = if (i == heroIdx % heroes.size) 30.dp else 14.dp, height = 14.dp).clip(CircleShape)
                    .background(if (i == heroIdx % heroes.size) Color.White else Color(0x59FFFFFF)))
            }
        }

        // botones de la portada; recorriendo las filas no se ven y solo se llega a ellos desde la primera fila
        if (heroItem != null) {
            val btnAlpha by animateFloatAsState(if (inRows) 0f else 1f, tween(250), label = "botones")
            val reachable = !inRows || rowIdx == 0
            Row(
                Modifier.padding(start = pad, top = (BUTTONS_TOP * k).dp).graphicsLayer { alpha = btnAlpha },
                horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                val btn = Modifier.focusProperties { canFocus = reachable }.onFocusChanged { if (it.isFocused) toHero() }
                NfButton(stringResource(R.string.play), Icons.Filled.PlayArrow, white = true, modifier = btn.focusRequester(play)) {
                    if (heroItem.kind == Kind.MOVIE) Play.movie(ctx, heroItem, heroItem.ext) else state.push(Route.Detail(heroItem))
                }
                NfButton(stringResource(R.string.more_info), Icons.Filled.Info, white = false, modifier = btn) { state.push(Route.Detail(heroItem)) }
            }
        }

        // filas: una por ranura del alto de la zona de abajo
        val slot = h - (ROWS_IN * k).dp
        val top by animateDpAsState(((if (inRows || heroItem == null) ROWS_IN else ROWS_HERO) * k).dp, tween(300), label = "filas")
        LazyColumn(
            Modifier.fillMaxWidth().height(slot).offset(y = top).clipToBounds(),
            state = list,
        ) {
            itemsIndexed(rows, key = { _, r -> r.key }) { i, r ->
                Box(Modifier.fillMaxWidth().height(slot).onFocusChanged { if (it.hasFocus) focusRow(i) }) {
                    RowSlot(state, r, slot, ::focusItem, ::focusLabel)
                }
            }
        }
    }
}

/** una fila dentro de su ranura: título y carátulas del alto justo para que se vea completa y sola */
@Composable
private fun RowSlot(state: AppState, r: BrowseRow, slot: Dp, focusItem: (Item) -> Unit, focusLabel: (String, String) -> Unit) {
    val cardH = (slot - 78.dp).coerceAtLeast(120.dp)
    val cardW = cardH * (2f / 3f)
    val open: (Item) -> Unit = { state.push(Route.Detail(it)) }
    val seeAll = stringResource(R.string.browse_row_plot)
    when (r) {
        is BrowseRow.Posters -> TvRow(
            r.title, r.items, onViewAll = r.onViewAll, cardWidth = cardW, top = 10.dp,
            onViewAllFocus = { focusLabel(r.title, seeAll) },
        ) { _, it -> TvCard(it, cardW, progress = r.progress[it.key] ?: 0f, onFocus = { focusItem(it) }) { open(it) } }
        is BrowseRow.Top10 -> TvRow(r.title, r.items, cardWidth = cardW, top = 10.dp) { i, it -> TvTop10Card(i + 1, it, cardW, onFocus = { focusItem(it) }) { open(it) } }
        is BrowseRow.Plats -> Column(Modifier.padding(top = 10.dp)) {
            val pad = tvPad()
            val platPlot = stringResource(R.string.browse_platform_plot, "%s")
            Text(r.title, color = Color(0xFFE5E5E5), fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = pad))
            LazyRow(contentPadding = PaddingValues(start = pad, end = pad, top = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(r.list, key = { it.key }) { p ->
                    TvPlatformTile(p, cardW * 1.6f, onFocus = { focusLabel(p.label, platPlot.replace("%s", p.label)) }) { state.push(Route.PlatformPage(p)) }
                }
            }
        }
        is BrowseRow.Chips -> Column(Modifier.padding(top = 10.dp)) {
            val genrePlot = stringResource(R.string.browse_genre_plot, "%s")
            Text(r.title, color = Color(0xFFE5E5E5), fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = tvPad()))
            TvChipRow(r.chips, Modifier.padding(top = 8.dp), onFocus = { i -> r.chips.getOrNull(i)?.let { c -> focusLabel(c, genrePlot.replace("%s", c)) } }) { i -> r.onChip(i) }
        }
    }
}

/** carátulas de la fila "Continuar viendo" con su avance */
fun continueRow(state: AppState, title: String, onViewAll: () -> Unit): BrowseRow.Posters? {
    val prog = HashMap<String, Float>()
    val items = com.latmpx.player.data.Cloud.progressList().mapNotNull { p ->
        val it = state.itemFromProgress(p) ?: return@mapNotNull null
        val x = it.copy(poster = p.poster.ifEmpty { it.poster })
        prog[x.key] = if (p.duration > 0) p.position.toFloat() / p.duration else 0.05f
        x
    }.distinctBy { it.key }
    return if (items.isEmpty()) null else BrowseRow.Posters("cont", title, items, prog, onViewAll)
}
