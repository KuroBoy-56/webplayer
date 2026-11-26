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

private enum class ExType { ALL, MOVIE, SERIES }
private enum class ExSort { RECENT, AZ, RATING }

/**
 * Explorar (solo con perfiles: el botón «Categorías» de arriba), como la del web player (browse.php) pero en vertical:
 * Todo / Películas / Series, ordenar (recientes, A - Z, mejor valorados), carpetas del servidor (con Películas o Series),
 * filtrar por título, géneros y plataformas. Solo las carpetas que el cliente ve (control parental) y, en el perfil
 * infantil, lo que deja el filtro de niños (state.movies / state.series ya vienen filtrados).
 */
@Composable
fun ExploreScreen(state: AppState) {
    var type by rememberSaveable { mutableStateOf(ExType.ALL) }
    var sort by rememberSaveable { mutableStateOf(ExSort.RECENT) }
    var folder by rememberSaveable { mutableStateOf("") }
    var genre by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }

    val mCats = remember(state.movieCats, state.refresh) { Store.visibleCats(state.movieCats) }
    val sCats = remember(state.seriesCats, state.refresh) { Store.visibleCats(state.seriesCats) }
    // lo que se puede mostrar: solo títulos de carpetas visibles
    val movies = remember(state.movies, mCats) { mCats.map { it.id }.toSet().let { ids -> state.movies.filter { it.categoryId in ids } } }
    val series = remember(state.series, sCats) { sCats.map { it.id }.toSet().let { ids -> state.series.filter { it.categoryId in ids } } }
    val pool = when (type) { ExType.MOVIE -> movies; ExType.SERIES -> series; ExType.ALL -> movies + series }
    val cats: List<Category> = when (type) { ExType.MOVIE -> mCats; ExType.SERIES -> sCats; ExType.ALL -> mCats + sCats }
    // géneros con al menos una carpeta en lo que se está viendo
    val genres = remember(cats) { Platforms.genres.filter { (_, kw) -> Platforms.categoriesFor(cats, kw).isNotEmpty() } }
    val shown = remember(pool, cats, sort, folder, genre, query) {
        var l = pool
        if (folder.isNotEmpty()) l = l.filter { it.categoryId == folder }
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
    val pw = posterWidth()
    val progress = remember(state.refresh, Cloud.rev) { Cloud.progressList().associateBy { it.key.split(":").take(2).joinToString(":") } }
    val pad = sidePad()
    val full: (androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope) -> GridItemSpan = { GridItemSpan(it.maxLineSpan) }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(pw), contentPadding = PaddingValues(start = pad, end = pad, top = 8.dp, bottom = 90.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier.fillMaxSize().background(NfBg),
    ) {
        item(key = "head", span = full) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PhoneBackButton(state)
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.explore), color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Black)
                    Text(stringResource(R.string.explore_sub), color = Color(0xFFB3B3B3), fontSize = 13.sp)
                }
            }
        }
        // Todo / Películas / Series
        item(key = "type", span = full) {
            Row(Modifier.fillMaxWidth().background(Color(0xFF2A2A2A), RoundedCornerShape(8.dp)).padding(3.dp)) {
                listOf(ExType.ALL to R.string.ex_all, ExType.MOVIE to R.string.movies, ExType.SERIES to R.string.series).forEach { (t, label) ->
                    val on = type == t
                    Box(
                        Modifier.weight(1f).background(if (on) Color.White else Color.Transparent, RoundedCornerShape(6.dp))
                            .clickable { if (type != t) { type = t; folder = ""; genre = "" } }.padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(stringResource(label), color = if (on) Color.Black else Color(0xFFCCCCCC), fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }
        // ordenar y carpeta
        item(key = "pickers", span = full) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val sorts = listOf(ExSort.RECENT to stringResource(R.string.ex_sort_recent), ExSort.AZ to "A - Z", ExSort.RATING to stringResource(R.string.ex_sort_rating))
                ExPicker(sorts.first { it.first == sort }.second, sorts.map { it.second }, Modifier.weight(1f)) { i -> sort = sorts[i].first }
                if (type != ExType.ALL) {
                    val names = listOf(stringResource(R.string.ex_all_folders)) + cats.map { it.name }
                    val sel = cats.indexOfFirst { it.id == folder }
                    ExPicker(names[sel + 1], names, Modifier.weight(1f)) { i -> folder = if (i == 0) "" else cats[i - 1].id }
                }
            }
        }
        item(key = "q", span = full) {
            Column {
                ExTitleField(query) { query = it }
                Text(
                    stringResource(R.string.ex_count, shown.size), color = Color(0xFF8C8C8C), fontSize = 13.sp,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
        if (folder.isEmpty() && genres.isNotEmpty()) item(key = "genres", span = full) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { ExChip(stringResource(R.string.ex_all_genres), genre.isEmpty()) { genre = "" } }
                items(genres, key = { it.first }) { (label, _) -> ExChip(label, genre == label) { genre = if (genre == label) "" else label } }
            }
        }
        if (platforms.isNotEmpty()) item(key = "plats", span = full) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(platforms, key = { it.key }) { p -> ExChip(p.label, false) { state.push(Route.PlatformPage(p)) } }
            }
        }
        if (shown.isEmpty()) item(key = "empty", span = full) {
            Text(
                if (query.isNotBlank()) stringResource(R.string.no_matches, query.trim()) else stringResource(R.string.empty_section),
                color = Color(0xFFB3B3B3), fontSize = 15.sp, modifier = Modifier.padding(vertical = 40.dp),
            )
        }
        items(shown, key = { it.key }) { it ->
            val p = progress[it.key]
            PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, progress = if (p != null && p.duration > 0) p.position.toFloat() / p.duration else 0f)
        }
    }
}

/** lista desplegable (ordenar / carpeta) */
@Composable
private fun ExPicker(current: String, options: List<String>, modifier: Modifier, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().background(Color(0xFF1F1F1F), RoundedCornerShape(6.dp)).border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(6.dp))
                .clickable { open = true }.padding(start = 12.dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(current, color = Color.White, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
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
private fun ExTitleField(value: String, onChange: (String) -> Unit) {
    val kb = LocalSoftwareKeyboardController.current
    BasicTextField(
        value = value, onValueChange = onChange, singleLine = true,
        textStyle = TextStyle(color = Color.White, fontSize = 16.sp), cursorBrush = SolidColor(Color.White),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { kb?.hide() }),
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().background(Color(0xFF1F1F1F), RoundedCornerShape(6.dp)).border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(6.dp))
                    .padding(horizontal = 12.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Search, null, tint = Color(0xFF8C8C8C), modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(stringResource(R.string.ex_filter_title), color = Color(0xFF8C8C8C), fontSize = 16.sp)
                    inner()
                }
                if (value.isNotEmpty()) Icon(Icons.Filled.Close, null, tint = Color.White, modifier = Modifier.size(20.dp).clickable { onChange("") })
            }
        },
    )
}

@Composable
private fun ExChip(text: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Text(
        text, color = if (selected) Color.Black else Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.background(if (selected) Color.White else Color(0x1FFFFFFF), shape).border(1.dp, Color(0x33FFFFFF), shape)
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
    )
}
