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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.latmpx.player.ui.components.GenreCard
import com.latmpx.player.ui.components.TvGenreTile
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

private fun safe(cats: List<Category>) = Store.visibleCats(cats)

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
    // Top 10 de la semana del panel (cada 12 h); al llegar una lista nueva se rehacen las filas
    LaunchedEffect(Unit) { com.latmpx.player.data.WeekTop.load() }
    // «En vivo ahora» (solo con perfiles): después del Top 10; con partidos en vivo las plataformas solo van (en su lugar
    // de siempre, arriba) si se activaron en Cuenta
    val live = rememberTvLive(state)
    var liveMenu by remember { mutableStateOf<TvLiveCard?>(null) }
    liveMenu?.let { TvLiveMenu(it) { liveMenu = null } }
    val tLive = stringResource(R.string.sl_title)
    val ctx = androidx.compose.ui.platform.LocalContext.current
    // Explorar (la lupa) queda armado en segundo plano: abre al momento
    LaunchedEffect(state.movies, state.series) { kotlinx.coroutines.delay(3000); ExploreCache.warm(state) }
    val rows = remember(movies, series, platforms, state.movieCats, state.seriesCats, state.refresh, Cloud.rev, com.latmpx.player.data.WeekTop.rev, live, com.latmpx.player.data.SportsLive.hidesPlatforms) {
        val out = ArrayList<BrowseRow>()
        if (platforms.isNotEmpty() && !com.latmpx.player.data.SportsLive.hidesPlatforms) out += BrowseRow.Plats("plats", tPlats, platforms)
        continueRow(state, tCont) { state.push(Route.Saved(continueWatching = true)) }?.let { out += it }
        val favs = Cloud.favList().filter { it.kind != Kind.LIVE }
        if (favs.isNotEmpty()) out += BrowseRow.Posters("favs", tMyList, favs, onViewAll = { state.push(Route.Saved(continueWatching = false)) })
        val top10 = com.latmpx.player.data.WeekTop.top10Home(movies, series)
        // «Ver todo» de cada fila: Explorar con su filtro, como browse.php del web player (Top 10 = Mejor valorados)
        if (top10.isNotEmpty()) out += BrowseRow.Top10("top", tTop, top10, onViewAll = { state.push(Route.ExploreAt(sort = 2)) })
        // un partido: el menú de canales (como en Deportes), no solo la primera coincidencia
        if (live.isNotEmpty()) out += BrowseRow.Live("live", tLive, live, onSports = { state.stack.clear(); state.tab = com.latmpx.player.ui.Tab.SPORTS }) { c -> liveMenu = c }
        val rm = movies.sortedByDescending { it.added }.take(30)
        if (rm.isNotEmpty()) out += BrowseRow.Posters("rm", tNewMovies, rm, onViewAll = { state.push(Route.ExploreAt(type = 1)) })
        val rs = series.sortedByDescending { it.added }.take(30)
        if (rs.isNotEmpty()) out += BrowseRow.Posters("rs", tNewSeries, rs, onViewAll = { state.push(Route.ExploreAt(type = 2)) })
        platforms.filter { it.key != "xmas" && it.key != "halloween" }.map { p ->
            val m = Platforms.categoriesFor(safe(state.movieCats), p.kw)
            val se = Platforms.categoriesFor(safe(state.seriesCats), p.kw)
            p to (movies.filter { it.categoryId in m } + series.filter { it.categoryId in se }).sortedByDescending { it.added }.take(30)
        }.filter { it.second.size >= 4 }.take(5).forEach { (p, l) ->
            out += BrowseRow.Posters("p_${p.key}", bestOf.replace("%s", p.label), l, onViewAll = { state.push(Route.ExploreAt(platform = p.key)) })
        }
        val sfy = series.filter { it.poster.isNotBlank() }.shuffled().take(24)
        if (sfy.isNotEmpty()) out += BrowseRow.Posters("sfy", tSeriesForYou, sfy, onViewAll = { state.stack.clear(); state.tab = com.latmpx.player.ui.Tab.SERIES })
        preferredGenres.forEach { label ->
            val kw = Platforms.genres.firstOrNull { it.first == label }?.second ?: return@forEach
            val m = Platforms.categoriesFor(safe(state.movieCats), kw)
            val se = Platforms.categoriesFor(safe(state.seriesCats), kw)
            val l = (movies.filter { it.categoryId in m } + series.filter { it.categoryId in se }).sortedByDescending { it.added }.take(30)
            if (l.size >= 4) out += BrowseRow.Posters("g_$label", label, l, onViewAll = { state.push(Route.ExploreAt(genre = label)) })
        }
        val mfy = movies.filter { it.poster.isNotBlank() }.shuffled().take(24)
        if (mfy.isNotEmpty()) out += BrowseRow.Posters("mfy", tMoviesForYou, mfy, onViewAll = { state.stack.clear(); state.tab = com.latmpx.player.ui.Tab.MOVIES })
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
    LaunchedEffect(Unit) { com.latmpx.player.data.WeekTop.load() }
    val rows = remember(all, cats, com.latmpx.player.data.WeekTop.rev) {
        val out = ArrayList<BrowseRow>()
        val t = if (kind == Kind.SERIES) 2 else 1 // Explorar: Películas o Series
        val recent = all.sortedByDescending { it.added }.take(30)
        if (recent.isNotEmpty()) out += BrowseRow.Posters("recent", tRecent, recent, onViewAll = { state.push(Route.ExploreAt(type = t)) })
        // cada género con su dibujo y el póster de su título más destacado: el de la lista de la semana de TMDB del panel
        // que está en esas carpetas o, si no hay, uno de los mejor calificados (como las tarjetas de deportes)
        val genres = Platforms.genres.mapIndexed { i, (g, kw) -> Triple(i, g, Platforms.categoriesFor(cats, kw)) }.filter { it.third.isNotEmpty() }
        if (genres.isNotEmpty()) out += BrowseRow.Genres("genres", tGenres, genres.map { (i, g, ids) ->
            val st = Platforms.genreStyles.getOrNull(i)
            GenreCard(g, st?.first ?: 0xFF333333, st?.second ?: 0, com.latmpx.player.data.WeekTop.top10(all.filter { it.categoryId in ids }, kind).firstOrNull())
        }) { i -> genres.getOrNull(i)?.let { (_, g, _) -> state.push(Route.ExploreAt(type = t, genre = g)) } }
        val top10 = com.latmpx.player.data.WeekTop.top10(all, kind)
        if (top10.isNotEmpty()) out += BrowseRow.Top10("top", tTop, top10, onViewAll = { state.push(Route.ExploreAt(type = t, sort = 2)) })
        val byCat = all.groupBy { it.categoryId }
        cats.forEach { c ->
            val l = byCat[c.id]?.take(30).orEmpty()
            if (l.isNotEmpty()) out += BrowseRow.Posters("c_${c.id}", c.name, l, onViewAll = { state.push(Route.ExploreAt(type = t, cat = c.id, catKind = if (kind == Kind.SERIES) "s" else "m")) })
        }
        out
    }
    TvBrowse(state, pool, kind.name, rows)
}
