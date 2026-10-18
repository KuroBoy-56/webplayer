package com.latmpx.player.ui.screens

import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.Tab
import com.latmpx.player.ui.components.HeroCarousel
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.components.ShelfRow
import com.latmpx.player.ui.components.Top10Card
import com.latmpx.player.ui.theme.NfBg

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(state: AppState, kind: Kind) {
    val all = if (kind == Kind.MOVIE) state.movies else state.series
    val cats = (if (kind == Kind.MOVIE) state.movieCats else state.seriesCats).filter { it.id !in com.latmpx.player.data.Store.blockedCats }
    val tv = LocalIsTv.current
    val heroItems = remember(all) { all.sortedByDescending { it.added }.filter { it.backdrop.isNotEmpty() }.take(5).ifEmpty { all.take(1) } }
    if (state.loading && all.isEmpty()) { Loading(); return }
    
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    // derivedStateOf: la pantalla ya no se recompone en cada píxel de desplazamiento, solo al cambiar el valor
    val solid by remember { androidx.compose.runtime.derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 260 } }
    // filas calculadas una vez por catálogo (antes se filtraba todo el catálogo por cada categoría en cada recomposición)
    val recent = remember(all) { all.sortedByDescending { it.added }.take(20) }
    val top10 = remember(all) { all.sortedByDescending { it.added }.take(300).sortedByDescending { it.rating }.take(10) }
    val rows = remember(all, cats) {
        val byCat = all.groupBy { it.categoryId }
        cats.mapNotNull { c -> byCat[c.id]?.sortedByDescending { it.added }?.take(20)?.let { c to it } }
    }
    val cardHero = remember(all) { all.sortedByDescending { it.added }.take(40).sortedByDescending { it.rating }.take(6) }
    Box(Modifier.fillMaxSize().background(NfBg)) {
        val pw = posterWidth()
        val sp = sidePad()

        LazyColumn(Modifier.fillMaxSize(), state = listState) {
            item {
                if (tv) HeroCarousel(items = heroItems, tv = tv) { item -> com.latmpx.player.ui.screens.Hero(state, item, tv) }
                else HeroCards(state, cardHero.ifEmpty { heroItems }, topPad = 112.dp)
            }
            if (tv) item {
                Row(Modifier.fillMaxWidth().padding(horizontal = sp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(if (kind == Kind.MOVIE) R.string.movies else R.string.series), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                }
            }
            
            item { ShelfRow(stringResource(R.string.recently_added), recent, sp, onViewAll = { state.push(Route.Browse(tr(R.string.recently_added), kind, emptySet())) }) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) } }
            
            item { ShelfRow(stringResource(R.string.top10), top10, sp) { i, it -> Top10Card(i + 1, it, pw * 1.15f, onClick = { state.push(Route.Detail(it)) }) } }
            
            rows.forEach { (c, list) ->
                item(key = "c_${c.id}") {
                    ShelfRow(c.name, list, sp, onViewAll = { state.push(Route.Browse(c.name, kind, setOf(c.id))) }) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) }
                }
            }
            item { Spacer(Modifier.height(40.dp)) }
        }
        if (!tv) PhoneTopBar(state, sp, solid, if (kind == Kind.MOVIE) Tab.MOVIES else Tab.SERIES) { state.tab = Tab.ACCOUNT }
    }
}

fun byCats(all: List<Item>, ids: Set<String>): List<Item> = if (ids.isEmpty()) all.sortedByDescending { it.added } else all.filter { it.categoryId in ids }.sortedByDescending { it.added }

@Composable
fun Grid(state: AppState, items: List<Item>, heroItems: List<Item> = emptyList(), tv: Boolean = false) {
    if (items.isEmpty()) { Empty(stringResource(R.string.empty_section)); return }
    val pw = posterWidth()
    val progress = remember(state.refresh, Cloud.rev) { Cloud.progressList().associateBy { it.key.split(":").take(2).joinToString(":") } }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(pw), contentPadding = PaddingValues(horizontal = sidePad(), vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize(),
    ) {
        items(items, key = { it.key }) { it ->
            val p = progress[it.key]
            PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, progress = if (p != null && p.duration > 0) p.position.toFloat() / p.duration else 0f)
        }
        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(this.maxLineSpan) }) { Spacer(Modifier.height(60.dp)) }
    }
}

