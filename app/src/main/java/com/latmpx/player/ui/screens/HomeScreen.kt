package com.latmpx.player.ui.screens

import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R
import androidx.compose.foundation.layout.size
import com.latmpx.player.ui.theme.NfRed

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Download
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.aspectRatio
import com.latmpx.player.ui.Tab

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Store
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Platforms
import com.latmpx.player.data.Cloud
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.HeroCarousel
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.components.PlatformCard
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.components.ShelfRow
import com.latmpx.player.ui.components.Top10Card
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2

@Composable
fun HomeScreen(state: AppState) {
    if (state.loading && state.movies.isEmpty()) { Loading(stringResource(R.string.preparing_catalog)); return }
    val tv = LocalIsTv.current
    val pad = sidePad()
    val pw = posterWidth()
    val movies = state.movies
    val series = state.series

    val recentMovies = remember(movies) { state.cached("h_recentMovies", movies) { movies.sortedByDescending { it.added }.take(40) } }
    val recentSeries = remember(series) { state.cached("h_recentSeries", series) { series.sortedByDescending { it.added }.take(40) } }
    // Top 10 de la semana del panel (cada 12 h), como Roku, Vega OS y Android TV
    androidx.compose.runtime.LaunchedEffect(Unit) { com.latmpx.player.data.WeekTop.load() }
    val top10 = remember(movies, series, com.latmpx.player.data.WeekTop.rev) { state.cached("h_top10", movies, series, com.latmpx.player.data.WeekTop.rev) { com.latmpx.player.data.WeekTop.top10Home(movies, series) } }
    val genreRows = remember(movies, state.movieCats) { state.cached("h_genres", movies, com.latmpx.player.data.Store.visibleCats(state.movieCats)) { // las carpetas visibles: cambian con el control parental
        Platforms.genres.mapNotNull { (label, kw) ->
            val mcats = com.latmpx.player.data.Store.visibleCats(state.movieCats)
            val ids = Platforms.categoriesFor(mcats, kw)
            val list = if (ids.isEmpty()) emptyList() else movies.filter { it.categoryId in ids }.sortedByDescending { it.added }.take(30)
            if (list.size >= 4) label to list else null
        }
    } }
    // partidos en vivo (solo con perfiles y una clave de pago de TheSportsDB en el panel): van en el lugar de Plataformas
    val live = rememberLiveSports(state)
    val platOn = com.latmpx.player.data.Tenant.platformsEnabled
    val platforms = remember(state.movieCats, state.seriesCats, platOn) { state.cached("h_platforms", com.latmpx.player.data.Store.visibleCats(state.movieCats + state.seriesCats), platOn) {
        // platforms=false del distribuidor: sin fila de plataformas
        if (!platOn) return@cached emptyList()
        val safeCats = com.latmpx.player.data.Store.visibleCats(state.movieCats + state.seriesCats)
        Platforms.list.filter { p -> Platforms.categoriesFor(safeCats, p.kw).isNotEmpty() }
    } }
    val cont = remember(state.refresh, Cloud.rev, movies, series) { Cloud.progressList() }
    val favs = remember(state.refresh, Cloud.rev) { Cloud.favList().filter { it.kind != Kind.LIVE } }
    val heroItems = remember(movies) { recentMovies.filter { it.backdrop.isNotEmpty() }.take(5).ifEmpty { recentMovies.take(1) } }
    var userFocusedHero by remember(movies) { mutableStateOf<Item?>(null) }

    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    // derivedStateOf: la pantalla ya no se recompone en cada píxel de desplazamiento, solo al cambiar el valor
    val solid by remember { androidx.compose.runtime.derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 260 } }
    val cardHero = remember(movies, series) { state.cached("h_cardHero", movies, series) {
        // destacados: lo más nuevo y mejor valorado, películas y series mezcladas
        val m = recentMovies.take(30).sortedByDescending { it.rating }.take(4)
        val se = recentSeries.take(30).sortedByDescending { it.rating }.take(3)
        (m.zip(se).flatMap { listOf(it.first, it.second) } + m.drop(se.size) + se.drop(m.size)).distinctBy { it.key }.take(7)
    } }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().background(NfBg), state = listState) {
        item {
            if (tv) {
                val h = userFocusedHero
                if (h != null) Hero(state, h, tv) else HeroCarousel(items = heroItems, tv = tv) { item -> Hero(state, item, tv) }
            } else HeroCards(state, cardHero.ifEmpty { heroItems }, topPad = 116.dp)
        }
        item {
            ShelfRow(stringResource(R.string.continue_watching_for, Store.shownUser(state.session)), cont, pad) { _, p ->
                val it = state.itemFromProgress(p) ?: return@ShelfRow
                ContinueCard(state, it.copy(poster = p.poster.ifEmpty { it.poster }), p, pw)
            }
        }
        item { ShelfRow(stringResource(R.string.my_list), favs, pad) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) } }
        item {
            ShelfRow(stringResource(R.string.top10_today), top10, pad) { i, it -> Top10Card(i + 1, it, pw * 1.15f, onClick = { state.push(Route.Detail(it)) }) }
        }
        item {
            if (live.enabled) LiveSportsRow(live, pad) { state.stack.clear(); state.tab = Tab.SPORTS }
            // con «En vivo ahora» las plataformas solo vuelven (debajo) si se activaron en Ajustes
            if (!live.hidesPlats) {
                ShelfRow(stringResource(R.string.platforms), platforms, pad) { _, p -> PlatformCard(p, if (tv) 200.dp else 150.dp, onClick = { state.push(Route.PlatformPage(p)) }) }
            }
        }
        item {
            ShelfRow(stringResource(R.string.new_movies), recentMovies, pad, onViewAll = { state.push(Route.Browse(tr(R.string.new_movies), com.latmpx.player.data.Kind.MOVIE, emptySet())) }) { _, it ->
                PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, onFocus = if (tv) ({ userFocusedHero = it }) else null)
            }
        }
        item { ShelfRow(stringResource(R.string.new_series), recentSeries, pad, onViewAll = { state.push(Route.Browse(tr(R.string.new_series), com.latmpx.player.data.Kind.SERIES, emptySet())) }) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) } }
        genreRows.forEach { (label, list) ->
            item(key = "g_$label") {
                val kw = com.latmpx.player.data.Platforms.genres.find { it.first == label }?.second ?: emptyList()
                val ids = com.latmpx.player.data.Platforms.categoriesFor(com.latmpx.player.data.Store.visibleCats(state.movieCats), kw)
                ShelfRow(label, list, pad, onViewAll = { state.push(Route.Browse(label, com.latmpx.player.data.Kind.MOVIE, ids)) }) { _, it ->
                    PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, onFocus = if (tv) ({ userFocusedHero = it }) else null)
                }
            }
        }
        // celular: lo último queda arriba de la barra flotante
        item { Spacer(Modifier.height(40.dp + phoneBarSpace())) }
    }
    if (!tv) PhoneTopBar(state, pad, solid, null)
}
}

