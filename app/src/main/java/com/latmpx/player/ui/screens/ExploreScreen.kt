package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.R
import com.latmpx.player.data.Category
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Platforms
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.theme.NfBg
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import com.latmpx.player.data.Profiles
import com.latmpx.player.ui.Tab
import com.latmpx.player.ui.theme.NfRed

private enum class ExType { ALL, MOVIE, SERIES }
private enum class ExSort { RECENT, AZ, RATING }

/**
 * Explorar (solo con perfiles: el botón «Categorías» de arriba), igual que la del web player en el celular (browse.php):
 * arriba Series / Películas / Categorías / Deportes sobre el degradado del color de la app, «Explorar», Todo / Películas /
 * Series, ordenar (recientes, A - Z, mejor valorados) y «Filtrar por título…» lado a lado, el total, géneros, plataformas
 * y la cuadrícula de 3 columnas. Solo las carpetas que el cliente ve (control parental). «Ver todo» de una fila la abre
 * con su filtro (init): tipo, orden, género, plataforma o carpeta.
 */
@Composable
fun ExploreScreen(state: AppState, init: Route.Explore = Route.Explore()) {
    // «Ver todo» de una fila: el filtro de esa fila (como browse.php?type=&sort=&genre=&platform=&cat= del web player)
    val cat = init.cat
    val catSeries = init.catKind == "s"
    var type by rememberSaveable { mutableStateOf(if (cat.isNotEmpty()) (if (catSeries) ExType.SERIES else ExType.MOVIE) else ExType.entries[init.type.coerceIn(0, 2)]) }
    var sort by rememberSaveable { mutableStateOf(ExSort.entries[init.sort.coerceIn(0, 2)]) }
    var genre by rememberSaveable { mutableStateOf(init.genre) }
    var query by rememberSaveable { mutableStateOf("") }

    val mCats = remember(state.movieCats, state.refresh) { Store.visibleCats(state.movieCats) }
    val sCats = remember(state.seriesCats, state.refresh) { Store.visibleCats(state.seriesCats) }
    // lo que se puede mostrar: solo títulos de carpetas visibles
    val movies = remember(state.movies, mCats) { mCats.map { it.id }.toSet().let { ids -> state.movies.filter { it.categoryId in ids } } }
    val series = remember(state.series, sCats) { sCats.map { it.id }.toSet().let { ids -> state.series.filter { it.categoryId in ids } } }
    val cats: List<Category> = when (type) { ExType.MOVIE -> mCats; ExType.SERIES -> sCats; ExType.ALL -> mCats + sCats }
    val plat = remember(init.platform) { Platforms.list.find { it.key == init.platform } }
    val catName = remember(cat, mCats, sCats) { (if (catSeries) sCats else mCats).firstOrNull { it.id == cat }?.name.orEmpty() }
    val pool = remember(type, movies, series, cats, plat, cat) {
        val base = when (type) { ExType.MOVIE -> movies; ExType.SERIES -> series; ExType.ALL -> movies + series }
        when {
            cat.isNotEmpty() -> base.filter { it.categoryId == cat }
            plat != null -> Platforms.categoriesFor(cats, plat.kw).let { ids -> base.filter { it.categoryId in ids } }
            else -> base
        }
    }
    // géneros con al menos una carpeta en lo que se está viendo
    val genres = remember(cats) { Platforms.genres.filter { (_, kw) -> Platforms.categoriesFor(cats, kw).isNotEmpty() } }
    val shown = remember(pool, cats, sort, genre, query) {
        var l = pool
        if (genre.isNotEmpty()) Platforms.genres.find { it.first == genre }?.let { (_, kw) ->
            val ids = Platforms.categoriesFor(cats, kw)
            l = l.filter { it.categoryId in ids }
        }
        val q = Platforms.fold(query.trim())
        if (q.isNotEmpty()) l = l.filter { Platforms.fold(it.name).contains(q) }
        when (sort) {
            ExSort.RECENT -> l.sortedByDescending { it.added }
            ExSort.AZ -> l.sortedBy { Platforms.fold(it.name) }
            ExSort.RATING -> l.sortedWith(compareByDescending<Item> { it.rating }.thenByDescending { it.added })
        }
    }
    val platforms = remember(mCats, sCats) {
        if (!Tenant.platformsEnabled) emptyList()
        else Platforms.list.filter { p -> Platforms.categoriesFor(mCats + sCats, p.kw).isNotEmpty() }
    }
    val progress = remember(state.refresh, Cloud.rev) { Cloud.progressList().associateBy { it.key.split(":").take(2).joinToString(":") } }
    val pad = sidePad()
    val gap = 10.dp
    val full: (androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope) -> GridItemSpan = { GridItemSpan(it.maxLineSpan) }
    val sorts = listOf(ExSort.RECENT to stringResource(R.string.ex_sort_recent), ExSort.AZ to "A - Z", ExSort.RATING to stringResource(R.string.ex_sort_rating))
    val accent = NfRed
    val grid = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    // ya no se ve el principio del degradado: la barra de notificaciones toma el color de la app
    val scrolled by remember { androidx.compose.runtime.derivedStateOf { grid.firstVisibleItemIndex > 0 || grid.firstVisibleItemScrollOffset > 40 } }
    val inset = topInset()

    BoxWithConstraints(Modifier.fillMaxSize().background(NfBg)) {
        // 3 columnas en el teléfono, como el web player; más en la tableta
        val cols = if (maxWidth < 600.dp) 3 else ((maxWidth - pad * 2 + gap) / (150.dp + gap)).toInt().coerceAtLeast(4)
        val colW = (maxWidth - pad * 2 - gap * (cols - 1)) / cols
        LazyVerticalGrid(
            columns = GridCells.Fixed(cols), state = grid, contentPadding = PaddingValues(start = pad, end = pad, bottom = 90.dp),
            horizontalArrangement = Arrangement.spacedBy(gap), verticalArrangement = Arrangement.spacedBy(gap),
            modifier = Modifier.fillMaxSize(),
        ) {
            // arriba: las secciones (Categorías marcada) y el título sobre el degradado del color de la app
            item(key = "head", span = full) {
                Column(
                    Modifier.fullBleed(pad).background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.42f), accent.copy(alpha = 0.14f), NfBg)))
                        // el degradado sigue por detrás de la barra de notificaciones y la cámara; las secciones, justo debajo
                        .padding(top = inset + 10.dp, bottom = 18.dp),
                ) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = pad), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ExChip(stringResource(R.string.series), false, big = true) { state.stack.clear(); state.tab = Tab.SERIES }
                        ExChip(stringResource(R.string.movies), false, big = true) { state.stack.clear(); state.tab = Tab.MOVIES }
                        ExChip(stringResource(R.string.categories), true, big = true) {}
                        if (Tenant.sportsEnabled && !Profiles.kids) ExChip(stringResource(R.string.sports), false, big = true) { state.stack.clear(); state.tab = Tab.SPORTS }
                    }
                    Text(
                        if (cat.isNotEmpty()) catName else plat?.label ?: stringResource(R.string.explore),
                        color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.Black, maxLines = 2, modifier = Modifier.padding(start = pad, end = pad, top = 26.dp),
                    )
                    Text(
                        when {
                            cat.isNotEmpty() -> stringResource(if (catSeries) R.string.ex_sub_cat_series else R.string.ex_sub_cat_movies, catName)
                            plat != null -> stringResource(R.string.ex_sub_platform, plat.label)
                            else -> stringResource(R.string.explore_sub)
                        },
                        color = Color(0xFFB3B3B3), fontSize = 17.sp, modifier = Modifier.padding(start = pad, end = pad, top = 4.dp),
                    )
                }
            }
            // Todo / Películas / Series (con una carpeta no: es de un solo tipo, como el web player)
            if (cat.isEmpty()) item(key = "type", span = full) {
                Box {
                    Row(Modifier.border(1.dp, Color(0x80FFFFFF), RoundedCornerShape(50)).padding(2.dp)) {
                        listOf(ExType.ALL to R.string.ex_all, ExType.MOVIE to R.string.movies, ExType.SERIES to R.string.series).forEach { (t, label) ->
                            val on = type == t
                            Text(
                                stringResource(label), color = if (on) Color.Black else Color.White, fontSize = 16.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                                modifier = Modifier.background(if (on) Color.White else Color.Transparent, RoundedCornerShape(50))
                                    .clickable { if (type != t) { type = t; genre = "" } }.padding(horizontal = 20.dp, vertical = 9.dp),
                            )
                        }
                    }
                }
            }
            // ordenar y filtrar por título, lado a lado
            item(key = "pickers", span = full) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ExPicker(sorts.first { it.first == sort }.second, sorts.map { it.second }, Modifier.weight(0.6f)) { i -> sort = sorts[i].first }
                    ExTitleField(query, Modifier.weight(0.4f)) { query = it }
                }
            }
            item(key = "count", span = full) {
                Text(stringResource(R.string.ex_count, shown.size), color = Color(0xFFA0A0A0), fontSize = 15.sp)
            }
            if (cat.isEmpty() && genres.isNotEmpty()) item(key = "genres", span = full) {
                LazyRow(Modifier.fullBleed(pad), contentPadding = PaddingValues(horizontal = pad), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { ExChip(stringResource(R.string.ex_all_genres), genre.isEmpty()) { genre = "" } }
                    items(genres, key = { it.first }) { (label, _) -> ExChip(label, genre == label) { genre = if (genre == label) "" else label } }
                }
            }
            if (cat.isEmpty() && plat == null && platforms.isNotEmpty()) item(key = "plats", span = full) {
                LazyRow(Modifier.fullBleed(pad), contentPadding = PaddingValues(horizontal = pad), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(platforms, key = { it.key }) { p -> ExChip(p.label, false) { state.push(Route.Explore(platform = p.key)) } }
                }
            }
            item(key = "line", span = full) { Box(Modifier.fullBleed(pad).padding(top = 4.dp, bottom = 10.dp).height(1.dp).background(Color(0xFF2A2A2A))) }
            if (shown.isEmpty()) item(key = "empty", span = full) {
                Text(
                    if (query.isNotBlank()) stringResource(R.string.no_matches, query.trim()) else stringResource(R.string.empty_section),
                    color = Color(0xFFB3B3B3), fontSize = 15.sp, modifier = Modifier.padding(vertical = 40.dp),
                )
            }
            items(shown, key = { it.key }) { it ->
                val p = progress[it.key]
                PosterCard(it, colW, onClick = { state.push(Route.Detail(it)) }, progress = if (p != null && p.duration > 0) p.position.toFloat() / p.duration else 0f)
            }
        }
        StatusScrim(scrolled, Modifier.align(Alignment.TopCenter))
    }
}

