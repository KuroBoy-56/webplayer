package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import com.latmpx.player.R

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.ItemPoster
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/*
 * Portada de Inicio / Películas / Series de la TV, igual que Roku y Vega OS: queda fija a pantalla completa detrás de
 * las filas. Con el foco en sus botones muestra los destacados (cambian cada 8 s); recorriendo las filas muestra el
 * título enfocado (fondo, nombre, año y sinopsis) en tamaño compacto.
 */

/** lo que muestra la portada: un título (con su fondo y sinopsis si ya se encontraron) o un nombre y un texto */
data class StageInfo(val item: Item?, val art: TvHero? = null, val title: String = "", val plot: String = "")

/** fondos ya buscados de los títulos enfocados (null = no tiene): al volver a enfocarlos salen al instante */
internal object FocusArt {
    val map = java.util.concurrent.ConcurrentHashMap<String, TvHero>()
    val none: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())
}

/** destacados de la sección (hasta 6 con fondo horizontal), como TvBillboard: se buscan una vez y quedan guardados */
@Composable
fun rememberHeroes(state: AppState, pool: List<Item>, cacheKey: String): Pair<List<TvHero>, Boolean> {
    val s = state.session ?: return emptyList<TvHero>() to true
    val key = "$cacheKey|${s.user}@${s.base}|${com.latmpx.player.Lang.current}"
    val heroes = remember(key) { mutableStateListOf<TvHero>().apply { addAll(HeroCache.map[key].orEmpty()) } }
    var done by remember(key) { mutableStateOf(heroes.isNotEmpty()) }
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
    return heroes to done
}

/**
 * Fondo y textos de la portada. h / w: alto y ancho de la pantalla; k = h / 1080 (las medidas son las de Roku y Vega en
 * 1920×1080). Los textos empiezan debajo del menú de arriba (21 % del alto; 13 % recorriendo las filas, con el menú oculto)
 * y nunca llegan a los botones (65 % del alto).
 */
@Composable
fun TvStageView(info: StageInfo, compact: Boolean, h: Dp, w: Dp, pad: Dp) {
    val k = h.value / 1080f
    val item = info.item
    val art = info.art?.takeIf { it.item.key == item?.key }
    val artUrl = art?.backdrop?.takeIf { it.isNotBlank() } ?: item?.backdrop.orEmpty()
    // sin fondo propio (plataforma, género, «Ver todo»): queda el último fondo, nunca negro
    var last by remember { mutableStateOf<TvHero?>(HeroCache.last) }
    val shown = when {
        artUrl.isNotBlank() -> art ?: TvHero(item!!, artUrl, "", item.plot, "")
        item == null -> last
        else -> null
    }
    LaunchedEffect(shown?.backdrop) { if (shown != null && item != null) { last = shown; HeroCache.last = shown } }
    Box(Modifier.fillMaxSize().background(NfBg)) {
        if (shown != null) {
            Crossfade(targetState = shown, animationSpec = tween(500), label = "portada") { hh -> HeroBackdrop(hh) }
        } else if (item != null) {
            // sin fondo: la carátula del mismo título agrandada, difuminada y oscurecida, y la carátula a la derecha
            ItemPoster(item, Modifier.fillMaxSize().blur(18.dp).alpha(0.45f))
        }
        // degradados como Roku: desde la izquierda (1500 de ancho, 92 %) y desde abajo (a partir de la fila de las filas)
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to NfBg.copy(alpha = 0.92f), 0.45f to NfBg.copy(alpha = 0.55f), 0.78f to Color.Transparent)))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0x80000000), 0.14f to Color.Transparent, 0.52f to Color.Transparent, 0.75f to NfBg.copy(alpha = 0.85f), 1f to NfBg)))
        if (item != null && artUrl.isBlank()) {
            val pw = if (compact) 260 * k else 427 * k
            ItemPoster(
                item,
                Modifier.offset(x = w - pad - pw.dp, y = (if (compact) 120 * k else 150 * k).dp).width(pw.dp).height((pw * 1.5f).dp).clip(RoundedCornerShape(8.dp)),
            )
        }
        StageText(info, art, compact, k, pad, w)
    }
}

@Composable
private fun StageText(info: StageInfo, art: TvHero?, compact: Boolean, k: Float, pad: Dp, w: Dp) {
    val item = info.item
    val title = item?.name ?: info.title
    val plot = (art?.plot?.takeIf { it.isNotBlank() } ?: item?.plot)?.ifBlank { null } ?: info.plot
    val shadow = Shadow(Color(0x99000000), blurRadius = 8f)
    Column(Modifier.padding(start = pad, top = ((if (compact) 140 else 230) * k).dp).width(w * (if (compact) 0.57f else 0.51f))) {
        if (item != null) {
            val kindLabel = stringResource(if (item.kind == Kind.SERIES) R.string.series_badge else if (item.kind == Kind.LIVE) R.string.live_badge else R.string.movie_badge)
            Text(
                buildAnnotatedString {
                    // la "N" de Netflix: la inicial de la marca en su color de acento
                    withStyle(SpanStyle(color = NfRed, fontSize = (44 * k).sp, fontWeight = FontWeight.Black)) {
                        append(com.latmpx.player.data.Tenant.initial(stringResource(R.string.app_name)))
                    }
                    append("  " + kindLabel.uppercase().toCharArray().joinToString(" "))
                },
                color = Color(0xFFB3B3B3), fontSize = (24 * k).sp, fontWeight = FontWeight.ExtraBold, maxLines = 1,
                modifier = Modifier.padding(bottom = (8 * k).dp),
            )
        }
        val ts = if (compact) 58 * k else 76 * k
        Text(
            title, maxLines = 2, overflow = TextOverflow.Ellipsis,
            style = TextStyle(color = Color.White, fontSize = ts.sp, lineHeight = (ts * 1.1f).sp, fontWeight = FontWeight.Black, shadow = shadow),
        )
        if (item != null) {
            val meta = listOfNotNull(item.year.take(4).ifBlank { null }, if (item.rating > 0) "★ " + String.format(java.util.Locale.US, "%.1f", item.rating) else null,
                art?.genre?.ifBlank { null }).joinToString("   ")
            if (meta.isNotBlank()) Text(meta, color = Color(0xFF46D369), fontSize = (28 * k).sp, fontWeight = FontWeight.Bold, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = (12 * k).dp))
        }
        if (plot.isNotBlank()) Text(
            plot, maxLines = if (compact) 2 else 3, overflow = TextOverflow.Ellipsis,
            style = TextStyle(color = Color.White, fontSize = (28 * k).sp, lineHeight = (38 * k).sp, shadow = shadow),
            modifier = Modifier.padding(top = (16 * k).dp),
        )
    }
}