/**
 * Barra superior de la app de Netflix para celular: el logo y el nombre de la sección («Inicio») con Mis descargas a la
 * derecha; debajo Series / Películas / Deportes / Mi lista (se desliza si no cabe). Buscar y el perfil están en la barra
 * de abajo. Transparente sobre los destacados y oscura al bajar.
 */
@Composable
fun PhoneTopBar(state: AppState, pad: androidx.compose.ui.unit.Dp, solid: Boolean, current: Tab?) {
    val bg by androidx.compose.animation.animateColorAsState(if (solid) Color(0xF2141414) else Color.Transparent, label = "bar")
    Column(Modifier.fillMaxWidth().background(bg).background(Brush.verticalGradient(listOf(Color(0xB3000000), Color.Transparent)))) {
        Row(Modifier.fillMaxWidth().padding(start = pad, end = pad - 8.dp, top = 10.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            LogoHeader(height = 34.dp)
            Spacer(Modifier.width(12.dp))
            Text((current ?: Tab.HOME).label, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            // campanita: avisos de partidos de las últimas 24 h (el perfil infantil no tiene Deportes)
            if (com.latmpx.player.data.Tenant.sportsEnabled && com.latmpx.player.data.Profiles.current != null && !com.latmpx.player.data.Profiles.kids) BellButton()
            Icon(
                Icons.Filled.Download, stringResource(R.string.my_downloads), tint = Color.White,
                modifier = Modifier.size(44.dp).clip(CircleShape).clickable { state.push(Route.Downloads) }.padding(9.dp),
            )
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()).padding(start = pad, end = pad, bottom = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (current != null) TopChip("✕", false) { state.tab = Tab.HOME }
            TopChip(stringResource(R.string.series), current == Tab.SERIES) { state.tab = Tab.SERIES }
            TopChip(stringResource(R.string.movies), current == Tab.MOVIES) { state.tab = Tab.MOVIES }
            // con perfiles (no el infantil): Explorar como la del web player (mismo orden: Series, Películas, Categorías, Deportes)
            if (com.latmpx.player.data.Profiles.current != null && !com.latmpx.player.data.Profiles.kids) TopChip(stringResource(R.string.categories), false) { state.push(Route.Explore) }
            // el perfil infantil nunca tiene Deportes
            if (com.latmpx.player.data.Tenant.sportsEnabled && !com.latmpx.player.data.Profiles.kids) TopChip(stringResource(R.string.sports), current == Tab.SPORTS) { state.tab = Tab.SPORTS }
            TopChip(stringResource(R.string.my_list), current == Tab.MYLIST) { state.tab = Tab.MYLIST }
        }
    }
}

/** filtro de arriba como Netflix: recuadro gris redondeado (el elegido, blanco) */
@Composable
private fun TopChip(text: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    FocusBox(onClick = onClick, shape = shape, focusScale = 1.04f) {
        Text(
            text, color = if (selected) Color.Black else Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
            modifier = Modifier.background(if (selected) Color.White else Color(0x2EFFFFFF), shape).border(1.dp, Color(0x1FFFFFFF), shape)
                .padding(horizontal = 18.dp, vertical = 10.dp),
        )
    }
}

/** Continuar viendo: carátula con barra roja de avance y botones de información, como Netflix */
@Composable
fun ContinueCard(state: AppState, item: Item, p: com.latmpx.player.data.Progress, width: androidx.compose.ui.unit.Dp) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Column(Modifier.width(width).clip(RoundedCornerShape(6.dp)).background(Color(0xFF1F1F1F))) {
        FocusBox(onClick = { state.push(Route.Detail(item)) }, modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f), shape = RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp)) {
            com.latmpx.player.ui.components.ItemPoster(item, Modifier.fillMaxSize())
            Box(Modifier.align(Alignment.Center).size(46.dp).background(Color(0x99000000), CircleShape).border(1.5.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.PlayArrow, stringResource(R.string.play), tint = Color.White, modifier = Modifier.size(28.dp))
            }
        }
        androidx.compose.material3.LinearProgressIndicator(
            progress = { if (p.duration > 0) (p.position.toFloat() / p.duration).coerceIn(0f, 1f) else 0f }, color = NfRed, trackColor = Color(0xFF4D4D4D),
            modifier = Modifier.fillMaxWidth().height(3.dp),
        )
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(p.label.removePrefix(item.name).trim().trimStart('·').trim().ifBlank { item.name }, color = NfGray2, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.Info, stringResource(R.string.info), tint = NfGray2, modifier = Modifier.size(18.dp).clickable { state.push(Route.Detail(item)) })
        }
    }
}

