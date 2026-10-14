package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Downloads
import com.latmpx.player.player.Play
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.Poster
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/** carátula guardada en el equipo (sin internet) o, si no se pudo bajar, la del servidor */
fun localImage(path: String, fallback: String = ""): String = if (path.isNotBlank()) "file://$path" else fallback

/** estado corto de una descarga para mostrar sobre la carátula */
private fun stateLabel(e: Downloads.Entry): String = when (e.state) {
    Downloads.State.DONE -> ""
    Downloads.State.RUNNING -> if (e.total > 0) tr(R.string.percent, e.percent) else tr(R.string.downloading_dots)
    Downloads.State.QUEUED -> tr(R.string.queued)
    Downloads.State.FAILED -> tr(R.string.dl_failed_tap)
}

/**
 * Mis descargas (Cuenta › Mis descargas, y en el inicio de sesión cuando no hay internet).
 * Películas: carátula y título. Series: cada serie abre sus episodios descargados. Se ven sin internet
 * y se pueden eliminar (se borra el archivo del equipo).
 */
@Composable
fun DownloadsScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val rev = Downloads.rev
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var openSeries by rememberSaveable { mutableIntStateOf(0) }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    BackHandler { if (openSeries != 0) openSeries = 0 else onBack() }

    val movies = remember(rev) { Downloads.movies() }
    val series = remember(rev) { Downloads.series() }

    Column(Modifier.fillMaxSize().background(NfBg).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(CircleShape).clickable { if (openSeries != 0) openSeries = 0 else onBack() }, contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = Color.White)
            }
            val title = if (openSeries != 0) series.firstOrNull { it.first.seriesId == openSeries }?.first?.seriesName ?: stringResource(R.string.my_downloads) else stringResource(R.string.my_downloads)
            Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
        val eps = remember(rev, openSeries) { if (openSeries != 0) Downloads.episodes(openSeries) else emptyList() }
        // se borró el último episodio de la serie abierta: de vuelta a la lista
        if (openSeries != 0 && eps.isEmpty()) LaunchedEffect(Unit) { openSeries = 0 }
        if (openSeries != 0 && eps.isNotEmpty()) {
            EpisodeList(eps, onPlay = { e ->
                val done = eps.filter { it.state == Downloads.State.DONE }
                Play.offline(ctx, done, done.indexOf(e).coerceAtLeast(0))
            }, onDelete = { e -> confirm = tr(R.string.dl_confirm_ep, e.season, e.episode) to { Downloads.delete(e.key) } },
                onDeleteAll = { confirm = tr(R.string.dl_confirm_series, eps.first().seriesName) to { Downloads.deleteSeries(openSeries); openSeries = 0 } })
        } else {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip(stringResource(R.string.movies) + " (${movies.size})", tab == 0) { tab = 0 }
                Chip(stringResource(R.string.series) + " (${series.size})", tab == 1) { tab = 1 }
            }
            if (tab == 0) {
                if (movies.isEmpty()) Empty(stringResource(R.string.dl_no_movies))
                else LazyVerticalGrid(GridCells.Adaptive(108.dp), contentPadding = PaddingValues(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(movies, key = { it.key }) { e ->
                        DownloadCard(localImage(e.poster, e.posterUrl), e.title, e, null,
                            onClick = { tapEntry(e) { Play.offline(ctx, listOf(e), 0) } },
                            onDelete = { confirm = tr(R.string.dl_confirm_title, e.title) to { Downloads.delete(e.key) } })
                    }
                }
            } else {
                if (series.isEmpty()) Empty(stringResource(R.string.dl_no_episodes))
                else LazyVerticalGrid(GridCells.Adaptive(108.dp), contentPadding = PaddingValues(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(series, key = { it.first.seriesId }) { (e, n) ->
                        val busy = Downloads.episodes(e.seriesId).firstOrNull { it.state != Downloads.State.DONE }
                        DownloadCard(localImage(e.seriesPoster, e.seriesPosterUrl), e.seriesName, busy, pluralStringResource(R.plurals.episodes_count, n, n),
                            onClick = { openSeries = e.seriesId },
                            onDelete = { confirm = tr(R.string.dl_confirm_series, e.seriesName) to { Downloads.deleteSeries(e.seriesId) } })
                    }
                }
            }
        }
    }
    confirm?.let { (msg, action) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(stringResource(R.string.dl_delete_title)) },
            text = { Text(msg) },
            confirmButton = { TextButton({ action(); confirm = null }) { Text(stringResource(R.string.remove), color = NfRed) } },
            dismissButton = { TextButton({ confirm = null }) { Text(stringResource(R.string.cancel)) } },
            containerColor = Color(0xFF1F1F1F), titleContentColor = Color.White, textContentColor = Color(0xFFDDDDDD),
        )
    }
}

