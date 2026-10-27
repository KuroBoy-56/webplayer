package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.zIndex
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Session
import com.latmpx.player.data.Tmdb
import com.latmpx.player.data.Xtream
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.ItemPoster
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

/** Un destacado listo para mostrar: siempre con imagen horizontal (backdrop), como el "hero" de api.php de la web. */
data class TvHero(val item: Item, val backdrop: String, val tmdbBackdrop: String, val plot: String, val genre: String)

/** destacados ya resueltos por sección (al volver de una ficha no se vuelven a pedir ni cambian) */
private object HeroCache {
    val map = java.util.concurrent.ConcurrentHashMap<String, List<TvHero>>()
    /** último destacado mostrado: queda de fondo mientras la sección nueva busca los suyos (nunca pantalla negra) */
    var last: TvHero? = null
}

/**
 * Igual que api.php?action=hero: de lo más reciente con carátula se eligen al azar 8 películas y 8 series,
 * se pide su ficha (get_vod_info / get_series_info) y solo quedan las que tienen fondo horizontal.
 * Si el servidor no trae fondo se usa el de TMDB (llave del panel con la de respaldo).
 */
private suspend fun resolveHero(s: Session, it: Item): TvHero? {
    val d = runCatching { if (it.kind == Kind.SERIES) Xtream.seriesDetails(s, it) else Xtream.movieDetails(s, it) }.getOrNull()
    val own = it.backdrop.ifBlank { d?.backdrop.orEmpty() }
    var plot = d?.plot?.ifBlank { null } ?: it.plot
    var tmdbBd = ""
    // fuera del español también se pide la ficha de TMDB: la sinopsis va en el idioma de la app
    if (own.isBlank() || plot.isBlank() || com.latmpx.player.Lang.current != "es") {
        val t = runCatching { Tmdb.getDetails(if (it.kind == Kind.SERIES) "tv" else "movie", it.name, it.year, d?.tmdbId.orEmpty()) }.getOrNull()
        tmdbBd = t?.backdrop.orEmpty()
        if (plot.isBlank()) plot = t?.overview.orEmpty()
        plot = Tmdb.localPlot(plot, t?.overview)
    }
    if (own.isBlank() && tmdbBd.isBlank()) return null
    val genre = d?.genre.orEmpty().split(',', '/').map { g -> g.trim() }.filter { g -> g.isNotEmpty() }.take(2).joinToString(", ")
    return TvHero(it, own.ifBlank { tmdbBd }, tmdbBd, plot, genre)
}

/** candidatos al azar entre lo más reciente con carátula (8 de cada tipo, mezclados) */
fun heroPool(lists: List<List<Item>>): List<Item> =
    lists.flatMap { l -> l.filter { it.poster.isNotBlank() }.sortedByDescending { it.added }.take(150).shuffled().take(8) }.shuffled()

/**
 * Cartelera de la TV igual que .nf-hero de la web: fondo horizontal a todo el ancho (56.25% del ancho, máx. 88% del alto)
 * por detrás del menú, degradado oscuro desde la izquierda, inicial de la marca + tipo, título grande, % para ti / año / HD / género,
 * sinopsis de tres líneas y los botones Reproducir / Más información. Cambia sola cada 8 s mientras el foco no está en ella.
 */
