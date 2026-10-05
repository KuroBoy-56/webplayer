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
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.PanelEpg
import com.latmpx.player.data.Store
import com.latmpx.player.data.Xtream
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.screens.AccountScreen
import com.latmpx.player.ui.screens.BrowseScreen
import com.latmpx.player.ui.screens.CatalogScreen
import com.latmpx.player.ui.screens.DetailScreen
import com.latmpx.player.ui.screens.HomeScreen
import com.latmpx.player.ui.screens.LiveScreen
import com.latmpx.player.ui.screens.LoginScreen
import com.latmpx.player.ui.screens.MyListScreen
import com.latmpx.player.ui.screens.SearchScreen
import com.latmpx.player.ui.screens.SportsScreen
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.launch

@Composable
fun AppRoot() {
    val state = remember { AppState() }
    val scope = rememberCoroutineScope()
    val booted = remember { mutableStateOf(false) }
    val ctx = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(Unit) {
        state.session = Store.session()
        booted.value = true
    }
    // al entrar con sesión se cargan categorías y catálogos
        LaunchedEffect(state.session) {
        val s = state.session ?: return@LaunchedEffect
        state.loading = true
        launch { Cloud.load() } // continuar viendo y favoritos desde el panel
        Xtream.warmUp(s)
        
        launch(kotlinx.coroutines.Dispatchers.IO) {
            
            val cacheFile = java.io.File(ctx.cacheDir, "catalog_cache_" + s.user + ".json")
            
            // Try to load from cache first for instant UI
            if (cacheFile.exists()) {
                try {
                    val jsonStr = cacheFile.readText()
                    val jsonObj = org.json.JSONObject(jsonStr)
                    
                    val parseItem = { o: org.json.JSONObject, k: Kind ->
                        com.latmpx.player.data.Item(
                            id = o.optInt("id"), name = o.optString("name"), poster = o.optString("poster"),
                            kind = k, categoryId = o.optString("categoryId"), ext = o.optString("ext"),
                            rating = o.optDouble("rating"), year = o.optString("year"), added = o.optLong("added"),
                            plot = o.optString("plot"), epgId = o.optString("epgId"), backdrop = o.optString("backdrop")
                        )
                    }
                    val parseCategory = { o: org.json.JSONObject, k: Kind ->
                        com.latmpx.player.data.Category(id = o.optString("id"), name = o.optString("name"), kind = k)
                    }
                    
                    val mc = mutableListOf<com.latmpx.player.data.Category>()
                    val mca = jsonObj.optJSONArray("movieCats")
                    if (mca != null) for (i in 0 until mca.length()) mc.add(parseCategory(mca.getJSONObject(i), Kind.MOVIE))
                    
                    val sc = mutableListOf<com.latmpx.player.data.Category>()
                    val sca = jsonObj.optJSONArray("seriesCats")
                    if (sca != null) for (i in 0 until sca.length()) sc.add(parseCategory(sca.getJSONObject(i), Kind.SERIES))
                    
                    val lc = mutableListOf<com.latmpx.player.data.Category>()
                    val lca = jsonObj.optJSONArray("liveCats")
                    if (lca != null) for (i in 0 until lca.length()) lc.add(parseCategory(lca.getJSONObject(i), Kind.LIVE))
                    
                    val m = mutableListOf<com.latmpx.player.data.Item>()
                    val ma = jsonObj.optJSONArray("movies")
                    if (ma != null) for (i in 0 until ma.length()) m.add(parseItem(ma.getJSONObject(i), Kind.MOVIE))
                    
                    val ser = mutableListOf<com.latmpx.player.data.Item>()
                    val sera = jsonObj.optJSONArray("series")
                    if (sera != null) for (i in 0 until sera.length()) ser.add(parseItem(sera.getJSONObject(i), Kind.SERIES))
                    
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        state.movieCats = mc; state.seriesCats = sc; state.liveCats = lc
                        state.movies = m; state.series = ser
                        state.loading = false
                    }
                } catch (e: Exception) { e.printStackTrace() }
            }
            
            // Fetch updates in background
            val newMc = Xtream.categories(s, Kind.MOVIE)
            val newSc = Xtream.categories(s, Kind.SERIES)
            val newLc = Xtream.categories(s, Kind.LIVE)
            val newM = Xtream.items(s, Kind.MOVIE)
            val newSer = Xtream.items(s, Kind.SERIES)
            
            // Save to cache
            try {
                val out = org.json.JSONObject()
                val toJsonCat = { c: com.latmpx.player.data.Category -> org.json.JSONObject().put("id", c.id).put("name", c.name) }
                val toJsonItem = { i: com.latmpx.player.data.Item -> 
                    org.json.JSONObject().put("id", i.id).put("name", i.name).put("poster", i.poster).put("categoryId", i.categoryId)
                    .put("ext", i.ext).put("rating", i.rating).put("year", i.year).put("added", i.added).put("plot", i.plot)
                    .put("epgId", i.epgId).put("backdrop", i.backdrop)
                }
                out.put("movieCats", org.json.JSONArray(newMc.map { toJsonCat(it) }))
                out.put("seriesCats", org.json.JSONArray(newSc.map { toJsonCat(it) }))
                out.put("liveCats", org.json.JSONArray(newLc.map { toJsonCat(it) }))
                out.put("movies", org.json.JSONArray(newM.map { toJsonItem(it) }))
                out.put("series", org.json.JSONArray(newSer.map { toJsonItem(it) }))
                cacheFile.writeText(out.toString())
            } catch (e: Exception) { e.printStackTrace() }
            
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                state.movieCats = newMc; state.seriesCats = newSc; state.liveCats = newLc
                state.movies = newM; state.series = newSer
                state.loading = false
            }
        }
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
                    Store.logout(); Xtream.clearCache(); Cloud.clear(); PanelEpg.clear(); state.stack.clear(); state.tab = Tab.HOME; state.session = null
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
    BackHandler(enabled = state.stack.isNotEmpty() || state.tab != Tab.HOME) {
        if (!state.pop()) state.tab = Tab.HOME
    }
    val top = state.stack.lastOrNull()
    val content: @Composable () -> Unit = {
        when (top) {
            is Route.Detail -> DetailScreen(state, top.item)
            is Route.Browse -> BrowseScreen(state, top.title, top.kind, top.categoryIds)
            is Route.PlatformPage -> BrowseScreen(state, top.platform.label, null, emptySet(), top.platform)
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
        // TV: menú lateral que se recorre con el control remoto
        Row(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxHeight().width(84.dp).background(Color(0xFF0B0B0B)).padding(vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                LogoHeader(height = 30.dp)
                Spacer(Modifier.height(18.dp))
                Tab.entries.forEach { t ->
                    val sel = state.tab == t && top == null
                    FocusBox(onClick = { state.stack.clear(); state.tab = t }, shape = RoundedCornerShape(10.dp), focusScale = 1.1f) { f ->
                        Column(
                            Modifier.width(72.dp).background(if (f) Color(0x33FFFFFF) else Color.Transparent).padding(vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(tabIcons.getValue(t), t.label, tint = if (sel) NfRed else if (f) Color.White else NfGray, modifier = Modifier.size(26.dp))
                            Text(t.label, fontSize = 10.sp, color = if (sel || f) Color.White else NfGray, fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
                        }
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxHeight()) { content() }
        }
    } else {
        // teléfono: barra inferior como la app de Netflix
        val phoneTabs = listOf(Tab.HOME, Tab.SERIES, Tab.MOVIES, Tab.LIVE, Tab.ACCOUNT)
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) { content() }
            NavigationBar(containerColor = Color(0xFF0B0B0B), tonalElevation = 0.dp) {
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

