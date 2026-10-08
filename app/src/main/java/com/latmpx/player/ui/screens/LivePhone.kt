package com.latmpx.player.ui.screens

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.provider.Settings
import android.view.OrientationEventListener
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.latmpx.player.Device
import com.latmpx.player.player.LivePreview
import coil3.compose.AsyncImage
import com.latmpx.player.R
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.EpgEntry
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.PanelEpg
import com.latmpx.player.data.Store
import com.latmpx.player.data.Xtream
import com.latmpx.player.player.Play
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Locale

/* colores de tvguide.php (web) */
private val TvCol = Color(0xFF1A1A1A)
private val TvLogoBg = Color(0xFF0D0D0D)
private val TvActive = Color(0xFF333333)
private val TvLine = Color(0xFF262626)
private val TvEmpty = Color(0xFF888888)

/**
 * TV en vivo para celular, igual que tvguide.php de la web en pantallas pequeñas:
 * arriba (fijo) el reproductor, el canal elegido con su favorito y la guía de programas;
 * debajo el selector de categorías, el buscador y la lista de canales con lo que se emite ahora.
 * Al tocar un canal se reproduce en la miniatura de arriba; la pantalla completa se abre solo con su botón
 * o al girar el teléfono (atrás o volver a vertical regresa a la miniatura).
 */