/** un elemento de la cuadrícula a todo el ancho de la pantalla (sin el margen de los lados) */
private fun Modifier.fullBleed(pad: Dp): Modifier = layout { m, c ->
    val extra = (pad * 2).roundToPx()
    val w = c.maxWidth + extra
    val pl = m.measure(c.copy(minWidth = w, maxWidth = w))
    layout(c.maxWidth, pl.height) { pl.place(-extra / 2, 0) }
}

/** lista desplegable para ordenar (fondo negro con borde, como el web player) */
@Composable
private fun ExPicker(current: String, options: List<String>, modifier: Modifier, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().background(Color.Black, RoundedCornerShape(4.dp)).border(1.dp, Color(0x80FFFFFF), RoundedCornerShape(4.dp))
                .clickable { open = true }.padding(start = 10.dp, end = 2.dp, top = 11.dp, bottom = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(current, color = Color.White, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.ArrowDropDown, null, tint = Color.White)
        }
        DropdownMenu(open, onDismissRequest = { open = false }, modifier = Modifier.background(Color(0xFF1F1F1F))) {
            options.forEachIndexed { i, o ->
                DropdownMenuItem(text = { Text(o, color = if (o == current) Color.White else Color(0xFFCCCCCC), fontWeight = if (o == current) FontWeight.Bold else FontWeight.Normal) },
                    onClick = { open = false; onPick(i) })
            }
        }
    }
}

