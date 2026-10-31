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
 * Inicio de la TV como Roku y Vega OS (portada fija y una sola fila abajo, TvBrowse), con las filas de homex.php:
 * plataformas, Continuar viendo, Mi lista, Top 10, recién agregadas, "Lo mejor de" cada plataforma, géneros y sugerencias.
 */
@Composable
fun TvHomeScreen(state: AppState) {
    if (state.loading && state.movies.isEmpty()) { Loading(stringResource(R.string.preparing_catalog)); return }
    val movies = state.movies
    val series = state.series

    val pool = remember(movies.size, series.size) { heroPool(listOf(movies, series)) }
    val platOn = com.latmpx.player.data.Tenant.platformsEnabled
    val platforms = remember(state.movieCats, state.seriesCats, platOn) {
        // platforms=false del distribuidor: sin mosaicos ni filas de plataformas
        if (!platOn) return@remember emptyList()
        val cats = safe(state.movieCats + state.seriesCats)
        Platforms.list.filter { p -> Platforms.categoriesFor(cats, p.kw).isNotEmpty() }
    }
    val tPlats = stringResource(R.string.browse_platforms)
    val tCont = stringResource(R.string.continue_watching)
    val tMyList = stringResource(R.string.my_list)
    val tTop = stringResource(R.string.top10_today)
    val tNewMovies = stringResource(R.string.new_movies)
    val tNewSeries = stringResource(R.string.new_series)
    val tSeriesForYou = stringResource(R.string.series_for_you)
    val tMoviesForYou = stringResource(R.string.movies_for_you)
    val bestOf = stringResource(R.string.best_of, "%s")
    val rows = remember(movies, series, platforms, state.movieCats, state.seriesCats, state.refresh, Cloud.rev) {
        val out = ArrayList<BrowseRow>()
        if (platforms.isNotEmpty()) out += BrowseRow.Plats("plats", tPlats, platforms)
        continueRow(state, tCont) { state.push(Route.Saved(continueWatching = true)) }?.let { out += it }
        val favs = Cloud.favList().filter { it.kind != Kind.LIVE }
        if (favs.isNotEmpty()) out += BrowseRow.Posters("favs", tMyList, favs, onViewAll = { state.push(Route.Saved(continueWatching = false)) })
        val top10 = movies.sortedByDescending { it.added }.take(300).sortedByDescending { it.rating }.take(10)
        if (top10.isNotEmpty()) out += BrowseRow.Top10("top", tTop, top10)
        val rm = movies.sortedByDescending { it.added }.take(30)
        if (rm.isNotEmpty()) out += BrowseRow.Posters("rm", tNewMovies, rm, onViewAll = { state.push(Route.Browse(tNewMovies, Kind.MOVIE, emptySet())) })
        val rs = series.sortedByDescending { it.added }.take(30)
        if (rs.isNotEmpty()) out += BrowseRow.Posters("rs", tNewSeries, rs, onViewAll = { state.push(Route.Browse(tNewSeries, Kind.SERIES, emptySet())) })
        platforms.filter { it.key != "xmas" && it.key != "halloween" }.map { p ->
            val m = Platforms.categoriesFor(safe(state.movieCats), p.kw)
            val se = Platforms.categoriesFor(safe(state.seriesCats), p.kw)
            p to (movies.filter { it.categoryId in m } + series.filter { it.categoryId in se }).sortedByDescending { it.added }.take(30)
        }.filter { it.second.size >= 4 }.take(5).forEach { (p, l) ->
            out += BrowseRow.Posters("p_${p.key}", bestOf.replace("%s", p.label), l, onViewAll = { state.push(Route.PlatformPage(p)) })
        }
        val sfy = series.filter { it.poster.isNotBlank() }.shuffled().take(24)
        if (sfy.isNotEmpty()) out += BrowseRow.Posters("sfy", tSeriesForYou, sfy)
        preferredGenres.forEach { label ->
            val kw = Platforms.genres.firstOrNull { it.first == label }?.second ?: return@forEach
            val m = Platforms.categoriesFor(safe(state.movieCats), kw)
            val se = Platforms.categoriesFor(safe(state.seriesCats), kw)
            val l = (movies.filter { it.categoryId in m } + series.filter { it.categoryId in se }).sortedByDescending { it.added }.take(30)
            if (l.size >= 4) out += BrowseRow.Posters("g_$label", label, l, onViewAll = { state.push(Route.Browse(label, Kind.MOVIE, m)) })
        }
        val mfy = movies.filter { it.poster.isNotBlank() }.shuffled().take(24)
        if (mfy.isNotEmpty()) out += BrowseRow.Posters("mfy", tMoviesForYou, mfy)
        out
    }
    TvBrowse(state, pool, "home", rows)
}

/**
 * Películas / Series de la TV como Roku y Vega OS (TvBrowse), con las filas de includes/ondemand.php: Agregadas
 * recientemente, los géneros en píldoras, Top 10 de hoy y una fila por categoría.
 */
@Composable
fun TvCatalogScreen(state: AppState, kind: Kind) {
    val all = if (kind == Kind.MOVIE) state.movies else state.series
    if (state.loading && all.isEmpty()) { Loading(); return }
    val cats = safe(if (kind == Kind.MOVIE) state.movieCats else state.seriesCats)
    val pool = remember(all.size) { heroPool(listOf(all)) }
    val tRecent = stringResource(R.string.recently_added)
    val tGenres = stringResource(R.string.browse_genres)
    val tTop = stringResource(if (kind == Kind.MOVIE) R.string.top10_movies_today else R.string.top10_series_today)
    val rows = remember(all, cats) {
        val out = ArrayList<BrowseRow>()
        val recent = all.sortedByDescending { it.added }.take(30)
        if (recent.isNotEmpty()) out += BrowseRow.Posters("recent", tRecent, recent, onViewAll = { state.push(Route.Browse(tRecent, kind, emptySet())) })
        val genres = Platforms.genres.map { (g, kw) -> g to Platforms.categoriesFor(cats, kw) }.filter { it.second.isNotEmpty() }
        if (genres.isNotEmpty()) out += BrowseRow.Chips("genres", tGenres, genres.map { it.first }) { i -> genres.getOrNull(i)?.let { (g, ids) -> state.push(Route.Browse(g, kind, ids)) } }
        val top10 = all.sortedByDescending { it.added }.take(300).sortedByDescending { it.rating }.take(10)
        if (top10.isNotEmpty()) out += BrowseRow.Top10("top", tTop, top10)
        val byCat = all.groupBy { it.categoryId }
        cats.forEach { c ->
            val l = byCat[c.id]?.take(30).orEmpty()
            if (l.isNotEmpty()) out += BrowseRow.Posters("c_${c.id}", c.name, l, onViewAll = { state.push(Route.Browse(c.name, kind, setOf(c.id))) })
        }
        out
    }
    TvBrowse(state, pool, kind.name, rows)
}
