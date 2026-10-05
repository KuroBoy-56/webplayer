package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
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
import com.latmpx.player.ui.Tab
import com.latmpx.player.ui.components.Chip
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
    val cats = if (kind == Kind.MOVIE) state.movieCats else state.seriesCats
    val tv = LocalIsTv.current
    val heroItems = remember(all) { all.sortedByDescending { it.added }.filter { it.backdrop.isNotEmpty() }.take(5).ifEmpty { all.take(1) } }
    if (state.loading && all.isEmpty()) { Loading(); return }
    
    var filter by rememberSaveable(kind) { mutableStateOf("all") }
    var dropdownExpanded by remember { mutableStateOf(false) }
    
    val catList = remember(cats) { listOf("all" to "Todo") + cats.map { "c:" to it.name } }
    val currentCatName = catList.firstOrNull { it.first == filter }?.second ?: "CategorÃ­as"

    Column(Modifier.fillMaxSize().background(NfBg)) {
        if (!tv) {
            Row(Modifier.fillMaxWidth().padding(horizontal = sidePad(), vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Series", color = if (kind == Kind.SERIES) Color.White else Color.Gray, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { state.tab = Tab.SERIES })
                Text("PelÃ­culas", color = if (kind == Kind.MOVIE) Color.White else Color.Gray, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { state.tab = Tab.MOVIES })
                Text("Deportes", color = Color.Gray, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { state.tab = Tab.SPORTS })
            }
        }
        
        val pw = posterWidth()
        val sp = sidePad()
        
        if (filter == "all") {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    HeroCarousel(items = heroItems, tv = tv) { item ->
                        com.latmpx.player.ui.screens.Hero(state, item, tv)
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth().padding(horizontal = sp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (kind == Kind.MOVIE) "Películas" else "Series", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.width(12.dp))
                        Box {
                            Row(Modifier.clickable { dropdownExpanded = true }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(currentCatName, color = Color.LightGray)
                                Icon(Icons.Filled.ArrowDropDown, null, tint = Color.LightGray)
                            }
                            DropdownMenu(expanded = dropdownExpanded, onDismissRequest = { dropdownExpanded = false }) {
                                catList.forEach { (k, n) ->
                                    DropdownMenuItem(text = { Text(n) }, onClick = { filter = k; dropdownExpanded = false })
                                }
                            }
                        }
                    }
                }
                
                val recent = all.sortedByDescending { it.added }.take(20)
                item { ShelfRow("Agregadas recientemente", recent, sp, onViewAll = { state.push(Route.Browse("Agregadas recientemente", kind, setOf(filter.removePrefix("c:")))) }) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) } }
                
                val top10 = all.sortedByDescending { it.added }.take(300).sortedByDescending { it.rating }.take(10)
                item { ShelfRow("Top 10", top10, sp) { i, it -> Top10Card(i + 1, it, pw * 1.15f, onClick = { state.push(Route.Detail(it)) }) } }
                
                cats.take(15).forEach { c ->
                    val list = all.filter { it.categoryId == c.id }.sortedByDescending { it.added }.take(20)
                    if (list.isNotEmpty()) {
                        item(key = "c_${c.id}") {
                            ShelfRow(c.name, list, sp, onViewAll = { state.push(Route.Browse(c.name, kind, setOf(c.id))) }) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) }
                        }
                    }
                }
                item { Spacer(Modifier.height(40.dp)) }
            }
        } else {
            val shown = byCats(all, setOf(filter.removePrefix("c:")))
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = sidePad(), vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (kind == Kind.MOVIE) "PelÃ­culas" else "Series", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(12.dp))
                    Box {
                        Row(Modifier.clickable { dropdownExpanded = true }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(currentCatName, color = Color.LightGray)
                            Icon(Icons.Filled.ArrowDropDown, null, tint = Color.LightGray)
                        }
                        DropdownMenu(expanded = dropdownExpanded, onDismissRequest = { dropdownExpanded = false }) {
                            catList.forEach { (k, n) ->
                                DropdownMenuItem(text = { Text(n) }, onClick = { filter = k; dropdownExpanded = false })
                            }
                        }
                    }
                }
                Grid(state, shown, emptyList(), tv)
            }
        }
    }
}

fun byCats(all: List<Item>, ids: Set<String>): List<Item> = all.filter { it.categoryId in ids }.sortedByDescending { it.added }

@Composable
fun Grid(state: AppState, items: List<Item>, heroItems: List<Item> = emptyList(), tv: Boolean = false) {
    if (items.isEmpty()) { Empty("No hay contenido en esta secciÃ³n"); return }
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
        if (favs.isEmpty()) Empty("Agrega pelÃ­culas y series con el botÃ³n \"Mi lista\" para verlas aquÃ­") else Grid(state, favs)
    }
}
