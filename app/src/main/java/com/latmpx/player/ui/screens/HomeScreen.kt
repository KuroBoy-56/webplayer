package com.latmpx.player.ui.screens
import androidx.compose.foundation.layout.size
import com.latmpx.player.ui.theme.NfRed

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.ui.draw.clip
import androidx.compose.material3.AlertDialog
import androidx.compose.ui.window.Dialog
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.border
import androidx.compose.material3.TextButton
import com.latmpx.player.ui.Tab

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SportsSoccer
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
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
    if (state.loading && state.movies.isEmpty()) { Loading("Preparando tu catálogo…"); return }
    val tv = LocalIsTv.current
    val pad = sidePad()
    val pw = posterWidth()
    val movies = state.movies
    val series = state.series

    val recentMovies = remember(movies) { movies.sortedByDescending { it.added }.take(40) }
    val recentSeries = remember(series) { series.sortedByDescending { it.added }.take(40) }
    val top10 = remember(movies) { movies.sortedByDescending { it.added }.take(300).sortedByDescending { it.rating }.take(10) }
    val genreRows = remember(movies, state.movieCats) {
        Platforms.genres.mapNotNull { (label, kw) ->
            val mcats = state.movieCats.filter { it.id !in com.latmpx.player.data.Store.blockedCats }
            val ids = Platforms.categoriesFor(mcats, kw)
            val list = if (ids.isEmpty()) emptyList() else movies.filter { it.categoryId in ids }.sortedByDescending { it.added }.take(30)
            if (list.size >= 4) label to list else null
        }
    }
    val platforms = remember(state.movieCats, state.seriesCats) {
        val safeCats = (state.movieCats + state.seriesCats).filter { it.id !in com.latmpx.player.data.Store.blockedCats }
        Platforms.list.filter { p -> Platforms.categoriesFor(safeCats, p.kw).isNotEmpty() }
    }
    val cont = remember(state.refresh, Cloud.rev, movies, series) { Cloud.progressList() }
    val favs = remember(state.refresh, Cloud.rev) { Cloud.favList().filter { it.kind != Kind.LIVE } }
    val heroItems = remember(movies) { recentMovies.filter { it.backdrop.isNotEmpty() }.take(5).ifEmpty { recentMovies.take(1) } }
    var userFocusedHero by remember(movies) { mutableStateOf<Item?>(null) }

    var showProfileDialog by remember { mutableStateOf(false) }

    if (showProfileDialog) {
        Dialog(onDismissRequest = { showProfileDialog = false }) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color(0xE6141414), Color(0xF2000000))), RoundedCornerShape(16.dp))
                    .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(16.dp))
                    .padding(24.dp)
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Perfil", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(state.session?.user ?: "", color = Color.White, fontSize = 16.sp)
                        Text(state.session?.dnsName ?: "", color = NfGray2, fontSize = 13.sp)
                    }
                    HorizontalDivider(color = Color(0x33FFFFFF))
                    Row(Modifier.fillMaxWidth().clickable { showProfileDialog = false; state.tab = Tab.ACCOUNT }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Person, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(16.dp))
                        Text("Mi cuenta", color = Color.White, fontSize = 16.sp)
                    }
                    Row(Modifier.fillMaxWidth().clickable { showProfileDialog = false; state.tab = Tab.ACCOUNT }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Settings, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(16.dp))
                        Text("Ajustes", color = Color.White, fontSize = 16.sp)
                    }
                    Row(Modifier.fillMaxWidth().clickable { showProfileDialog = false; state.tab = Tab.SPORTS }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.SportsSoccer, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(16.dp))
                        Text("Deportes", color = Color.White, fontSize = 16.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { showProfileDialog = false }, modifier = Modifier.align(Alignment.End)) { 
                        Text("Cerrar", color = NfRed) 
                    }
                }
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().background(NfBg)) {
        item {
            val h = userFocusedHero
            if (h != null) {
                Hero(state, h, tv)
            } else {
                HeroCarousel(items = heroItems, tv = tv) { item ->
                    Hero(state, item, tv)
                }
            }
        }
        item {
            ShelfRow("Continuar viendo", cont, pad) { _, p ->
                val it = state.itemFromProgress(p) ?: return@ShelfRow
                PosterCard(it.copy(poster = p.poster.ifEmpty { it.poster }), pw, onClick = { state.push(Route.Detail(it)) },
                    progress = if (p.duration > 0) p.position.toFloat() / p.duration else 0f)
            }
        }
        item { ShelfRow("Mi lista", favs, pad) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) } }
        item {
            ShelfRow("Top 10 de hoy", top10, pad) { i, it -> Top10Card(i + 1, it, pw * 1.15f, onClick = { state.push(Route.Detail(it)) }) }
        }
        item {
            ShelfRow("Plataformas", platforms, pad) { _, p -> PlatformCard(p, if (tv) 200.dp else 150.dp, onClick = { state.push(Route.PlatformPage(p)) }) }
        }
        item {
            ShelfRow("Películas recién agregadas", recentMovies, pad, onViewAll = { state.push(Route.Browse("Películas recién agregadas", com.latmpx.player.data.Kind.MOVIE, emptySet())) }) { _, it ->
                PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, onFocus = if (tv) ({ userFocusedHero = it }) else null)
            }
        }
        item { ShelfRow("Series recién agregadas", recentSeries, pad, onViewAll = { state.push(Route.Browse("Series recién agregadas", com.latmpx.player.data.Kind.SERIES, emptySet())) }) { _, it -> PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }) } }
        genreRows.forEach { (label, list) ->
            item(key = "g_$label") {
                val kw = com.latmpx.player.data.Platforms.genres.find { it.first == label }?.second ?: emptyList()
                val ids = com.latmpx.player.data.Platforms.categoriesFor(state.movieCats.filter { it.id !in com.latmpx.player.data.Store.blockedCats }, kw)
                ShelfRow(label, list, pad, onViewAll = { state.push(Route.Browse(label, com.latmpx.player.data.Kind.MOVIE, ids)) }) { _, it ->
                    PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, onFocus = if (tv) ({ userFocusedHero = it }) else null)
                }
            }
        }
        item { Spacer(Modifier.height(40.dp)) }
    }
    if (!tv) {
        Column(Modifier.fillMaxWidth().background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color(0xCC000000), Color(0x66000000), Color.Transparent)))) {
            Row(Modifier.fillMaxWidth().padding(horizontal = pad, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(com.latmpx.player.R.drawable.logo), null, modifier = Modifier.height(32.dp))
                Spacer(Modifier.weight(1f))
                Icon(Icons.Filled.Search, null, tint = Color.White, modifier = Modifier.size(28.dp).clickable { state.tab = Tab.SEARCH })
                Spacer(Modifier.width(16.dp))
                Box(Modifier.size(32.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFFE50914)).clickable { showProfileDialog = true }, contentAlignment = androidx.compose.ui.Alignment.Center) {
                    Text(state.session?.user?.take(1)?.uppercase() ?: "U", color = Color.White, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, fontSize = 16.sp)
                }
            }
            Row(Modifier.fillMaxWidth().padding(start = pad, end = pad, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                com.latmpx.player.ui.components.Chip("Series", false) { state.tab = Tab.SERIES }
                com.latmpx.player.ui.components.Chip("Películas", false) { state.tab = Tab.MOVIES }
                com.latmpx.player.ui.components.Chip("Deportes", false) { state.tab = Tab.SPORTS }
            }
        }
    }
}
}

@Composable
fun Hero(state: AppState, item: Item, tv: Boolean) {
    val first = remember { FocusRequester() }
    if (tv) LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxWidth().height(if (tv) 360.dp else 470.dp)) {
        AsyncImage(
            model = item.backdrop.ifEmpty { item.poster }, contentDescription = item.name, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
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
                HeroButton("Reproducir", Icons.Filled.PlayArrow, true, Modifier.focusRequester(first)) { state.push(Route.Detail(item)) }
                HeroButton("Más información", Icons.Filled.Info, false) { state.push(Route.Detail(item)) }
            }
        }
    }
}

@Composable
fun HeroButton(text: String, icon: ImageVector, primary: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(4.dp), focusScale = 1.06f) { f ->
        Row(
            Modifier.background(if (primary) Color.White else if (f) Color(0xCCFFFFFF) else Color(0x806D6D6E)).padding(horizontal = 18.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val c = if (primary || f) Color.Black else Color.White
            Icon(icon, null, tint = c)
            Text(text, color = c, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.padding(start = 6.dp))
        }
    }
}
