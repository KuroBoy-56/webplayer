package com.latmpx.player.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.collectIsFocusedAsState
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import com.latmpx.player.R
import com.latmpx.player.data.Category
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Item
import com.latmpx.player.data.Platforms
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.components.TvTextFieldBox
import com.latmpx.player.ui.components.rememberTvField
import com.latmpx.player.ui.components.tvKeyboard
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/**
 * Explorar en la TV (la lupa de la barra, solo con perfiles): como browse.php del web player en horizontal. «Explorar» y
 * su subtítulo sobre el degradado del color, la cápsula Todo / Películas / Series, el orden (Agregados recientemente /
 * A - Z / Mejor valorados; cada OK pasa al siguiente), «Filtrar por título…» (OK abre el teclado), el total, los géneros,
 * las plataformas, el divisor y la cuadrícula de carátulas. Solo las carpetas que el cliente ve (control parental).
 */
@Composable
fun TvExploreScreen(state: AppState) {
    var type by rememberSaveable { mutableStateOf(0) } // 0 todo, 1 películas, 2 series
    var sort by rememberSaveable { mutableStateOf(0) } // 0 recientes, 1 A - Z, 2 mejor valorados
    var genre by rememberSaveable { mutableStateOf("") }
    var platform by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }

    val mCats = remember(state.movieCats, state.refresh) { Store.visibleCats(state.movieCats) }
    val sCats = remember(state.seriesCats, state.refresh) { Store.visibleCats(state.seriesCats) }
    val movies = remember(state.movies, mCats) { mCats.map { it.id }.toSet().let { ids -> state.movies.filter { it.categoryId in ids } } }
    val series = remember(state.series, sCats) { sCats.map { it.id }.toSet().let { ids -> state.series.filter { it.categoryId in ids } } }
    val pool = when (type) { 1 -> movies; 2 -> series; else -> movies + series }
    val cats: List<Category> = when (type) { 1 -> mCats; 2 -> sCats; else -> mCats + sCats }
    val genres = remember(cats) { Platforms.genres.filter { (_, kw) -> Platforms.categoriesFor(cats, kw).isNotEmpty() } }
    val platforms = remember(mCats, sCats) {
        if (!Tenant.platformsEnabled) emptyList() else Platforms.list.filter { p -> Platforms.categoriesFor(mCats + sCats, p.kw).isNotEmpty() }
    }
    val plat = platforms.find { it.key == platform }
    val gen = Platforms.genres.find { it.first == genre }
    val shown = remember(pool, cats, sort, genre, plat, query) {
        var l = pool
        for (kw in listOfNotNull(plat?.kw, gen?.second)) {
            val ids = Platforms.categoriesFor(cats, kw)
            l = l.filter { it.categoryId in ids }
        }
        val q = Platforms.fold(query.trim())
        if (q.isNotEmpty()) l = l.filter { Platforms.fold(it.name).contains(q) }
        when (sort) {
            1 -> l.sortedBy { Platforms.fold(it.name) }
            2 -> l.sortedWith(compareByDescending<Item> { it.rating }.thenByDescending { it.added })
            else -> l.sortedByDescending { it.added }
        }
    }
    val progress = remember(state.refresh, Cloud.rev) { Cloud.progressList().associateBy { it.key.split(":").take(2).joinToString(":") } }
    val pad = sidePad()
    // pósters más chicos que en las filas: más columnas, como la cuadrícula del web player
    val pw = 100.dp
    val accent = plat?.let { Color(it.color) } ?: NfRed
    val full: (androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope) -> GridItemSpan = { GridItemSpan(it.maxLineSpan) }
    // al abrir la lupa el foco entra a «Filtrar por título…» (sin teclado; OK lo abre), como la web y la computadora; de
    // vuelta de una ficha, TvLayer (focusRestorer) lo devuelve a la carátula que se abrió y Atrás vuelve a la lupa
    val field = rememberTvField()
    androidx.compose.runtime.LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(120)
        runCatching { field.box.requestFocus() }
    }
    val sortLabel = when (sort) { 1 -> "A - Z"; 2 -> stringResource(R.string.ex_sort_rating); else -> stringResource(R.string.ex_sort_recent) }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(pw), contentPadding = PaddingValues(start = pad, end = pad, bottom = 60.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier.fillMaxSize().background(NfBg),
    ) {
        item(key = "head", span = full) {
            Column(
                Modifier.bleed(pad).fillMaxWidth().drawBehind {
                    // el resplandor del color arriba a la izquierda (radial-gradient(1200px 300px at 0 0) del web player)
                    scale(4f, 1f, pivot = Offset.Zero) {
                        drawRect(Brush.radialGradient(listOf(accent.copy(alpha = 0.33f), Color.Transparent), center = Offset.Zero, radius = size.height), size = Size(size.width / 4f, size.height))
                    }
                }.padding(start = pad, end = pad, top = 76.dp, bottom = 4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (plat != null) {
                        Image(painterResource(plat.image), null, contentScale = ContentScale.Fit, modifier = Modifier.size(56.dp, 40.dp).clip(RoundedCornerShape(5.dp)))
                        Spacer(Modifier.width(12.dp))
                    }
                    Text(plat?.label ?: gen?.first ?: stringResource(R.string.explore), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
                }
                Text(
                    when {
                        plat != null -> stringResource(R.string.ex_sub_platform, plat.label)
                        gen != null -> stringResource(R.string.ex_sub_genre, gen.first.lowercase())
                        else -> stringResource(R.string.explore_sub)
                    },
                    color = NfGray2, fontSize = 14.sp, maxLines = 1, modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        item(key = "bar", span = full) {
            Column(Modifier.bleed(pad).fillMaxWidth().drawBehind {
                drawLine(Color(0xFF222222), Offset(0f, size.height - 1f), Offset(size.width, size.height - 1f), 2f)
            }.padding(start = pad, end = pad, top = 8.dp, bottom = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.border(1.dp, Color(0xFF444444), RoundedCornerShape(50)).clip(RoundedCornerShape(50))) {
                        listOf(stringResource(R.string.ex_all), stringResource(R.string.movies), stringResource(R.string.series)).forEachIndexed { i, l ->
                            FocusBox(onClick = { type = i; genre = "" }, shape = RoundedCornerShape(50), focusScale = 1.05f) { f ->
                                Text(
                                    l, color = if (type == i) Color.Black else Color(0xFFDDDDDD), fontSize = 13.sp, fontWeight = if (type == i) FontWeight.Bold else FontWeight.Normal,
                                    modifier = Modifier.background(if (type == i || f) Color.White else Color.Transparent).padding(horizontal = 14.dp, vertical = 6.dp),
                                )
                            }
                        }
                    }
                    Spacer(Modifier.width(10.dp))
                    FocusBox(onClick = { sort = (sort + 1) % 3 }, shape = RoundedCornerShape(4.dp), focusScale = 1.05f) { f ->
                        Text(
                            "$sortLabel  ▾", color = Color.White, fontSize = 13.sp,
                            modifier = Modifier.background(Color.Black).border(1.dp, if (f) Color.White else Color(0xFF555555), RoundedCornerShape(4.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    TitleFilter(field, query) { query = it }
                    Spacer(Modifier.weight(1f))
                    if (shown.isNotEmpty()) Text(stringResource(R.string.ex_count, shown.size), color = NfGray2, fontSize = 12.sp)
                }
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(top = 12.dp, bottom = 2.dp)) {
                    item { ExChip(stringResource(R.string.ex_all_genres), genre.isEmpty()) { genre = "" } }
                    items(genres, key = { it.first }) { (label, _) -> ExChip(label, genre == label) { genre = label } }
                }
                if (platforms.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(top = 6.dp, bottom = 2.dp)) {
                    // con una plataforma elegida, el primero la quita (en la web se vuelve con Atrás)
                    if (plat != null) item { ExChip(stringResource(R.string.ex_all_platforms), false) { platform = "" } }
                    items(platforms, key = { it.key }) { p -> ExChip(p.label, p.key == platform) { platform = if (p.key == platform) "" else p.key } }
                }
            }
        }
        if (shown.isEmpty()) item(key = "none", span = full) { Box(Modifier.fillMaxWidth().height(160.dp)) { Empty(stringResource(R.string.ex_none)) } }
        items(shown, key = { it.key }) { it ->
            val p = progress[it.key]
            PosterCard(it, pw, onClick = { state.push(Route.Detail(it)) }, progress = if (p != null && p.duration > 0) p.position.toFloat() / p.duration else 0f)
        }
    }
}

/** «Filtrar por título…»: el recuadro del web player; con el control, OK abre el teclado */
@Composable
private fun TitleFilter(field: com.latmpx.player.ui.components.TvField, value: String, onChange: (String) -> Unit) {
    val focused by field.interaction.collectIsFocusedAsState()
    val kb = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    TvTextFieldBox(field, Modifier.width(230.dp)) { fieldModifier ->
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = true, cursorBrush = SolidColor(Color.White),
            textStyle = TextStyle(color = Color.White, fontSize = 13.sp), interactionSource = field.interaction,
            keyboardOptions = tvKeyboard(KeyboardOptions(imeAction = ImeAction.Search)),
            keyboardActions = KeyboardActions(onSearch = { kb?.hide(); field.leave() }, onDone = { kb?.hide(); field.leave() }),
            modifier = fieldModifier,
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().background(Color.Black).border(1.dp, if (focused) Color.White else Color(0xFF555555), RoundedCornerShape(4.dp)).padding(horizontal = 10.dp, vertical = 7.dp)) {
                    if (value.isEmpty()) Text(stringResource(R.string.ex_filter_title), color = Color(0xFF8C8C8C), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    inner()
                }
            },
        )
    }
}

@Composable
private fun ExChip(text: String, on: Boolean, onClick: () -> Unit) {
    FocusBox(onClick = onClick, shape = RoundedCornerShape(50), focusScale = 1.08f) { f ->
        Text(
            text, color = if (on) Color.Black else Color.White, fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, maxLines = 1,
            modifier = Modifier.background(if (on) Color.White else if (f) Color(0x33FFFFFF) else Color(0x99141414))
                .border(1.dp, if (on || f) Color.White else Color(0x59FFFFFF), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 6.dp),
        )
    }
}

/** a todo el ancho de la pantalla dentro de la cuadrícula (el degradado y el divisor llegan a los bordes) */
private fun Modifier.bleed(pad: Dp): Modifier = layout { m, c ->
    val side = pad.roundToPx()
    val p = m.measure(c.copy(minWidth = c.minWidth + side * 2, maxWidth = c.maxWidth + side * 2))
    layout(c.maxWidth, p.height) { p.place(-side, 0) }
}