/** terminada: se reproduce; con error: se reintenta; bajando o en espera: nada */
private fun tapEntry(e: Downloads.Entry, play: () -> Unit) {
    when (e.state) {
        Downloads.State.DONE -> play()
        Downloads.State.FAILED -> Downloads.retry(e.key)
        else -> Unit
    }
}

@Composable
private fun DownloadCard(image: String, title: String, e: Downloads.Entry?, sub: String?, onClick: () -> Unit, onDelete: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp))) {
            Poster(image, title, Modifier.fillMaxSize())
            if (e != null && e.state != Downloads.State.DONE) {
                Box(Modifier.fillMaxSize().background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                    Text(stateLabel(e), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(6.dp))
                }
                if (e.state == Downloads.State.RUNNING) LinearProgressIndicator(progress = { e.percent / 100f }, color = NfRed, trackColor = Color(0x44FFFFFF),
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp))
            }
            Box(Modifier.align(Alignment.TopEnd).padding(4.dp).size(30.dp).clip(CircleShape).background(Color(0xAA000000)).clickable(onClick = onDelete),
                contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Delete, stringResource(R.string.remove), tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }
        Text(title, color = Color.White, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        sub?.let { Text(it, color = NfGray2, fontSize = 11.sp) }
    }
}

@Composable
private fun EpisodeList(eps: List<Downloads.Entry>, onPlay: (Downloads.Entry) -> Unit, onDelete: (Downloads.Entry) -> Unit, onDeleteAll: () -> Unit) {
    LazyColumn(contentPadding = PaddingValues(bottom = 30.dp)) {
        items(eps, key = { it.key }) { e ->
            Row(Modifier.fillMaxWidth().clickable { tapEntry(e) { onPlay(e) } }.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(140.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(4.dp))) {
                    Poster(localImage(e.poster, e.posterUrl), "E${e.episode}", Modifier.fillMaxSize())
                    if (e.state == Downloads.State.DONE) {
                        Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.align(Alignment.Center).size(34.dp).background(Color(0x66000000), CircleShape).padding(4.dp))
                        if (e.duration > 0 && e.position > 0) LinearProgressIndicator(progress = { (e.position.toFloat() / e.duration).coerceIn(0f, 1f) }, color = NfRed,
                            trackColor = Color(0x66FFFFFF), modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp))
                    } else {
                        Box(Modifier.fillMaxSize().background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                            if (e.state == Downloads.State.FAILED) Icon(Icons.Filled.Refresh, stringResource(R.string.retry), tint = Color.White)
                            else Text(stateLabel(e), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(stringResource(R.string.season_ep, e.season, e.episode), color = NfGray2, fontSize = 12.sp)
                    Text(e.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (e.state == Downloads.State.FAILED && e.error.isNotBlank()) Text(e.error, color = Color(0xFFE87C03), fontSize = 11.sp, maxLines = 2)
                }
                Box(Modifier.size(40.dp).clip(CircleShape).clickable { onDelete(e) }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Delete, stringResource(R.string.remove), tint = NfGray2)
                }
            }
        }
        item {
            TextButton(onDeleteAll, modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp)) {
                Icon(Icons.Filled.Delete, null, tint = NfRed, modifier = Modifier.size(18.dp))
                Text("  " + stringResource(R.string.dl_delete_all_eps), color = NfRed)
            }
        }
    }
}

/** Android 13+: pide permiso para la notificación del progreso la primera vez que se descarga algo */
@Composable
fun rememberDownloadNotice(): () -> Unit {
    val ctx = LocalContext.current
    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    return {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) runCatching { launcher.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
    }
}