@Composable
fun PhoneLive(state: AppState, all: List<Item>, cats: List<Pair<String, String>>) {
    val s = state.session ?: return
    val ctx = LocalContext.current
    var cat by rememberSaveable { mutableStateOf(if (Cloud.favList(Kind.LIVE).isNotEmpty()) FAVS else ALL) }
    var query by rememberSaveable { mutableStateOf("") }
    var selId by rememberSaveable { mutableIntStateOf(Store.lastChannel()) }
    var catOpen by remember { mutableStateOf(false) }
    var favTick by remember { mutableIntStateOf(0) }
    // la barra de progreso avanza sola
    val now by produceState(System.currentTimeMillis()) {
        while (true) { delay(30_000); value = System.currentTimeMillis() }
    }

    val inCat = remember(all, cat, favTick, Cloud.rev) {
        when (cat) {
            ALL -> all
            FAVS -> all.filter { Cloud.isFav(it.key) }
            else -> all.filter { it.categoryId == cat }
        }
    }
    val shown = remember(inCat, query) {
        val q = query.trim()
        if (q.isEmpty()) inCat else inCat.filter { it.name.contains(q, ignoreCase = true) }
    }
    val sel = remember(all, selId) { all.firstOrNull { it.id == selId } }

    /* ---------- reproductor en la miniatura ---------- */
    // active: el usuario eligió un canal (o tocó reproducir); full: pantalla completa
    var active by rememberSaveable { mutableStateOf(false) }
    var full by rememberSaveable { mutableStateOf(false) }
    var byRotation by remember { mutableStateOf(false) }
    // tras salir de pantalla completa con el teléfono aún horizontal, no se vuelve a entrar hasta ponerlo vertical
    var armed by remember { mutableStateOf(true) }
    val preview = remember { LivePreview(ctx) }
    var resumeTick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        resumeTick++
        onPauseOrDispose { preview.release() } // segundo plano: se suelta la conexión
    }
    DisposableEffect(Unit) { onDispose { preview.release() } }
    LaunchedEffect(sel?.id, active, resumeTick) {
        val ch = sel
        if (active && ch != null) preview.play(s, ch)
    }

    val activity = remember(ctx) { ctx.findActivity() }
    val tablet = remember(ctx) { Device.isTablet(ctx) }
    val baseOrientation = if (tablet) ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    LaunchedEffect(full) {
        state.immersive = full
        activity?.let { a ->
            a.requestedOrientation = if (full) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else baseOrientation
            systemBars(a, show = !full)
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            state.immersive = false
            activity?.let { a -> a.requestedOrientation = baseOrientation; systemBars(a, show = true) }
        }
    }
    val exitFull: () -> Unit = { full = false; byRotation = false; armed = false }
    BackHandler(enabled = full) { exitFull() }
    // girar el teléfono con un canal en reproducción abre la pantalla completa; volver a vertical la cierra
    val hasChannel by rememberUpdatedState(sel != null)
    if (!tablet) DisposableEffect(Unit) {
        val listener = object : OrientationEventListener(ctx) {
            override fun onOrientationChanged(deg: Int) {
                if (deg == ORIENTATION_UNKNOWN) return
                val portrait = deg <= 25 || deg >= 335
                val landscape = deg in 65..115 || deg in 245..295
                if (portrait) {
                    armed = true
                    if (full && byRotation) { full = false; byRotation = false }
                } else if (landscape && armed && !full && active && hasChannel) {
                    val autoRotate = runCatching { Settings.System.getInt(ctx.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0) == 1 }.getOrDefault(true)
                    if (autoRotate) { full = true; byRotation = true }
                }
            }
        }
        if (listener.canDetectOrientation()) listener.enable()
        onDispose { listener.disable() }
    }

    val select: (Item) -> Unit = { ch ->
        selId = ch.id
        Store.setLastChannel(ch.id)
        active = true
    }
    val openFull: () -> Unit = {
        val ch = sel
        if (ch != null && Store.externalPlayer) {
            // reproductor externo elegido en Cuenta: se le pasa el canal
            preview.release()
            active = false
            val i = shown.indexOfFirst { it.id == ch.id }
            if (i >= 0) Play.live(ctx, shown, i) else Play.live(ctx, listOf(ch), 0)
        } else if (ch != null) {
            active = true
            full = true
            byRotation = false
        }
    }
    val toggleFav: (Item) -> Unit = { ch -> Cloud.toggleFav(ch.copy(kind = Kind.LIVE)); favTick++ }

    // guía del canal elegido: la del panel y, si no tiene, la del servidor IPTV (como la web)
    val guide by produceState<List<EpgEntry>?>(null, sel?.id) {
        val ch = sel
        if (ch == null) { value = emptyList(); return@produceState }
        value = PanelEpg.cached(ch.id)
        var g = PanelEpg.guide(ch, shown.take(400))
        if (g.isEmpty()) g = runCatching { Xtream.shortEpg(s, ch.id, 12) }.getOrDefault(emptyList())
        value = g.take(15)
    }
    val nowProg = guide?.firstOrNull { it.start <= now && it.end > now }
    val epgMax = (LocalConfiguration.current.screenHeightDp * 0.24f).dp
    val listState = rememberLazyListState()

    Column(Modifier.fillMaxSize().background(if (full) Color.Black else NfBg)) {
        /* ---------- reproductor (miniatura 16:9 o pantalla completa, mismo reproductor) ---------- */
        PhonePlayerBox(
            preview = preview, ch = sel, active = active, full = full, nowProg = nowProg, now = now,
            modifier = if (full) Modifier.fillMaxSize() else Modifier.fillMaxWidth().aspectRatio(16f / 9f),
            onStart = { active = true }, onRetry = { preview.release(); resumeTick++ },
            onFull = openFull, onExitFull = exitFull,
        )
        if (!full) {
            /* ---------- canal elegido ---------- */
            if (sel != null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    ChannelLogo(sel.poster, Modifier.size(64.dp, 42.dp), RoundedCornerShape(4.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(sel.name, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    val on = remember(sel.key, favTick, Cloud.rev) { Cloud.isFav(sel.key) }
                    Box(
                        Modifier.size(40.dp).clip(CircleShape)
                            .background(if (on) Color.White else Color(0x992A2A2A))
                            .border(2.dp, if (on) Color.White else Color(0x99FFFFFF), CircleShape)
                            .clickable { toggleFav(sel) },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Star, "Favorito", tint = if (on) Color.Black else Color.White, modifier = Modifier.size(22.dp)) }
                }
            }

            /* ---------- guía de programas (solo si el canal la tiene) ---------- */
            val g = guide
            if (sel != null && !g.isNullOrEmpty()) {
                Column(Modifier.fillMaxWidth().heightIn(max = epgMax).background(TvCol)) {
                    Text("Guía de programas", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 6.dp))
                    LazyColumn(Modifier.fillMaxWidth()) {
                        items(g) { p -> ProgramRow(p, now) }
                    }
                }
            }

            /* ---------- categorías, buscador y canales ---------- */
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(bottom = 16.dp)) {
                item(key = "cat") {
                    val catName = cats.firstOrNull { it.first == cat }?.second ?: "Categorías"
                    Box(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 10.dp)) {
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(Color.Black)
                                .border(1.dp, Color(0xFF555555), RoundedCornerShape(4.dp))
                                .clickable { catOpen = true }.padding(start = 12.dp, end = 6.dp, top = 9.dp, bottom = 9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(catName, color = Color.White, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            Icon(Icons.Filled.ArrowDropDown, null, tint = Color.White)
                        }
                        DropdownMenu(
                            expanded = catOpen, onDismissRequest = { catOpen = false },
                            modifier = Modifier.heightIn(max = 420.dp).background(TvCol),
                        ) {
                            cats.forEach { (k, n) ->
                                DropdownMenuItem(
                                    text = { Text(n, color = if (k == cat) Color.White else Color(0xFFCCCCCC), fontWeight = if (k == cat) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                    onClick = { cat = k; catOpen = false },
                                    modifier = Modifier.background(if (k == cat) NfRed else Color.Transparent),
                                )
                            }
                        }
                    }
                }
                item(key = "head") {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 10.dp), verticalAlignment = Alignment.Bottom) {
                        Text("Canales", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        if (shown.isNotEmpty()) Text("  (${shown.size})", color = TvEmpty, fontSize = 12.sp)
                    }
                }
                item(key = "filter") { FilterField(query) { query = it } }
                if (shown.isEmpty()) item(key = "empty") {
                    Text(
                        if (cat == FAVS && query.isBlank()) "Aún no tienes canales favoritos." else "No hay canales en esta sección.",
                        color = TvEmpty, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp),
                    )
                }
                itemsIndexed(shown, key = { _, c -> c.id }) { i, ch ->
                    LiveRow(ch, i, shown, active = ch.id == selId, fav = Cloud.isFav(ch.key), now = now, onClick = { select(ch) }, onLong = { toggleFav(ch) })
                }
            }
        }
    }
}

