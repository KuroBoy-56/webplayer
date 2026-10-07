package com.latmpx.player.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.R
import com.latmpx.player.data.Item
import com.latmpx.player.data.Posters
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.latmpx.player.data.Platform
import com.latmpx.player.ui.theme.NfCard
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/** Carátula vertical con el nombre de respaldo si la imagen no carga. */
@Composable
fun Poster(url: String, title: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    Box(modifier.background(NfCard), contentAlignment = Alignment.Center) {
        Text(title, color = NfGray2, fontSize = 12.sp, textAlign = TextAlign.Center, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(6.dp))
        if (url.isNotBlank()) AsyncImage(model = url, contentDescription = title, contentScale = contentScale, modifier = Modifier.fillMaxSize())
    }
}

/**
 * Carátula de una película o serie que nunca queda vacía: si el servidor no trae imagen
 * o el enlace falla, se busca en TMDB (llave del panel). Mientras tanto se ve el título.
 */
@Composable
fun ItemPoster(item: Item, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    var url by remember(item.key, item.poster) { mutableStateOf(item.poster.ifBlank { Posters.cached(item).orEmpty() }) }
    var tried by remember(item.key) { mutableStateOf(false) }
    LaunchedEffect(item.key, url) {
        if (url.isBlank() && !tried && item.kind != com.latmpx.player.data.Kind.LIVE) { tried = true; url = Posters.resolve(item) }
    }
    Box(modifier.background(Brush.verticalGradient(listOf(Color(0xFF2B2B2B), Color(0xFF1A1A1A)))), contentAlignment = Alignment.Center) {
        Text(item.name, color = NfGray2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(8.dp))
        if (url.isNotBlank()) AsyncImage(
            model = url, contentDescription = item.name, contentScale = contentScale, modifier = Modifier.fillMaxSize(),
            onError = { if (!tried) url = "" },
        )
    }
}

@Composable
fun PosterCard(item: Item, width: Dp, onClick: () -> Unit, progress: Float = 0f, onFocus: (() -> Unit)? = null) {
    Column(Modifier.width(width)) {
        FocusBox(onClick = onClick, onFocus = onFocus, modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f)) {
            ItemPoster(item, Modifier.fillMaxSize())
            if (item.rating > 0) {
                Text(
                    "★ " + String.format(java.util.Locale.US, "%.1f", item.rating), color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).background(Color(0xAA000000), RoundedCornerShape(3.dp)).padding(horizontal = 4.dp, vertical = 1.dp),
                )
            }
            if (progress > 0f) {
                LinearProgressIndicator(
                    progress = { progress.coerceIn(0f, 1f) }, color = NfRed, trackColor = Color(0x66FFFFFF),
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp),
                )
            }
        }
    }
}

/** Fila horizontal con título, como las de Netflix. */
@Composable
fun <T> ShelfRow(title: String, items: List<T>, pad: Dp, onViewAll: (() -> Unit)? = null, content: @Composable (Int, T) -> Unit) {
    if (items.isEmpty()) return
    Column(Modifier.padding(top = 18.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = pad, end = pad, bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.Bottom) {
            Text(title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            if (onViewAll != null) {
                Text("Ver todos", color = Color.LightGray, fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, modifier = Modifier.clickable { onViewAll() }.padding(start = 16.dp, top = 4.dp, bottom = 4.dp))
            }
        }
        LazyRow(contentPadding = PaddingValues(horizontal = pad, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            itemsIndexed(items) { i, it -> content(i, it) }
            if (onViewAll != null) {
                item {
                    Box(Modifier.width(100.dp).fillMaxHeight().clickable { onViewAll() }.padding(start = 16.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                        Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                            Icon(androidx.compose.material.icons.Icons.Filled.ArrowForward, null, tint = Color.White, modifier = Modifier.size(32.dp).background(Color(0x33FFFFFF), androidx.compose.foundation.shape.CircleShape).padding(8.dp))
                            Spacer(Modifier.height(8.dp))
                            Text("Ver todos", color = Color.White, fontSize = 14.sp)
                        }
                    }
                }
            }
        }
    }
}

/** Top 10: número grande con contorno detrás de la carátula. El 10 tiene más espacio para que el 0 no quede tapado. */
@Composable
fun Top10Card(rank: Int, item: Item, posterWidth: Dp, onClick: () -> Unit) {
    val numW = if (rank >= 10) posterWidth * 0.95f else posterWidth * 0.55f
    Box(Modifier.width(numW + posterWidth * 0.82f).aspectRatio(((numW + posterWidth * 0.82f) / (posterWidth * 1.23f)).coerceAtLeast(0.1f))) {
        Text(
            "$rank",
            style = TextStyle(
                fontSize = (posterWidth.value * 1.05f).sp, fontWeight = FontWeight.Black, color = Color(0xFF141414),
                shadow = Shadow(Color(0xFF8C8C8C), blurRadius = 2f), letterSpacing = (-6).sp,
            ),
            maxLines = 1, softWrap = false,
            modifier = Modifier.align(Alignment.BottomStart).offset(y = (posterWidth.value * 0.16f).dp),
        )
        FocusBox(onClick = onClick, modifier = Modifier.align(Alignment.CenterEnd).width(posterWidth * 0.82f).aspectRatio(2f / 3f)) {
            ItemPoster(item, Modifier.fillMaxSize())
        }
    }
}

@Composable
fun PlatformCard(p: Platform, width: Dp, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = Modifier.width(width).aspectRatio(16f / 9f), shape = RoundedCornerShape(10.dp)) {
        Box(
            Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(p.color), Color(0xFF101010)))),
            contentAlignment = Alignment.Center,
        ) {
            if (p.image != 0) Image(painterResource(p.image), p.label, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Text(p.label, color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp)
        }
    }
}

@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    FocusBox(onClick = onClick, shape = RoundedCornerShape(50), focusScale = 1.05f) {
        Text(
            text, color = if (selected) Color.Black else Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
            modifier = Modifier.background(if (selected) Color.White else Color(0x33FFFFFF), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 7.dp),
        )
    }
}

@Composable
fun LogoHeader(modifier: Modifier = Modifier, height: Dp = 34.dp) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.logo), "LatMpx", modifier = Modifier.height(height).clip(RoundedCornerShape(4.dp)))
    }
}
