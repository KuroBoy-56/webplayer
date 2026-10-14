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
    val pager = rememberPagerState(pageCount = { items.size })
    LaunchedEffect(items) {
        while (true) {
            delay(6500)
            if (!pager.isScrollInProgress && items.size > 1) pager.animateScrollToPage((pager.currentPage + 1) % items.size)
        }
    }
    val cur = items[pager.currentPage.coerceIn(0, items.lastIndex)]
    Box(Modifier.fillMaxWidth()) {
        // fondo: la carátula actual muy difuminada (Android 12+) o oscurecida
        Box(Modifier.matchParentSize()) {
            val bg = cur.poster.ifBlank { Posters.cached(cur).orEmpty() }
            if (bg.isNotBlank()) AsyncImage(
                model = bg, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(70.dp) else Modifier.graphicsLayer { alpha = 0.45f }),
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x99000000), Color(0x66141414), NfBg))))
        }
        Column(Modifier.fillMaxWidth().padding(top = topPad)) {
            HorizontalPager(
                state = pager, contentPadding = PaddingValues(horizontal = 30.dp), pageSpacing = 14.dp,
                modifier = Modifier.fillMaxWidth(),
            ) { page ->
                val it = items[page]
                val off = ((pager.currentPage - page) + pager.currentPageOffsetFraction).absoluteValue.coerceIn(0f, 1f)
                HeroCard(state, it, Modifier.graphicsLayer {
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
private fun HeroCard(state: AppState, item: Item, modifier: Modifier) {
    val ctx = LocalContext.current
    var fav by remember(item.key, Cloud.rev) { mutableStateOf(Cloud.isFav(item.key)) }
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier.fillMaxWidth().aspectRatio(0.70f).shadow(18.dp, shape).clip(shape).border(1.dp, Color(0x2EFFFFFF), shape),
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

@Composable
private fun CardButton(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, primary: Boolean, modifier: Modifier, onClick: () -> Unit) {
    com.latmpx.player.ui.components.AppButton(text, modifier, primary = primary, icon = icon, minHeight = 44.dp, fontSize = 15.sp, onClick = onClick)
}
