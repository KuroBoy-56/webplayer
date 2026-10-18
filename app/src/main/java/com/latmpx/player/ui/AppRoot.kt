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
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.latmpx.player.Device
import com.latmpx.player.data.Alerts
import com.latmpx.player.data.CatalogCache
import com.latmpx.player.data.Category
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Cloud
import com.latmpx.player.data.PanelEpg
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.data.Xtream
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.components.PanelAlertDialog
import com.latmpx.player.ui.screens.AccountScreen
import com.latmpx.player.ui.screens.ActorScreen
import com.latmpx.player.ui.screens.BrowseScreen
import com.latmpx.player.ui.screens.CatalogScreen
import com.latmpx.player.ui.screens.DistributorScreen
import com.latmpx.player.ui.screens.TenantRetryScreen
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

/** puerta del distribuidor antes del inicio de sesión */
private enum class Gate { CHOOSE, RETRY, OPEN }

@Composable
fun AppRoot() {
    // tras cambiar el idioma (se recrea la actividad) se vuelve a Cuenta
    val state = remember { AppState().apply { if (com.latmpx.player.Lang.reopenAccount) { com.latmpx.player.Lang.reopenAccount = false; tab = Tab.ACCOUNT } } }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val booted = remember { mutableStateOf(false) }
    val alert = remember { mutableStateOf<Alerts.Alert?>(null) }
    val gate = remember { mutableStateOf(Gate.OPEN) }
    val distMsg = remember { mutableStateOf<String?>(null) }
    val retryMsg = remember { mutableStateOf("") }
    val checking = remember { mutableStateOf(false) }
    /** Mis descargas desde el inicio de sesión (sin internet) */
    val offlineDownloads = remember { mutableStateOf(false) }

    // "Cambiar distribuidor" o número cortado por el panel: se borra el número, su marca, la sesión y el token
    fun wipe(msg: String?) {
        Store.logout() // antes de Tenant.clear(): borra el token de este distribuidor
        Tenant.clear()
        Alerts.reset(); alert.value = null; Xtream.clearCache(); CatalogCache.clear(); Cloud.clear(); PanelEpg.clear()
        state.stack.clear(); state.tab = Tab.HOME; state.session = null
        distMsg.value = msg
        gate.value = Gate.CHOOSE
    }

    // guardián: vuelve a pedir tenant_config (al abrir y al volver a la app pasado recheck_after)
    fun guard() {
        val b = Tenant.brand ?: return
        if (b.expired()) { wipe(Tenant.expiredMessage(b)); return }
        if (checking.value) return
        checking.value = true
        scope.launch {
            val r = Tenant.fetch(b.code, Device.id(ctx))
            checking.value = false
            if (Tenant.code != b.code) return@launch // cambió de distribuidor mientras tanto
            when (r) {
                is Tenant.Check.Ok -> {
                    if (r.brand.expired()) wipe(Tenant.expiredMessage(r.brand))
                    else { Tenant.refresh(r.brand); if (gate.value == Gate.RETRY) gate.value = Gate.OPEN }
                }
                is Tenant.Check.Denied -> wipe(r.message)
                // sin conexión o error del servidor: se sigue con la copia guardada hasta 72 h
                is Tenant.Check.Offline -> if (!Tenant.offlineOk()) { retryMsg.value = r.message; gate.value = Gate.RETRY }
                is Tenant.Check.Problem -> if (!Tenant.offlineOk()) { retryMsg.value = r.message; gate.value = Gate.RETRY }
            }
        }
    }

    LaunchedEffect(Unit) {
        when {
            Store.distChoice.isEmpty() -> gate.value = Gate.CHOOSE // primera vez: se pregunta el número
            Store.distChoice == "code" && Tenant.brand == null -> wipe(null)
            else -> {
                gate.value = Gate.OPEN
                state.session = Store.session()
            }
        }
        booted.value = true
        if (gate.value == Gate.OPEN && Tenant.active) guard()
    }
    // el panel cortó el distribuidor mientras se usaba la app (vencido, suspendido, no vinculado)
    LaunchedEffect(Tenant.revoked) {
        val m = Tenant.revoked ?: return@LaunchedEffect
        Tenant.revoked = null
        if (Tenant.active) wipe(m)
    }
    // al entrar con sesión: primero el catálogo guardado en el equipo (al instante) y
    // después, en segundo plano, el del servidor si la copia ya es vieja o no existe
    LaunchedEffect(state.session) {
        val s = state.session ?: return@LaunchedEffect
        launch { Cloud.load() } // continuar viendo y favoritos desde el panel (no bloquea la pantalla)
        launch { alert.value = Alerts.forLaunch(s) } // aviso del panel (bienvenida o vencimiento)
        val kinds = listOf(Kind.MOVIE, Kind.SERIES, Kind.LIVE)
        fun put(kind: Kind, cats: List<Category>, items: List<Item>) {
            when (kind) {
                Kind.MOVIE -> { if (cats.isNotEmpty()) state.movieCats = cats; state.movies = items }
                Kind.SERIES -> { if (cats.isNotEmpty()) state.seriesCats = cats; state.series = items }
                Kind.LIVE -> { if (cats.isNotEmpty()) state.liveCats = cats; state.live = items }
            }
        }
        state.catalogLoading = true
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
        state.catalogLoading = false
    }
    // al volver a la app: si el dueño quitó la línea de este equipo en el panel, se vuelve al inicio de sesión
    val lastPanelCheck = remember { mutableLongStateOf(System.currentTimeMillis()) }
    fun revalidate() {
        val s = state.session ?: return
        if (System.currentTimeMillis() - lastPanelCheck.longValue < 15 * 60_000L) return
        lastPanelCheck.longValue = System.currentTimeMillis()
        scope.launch {
            val c = com.latmpx.player.data.Panel.checkMac(Store.deviceIdOrEmpty())
            // sin conexión o error del panel no se cierra la sesión; solo cuando el panel dice que no hay línea
            if (c.error == null && c.value == null && state.session === s) {
                Store.logout(); Alerts.reset(); alert.value = null; Xtream.clearCache(); Cloud.clear(); PanelEpg.clear(); state.stack.clear(); state.tab = Tab.HOME; state.session = null
            }
        }
    }
    // al volver del reproductor se recarga del panel (otro equipo pudo haber cambiado algo)
    LifecycleResumeEffect(Unit) {
        state.refresh++
        revalidate()
        if (state.session != null) scope.launch { Cloud.load() }
        if (booted.value && Tenant.active && (Tenant.due() || Tenant.brand?.expired() == true)) guard()
        onPauseOrDispose { }
    }

    Box(Modifier.fillMaxSize().background(NfBg)) {
        when {
            !booted.value -> Splash()
            gate.value == Gate.CHOOSE -> DistributorScreen(distMsg.value) {
                // con un número nuevo no se reutiliza la sesión de antes (era de otro distribuidor o del dueño)
                if (Tenant.active) Store.logout()
                distMsg.value = null
                gate.value = Gate.OPEN
                state.session = Store.session()
            }
            gate.value == Gate.RETRY -> TenantRetryScreen(retryMsg.value, checking.value, onRetry = { guard() }, onChange = { wipe(null) })
            state.session == null && offlineDownloads.value -> com.latmpx.player.ui.screens.DownloadsScreen { offlineDownloads.value = false }
            state.session == null -> LoginScreen(onDownloads = { offlineDownloads.value = true }) { s ->
                lastPanelCheck.longValue = System.currentTimeMillis()
                Store.saveSession(s)
                Xtream.clearCache()
                state.session = s
            }
            else -> MainShell(state, onLogout = {
                scope.launch {
                    Store.logout(); Alerts.reset(); alert.value = null; Xtream.clearCache(); CatalogCache.clear(); Cloud.clear(); PanelEpg.clear(); state.stack.clear(); state.tab = Tab.HOME; state.session = null
                }
            }, onChangeDistributor = { wipe(null) })
        }
        alert.value?.takeIf { state.session != null }?.let { a -> PanelAlertDialog(a) { alert.value = null } }
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
private fun MainShell(state: AppState, onLogout: () -> Unit, onChangeDistributor: () -> Unit) {
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
            is Route.ActorPage -> ActorScreen(state, top)
            is Route.Saved -> SavedScreen(state, top.continueWatching)
            is Route.Downloads -> com.latmpx.player.ui.screens.DownloadsScreen { state.pop() }
            null -> when (state.tab) {
                Tab.HOME -> HomeScreen(state)
                Tab.MOVIES -> CatalogScreen(state, Kind.MOVIE)
                Tab.SERIES -> CatalogScreen(state, Kind.SERIES)
                Tab.LIVE -> LiveScreen(state)
                Tab.SPORTS -> if (Tenant.sportsEnabled) SportsScreen(state) else HomeScreen(state)
                Tab.MYLIST -> MyListScreen(state)
                Tab.SEARCH -> SearchScreen(state)
                Tab.ACCOUNT -> AccountScreen(state, onLogout, onChangeDistributor)
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
                Tab.entries.filter { it != Tab.SPORTS || Tenant.sportsEnabled }.forEach { t ->
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

