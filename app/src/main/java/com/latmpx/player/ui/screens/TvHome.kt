package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Category
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Platforms
import com.latmpx.player.data.Store
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.TvCard
import com.latmpx.player.ui.components.TvChipRow
import com.latmpx.player.ui.components.TvPlatformTile
import com.latmpx.player.ui.components.TvRow
import com.latmpx.player.ui.components.TvTop10Card
import com.latmpx.player.ui.components.pullUp
import com.latmpx.player.ui.components.tvCardWidth
import com.latmpx.player.ui.components.tvPad
import com.latmpx.player.ui.theme.NfBg
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** géneros en el orden de homex.php ($preferred) */
private val preferredGenres get() = listOf(
    tr(R.string.genre_action), tr(R.string.genre_comedy), tr(R.string.genre_horror), "Anime", "Drama", tr(R.string.genre_suspense),
    tr(R.string.genre_adventure), tr(R.string.genre_animation), tr(R.string.genre_scifi), "Romance", tr(R.string.genre_documentary),
)

private fun safe(cats: List<Category>) = cats.filter { it.id !in Store.blockedCats }

/**
 * El menú superior se oculta al bajar por las filas (Netflix para TV) y la fila enfocada se coloca arriba,
 * con su título visible. Atrás (TvShell) devuelve la lista al inicio.
 */
@Composable
private fun HeaderAndScroll(state: AppState, list: LazyListState) {
    val hidden by remember { derivedStateOf { list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > 40 } }
    LaunchedEffect(hidden) { state.tvHeaderHidden = hidden }
    LaunchedEffect(state.tvScrollTop) { if (state.tvScrollTop > 0) list.animateScrollToItem(0) }
    DisposableEffect(Unit) { onDispose { state.tvHeaderHidden = false } }
}

/** lleva la fila [key] al borde superior (después del desplazamiento automático del foco, para que gane este) */
private fun CoroutineScope.focusRow(list: LazyListState, key: Any) = launch {
    delay(40)
    val i = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key }?.index ?: return@launch
    list.animateScrollToItem(i)
}

/**
 * Inicio de la TV igual que homex.php: destacado, mosaicos de plataformas montados sobre el destacado,
 * Continuar viendo, Mi lista, Top 10, recién agregadas, "Lo mejor de" cada plataforma, géneros y sugerencias.
 */