@Composable
fun TvBillboard(state: AppState, pool: List<Item>, cacheKey: String = state.tab.name, onFocusTop: () -> Unit = {}) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    val conf = LocalConfiguration.current
    val height = minOf(conf.screenWidthDp * 0.5625f, conf.screenHeightDp * 0.88f).dp
    val key = "$cacheKey|${s.user}@${s.base}|${com.latmpx.player.Lang.current}" // otra cuenta, otro servidor u otro idioma (resumen de TMDB): otros destacados
    val heroes = remember(key) { mutableStateListOf<TvHero>().apply { addAll(HeroCache.map[key].orEmpty()) } }
    var done by remember(key) { mutableStateOf(heroes.isNotEmpty()) }
    var index by remember(key) { mutableIntStateOf(0) }
    var holding by remember { mutableStateOf(false) }
    val play = remember { FocusRequester() }

    LaunchedEffect(key, pool.isNotEmpty()) {
        if (done || pool.isEmpty()) return@LaunchedEffect
        val found = ArrayList<TvHero>()
        for (chunk in pool.chunked(4)) {
            val got = coroutineScope { chunk.map { c -> async { resolveHero(s, c) } }.awaitAll() }.filterNotNull()
            got.forEach { h -> if (found.size < 6 && found.none { it.item.key == h.item.key }) { found += h; heroes += h } }
            if (found.size >= 6) break
        }
        if (found.isNotEmpty()) HeroCache.map[key] = found.toList()
        done = true
    }
    // el foco entra a la cartelera una sola vez por visita a la sección, cuando ya hay botones
    val onTop = com.latmpx.player.ui.LocalLayerOnTop.current
    LaunchedEffect(heroes.isNotEmpty(), done) {
        if (onTop && (heroes.isNotEmpty() || done) && state.billboardFocusedTab != state.tab) {
            state.billboardFocusedTab = state.tab
            delay(60)
            runCatching { play.requestFocus() }
        }
    }
    LaunchedEffect(heroes.size, holding) {
        while (!holding && heroes.size > 1) {
            delay(8000)
            index = (index + 1) % heroes.size
        }
    }

    Box(Modifier.fillMaxWidth().height(height).background(Color.Black)) {
        val hero = heroes.getOrNull(index.coerceIn(0, (heroes.size - 1).coerceAtLeast(0)))
        // sin destacados con fondo (todavía o nunca): la carátula del primero, sin estirarla, a la derecha
        val fallback = if (hero == null && done) pool.firstOrNull() else null
        val bg = hero ?: HeroCache.last.takeIf { fallback == null }
        if (hero != null) androidx.compose.runtime.SideEffect { HeroCache.last = hero }
        if (bg != null) {
            Crossfade(targetState = bg, animationSpec = tween(900), label = "fondo") { h -> HeroBackdrop(h) }
        } else if (fallback != null) {
            Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xFF3A0A0D), Color.Black), radius = 1600f)))
            ItemPoster(fallback, Modifier.align(Alignment.CenterEnd).padding(end = 90.dp, top = 70.dp, bottom = 60.dp).fillMaxHeight().aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp)))
        } else {
            Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xFF1C1C1C), Color.Black), radius = 1600f)))
        }
        // .nf-hero::before (77°: negro .75 → .35 al 38% → transparente al 70%) y ::after (difuminado inferior hacia el fondo)
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Color(0xC0000000), 0.38f to Color(0x59000000), 0.70f to Color.Transparent)))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0x99000000), 0.16f to Color.Transparent)))
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height((conf.screenWidthDp * 0.147f).coerceAtLeast(120f).dp)
                .background(Brush.verticalGradient(0f to Color.Transparent, 0.15f to Color(0x26141414), 0.45f to Color(0x8C141414), 1f to NfBg)),
        )

        val item = hero?.item ?: fallback
        if (item != null) {
            Column(
                Modifier.align(Alignment.BottomStart)
                    .padding(start = (conf.screenWidthDp * 0.04f).dp, bottom = height * 0.30f)
                    .width((conf.screenWidthDp * 0.40f).coerceAtLeast(320f).dp)
                    .onFocusChanged { holding = it.hasFocus; if (it.hasFocus) onFocusTop() },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // inicial de la marca (distribuidor o la app) en su color de acento
                    Text(com.latmpx.player.data.Tenant.initial(stringResource(R.string.app_name)), color = NfRed, fontSize = 26.sp, fontWeight = FontWeight.Black)
                    Text(
                        stringResource(if (item.kind == Kind.SERIES) R.string.series_badge else R.string.movie_badge), color = Color(0xFFDDDDDD), fontSize = 13.sp,
                        fontWeight = FontWeight.Bold, letterSpacing = 3.sp, modifier = Modifier.padding(start = 8.dp),
                    )
                }
                Text(
                    item.name,
                    style = TextStyle(
                        color = Color.White, fontSize = (conf.screenWidthDp * 0.042f).coerceIn(30f, 64f).sp, fontWeight = FontWeight.ExtraBold,
                        lineHeight = ((conf.screenWidthDp * 0.042f).coerceIn(30f, 64f) * 1.05f).sp, shadow = Shadow(Color(0x73000000), blurRadius = 8f),
                    ),
                    maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp, bottom = 12.dp),
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (item.rating > 0) Text(stringResource(R.string.match_pct, (item.rating * 10).toInt().coerceAtMost(99)), color = Color(0xFF46D369), fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    if (item.year.isNotBlank()) Text(item.year.take(4), color = Color(0xFFDDDDDD), fontSize = 15.sp)
                    Text(
                        "HD", color = Color(0xFFDDDDDD), fontSize = 12.sp,
                        modifier = Modifier.border(1.dp, Color(0x66FFFFFF), RoundedCornerShape(3.dp)).padding(horizontal = 6.dp),
                    )
                    hero?.genre?.takeIf { it.isNotBlank() }?.let { Text(it, color = Color(0xFFDDDDDD), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                val plot = hero?.plot ?: item.plot
                if (plot.isNotBlank()) Text(
                    plot, style = TextStyle(color = Color.White, fontSize = 16.sp, lineHeight = 22.sp, shadow = Shadow(Color(0x99000000), blurRadius = 4f)),
                    maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp),
                )
                Spacer(Modifier.height(20.dp))
                // los botones no se encogen al ancho del texto de arriba: siempre en una línea y del mismo alto
                Row(Modifier.wrapContentWidth(Alignment.Start, unbounded = true), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    NfButton(stringResource(R.string.play), Icons.Filled.PlayArrow, white = true, modifier = Modifier.focusRequester(play)) {
                        if (item.kind == Kind.MOVIE) Play.movie(ctx, item, item.ext) else state.push(Route.Detail(item))
                    }
                    NfButton(stringResource(R.string.more_info), Icons.Filled.Info, white = false) { state.push(Route.Detail(item)) }
                }
            }
        }
        // .nf-hero-dots
        if (heroes.size > 1) Row(
            Modifier.align(Alignment.BottomEnd).padding(end = (conf.screenWidthDp * 0.04f).dp, bottom = height * 0.30f),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            heroes.indices.forEach { i -> Box(Modifier.size(10.dp).clip(CircleShape).background(if (i == index) Color.White else Color(0x59FFFFFF))) }
        }
    }
}