@Composable
fun Hero(state: AppState, item: Item, tv: Boolean) {
    val first = remember { FocusRequester() }
    if (tv) LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxWidth().height(if (tv) 360.dp else 470.dp)) {
        // fondo Full HD del panel y, si no hay fondo, la carátula por la caché del panel
        if (item.backdrop.isNotEmpty()) com.latmpx.player.ui.components.ChainImage(remember(item.backdrop) { com.latmpx.player.data.PanelImg.backdropSources(item.backdrop) }, Modifier.fillMaxSize())
        else com.latmpx.player.ui.components.ItemPoster(item, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x66000000), Color.Transparent, Color(0xCC141414), NfBg))))
        if (tv) Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color(0xEE141414), Color.Transparent))))
        if (!tv) LogoHeader(Modifier.padding(14.dp), height = 30.dp)
        Column(
            Modifier.align(if (tv) Alignment.BottomStart else Alignment.BottomCenter).padding(horizontal = sidePad(), vertical = 18.dp)
                .then(if (tv) Modifier.width(520.dp) else Modifier.fillMaxWidth()),
            horizontalAlignment = if (tv) Alignment.Start else Alignment.CenterHorizontally,
        ) {
            Text(item.name, color = Color.White, fontSize = if (tv) 34.sp else 28.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val meta = listOfNotNull(item.year.takeIf { it.isNotBlank() }, item.rating.takeIf { it > 0 }?.let { "★ %.1f".format(it) }).joinToString("  ·  ")
            if (meta.isNotEmpty()) Text(meta, color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
            if (tv && item.plot.isNotBlank()) Text(item.plot, color = NfGray2, fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HeroButton(stringResource(R.string.play), Icons.Filled.PlayArrow, true, Modifier.focusRequester(first)) { state.push(Route.Detail(item)) }
                HeroButton(stringResource(R.string.more_info), Icons.Filled.Info, false) { state.push(Route.Detail(item)) }
            }
        }
    }
}

@Composable
fun HeroButton(text: String, icon: ImageVector, primary: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    // mismo botón en toda la app (color del distribuidor en el principal)
    com.latmpx.player.ui.components.AppButton(text, modifier, primary = primary, icon = icon, minHeight = 44.dp, fontSize = 15.sp, onClick = onClick)
}