@Composable
fun TvHomeScreen(state: AppState) {
    if (state.loading && state.movies.isEmpty()) { Loading(stringResource(R.string.preparing_catalog)); return }
    val movies = state.movies
    val series = state.series
    val w = tvCardWidth()
    val pad = tvPad()
    val sw = LocalConfiguration.current.screenWidthDp
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    HeaderAndScroll(state, list)

    val pool = remember(movies.size, series.size) { heroPool(listOf(movies, series)) }
    val recentMovies = remember(movies) { movies.sortedByDescending { it.added }.take(30) }
    val recentSeries = remember(series) { series.sortedByDescending { it.added }.take(30) }
    val top10 = remember(movies) { movies.sortedByDescending { it.added }.take(300).sortedByDescending { it.rating }.take(10) }
    val platforms = remember(state.movieCats, state.seriesCats) {
        val cats = safe(state.movieCats + state.seriesCats)
        Platforms.list.filter { p -> Platforms.categoriesFor(cats, p.kw).isNotEmpty() }
    }
    val platformRows = remember(platforms, movies, series) {
        platforms.filter { it.key != "xmas" && it.key != "halloween" }.map { p ->
            val m = Platforms.categoriesFor(safe(state.movieCats), p.kw)
            val se = Platforms.categoriesFor(safe(state.seriesCats), p.kw)
            p to (movies.filter { it.categoryId in m } + series.filter { it.categoryId in se }).sortedByDescending { it.added }.take(30)
        }.filter { it.second.size >= 4 }.take(5)
    }
    val seriesForYou = remember(series) { series.filter { it.poster.isNotBlank() }.shuffled().take(24) }
    val moviesForYou = remember(movies) { movies.filter { it.poster.isNotBlank() }.shuffled().take(24) }
    val genreRows = remember(movies, series, state.movieCats, state.seriesCats) {
        preferredGenres.mapNotNull { label ->
            val kw = Platforms.genres.firstOrNull { it.first == label }?.second ?: return@mapNotNull null
            val m = Platforms.categoriesFor(safe(state.movieCats), kw)
            val se = Platforms.categoriesFor(safe(state.seriesCats), kw)
            val l = (movies.filter { it.categoryId in m } + series.filter { it.categoryId in se }).sortedByDescending { it.added }.take(30)
            if (l.size >= 4) Triple(label, m, l) else null
        }
    }
    val cont = remember(state.refresh, Cloud.rev, movies, series) { Cloud.progressList() }
    val favs = remember(state.refresh, Cloud.rev) { Cloud.favList().filter { it.kind != Kind.LIVE } }
    val open: (Item) -> Unit = { state.push(Route.Detail(it)) }

    LazyColumn(Modifier.fillMaxSize().background(NfBg), state = list, contentPadding = PaddingValues(bottom = 48.dp)) {
        item(key = "hero") { TvBillboard(state, pool, "home") { scope.launch { list.animateScrollToItem(0) } } }
        if (platforms.isNotEmpty()) item(key = "plats") {
            // .nf-platforms: margin-top -9vw, encima del destacado
            LazyRow(
                Modifier.fillMaxWidth().pullUp((sw * 0.09f).dp).onFocusChanged { if (it.hasFocus) scope.launch { delay(40); list.animateScrollToItem(0) } },
                contentPadding = PaddingValues(horizontal = pad, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                items(platforms, key = { it.key }) { p -> TvPlatformTile(p, (sw * 0.125f).coerceIn(130f, 210f).dp) { state.push(Route.PlatformPage(p)) } }
            }
        }
        if (cont.isNotEmpty()) item(key = "cont") {
            TvRow(stringResource(R.string.continue_watching), cont, onViewAll = { state.push(Route.Saved(continueWatching = true)) }, onFocused = { scope.focusRow(list, "cont") }) { _, p ->
                val it = state.itemFromProgress(p) ?: return@TvRow
                TvCard(it.copy(poster = p.poster.ifEmpty { it.poster }), w, progress = if (p.duration > 0) p.position.toFloat() / p.duration else 0.05f) { open(it) }
            }
        }
        if (favs.isNotEmpty()) item(key = "favs") { TvRow(stringResource(R.string.my_list), favs, onViewAll = { state.push(Route.Saved(continueWatching = false)) }, onFocused = { scope.focusRow(list, "favs") }) { _, it -> TvCard(it, w) { open(it) } } }
        item(key = "top") { TvRow(stringResource(R.string.top10_today), top10, onFocused = { scope.focusRow(list, "top") }) { i, it -> TvTop10Card(i + 1, it, w) { open(it) } } }
        item(key = "rm") {
            TvRow(stringResource(R.string.new_movies), recentMovies, onViewAll = { state.push(Route.Browse(tr(R.string.new_movies), Kind.MOVIE, emptySet())) }, onFocused = { scope.focusRow(list, "rm") }) { _, it -> TvCard(it, w) { open(it) } }
        }
        item(key = "rs") {
            TvRow(stringResource(R.string.new_series), recentSeries, onViewAll = { state.push(Route.Browse(tr(R.string.new_series), Kind.SERIES, emptySet())) }, onFocused = { scope.focusRow(list, "rs") }) { _, it -> TvCard(it, w) { open(it) } }
        }
        platformRows.forEach { (p, l) ->
            item(key = "p_${p.key}") { TvRow(stringResource(R.string.best_of, p.label), l, onViewAll = { state.push(Route.PlatformPage(p)) }, onFocused = { scope.focusRow(list, "p_${p.key}") }) { _, it -> TvCard(it, w) { open(it) } } }
        }
        item(key = "sfy") { TvRow(stringResource(R.string.series_for_you), seriesForYou, onFocused = { scope.focusRow(list, "sfy") }) { _, it -> TvCard(it, w) { open(it) } } }
        genreRows.forEach { (label, ids, l) ->
            item(key = "g_$label") { TvRow(label, l, onViewAll = { state.push(Route.Browse(label, Kind.MOVIE, ids)) }, onFocused = { scope.focusRow(list, "g_$label") }) { _, it -> TvCard(it, w) { open(it) } } }
        }
        item(key = "mfy") { TvRow(stringResource(R.string.movies_for_you), moviesForYou, onFocused = { scope.focusRow(list, "mfy") }) { _, it -> TvCard(it, w) { open(it) } } }
    }
}

/**
 * Películas / Series de la TV igual que includes/ondemand.php: destacado del tipo, título con los géneros en píldoras,
 * Agregadas recientemente, Top 10 de hoy y una fila por categoría.
 */
@Composable
fun TvCatalogScreen(state: AppState, kind: Kind) {
    val all = if (kind == Kind.MOVIE) state.movies else state.series
    if (state.loading && all.isEmpty()) { Loading(); return }
    val cats = safe(if (kind == Kind.MOVIE) state.movieCats else state.seriesCats)
    val label = stringResource(if (kind == Kind.MOVIE) R.string.movies else R.string.series)
    val w = tvCardWidth()
    val pad = tvPad()
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    HeaderAndScroll(state, list)

    val pool = remember(all.size) { heroPool(listOf(all)) }
    val recent = remember(all) { all.sortedByDescending { it.added }.take(30) }
    val top10 = remember(all) { all.sortedByDescending { it.added }.take(300).sortedByDescending { it.rating }.take(10) }
    val genres = remember(cats) { Platforms.genres.map { (g, kw) -> g to Platforms.categoriesFor(cats, kw) }.filter { it.second.isNotEmpty() } }
    val rows = remember(all, cats) {
        val byCat = all.groupBy { it.categoryId }
        cats.mapNotNull { c -> byCat[c.id]?.takeIf { it.isNotEmpty() }?.let { c to it.take(30) } }
    }
    val open: (Item) -> Unit = { state.push(Route.Detail(it)) }

    LazyColumn(Modifier.fillMaxSize().background(NfBg), state = list, contentPadding = PaddingValues(bottom = 48.dp)) {
        item(key = "hero") { TvBillboard(state, pool, kind.name) { scope.launch { list.animateScrollToItem(0) } } }
        item(key = "head") {
            Column(Modifier.onFocusChanged { if (it.hasFocus) scope.focusRow(list, "head") }) {
                Text(label, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = pad, end = pad, top = 4.dp))
                TvChipRow(genres.map { it.first }) { i -> genres.getOrNull(i)?.let { (g, ids) -> state.push(Route.Browse(g, kind, ids)) } }
            }
        }
        item(key = "recent") {
            TvRow(stringResource(R.string.recently_added), recent, onViewAll = { state.push(Route.Browse(tr(R.string.recently_added), kind, emptySet())) }, onFocused = { scope.focusRow(list, "recent") }) { _, it -> TvCard(it, w) { open(it) } }
        }
        item(key = "top") { TvRow(stringResource(if (kind == Kind.MOVIE) R.string.top10_movies_today else R.string.top10_series_today), top10, onFocused = { scope.focusRow(list, "top") }) { i, it -> TvTop10Card(i + 1, it, w) { open(it) } } }
        rows.forEach { (c, l) ->
            item(key = "c_${c.id}") { TvRow(c.name, l, onViewAll = { state.push(Route.Browse(c.name, kind, setOf(c.id))) }, onFocused = { scope.focusRow(list, "c_${c.id}") }) { _, it -> TvCard(it, w) { open(it) } } }
        }
    }
}