/**
 * Reproductor del canal elegido: la misma vista sirve de miniatura y de pantalla completa (no se reconecta).
 * Antes de la primera imagen se ve el logo del canal; en pantalla completa un toque muestra u oculta los controles.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@Composable
private fun PhonePlayerBox(
    preview: LivePreview, ch: Item?, active: Boolean, full: Boolean, nowProg: EpgEntry?, now: Long, modifier: Modifier,
    onStart: () -> Unit, onRetry: () -> Unit, onFull: () -> Unit, onExitFull: () -> Unit,
) {
    var controls by remember { mutableStateOf(true) }
    var touch by remember { mutableIntStateOf(0) }
    LaunchedEffect(full, touch) {
        controls = true
        if (full) { delay(4000); controls = false }
    }
    Box(
        modifier.background(Color.Black).clickable(enabled = ch != null) {
            when {
                !active -> onStart()
                full -> { if (controls) controls = false else touch++ }
            }
        },
        contentAlignment = Alignment.Center,
    ) {
        val player = preview.player
        if (active && player != null) AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    useController = false
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShutterBackgroundColor(android.graphics.Color.BLACK)
                    keepScreenOn = true
                }
            },
            update = { v ->
                if (v.player !== player) v.player = player
                v.resizeMode = if (full) Store.resizeMode else AspectRatioFrameLayout.RESIZE_MODE_FIT
            },
            onRelease = { v -> v.player = null },
            modifier = Modifier.fillMaxSize(),
        )
        if (ch == null) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Filled.LiveTv, null, tint = TvEmpty.copy(alpha = 0.5f), modifier = Modifier.size(54.dp))
                Text("Selecciona un canal para comenzar a ver", color = TvEmpty, fontSize = 14.sp, textAlign = TextAlign.Center)
            }
            return@Box
        }
        val showing = active && preview.showingId == ch.id
        val failed = active && preview.failedId == ch.id
        if (!showing) {
            // logo del canal mientras arranca (o para empezar a ver)
            AsyncImage(
                model = ch.poster, contentDescription = null, contentScale = ContentScale.Fit,
                placeholder = painterResource(R.drawable.logo), error = painterResource(R.drawable.logo),
                modifier = Modifier.fillMaxWidth(0.42f).aspectRatio(16f / 9f),
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x33000000), Color(0x22000000), Color(0xCC000000)))))
            when {
                failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("No se pudo reproducir este canal", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Reintentar", color = Color.Black, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 10.dp).clip(RoundedCornerShape(4.dp)).background(Color.White).clickable { onRetry() }.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                active -> CircularProgressIndicator(color = NfRed, strokeWidth = 3.dp, modifier = Modifier.size(42.dp))
                else -> Box(
                    Modifier.size(64.dp).clip(CircleShape).background(Color(0x99000000)).border(2.dp, Color(0xCCFFFFFF), CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.PlayArrow, "Ver", tint = Color.White, modifier = Modifier.size(38.dp)) }
            }
            if (!full && nowProg != null) {
                Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 12.dp, end = 56.dp, top = 10.dp, bottom = 10.dp)) {
                    Text(
                        "${hm(nowProg.start)} - ${hm(nowProg.end)} · ${nowProg.title}", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(6.dp))
                    ProgressLine(nowProg, now)
                }
            }
        }
        if (!full || controls) {
            Text(
                "EN VIVO", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopStart).padding(if (full) 16.dp else 10.dp).background(NfRed, RoundedCornerShape(3.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        if (full && controls) {
            // pantalla completa: canal y programa arriba, salir abajo a la derecha
            Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(96.dp).background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent))))
            Row(Modifier.align(Alignment.TopStart).fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(CircleShape).clickable { onExitFull() }, contentAlignment = Alignment.Center) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Salir de pantalla completa", tint = Color.White, modifier = Modifier.size(26.dp))
                }
                Spacer(Modifier.width(76.dp))
                Column(Modifier.weight(1f)) {
                    Text(ch.name, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (nowProg != null) Text("${hm(nowProg.start)} - ${hm(nowProg.end)} · ${nowProg.title}", color = Color(0xFFDDDDDD), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (active && (!full || controls)) {
            Box(
                Modifier.align(Alignment.BottomEnd).padding(if (full) 16.dp else 8.dp).size(40.dp).clip(CircleShape).background(Color(0x88000000))
                    .clickable { if (full) onExitFull() else onFull() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (full) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                    if (full) "Salir de pantalla completa" else "Pantalla completa", tint = Color.White, modifier = Modifier.size(28.dp),
                )
            }
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** muestra u oculta las barras del sistema (pantalla completa del video) */
private fun systemBars(a: Activity, show: Boolean) {
    val c = WindowCompat.getInsetsController(a.window, a.window.decorView)
    if (show) c.show(WindowInsetsCompat.Type.systemBars())
    else {
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        c.hide(WindowInsetsCompat.Type.systemBars())
    }
}

