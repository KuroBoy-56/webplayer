package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.GridItemSpan
import com.latmpx.player.ui.components.HeroCarousel
import com.latmpx.player.ui.components.LocalIsTv
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Platform
import com.latmpx.player.data.Platforms
import com.latmpx.player.data.Cloud
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.theme.NfBg

/** Pestaña Películas / Series: filtros por plataforma, género y categoría del servidor + cuadrícula. */
@Composable
fun CatalogScreen(state: AppState, kind: Kind) {
    val all = if (kind == Kind.MOVIE) state.movies else state.series
    val cats = if (kind == Kind.MOVIE) state.movieCats else state.seriesCats
    val tv = LocalIsTv.current
    val heroItems = remember(all) { all.sortedByDescending { it.added }.filter { it.backdrop.isNotEmpty() }.take(5).ifEmpty { all.take(1) } }
    if (state.loading && all.isEmpty()) { Loading(); return }
    var filter by rememberSaveable(kind) { mutableStateOf("all") }
    val filters = remember(cats) {
        val out = ArrayList<Pair<String, String>>()
        out += "all" to "Todo"
        out += "recent" to "Recién agregadas"
        Platforms.list.forEach { p -> if (Platforms.categoriesFor(cats, p.kw).isNotEmpty()) out += "p:${p.key}" to p.label }
        Platforms.genres.forEach { (l, kw) -> if (Platforms.categoriesFor(cats, kw).isNotEmpty()) out += "g:$l" to l }
        cats.forEach { out += "c:${it.id}" to it.name }
        out
    }
    val shown = remember(all, filter, cats) {
        when {
            filter == "all" -> all.sortedByDescending { it.added }
            filter == "recent" -> all.sortedByDescending { it.added }.take(100)
            filter.startsWith("p:") -> Platforms.list.firstOrNull { "p:${it.key}" == filter }?.let { p -> byCats(all, Platforms.categoriesFor(cats, p.kw)) } ?: emptyList()
            filter.startsWith("g:") -> Platforms.genres.firstOrNull { "g:${it.first}" == filter }?.let { g -> byCats(all, Platforms.categoriesFor(cats, g.second)) } ?: emptyList()
            else -> byCats(all, setOf(filter.removePrefix("c:")))
        }
    }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        Text(if (kind == Kind.MOVIE) "Películas" else "Series", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = sidePad(), top = 16.dp, bottom = 6.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = sidePad(), vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(filters, key = { it.first }) { (k, l) -> Chip(l, filter == k) { filter = k } }
        }
        Grid(state, shown, heroItems, tv)
    }
}

fun byCats(all: List<Item>, ids: Set<String>): List<Item> = all.filter { it.categoryId in ids }.sortedByDescending { it.added }

@Composable
fun Grid(state: AppState, items: List<Item>, heroItems: List<Item> = emptyList(), tv: Boolean = false) {
    if (items.isEmpty()) { Empty("No hay contenido en esta sección"); return }
    val pw = posterWidth()
    val progress = remember(state.refresh, Cloud.rev) { Cloud.progressList().associateBy { it.key.split(":").take(2).joinToString(":") } }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(pw), contentPadding = PaddingValues(horizontal = sidePad(), vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize(),
    ) {
        if (heroItems.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                HeroCarousel(items = heroItems, tv = tv) { item ->
                    com.latmpx.player.ui.screens.Hero(state, item, tv)
                }
            }
        }
        items(items, key = { it.key }) { it ->
            val p = progress[it.key]
            PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, progress = if (p != null && p.duration > 0) p.position.toFloat() / p.duration else 0f)
        }
    }
}

/** Página de una categoría o de una plataforma (películas y series juntas). */
@Composable
fun BrowseScreen(state: AppState, title: String, kind: Kind?, categoryIds: Set<String>, platform: Platform? = null) {
    val list = remember(state.movies, state.series, platform, categoryIds) {
        if (platform != null) {
            byCats(state.movies, Platforms.categoriesFor(state.movieCats, platform.kw)) + byCats(state.series, Platforms.categoriesFor(state.seriesCats, platform.kw))
        } else byCats(if (kind == Kind.SERIES) state.series else state.movies, categoryIds)
    }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        Text(title, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = sidePad(), top = 16.dp, bottom = 6.dp))
        Grid(state, list)
    }
}

@Composable
fun MyListScreen(state: AppState) {
    val favs = remember(state.refresh, Cloud.rev) { Cloud.favList().filter { it.kind != Kind.LIVE } }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        Text("Mi lista", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = sidePad(), top = 16.dp, bottom = 6.dp))
        if (favs.isEmpty()) Empty("Agrega películas y series con el botón \"Mi lista\" para verlas aquí") else Grid(state, favs)
    }
}

