package com.latmpx.player.ui.components
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.latmpx.player.data.Item
import com.latmpx.player.data.Platform
import com.latmpx.player.ui.theme.NfFocus
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfCard
import com.latmpx.player.ui.theme.NfRed

/* Piezas del diseño Netflix del reproductor web (assets/nf/app.css) a escala de televisor. */

/** --nf-pad: 4% del ancho */
@Composable
fun tvPad(): Dp = (LocalConfiguration.current.screenWidthDp * 0.04f).dp

/** --card-w: clamp(118px, 13.2vw, 230px) */
@Composable
fun tvCardWidth(): Dp = (LocalConfiguration.current.screenWidthDp * 0.132f).coerceIn(118f, 230f).dp

/** sube el elemento [d] sobre el anterior (como margin-top negativo) sin dejar hueco debajo */
fun Modifier.pullUp(d: Dp): Modifier = layout { m, c ->
    val p = m.measure(c)
    val px = d.roundToPx()
    layout(p.width, (p.height - px).coerceAtLeast(0)) { p.place(0, -px) }
}

/**
 * Elemento enfocable con el control: crece, se pone por encima de sus vecinos, lleva sombra y borde de foco (blanco o el acento del distribuidor)
 * (como .nf-card:focus-visible de la web y Netflix para TV).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TvFocusable(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(4.dp),
    scale: Float = 1.1f,
    border: Boolean = true,
    onFocus: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    val src = remember { MutableInteractionSource() }
    val focused by src.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocus?.invoke() }
    val sc by animateFloatAsState(if (focused) scale else 1f, label = "tvfocus")
    Box(
        modifier
            .zIndex(if (focused) 2f else 0f)
            .graphicsLayer { scaleX = sc; scaleY = sc }
            .then(if (focused) Modifier.shadow(18.dp, shape) else Modifier)
            .clip(shape)
            .then(if (focused && border) Modifier.border(3.dp, NfFocus, shape) else Modifier)
            .combinedClickable(interactionSource = src, indication = null, onLongClick = onLongClick, onClick = onClick),
    ) { content(focused) }
}

/** .nf-card: carátula 2:3; con el foco muestra el nombre abajo y la nota arriba; barra roja de avance opcional */
@Composable
fun TvCard(item: Item, width: Dp, progress: Float = 0f, onFocus: (() -> Unit)? = null, onClick: () -> Unit) {
    TvFocusable(onClick = onClick, onFocus = onFocus, modifier = Modifier.width(width).aspectRatio(2f / 3f)) { f ->
        ItemPoster(item, Modifier.fillMaxSize().background(NfCard))
        if (f) {
            Text(
                item.name, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, lineHeight = 16.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000))))
                    .padding(start = 8.dp, end = 8.dp, top = 26.dp, bottom = if (progress > 0f) 14.dp else 8.dp),
            )
            if (item.rating > 0) Text(
                "★ " + String.format(java.util.Locale.US, "%.1f", item.rating), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).background(Color(0xBF000000), RoundedCornerShape(3.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        if (progress > 0f) Box(
            Modifier.align(Alignment.BottomCenter).padding(6.dp).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x4DFFFFFF)),
        ) { Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).fillMaxHeight().background(NfRed)) }
    }
}

/** Top 10 numerado: número grande con contorno gris (#595959) detrás de la carátula; el 10 lleva más espacio */
@Composable
fun TvTop10Card(rank: Int, item: Item, width: Dp, onClick: () -> Unit) {
    val ten = rank >= 10
    val numW = if (ten) width * 1.2f else width * 0.55f
    val fs = (width.value * if (ten) 0.9f else 1.05f).sp
    Box(Modifier.width(numW + width).aspectRatio(((numW + width) / (width * 1.5f)).coerceAtLeast(0.1f))) {
        val base = TextStyle(fontSize = fs, fontWeight = FontWeight.Black, letterSpacing = if (ten) (-2).sp else (-6).sp, lineHeight = fs)
        Box(Modifier.align(Alignment.BottomStart).offset(y = (width.value * 0.13f).dp)) {
            Text("$rank", style = base.copy(color = NfBg), maxLines = 1, softWrap = false)
            Text("$rank", style = base.copy(color = Color(0xFF595959), drawStyle = Stroke(width = 6f)), maxLines = 1, softWrap = false)
        }
        Box(Modifier.align(Alignment.BottomEnd)) { TvCard(item, width, onClick = onClick) }
    }
}