@Composable
private fun FilterField(value: String, onChange: (String) -> Unit) {
    BasicTextField(
        value = value, onValueChange = onChange, singleLine = true,
        textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
        cursorBrush = SolidColor(Color.White),
        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 10.dp),
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(Color(0xFF0F0F0F))
                    .border(1.dp, Color(0xFF333333), RoundedCornerShape(4.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Search, null, tint = NfGray, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text("Buscar canal...", color = NfGray, fontSize = 14.sp)
                    inner()
                }
            }
        },
    )
}

/** fila de canal: logo, nombre y lo que se emite ahora con su barra de avance */
@Composable
private fun LiveRow(ch: Item, index: Int, shown: List<Item>, active: Boolean, fav: Boolean, now: Long, onClick: () -> Unit, onLong: () -> Unit) {
    // guía del panel por lotes: la primera fila visible pide también las siguientes (hasta 400)
    val epg by produceState(PanelEpg.cached(ch.id), ch.id) {
        if (value == null) value = PanelEpg.guide(ch, shown.subList(index, minOf(shown.size, index + 400)))
    }
    val cur = epg?.firstOrNull { it.start <= now && it.end > now }
    FocusBox(onClick = onClick, onLongClick = onLong, focusScale = 1f, shape = RoundedCornerShape(4.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Row(
            Modifier.fillMaxWidth()
                .background(if (active) TvActive else Color.Transparent)
                .then(if (active) Modifier.drawBehind { drawRect(NfRed, size = Size(3.dp.toPx(), size.height)) } else Modifier)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChannelLogo(ch.poster, Modifier.size(54.dp, 36.dp), RoundedCornerShape(3.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(ch.name, color = Color(0xFFEEEEEE), fontSize = 14.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (cur != null) {
                    Text(cur.title, color = NfGray2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
                    Spacer(Modifier.height(4.dp))
                    ProgressLine(cur, now)
                }
            }
            if (fav) {
                Spacer(Modifier.width(8.dp))
                Icon(Icons.Filled.Star, null, tint = NfRed, modifier = Modifier.size(16.dp))
            } else if (active) {
                Spacer(Modifier.width(8.dp))
                Icon(Icons.Filled.StarBorder, null, tint = Color(0x66FFFFFF), modifier = Modifier.size(16.dp))
            }
        }
    }
}

/** programa de la guía, como .tv-prog de la web (el actual resaltado en rojo) */
@Composable
private fun ProgramRow(p: EpgEntry, now: Long) {
    val on = p.start <= now && p.end > now
    Column(Modifier.fillMaxWidth().background(if (on) Color(0x1FE50914) else Color.Transparent)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text("${hm(p.start)} - ${hm(p.end)}", color = if (on) NfRed else Color(0xFF999999), fontSize = 14.sp, modifier = Modifier.width(104.dp))
            Column(Modifier.weight(1f)) {
                Text(p.title, color = if (on) Color.White else Color(0xFFDDDDDD), fontSize = 14.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (on) { Spacer(Modifier.height(6.dp)); ProgressLine(p, now) }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(TvLine))
    }
}

@Composable
private fun ProgressLine(p: EpgEntry, now: Long) {
    val pct = if (p.end > p.start) ((now - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) else 0f
    Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color(0xFF444444))) {
        Box(Modifier.fillMaxWidth(pct).fillMaxHeight().background(NfRed))
    }
}

@Composable
private fun ChannelLogo(url: String, modifier: Modifier, shape: RoundedCornerShape) {
    Box(modifier.clip(shape).background(TvLogoBg), contentAlignment = Alignment.Center) {
        AsyncImage(
            model = url.ifBlank { null }, contentDescription = null, contentScale = ContentScale.Fit,
            placeholder = painterResource(R.drawable.logo), error = painterResource(R.drawable.logo), fallback = painterResource(R.drawable.logo),
            modifier = Modifier.fillMaxSize().padding(2.dp),
        )
    }
}

private val hmFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
private fun hm(ms: Long): String = hmFmt.format(ms)
