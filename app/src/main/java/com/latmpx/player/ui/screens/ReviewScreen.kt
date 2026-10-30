package com.latmpx.player.ui.screens

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.R
import com.latmpx.player.data.Panel
import com.latmpx.player.player.Play
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader

private enum class ReviewPage { HOME, MOVIES, SERIES, SETTINGS }

/**
 * Tema de prueba (estilo IBO Player), solo con Omitir y si el panel lo ofrece (Pantalla Falsa): recuadros grandes con
 * Películas a la izquierda, Series al lado y Ajustes (solo «Cerrar sesión»). Reproduce los videos de la carpeta player
 * del panel. No guarda sesión, progreso ni caché; siempre en horizontal (también en el celular).
 */
@Composable
fun ReviewScreen(review: Panel.Review, onLogout: () -> Unit) {
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    var page by remember { mutableStateOf(ReviewPage.HOME) }
    DisposableEffect(Unit) {
        val act = ctx as? Activity
        val before = act?.requestedOrientation
        act?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose { if (act != null && before != null) act.requestedOrientation = before }
    }
    BackHandler { if (page == ReviewPage.HOME) (ctx as? Activity)?.finish() else page = ReviewPage.HOME }
    Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF0B1026), Color(0xFF1B0B2E), Color(0xFF05070F))))) {
        Column(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = if (tv) 48.dp else 20.dp, vertical = if (tv) 28.dp else 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (page != ReviewPage.HOME) {
                    FocusBox(onClick = { page = ReviewPage.HOME }, shape = RoundedCornerShape(50), focusScale = 1.1f) { f ->
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.close), tint = if (f) Color.Black else Color.White,
                            modifier = Modifier.background(if (f) Color.White else Color(0x33FFFFFF), RoundedCornerShape(50)).padding(8.dp).size(24.dp))
                    }
                    Spacer(Modifier.size(14.dp))
                }
                LogoHeader(height = if (tv) 44.dp else 32.dp)
                Spacer(Modifier.weight(1f))
                if (page != ReviewPage.HOME) Text(title(page), color = Color.White, fontSize = if (tv) 26.sp else 20.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(if (tv) 28.dp else 14.dp))
            when (page) {
                ReviewPage.HOME -> Home(tv) { page = it }
                ReviewPage.MOVIES -> Videos(review.movies, tv)
                ReviewPage.SERIES -> Videos(review.series, tv)
                ReviewPage.SETTINGS -> Settings(tv, onLogout)
            }
        }
    }
}

@Composable
private fun title(p: ReviewPage): String = when (p) {
    ReviewPage.MOVIES -> stringResource(R.string.movies)
    ReviewPage.SERIES -> stringResource(R.string.series)
    ReviewPage.SETTINGS -> stringResource(R.string.settings)
    ReviewPage.HOME -> ""
}

@Composable
private fun Home(tv: Boolean, open: (ReviewPage) -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (tv) runCatching { first.requestFocus() } }
    Row(Modifier.fillMaxWidth().fillMaxHeight(0.8f), horizontalArrangement = Arrangement.spacedBy(if (tv) 28.dp else 14.dp)) {
        Tile(stringResource(R.string.movies), Icons.Filled.Movie, listOf(Color(0xFFE50914), Color(0xFF8E0E5C)), Modifier.weight(1f).focusRequester(first)) { open(ReviewPage.MOVIES) }
        Tile(stringResource(R.string.series), Icons.Filled.Tv, listOf(Color(0xFF1E88E5), Color(0xFF4A148C)), Modifier.weight(1f)) { open(ReviewPage.SERIES) }
        Tile(stringResource(R.string.settings), Icons.Filled.Settings, listOf(Color(0xFF455A64), Color(0xFF263238)), Modifier.weight(0.6f)) { open(ReviewPage.SETTINGS) }
    }
}

@Composable
private fun Tile(label: String, icon: ImageVector, colors: List<Color>, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier.fillMaxHeight(), shape = RoundedCornerShape(18.dp), focusScale = 1.05f) { f ->
        Column(
            Modifier.fillMaxSize().background(Brush.linearGradient(colors), RoundedCornerShape(18.dp))
                .then(if (f) Modifier.background(Color(0x22FFFFFF), RoundedCornerShape(18.dp)) else Modifier).padding(20.dp),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(12.dp))
            Text(label, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Videos(list: List<Panel.ReviewVideo>, tv: Boolean) {
    val ctx = LocalContext.current
    if (list.isEmpty()) {
        Text(stringResource(R.string.review_no_videos), color = Color(0xFFBBBBBB), fontSize = 18.sp)
        return
    }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (tv) runCatching { first.requestFocus() } }
    LazyVerticalGrid(GridCells.Adaptive(if (tv) 260.dp else 180.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        itemsIndexed(list) { i, v ->
            FocusBox(onClick = { Play.link(ctx, v.name, v.url) }, modifier = if (i == 0) Modifier.focusRequester(first) else Modifier, shape = RoundedCornerShape(12.dp)) { f ->
                Column(Modifier.fillMaxWidth().background(if (f) Color.White else Color(0x22FFFFFF), RoundedCornerShape(12.dp)).padding(12.dp)) {
                    Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color(0x55000000), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.PlayCircle, null, tint = if (f) Color(0xFFE50914) else Color.White, modifier = Modifier.size(48.dp))
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(v.name, color = if (f) Color.Black else Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun Settings(tv: Boolean, onLogout: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (tv) runCatching { first.requestFocus() } }
    FocusBox(onClick = onLogout, modifier = Modifier.focusRequester(first), shape = RoundedCornerShape(12.dp), focusScale = 1.05f) { f ->
        Row(Modifier.background(if (f) Color.White else Color(0x33FFFFFF), RoundedCornerShape(12.dp)).padding(horizontal = 28.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, tint = if (f) Color.Black else Color.White)
            Spacer(Modifier.size(12.dp))
            Text(stringResource(R.string.logout), color = if (f) Color.Black else Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
    }
}
