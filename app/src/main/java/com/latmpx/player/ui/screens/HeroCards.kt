package com.latmpx.player.ui.screens

import androidx.compose.ui.res.stringResource
import com.latmpx.player.R
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
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
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Posters
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.ItemPoster
import com.latmpx.player.ui.theme.NfBg
import kotlinx.coroutines.delay
import kotlin.math.absoluteValue

/**
 * Destacados como la app de Netflix para celular: tarjetas grandes con la carátula, el título,
 * etiquetas y los botones Reproducir / Mi lista. El fondo toma los colores de la carátula (difuminada).
 */
@Composable
fun HeroCards(state: AppState, items: List<Item>, topPad: Dp = 0.dp) {
    if (items.isEmpty()) return
    // tableta: una sola tarjeta ancha y apaisada como la app de Netflix en tableta
    if (com.latmpx.player.ui.components.LocalIsTablet.current) { TabletHero(state, items, topPad); return }
    val pager = rememberPagerState(pageCount = { items.size })
    LaunchedEffect(items) {
        while (true) {
            delay(6500)
            if (!pager.isScrollInProgress && items.size > 1) pager.animateScrollToPage((pager.currentPage + 1) % items.size)
        }
    }
    val cur = items[pager.currentPage.coerceIn(0, items.lastIndex)]
    // la tarjeta nunca más alta que ~2/3 de la pantalla (tableta, sobre todo girada): angosta y centrada, con las
    // vecinas asomando a los lados; en el celular queda como siempre (30 dp a cada lado)
    val conf = androidx.compose.ui.platform.LocalConfiguration.current
    // girada: tarjeta cuadrada para que «Reproducir» y «Mi lista» quepan enteros y no la tape la barra de abajo
    val aspect = if (conf.screenWidthDp > conf.screenHeightDp) 1f else 0.70f
    val cardW = minOf(conf.screenWidthDp - 60f, maxOf(conf.screenHeightDp * 0.66f * aspect, 360f))
    val sidePadCard = ((conf.screenWidthDp - cardW) / 2f).coerceAtLeast(30f).dp
    Box(Modifier.fillMaxWidth()) {
        // fondo: la carátula actual muy difuminada (Android 12+) o oscurecida
        Box(Modifier.matchParentSize()) {
            com.latmpx.player.ui.components.ItemPoster(
                cur,
                Modifier.fillMaxSize().then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(70.dp) else Modifier.graphicsLayer { alpha = 0.45f }),
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x99000000), Color(0x66141414), NfBg))))
        }
        Column(Modifier.fillMaxWidth().padding(top = topPad)) {
            HorizontalPager(
                state = pager, contentPadding = PaddingValues(horizontal = sidePadCard), pageSpacing = 14.dp,
                modifier = Modifier.fillMaxWidth(),
            ) { page ->
                val it = items[page]
                val off = ((pager.currentPage - page) + pager.currentPageOffsetFraction).absoluteValue.coerceIn(0f, 1f)
                HeroCard(state, it, aspect, Modifier.graphicsLayer {
                    val sc = lerp(1f, 0.9f, off); scaleX = sc; scaleY = sc; alpha = lerp(1f, 0.6f, off)
                })
            }
            if (items.size > 1) Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
                repeat(items.size) { i ->
                    Box(Modifier.size(if (i == pager.currentPage) 18.dp else 6.dp, 6.dp).clip(CircleShape).background(if (i == pager.currentPage) Color.White else Color(0x55FFFFFF)))
                }
            }
        }
    }
}

@Composable
private fun HeroCard(state: AppState, item: Item, aspect: Float, modifier: Modifier) {
    val ctx = LocalContext.current
    var fav by remember(item.key, Cloud.rev) { mutableStateOf(Cloud.isFav(item.key)) }
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier.fillMaxWidth().aspectRatio(aspect).shadow(18.dp, shape).clip(shape).border(1.dp, Color(0x2EFFFFFF), shape),
    ) {
        FocusBox(onClick = { state.push(Route.Detail(item)) }, modifier = Modifier.fillMaxSize(), shape = shape, focusScale = 1f) {
            ItemPoster(item, Modifier.fillMaxSize())
        }
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(260.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xB3000000), Color(0xF2000000)))))
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                item.name, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 28.sp,
            )
            val tags = heroTags(state, item)
            if (tags.isNotEmpty()) Text(tags, color = Color(0xFFE5E5E5), fontSize = 13.sp, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CardButton(stringResource(R.string.play), Icons.Filled.PlayArrow, true, Modifier.weight(1f)) {
                    if (item.kind == Kind.MOVIE) Play.movie(ctx, item, item.ext) else state.push(Route.Detail(item))
                }
                CardButton(stringResource(if (fav) R.string.in_my_list else R.string.my_list), if (fav) Icons.Filled.Check else Icons.Filled.Add, false, Modifier.weight(1f)) {
                    fav = Cloud.toggleFav(item)
                }
            }
        }
    }
}

