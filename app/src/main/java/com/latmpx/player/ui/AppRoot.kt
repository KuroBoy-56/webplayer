package com.latmpx.player.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.latmpx.player.data.CatalogCache
import com.latmpx.player.data.Category
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.PanelEpg
import com.latmpx.player.data.Store
import com.latmpx.player.data.Xtream
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.screens.AccountScreen
import com.latmpx.player.ui.screens.ActorScreen
import com.latmpx.player.ui.screens.BrowseScreen
import com.latmpx.player.ui.screens.CatalogScreen
import com.latmpx.player.ui.screens.DetailScreen
import com.latmpx.player.ui.screens.HomeScreen
import com.latmpx.player.ui.screens.LiveScreen
import com.latmpx.player.ui.screens.LoginScreen
import com.latmpx.player.ui.screens.MyListScreen
import com.latmpx.player.ui.screens.SavedScreen
import com.latmpx.player.ui.screens.SearchScreen
import com.latmpx.player.ui.screens.SportsScreen
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch

@Composable
fun AppRoot() {
    val state = remember { AppState() }
    val scope = rememberCoroutineScope()
    val booted = remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        state.session = Store.session()
        booted.value = true
    }
    // al entrar con sesión: primero el catálogo guardado en el equipo (al instante) y
    // después, en segundo plano, el del servidor si la copia ya es vieja o no existe
    LaunchedEffect(state.session) {
        val s = state.session ?: return@LaunchedEffect
        launch { Cloud.load() } // continuar viendo y favoritos desde el panel (no bloquea la pantalla)
        val kinds = listOf(Kind.MOVIE, Kind.SERIES, Kind.LIVE)
        fun put(kind: Kind, cats: List<Category>, items: List<Item>) {
            when (kind) {
                Kind.MOVIE -> { if (cats.isNotEmpty()) state.movieCats = cats; state.movies = items }
                Kind.SERIES -> { if (cats.isNotEmpty()) state.seriesCats = cats; state.series = items }
                Kind.LIVE -> { if (cats.isNotEmpty()) state.liveCats = cats; state.live = items }
            }
        }
        val saved = kinds.map { k -> async { k to Xtream.cached(s, k) } }.awaitAll()
        saved.forEach { (k, c) -> if (c != null) put(k, c.first, c.second) }
        state.loading = state.movies.isEmpty()
        kinds.map { k ->
            async {
                if (CatalogCache.isStale(s, k)) Xtream.refresh(s, k)?.let { (c, i) -> put(k, c, i) }
                Unit
            }
        }.awaitAll()
        state.loading = false
    }
    // al volver del reproductor se recarga del panel (otro equipo pudo haber cambiado algo)
    LifecycleResumeEffect(Unit) {
        state.refresh++
        if (state.session != null) scope.launch { Cloud.load() }
        onPauseOrDispose { }
    }

    Box(Modifier.fillMaxSize().background(NfBg)) {
        when {
            !booted.value -> Splash()
            state.session == null -> LoginScreen { s ->
                Store.saveSession(s)
                Xtream.clearCache()
                state.session = s
            }
            else -> MainShell(state, onLogout = {
                scope.launch {
                    Store.logout(); Xtream.clearCache(); CatalogCache.clear(); Cloud.clear(); PanelEpg.clear(); state.stack.clear(); state.tab = Tab.HOME; state.session = null
                }
            })
        }
    }
}

@Composable
private fun Splash() {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        LogoHeader(height = 90.dp)
        Spacer(Modifier.height(24.dp))
        CircularProgressIndicator(color = NfRed)
    }
}

private val tabIcons: Map<Tab, ImageVector> = mapOf(
    Tab.HOME to Icons.Filled.Home, Tab.MOVIES to Icons.Filled.Movie, Tab.SERIES to Icons.Filled.Tv, Tab.LIVE to Icons.Filled.LiveTv, Tab.SPORTS to Icons.Filled.SportsSoccer,
    Tab.MYLIST to Icons.Filled.Bookmark, Tab.SEARCH to Icons.Filled.Search, Tab.ACCOUNT to Icons.Filled.AccountCircle,
)

@Composable
private fun MainShell(state: AppState, onLogout: () -> Unit) {
    val tv = LocalIsTv.current
    // en TV el botón atrás lo maneja TvShell (menú superior y diálogo de salida)
    if (!tv) BackHandler(enabled = state.stack.isNotEmpty() || state.tab != Tab.HOME) {
        if (!state.pop()) state.tab = Tab.HOME
    }
    val top = state.stack.lastOrNull()
    val content: @Composable () -> Unit = {
        when (top) {
            is Route.Detail -> DetailScreen(state, top.item)
            is Route.Browse -> BrowseScreen(state, top.title, top.kind, top.categoryIds)
            is Route.PlatformPage -> BrowseScreen(state, top.platform.label, null, emptySet(), top.platform)
            is Route.ActorPage -> ActorScreen(state, top)
            is Route.Saved -> SavedScreen(state, top.continueWatching)
            null -> when (state.tab) {
                Tab.HOME -> HomeScreen(state)
                Tab.MOVIES -> CatalogScreen(state, Kind.MOVIE)
                Tab.SERIES -> CatalogScreen(state, Kind.SERIES)
                Tab.LIVE -> LiveScreen(state)
                Tab.SPORTS -> SportsScreen(state)
                Tab.MYLIST -> MyListScreen(state)
                Tab.SEARCH -> SearchScreen(state)
                Tab.ACCOUNT -> AccountScreen(state, onLogout)
            }
        }
    }
    if (tv) {
        // TV: menú superior como el reproductor web
        TvShell(state) { content() }
    } else {
        // teléfono: barra inferior como la app de Netflix
        val phoneTabs = listOf(Tab.HOME, Tab.SERIES, Tab.MOVIES, Tab.LIVE, Tab.ACCOUNT)
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) { content() }
            if (!state.immersive) NavigationBar(containerColor = Color(0xFF0B0B0B), tonalElevation = 0.dp) {
                phoneTabs.forEach { t ->
                    NavigationBarItem(
                        selected = state.tab == t && top == null,
                        onClick = { state.stack.clear(); state.tab = t },
                        icon = { Icon(tabIcons.getValue(t), t.label) },
                        label = { Text(t.label, fontSize = 10.sp, maxLines = 1) },
                        alwaysShowLabel = false,
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Color.White, selectedTextColor = Color.White, indicatorColor = Color(0x22FFFFFF),
                            unselectedIconColor = NfGray, unselectedTextColor = NfGray,
                        ),
                    )
                }
            }
        }
    }
}