/** fondo del destacado: recortado como background-position: center 20%; si el enlace no carga, el de TMDB */
@Composable
private fun HeroBackdrop(h: TvHero) {
    var url by remember(h.item.key) { mutableStateOf(h.backdrop) }
    var failed by remember(h.item.key) { mutableStateOf(false) }
    LaunchedEffect(h.item.key, failed) {
        if (!failed) return@LaunchedEffect
        val alt = h.tmdbBackdrop.takeIf { it.isNotBlank() && it != url }
            ?: runCatching { Tmdb.getDetails(if (h.item.kind == Kind.SERIES) "tv" else "movie", h.item.name, h.item.year)?.backdrop }.getOrNull().orEmpty()
        if (alt.isNotBlank() && alt != url) { url = alt; failed = false }
    }
    // fondo Full HD del panel (si es de TMDB) y, si no carga, el original; si tampoco, el de TMDB por el título
    com.latmpx.player.ui.components.ChainImage(
        remember(url) { com.latmpx.player.data.PanelImg.backdropSources(url) }, Modifier.fillMaxSize(),
        alignment = BiasAlignment(0f, -0.6f), onAllFailed = { failed = true },
    )
}

/**
 * .nf-btn-white / .nf-btn-gray de la web a escala de TV: alto fijo, icono y texto centrados en una sola línea
 * (nunca se parten ni se aplastan) y esquinas redondeadas. Con el foco el botón crece un poco y aparece un aro
 * blanco por fuera (el blanco sigue blanco y el gris se aclara), así siempre se ve cuál está enfocado.
 */
@Composable
fun NfButton(text: String, icon: ImageVector?, white: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    // mismo botón que el resto de las apps: el "blanco" de antes es el principal con el color del distribuidor
    com.latmpx.player.ui.components.AppButton(text, modifier, primary = white, icon = icon, minHeight = 46.dp, fontSize = 18.sp, onClick = onClick)
}
