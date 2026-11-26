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
import com.latmpx.player.data.Kids
import com.latmpx.player.data.Profiles
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
import kotlinx.coroutines.flow.first
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
    /** tema de prueba del panel (Auto-Demo o una cuenta del tema): sin sesión, sin registro y sin caché */
    val review = remember { mutableStateOf<com.latmpx.player.data.Panel.Review?>(null) }
    /** se cerró sesión a mano: el inicio de sesión no pregunta al panel ni entra solo hasta volver a abrir la app */
    val manualLogout = androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }

    // "Cambiar distribuidor" o número cortado por el panel: se borra el número, su marca, la sesión y el token
    fun wipe(msg: String?) {
        Store.logout() // antes de Tenant.clear(): borra el token de este distribuidor
        manualLogout.value = false
        Tenant.clear()
        Alerts.reset(); alert.value = null; Xtream.clearCache(); CatalogCache.clear(); Cloud.clear(); PanelEpg.clear()
        Profiles.choose(null); state.profilesOpen = null; state.profileReady = false
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
            val first = Tenant.fetch(b.code, Device.id(ctx))
            // el panel rechaza el número: se confirma con una segunda consulta antes de borrar el número y la sesión (una
            // sola respuesta equivocada del panel sacaba al cliente de la app)
            val r = if (first is Tenant.Check.Denied) {
                kotlinx.coroutines.delay(3000L)
                Tenant.fetch(b.code, Device.id(ctx))
            } else first
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
        if (Tenant.revoked == null) return@LaunchedEffect
        Tenant.revoked = null
        // no se borra el número con un solo rechazo (progreso, guía, deportes): lo confirma el guardián con tenant_config
        if (Tenant.active) guard()
    }
    // al entrar con sesión: primero el catálogo guardado en el equipo (al instante) y
    // después, en segundo plano, el del servidor si la copia ya es vieja o no existe
    LaunchedEffect(state.session) {
        val s = state.session ?: return@LaunchedEffect
        // entró sin check_mac (Omitir con las listas de auth.php): se pregunta una vez por la orden de borrar caché
        if (!com.latmpx.player.data.CacheClear.asked) launch { com.latmpx.player.data.Panel.checkMac(Store.deviceIdOrEmpty()) }
        // Continuar viendo y Mi lista se leen cuando el perfil ya está elegido (más abajo)
        launch { alert.value = Alerts.forLaunch(s) } // aviso del panel (bienvenida o vencimiento)
        val kinds = listOf(Kind.MOVIE, Kind.SERIES, Kind.LIVE)
        // el catálogo completo queda en AppState; lo que se ve lo arma state.putCatalog (perfil infantil: Kids.kt)
        suspend fun put(kind: Kind, cats: List<Category>, items: List<Item>) = state.putCatalog(kind, cats, items)
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
    // Cuenta › «Actualizar catálogo» (como Roku): películas, series y canales otra vez del servidor IPTV aunque la copia del
    // equipo sea nueva (y las fichas / capítulos que quedaron en memoria). Lo que se ve sigue en pantalla mientras baja; si
    // el servidor no contesta un tipo, se conserva lo anterior de ese tipo.
    LaunchedEffect(state.catalogRev) {
        if (state.catalogRev == 0) return@LaunchedEffect
        val s = state.session
        if (s == null) { state.catalogReloading = false; return@LaunchedEffect }
        state.catalogLoading = true
        try {
            Xtream.clearDetails()
            val ok = listOf(Kind.MOVIE, Kind.SERIES, Kind.LIVE).map { k ->
                async {
                    val r = runCatching { Xtream.refresh(s, k) }.getOrNull()
                    if (r != null && state.session === s) state.putCatalog(k, r.first, r.second)
                    r != null
                }
            }.awaitAll()
            if (state.session === s) {
                // Continuar viendo y Mi lista también del panel
                if (state.profileReady) runCatching { Cloud.load() }
                state.refresh++
                android.widget.Toast.makeText(ctx, com.latmpx.player.tr(if (ok.all { it }) com.latmpx.player.R.string.catalog_reloaded else com.latmpx.player.R.string.catalog_reload_failed),
                    android.widget.Toast.LENGTH_LONG).show()
            }
        } finally {
            state.catalogLoading = false
            state.catalogReloading = false
        }
    }
    // perfiles (docs/PERFILES.md del panel): al entrar se leen. Apagados, una sola conexión, DEMO o el panel sin respuesta
    // en 12 s: directo al principal, como siempre (la app nunca se queda esperando). Si no, «¿Quién está viendo?».
    LaunchedEffect(state.session) {
        val s = state.session ?: return@LaunchedEffect
        state.profileReady = false
        state.profilesOpen = null
        Profiles.choose(null)
        Kids.resetPending()
        if (Store.demo) { state.profileReady = true; return@LaunchedEffect }
        val r = kotlinx.coroutines.withTimeoutOrNull(12_000L) { Profiles.load(s.maxCons.toIntOrNull() ?: 0) }
        if (state.session !== s) return@LaunchedEffect
        val st = (r as? Profiles.Result.Ok)?.state
        if (st != null && st.enabled && st.max > 1 && st.profiles.isNotEmpty()) {
            state.profilesData = st
            state.profilesFromAccount = false
            state.profilesOpen = false
        } else state.profileReady = true
    }
    // Continuar viendo y Mi lista del perfil elegido (y otra vez al cambiar de perfil)
    LaunchedEffect(state.session, state.profileReady, Profiles.current) {
        if (state.session != null && state.profileReady) Cloud.load()
    }
    // perfil infantil: lo que se ve se arma otra vez al cambiar de perfil y al llegar veredictos de TMDB
    LaunchedEffect(Profiles.current, Kids.rev) { state.applyKids() }
    // lo dudoso se le pregunta al panel en segundo plano (api/kids_rate.php), nunca esperando para mostrar la pantalla
    LaunchedEffect(state.session, Profiles.current) {
        Kids.resetPending()
        var rounds = 0
        while (state.session != null && Profiles.kids && rounds < 60) {
            kotlinx.coroutines.delay(if (rounds == 0) 2_000L else 4_000L)
            val more = runCatching { Kids.askPending() }.getOrDefault(false)
            rounds++
            if (!more) kotlinx.coroutines.delay(30_000L)
        }
    }
    // el panel contestó 410: el perfil elegido ya no existe (eliminado en otro equipo): otra vez a la pantalla de perfiles
    LaunchedEffect(Profiles.gone) {
        if (Profiles.gone == 0 || state.session == null) return@LaunchedEffect
        val s = state.session ?: return@LaunchedEffect
        val r = Profiles.load(s.maxCons.toIntOrNull() ?: 0)
        // sin respuesta del panel: la última lista (nunca se pasa solo al principal: podía ser un perfil infantil)
        val st = (r as? Profiles.Result.Ok)?.state ?: state.profilesData
        Profiles.choose(null)
        Cloud.clear()
        if (st != null && st.enabled && st.max > 1 && st.profiles.isNotEmpty()) {
            state.stack.clear(); state.tab = Tab.HOME
            state.profilesData = st
            state.profilesFromAccount = false
            state.profilesOpen = false
        }
    }
    // al volver a la app: si el dueño quitó la línea de este equipo en el panel, se vuelve al inicio de sesión
    val lastPanelCheck = remember { mutableLongStateOf(System.currentTimeMillis()) }
    fun revalidate(gap: Long = 15 * 60_000L) {
        val s = state.session ?: return
        if (System.currentTimeMillis() - lastPanelCheck.longValue < gap) return
        lastPanelCheck.longValue = System.currentTimeMillis()
        scope.launch {
            val c = com.latmpx.player.data.Panel.checkMac(Store.deviceIdOrEmpty(), poll = true)
            // sin conexión o error del panel no se cierra la sesión; solo cuando el panel deja de dar una línea que antes dio
            // a este equipo (Panel.lineGone) o el equipo está en la lista negra
            if (((c.error == null && c.value == null && com.latmpx.player.data.Panel.lineGone) || com.latmpx.player.data.Panel.blocked != null) && state.session === s) {
                Store.logout(); Alerts.reset(); alert.value = null; Xtream.clearCache(); Cloud.clear(); PanelEpg.clear(); state.stack.clear(); state.tab = Tab.HOME
                Profiles.choose(null); state.profilesOpen = null; state.profileReady = false; state.session = null
            }
        }
    }
    // con la app abierta (la tele suele quedar encendida) el panel se consulta cada 10 min: línea quitada, demo
    // vencida u orden de borrar la caché
    LaunchedEffect(state.session) {
        while (state.session != null) {
            kotlinx.coroutines.delay(60_000L)
            revalidate(10 * 60_000L)
        }
    }
    // al volver del reproductor se recarga del panel (otro equipo pudo haber cambiado algo)
    LifecycleResumeEffect(Unit) {
        state.refresh++
        revalidate()
        if (state.session != null && state.profileReady) scope.launch { Cloud.load() }
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
            state.session == null && review.value != null -> com.latmpx.player.ui.screens.ReviewScreen(review.value!!) { manualLogout.value = true; review.value = null }
            state.session == null && offlineDownloads.value -> com.latmpx.player.ui.screens.DownloadsScreen { offlineDownloads.value = false }
            state.session == null -> LoginScreen(autoCheck = !manualLogout.value, onDownloads = { offlineDownloads.value = true }, onChangeDistributor = { wipe(null) }, onReview = { review.value = it }) { s ->
                manualLogout.value = false
                lastPanelCheck.longValue = System.currentTimeMillis()
                Store.saveSession(s)
                Xtream.clearCache()
                state.session = s
            }
            // «¿Quién está viendo?» (al entrar, desde Cuenta o después de un 410)
            state.profilesOpen != null -> com.latmpx.player.ui.screens.ProfilesScreen(
                state,
                onChosen = { p ->
                    // el avatar va al centro con el circulito mientras se arma todo (null = perfiles apagados: nada que mostrar)
                    if (p != null) state.entering = p
                    val t0 = System.currentTimeMillis()
                    scope.launch {
                        Profiles.choose(p)
                        Cloud.clear()
                        // perfil infantil: el catálogo se recorta antes de dejar la pantalla de perfiles (nunca se ve el completo)
                        state.applyKids()
                        state.stack.clear(); state.tab = Tab.HOME
                        state.profilesOpen = null
                        state.profileReady = true
                        if (p != null) {
                            // Inicio se arma debajo: el circulito sigue hasta que el catálogo está (máx. 20 s)
                            kotlinx.coroutines.withTimeoutOrNull(20_000) {
                                androidx.compose.runtime.snapshotFlow { !state.loading || state.movies.isNotEmpty() }.first { it }
                            }
                            kotlinx.coroutines.delay((900 - (System.currentTimeMillis() - t0)).coerceAtLeast(150))
                            state.entering = null
                        }
                    }
                },
                onBack = { if (state.profilesFromAccount && Profiles.current != null) state.profilesOpen = null else (ctx as? android.app.Activity)?.finishAffinity() },
                onLogout = {
                    scope.launch {
                        manualLogout.value = true
                        Store.logout(); Alerts.reset(); alert.value = null; Xtream.clearCache(); CatalogCache.clear(); Cloud.clear(); PanelEpg.clear(); state.stack.clear(); state.tab = Tab.HOME
                        Profiles.choose(null); state.profilesOpen = null; state.profileReady = false; state.session = null
                    }
                },
            )
            else -> MainShell(state, onLogout = {
                scope.launch {
                    manualLogout.value = true
                    Store.logout(); Alerts.reset(); alert.value = null; Xtream.clearCache(); CatalogCache.clear(); Cloud.clear(); PanelEpg.clear(); state.stack.clear(); state.tab = Tab.HOME
                    Profiles.choose(null); state.profileReady = false; state.session = null
                }
            }, onChangeDistributor = { wipe(null) })
        }
        state.entering?.let { com.latmpx.player.ui.screens.ProfileEnterOverlay(it) }
        alert.value?.takeIf { state.session != null }?.let { a -> PanelAlertDialog(a) { alert.value = null } }
        // el panel pidió borrar la caché: aviso de 3 s, se borra y la app se reinicia sola
        if (com.latmpx.player.data.CacheClear.pending) {
            Box(Modifier.fillMaxSize().background(Color(0xE6000000)).padding(32.dp), contentAlignment = Alignment.Center) {
                Text(androidx.compose.ui.res.stringResource(com.latmpx.player.R.string.cache_clear_notice), color = Color.White, fontSize = 20.sp,
                    fontWeight = FontWeight.Bold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
            LaunchedEffect(Unit) {
                // viendo un video: espera a que se cierre el reproductor (no se corta la película)
                while (com.latmpx.player.player.PlayerActivity.open > 0) kotlinx.coroutines.delay(2_000)
                kotlinx.coroutines.delay(3_000)
                com.latmpx.player.data.CacheClear.wipeAndRestart(ctx)
            }
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
private fun MainShell(state: AppState, onLogout: () -> Unit, onChangeDistributor: () -> Unit) {
    val tv = LocalIsTv.current
    // en TV el botón atrás lo maneja TvShell (menú superior y diálogo de salida)
    if (!tv) BackHandler(enabled = state.stack.isNotEmpty() || state.tab != Tab.HOME) {
        if (!state.pop()) state.tab = Tab.HOME
    }
    val top = state.stack.lastOrNull()
    val routeContent: @Composable (Route) -> Unit = { r ->
        when (r) {
            is Route.Detail -> DetailScreen(state, r.item)
            is Route.Browse -> BrowseScreen(state, r.title, r.kind, r.categoryIds)
            is Route.PlatformPage -> BrowseScreen(state, r.platform.label, null, emptySet(), r.platform)
            is Route.ActorPage -> ActorScreen(state, r)
            is Route.Saved -> SavedScreen(state, r.continueWatching)
            is Route.Downloads -> com.latmpx.player.ui.screens.DownloadsScreen { state.pop() }
        }
    }
    val tabContent: @Composable () -> Unit = {
        when (state.tab) {
            Tab.HOME -> HomeScreen(state)
            Tab.MOVIES -> CatalogScreen(state, Kind.MOVIE)
            Tab.SERIES -> CatalogScreen(state, Kind.SERIES)
            Tab.LIVE -> LiveScreen(state)
            // el perfil infantil nunca tiene Deportes
            Tab.SPORTS -> if (Tenant.sportsEnabled && !Profiles.kids) SportsScreen(state) else HomeScreen(state)
            Tab.MYLIST -> MyListScreen(state)
            // TV con perfiles: la lupa abre Explorar (como el web player); si no, Buscar de siempre
            Tab.SEARCH -> if (tv && com.latmpx.player.data.Profiles.current != null) com.latmpx.player.ui.screens.TvExploreScreen(state) else SearchScreen(state)
            Tab.ACCOUNT -> AccountScreen(state, onLogout, onChangeDistributor)
        }
    }
    val content: @Composable () -> Unit = { if (top != null) routeContent(top) else tabContent() }
    if (tv) {
        // TV: menú superior como el reproductor web
        // TV: menú superior como el reproductor web; las fichas se apilan encima sin destruir lo de abajo
        // (al volver, la sección sigue donde estaba y el foco regresa a la tarjeta que se abrió)
        TvShell(state, base = tabContent, route = routeContent)
    } else {
        // teléfono: barra inferior como la app de Netflix
        // perfil infantil sin canales de niños: sin TV en vivo
        val phoneTabs = listOf(Tab.HOME, Tab.SERIES, Tab.MOVIES, Tab.LIVE, Tab.ACCOUNT).filter { it != Tab.LIVE || !state.hideLive }
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