/** «Filtrar por título…» (sin acentos ni mayúsculas; el teclado no se abre solo) */
@Composable
private fun ExTitleField(value: String, modifier: Modifier, onChange: (String) -> Unit) {
    val kb = LocalSoftwareKeyboardController.current
    BasicTextField(
        value = value, onValueChange = onChange, singleLine = true,
        textStyle = TextStyle(color = Color.White, fontSize = 16.sp), cursorBrush = SolidColor(Color.White),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { kb?.hide() }),
        modifier = modifier,
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().background(Color.Black, RoundedCornerShape(4.dp)).border(1.dp, Color(0x80FFFFFF), RoundedCornerShape(4.dp))
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(stringResource(R.string.ex_filter_title), color = Color(0xFF8C8C8C), fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    inner()
                }
                if (value.isNotEmpty()) Icon(Icons.Filled.Close, null, tint = Color.White, modifier = Modifier.size(20.dp).clickable { onChange("") })
            }
        },
    )
}

/** cápsula con borde (la elegida, blanca), como las del web player */
@Composable
private fun ExChip(text: String, selected: Boolean, big: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Text(
        text, color = if (selected) Color.Black else Color.White, fontSize = if (big) 17.sp else 16.sp,
        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal, maxLines = 1,
        modifier = Modifier.background(if (selected) Color.White else Color.Transparent, shape).border(1.dp, if (selected) Color.White else Color(0x80FFFFFF), shape)
            .clickable(onClick = onClick).padding(horizontal = if (big) 18.dp else 16.dp, vertical = if (big) 9.dp else 8.dp),
    )
}