/** .nf-plat: mosaico 16:9 de la plataforma con borde tenue; con el foco crece y el borde se vuelve blanco */
@Composable
fun TvPlatformTile(p: Platform, width: Dp, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    TvFocusable(onClick = onClick, shape = shape, scale = 1.08f, border = false, modifier = Modifier.width(width).aspectRatio(16f / 9f)) { f ->
        Box(
            Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF1D1D1D), Color(0xFF0D0D0D))))
                .border(2.dp, if (f) NfFocus else Color(0x1FFFFFFF), shape),
            contentAlignment = Alignment.Center,
        ) {
            if (p.image != 0) Image(painterResource(p.image), p.label, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().clip(shape))
            else Text(p.label, color = Color(p.color), fontWeight = FontWeight.Black, fontSize = 18.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(6.dp))
            if (p.image != 0 && f) Box(Modifier.fillMaxSize().border(2.dp, NfFocus, shape))
        }
    }
}

/** .nf-row: título y fila deslizable; al final una tarjeta "Ver todo" si hay más */
@Composable
fun <T> TvRow(title: String, items: List<T>, onViewAll: (() -> Unit)? = null, onFocused: (() -> Unit)? = null, content: @Composable (Int, T) -> Unit) {
    if (items.isEmpty()) return
    val pad = tvPad()
    Column(Modifier.padding(top = 22.dp).onFocusChanged { if (it.hasFocus) onFocused?.invoke() }) {
        Text(title, color = Color(0xFFE5E5E5), fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = pad, end = pad))
        LazyRow(contentPadding = PaddingValues(start = pad, end = pad, top = 12.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            itemsIndexed(items) { i, it -> content(i, it) }
            if (onViewAll != null) item {
                TvFocusable(onClick = onViewAll, scale = 1.06f, modifier = Modifier.width(tvCardWidth()).aspectRatio(2f / 3f)) { f ->
                    Column(
                        Modifier.fillMaxSize().background(if (f) Color(0xFF333333) else Color(0xFF1C1C1C)),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowForward, null, tint = if (f) Color.Black else Color.White,
                            modifier = Modifier.size(44.dp).background(if (f) Color.White else Color(0x33FFFFFF), CircleShape).padding(10.dp),
                        )
                        Text(stringResource(R.string.see_all), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
                    }
                }
            }
        }
    }
}

/** .nf-chip: píldora de género; con el foco se vuelve blanca */
@Composable
fun TvChip(text: String, selected: Boolean = false, onFocus: (() -> Unit)? = null, onClick: () -> Unit) {
    TvFocusable(onClick = onClick, onFocus = onFocus, shape = RoundedCornerShape(50), scale = 1.06f, border = false) { f ->
        val on = f || selected
        Text(
            text, color = if (on) Color.Black else Color.White, fontSize = 14.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, maxLines = 1,
            modifier = Modifier.background(if (on) Color.White else Color(0x99141414), RoundedCornerShape(50))
                .border(1.dp, if (on) Color.White else Color(0x59FFFFFF), RoundedCornerShape(50))
                .padding(horizontal = 16.dp, vertical = 7.dp),
        )
    }
}

/** Fila con chips de géneros (desliza con el control) */
@Composable
fun TvChipRow(chips: List<String>, modifier: Modifier = Modifier, selected: String? = null, onClick: (Int) -> Unit) {
    if (chips.isEmpty()) return
    val pad = tvPad()
    LazyRow(modifier, contentPadding = PaddingValues(horizontal = pad, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        itemsIndexed(chips) { i, c -> TvChip(c, c == selected) { onClick(i) } }
    }
}