/** "2024 • Acción • ★ 7.8" con el año, la categoría limpia y la nota */
fun heroTags(state: AppState, item: Item): String {
    val cats = if (item.kind == Kind.SERIES) state.seriesCats else state.movieCats
    val cat = cats.firstOrNull { it.id == item.categoryId }?.name.orEmpty()
        .replace(Regex("^\\s*[A-Z]{2,4}\\s*[-|:]\\s*"), "").replace(Regex("(?i)\\b(peliculas|películas|series|vod)\\b"), "").replace(Regex("[|\\-]+"), " ").trim()
    return listOfNotNull(
        item.year.takeIf { it.isNotBlank() }?.take(4),
        cat.takeIf { it.isNotBlank() && it.length <= 22 }?.replaceFirstChar { it.uppercase() },
        item.rating.takeIf { it > 0 }?.let { "★ " + String.format(java.util.Locale.US, "%.1f", it) },
    ).joinToString("  •  ")
}

/** «Reproducir» / «Mi lista» en cápsula como Netflix, con los colores del tema (dueño o distribuidor) */
@Composable
private fun CardButton(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, primary: Boolean, modifier: Modifier, onClick: () -> Unit) {
    com.latmpx.player.ui.components.AppButton(text, modifier, primary = primary, icon = icon, minHeight = 46.dp, fontSize = 16.sp, shape = CircleShape, onClick = onClick)
}

/**
 * Tableta (como Netflix en el iPad / tableta Android): una tarjeta ancha y apaisada con el fondo horizontal del título,
 * y abajo a la izquierda el título, sus datos, la sinopsis y «Reproducir» / «Mi lista» en cápsula. Pasa sola cada 6,5 s
 * o con el dedo; nunca más alta que la mitad de la pantalla (vertical) o ~60 % (girada).
 */
@Composable
private fun TabletHero(state: AppState, items: List<Item>, topPad: Dp) {
    // primero los que tienen fondo horizontal (la carátula vertical recortada se ve peor en una tarjeta ancha)
    val list = remember(items) { items.sortedByDescending { it.backdrop.isNotEmpty() } }
    val pager = rememberPagerState(pageCount = { list.size })
    LaunchedEffect(list) {
        while (true) {
            delay(6500)
            if (!pager.isScrollInProgress && list.size > 1) pager.animateScrollToPage((pager.currentPage + 1) % list.size)
        }
    }
    val conf = androidx.compose.ui.platform.LocalConfiguration.current
    val land = conf.screenWidthDp > conf.screenHeightDp
    val side = 24f
    val cardW = conf.screenWidthDp - side * 2
    val h = minOf(cardW / (if (land) 2.4f else 1.4f), conf.screenHeightDp * (if (land) 0.48f else 0.5f))
    Column(Modifier.fillMaxWidth().padding(top = topPad)) {
        HorizontalPager(state = pager, contentPadding = PaddingValues(horizontal = side.dp), pageSpacing = 16.dp, modifier = Modifier.fillMaxWidth()) { page ->
            TabletHeroCard(state, list[page], if (land) 0.5f else 0.75f, Modifier.fillMaxWidth().height(h.dp))
        }
        if (list.size > 1) Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
            repeat(list.size) { i ->
                Box(Modifier.size(if (i == pager.currentPage) 18.dp else 6.dp, 6.dp).clip(CircleShape).background(if (i == pager.currentPage) Color.White else Color(0x55FFFFFF)))
            }
        }
    }
}

@Composable
private fun TabletHeroCard(state: AppState, item: Item, textWidth: Float, modifier: Modifier) {
    val ctx = LocalContext.current
    var fav by remember(item.key, Cloud.rev) { mutableStateOf(Cloud.isFav(item.key)) }
    val shape = RoundedCornerShape(16.dp)
    Box(modifier.shadow(18.dp, shape).clip(shape).border(1.dp, Color(0x2EFFFFFF), shape)) {
        FocusBox(onClick = { state.push(Route.Detail(item)) }, modifier = Modifier.fillMaxSize(), shape = shape, focusScale = 1f) {
            if (item.backdrop.isNotEmpty()) com.latmpx.player.ui.components.ChainImage(remember(item.backdrop) { com.latmpx.player.data.PanelImg.backdropSources(item.backdrop) }, Modifier.fillMaxSize())
            else ItemPoster(item, Modifier.fillMaxSize())
        }
        // oscuro a la izquierda y abajo: los textos se leen sobre cualquier imagen
        Box(Modifier.matchParentSize().background(Brush.horizontalGradient(0f to Color(0xD9000000), 0.55f to Color(0x66000000), 0.85f to Color.Transparent)))
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color(0xCC000000))))
        // los textos ocupan la parte izquierda; los botones, lo que necesiten
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 26.dp, end = 26.dp, bottom = 24.dp)) {
            val tw = Modifier.fillMaxWidth(textWidth)
            Text(item.name, color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 36.sp, modifier = tw)
            val tags = heroTags(state, item)
            if (tags.isNotEmpty()) Text(tags, color = Color(0xFFE5E5E5), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = tw.padding(top = 8.dp))
            if (item.plot.isNotBlank()) Text(item.plot, color = Color(0xFFDDDDDD), fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, lineHeight = 19.sp, modifier = tw.padding(top = 8.dp))
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CardButton(stringResource(R.string.play), Icons.Filled.PlayArrow, true, Modifier.width(165.dp)) {
                    if (item.kind == Kind.MOVIE) Play.movie(ctx, item, item.ext) else state.push(Route.Detail(item))
                }
                CardButton(stringResource(if (fav) R.string.in_my_list else R.string.my_list), if (fav) Icons.Filled.Check else Icons.Filled.Add, false, Modifier.width(165.dp)) {
                    fav = Cloud.toggleFav(item)
                }
            }
        }
    }
}