@Composable
fun BrowseScreen(state: AppState, title: String, kind: Kind?, categoryIds: Set<String>, platform: com.latmpx.player.data.Platform? = null) {
    val list = remember(state.movies, state.series, platform, categoryIds) {
        if (platform != null) {
            byCats(state.movies, com.latmpx.player.data.Platforms.categoriesFor(state.movieCats, platform.kw)) + byCats(state.series, com.latmpx.player.data.Platforms.categoriesFor(state.seriesCats, platform.kw))
        } else byCats(if (kind == Kind.SERIES) state.series else state.movies, categoryIds)
    }
    // plataformas: lupa arriba a la derecha para filtrar por nombre (sin distinguir mayúsculas ni acentos)
    var searching by rememberSaveable(title) { mutableStateOf(false) }
    var query by rememberSaveable(title) { mutableStateOf("") }
    val shown = remember(list, query) {
        val q = com.latmpx.player.data.Platforms.fold(query.trim())
        if (q.isEmpty()) list else list.filter { com.latmpx.player.data.Platforms.fold(it.name).contains(q) }
    }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        Row(Modifier.fillMaxWidth().padding(start = sidePad(), end = sidePad(), top = 12.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = if (searching) Modifier.widthIn(max = 280.dp) else Modifier.weight(1f))
            if (platform != null) {
                if (searching) {
                    Spacer(Modifier.width(12.dp))
                    NameFilterField(query, Modifier.weight(1f)) { query = it }
                }
                Spacer(Modifier.width(10.dp))
                com.latmpx.player.ui.components.FocusBox(
                    onClick = { if (searching) { searching = false; query = "" } else searching = true },
                    shape = androidx.compose.foundation.shape.CircleShape, focusScale = 1.12f,
                ) { f ->
                    Box(Modifier.size(40.dp).background(if (f) Color.White else Color(0x22FFFFFF), androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) {
                        Icon(
                            if (searching) androidx.compose.material.icons.Icons.Filled.Close else androidx.compose.material.icons.Icons.Filled.Search,
                            stringResource(if (searching) R.string.close_search else R.string.search), tint = if (f) Color.Black else Color.White, modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }
        }
        if (shown.isEmpty() && query.isNotBlank()) Empty(stringResource(R.string.no_matches, query.trim())) else Grid(state, shown)
    }
}

/** Campo de texto para filtrar por nombre: toma el foco y abre el teclado al aparecer (celular y control remoto). */
@Composable
private fun NameFilterField(value: String, modifier: Modifier, onChange: (String) -> Unit) {
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    val kb = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { runCatching { focus.requestFocus(); kb?.show() } }
    androidx.compose.foundation.text.BasicTextField(
        value = value, onValueChange = onChange, singleLine = true,
        textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 16.sp),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(Color.White),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { kb?.hide() }),
        modifier = modifier.focusRequester(focus),
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().background(Color(0xFF000000), androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                    .border(1.dp, Color.White, androidx.compose.foundation.shape.RoundedCornerShape(4.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(androidx.compose.material.icons.Icons.Filled.Search, null, tint = Color(0xFF808080), modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(stringResource(R.string.filter_by_name), color = Color(0xFF808080), fontSize = 16.sp)
                    inner()
                }
            }
        },
    )
}

@Composable
fun MyListScreen(state: AppState) {
    val favs = remember(state.refresh, Cloud.rev) { Cloud.favList().filter { it.kind != Kind.LIVE } }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        Text(stringResource(R.string.my_list), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = sidePad(), top = 16.dp, bottom = 6.dp))
        if (favs.isEmpty()) Empty(stringResource(R.string.my_list_empty)) else Grid(state, favs)
    }
}

/** "Ver todo" de Continuar viendo / Mi lista: todos los títulos en rejilla (con su avance) */
@Composable
fun SavedScreen(state: AppState, continueWatching: Boolean) {
    val list = remember(continueWatching, state.refresh, Cloud.rev, state.movies, state.series) {
        if (continueWatching) {
            Cloud.progressList().mapNotNull { p -> state.itemFromProgress(p)?.let { it.copy(poster = p.poster.ifEmpty { it.poster }) } }.distinctBy { it.key }
        } else Cloud.favList().filter { it.kind != Kind.LIVE }
    }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        Text(
            stringResource(if (continueWatching) R.string.continue_watching else R.string.my_list), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = sidePad(), top = 16.dp, bottom = 6.dp),
        )
        if (list.isEmpty()) Empty(stringResource(if (continueWatching) R.string.continue_empty else R.string.my_list_empty))
        else Grid(state, list)
    }
}
