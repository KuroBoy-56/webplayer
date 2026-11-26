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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
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
import com.latmpx.player.data.CacheClear
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
        state.profilesNote = 0
        if (Store.demo) { state.profilesNote = com.latmpx.player.R.string.prof_st_demo; state.profileReady = true; return@LaunchedEffect }
        val r = kotlinx.coroutines.withTimeoutOrNull(12_000L) { Profiles.load(s.maxCons.toIntOrNull() ?: 0) }
        if (state.session !== s) return@LaunchedEffect
        val st = (r as? Profiles.Result.Ok)?.state
        // el motivo se ve en Mi cuenta › Perfiles (antes no había forma de saber por qué no aparecían)
        state.profilesNote = when {
            st == null -> com.latmpx.player.R.string.prof_st_no_panel
            !st.enabled -> com.latmpx.player.R.string.prof_st_off
            st.max <= 1 -> com.latmpx.player.R.string.prof_st_one
            else -> com.latmpx.player.R.string.prof_st_on
        }
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
    // Play Integrity (solo Google Play): con sesión, el panel verifica con Google que esta copia es de Google Play
    LaunchedEffect(state.session) { if (state.session != null) com.latmpx.player.data.PlayIntegrity.check(ctx) }
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
            // copia instalada por fuera de Google Play (Play Integrity, modo «Bloquear copias» del panel)
            com.latmpx.player.data.PlayIntegrity.blocked -> com.latmpx.player.ui.screens.PlayIntegrityScreen()
            // «¿Quién está viendo?» (al entrar, desde Cuenta o después de un 410)
            state.profilesOpen != null -> com.latmpx.player.ui.screens.ProfilesScreen(
                state,
                onChosen = { p ->
                    scope.launch {
                        Profiles.choose(p)
                        Cloud.clear()
                        // perfil infantil: el catálogo se recorta antes de dejar la pantalla de perfiles (nunca se ve el completo)
                        state.applyKids()
                        state.stack.clear(); state.tab = Tab.HOME
                        state.profilesOpen = null
                        state.profileReady = true
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
        alert.value?.takeIf { state.session != null }?.let { a -> PanelAlertDialog(a) { alert.value = null } }
        if (CacheClear.pending) CacheClearNotice()
    }
    // el panel mandó una orden nueva de borrado de caché: aviso ~3 s, se borra y la app se reinicia
    LaunchedEffect(CacheClear.pending) {
        if (!CacheClear.pending) return@LaunchedEffect
        // viendo un video: espera a que se cierre el reproductor (no se corta la película)
        while (com.latmpx.player.player.PlayerActivity.open > 0) kotlinx.coroutines.delay(2_000)
        kotlinx.coroutines.delay(3_000)
        CacheClear.wipeAndRestart(ctx)
    }
}

@Composable
private fun CacheClearNotice() {
    Box(Modifier.fillMaxSize().background(Color(0xE6000000)).padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(androidx.compose.ui.res.stringResource(com.latmpx.player.R.string.cache_clear_notice), color = Color.White, fontSize = 18.sp,
                fontWeight = FontWeight.Bold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Spacer(Modifier.height(20.dp))
            CircularProgressIndicator(color = NfRed)
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
    BackHandler(enabled = state.stack.isNotEmpty() || state.tab != Tab.HOME) {
        if (!state.pop()) state.tab = Tab.HOME
    }
    val top = state.stack.lastOrNull()
    // Cada pantalla guarda su posición (la lista de la sección, la rejilla de la categoría y cada fila horizontal) mientras
    // hay otra abierta encima: al volver de una ficha, Series › «Series 4K» queda donde estaba, con el título que se abrió
    // a la vista. Lo que se cierra se olvida (abrir otra vez la misma ficha empieza arriba) y cambiar de pestaña empieza
    // arriba, como antes.
    val saver = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
    val depth = state.stack.size
    val screenKey = if (top == null) "tab:${state.tab.name}" else "r$depth:${top.hashCode()}"
    val screenKeys = remember { HashMap<Int, String>() }
    LaunchedEffect(screenKey) {
        val gone = screenKeys.filterKeys { it > depth }.values + listOfNotNull(screenKeys[depth]?.takeIf { it != screenKey })
        gone.forEach { saver.removeState(it) }
        screenKeys.keys.removeAll { it > depth }
        screenKeys[depth] = screenKey
    }
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
                // el perfil infantil nunca tiene Deportes
                Tab.SPORTS -> if (Tenant.sportsEnabled && !Profiles.kids) SportsScreen(state) else HomeScreen(state)
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
                // perfil infantil: sin Deportes, y sin TV en vivo si la lista no tiene canales de niños
                Tab.entries.filter { (it != Tab.SPORTS || (Tenant.sportsEnabled && !Profiles.kids)) && (it != Tab.LIVE || !state.hideLive) }.forEach { t ->
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
        // teléfono: barra de abajo flotante como la app de Netflix (PhoneBar.kt). En Inicio, Películas y Series el contenido
        // pasa por detrás de la barra (esas pantallas dejan su espacio al final); en las demás se reserva el espacio abajo.
        val overlay = top == null && (state.tab == Tab.HOME || state.tab == Tab.MOVIES || state.tab == Tab.SERIES)
        val barSpace = com.latmpx.player.ui.screens.phoneBarSpace()
        // Android 15+ dibuja de borde a borde: el contenido empieza bajo la barra de estado (hora, señal, batería) y el
        // buscador y el perfil quedaban tapados. Se deja ese espacio arriba; las pantallas que ya lo tenían no se duplican.
        // girado, también los costados (muesca de la cámara, botones del sistema); con el video a pantalla completa solo arriba, como siempre
        val safe = WindowInsets.safeDrawing.only(if (state.immersive) WindowInsetsSides.Top else WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
        Box(Modifier.fillMaxSize().windowInsetsPadding(safe).consumeWindowInsets(safe)) {
            Box(Modifier.fillMaxSize().padding(bottom = if (state.immersive || overlay) 0.dp else barSpace)) { saver.SaveableStateProvider(screenKey) { content() } }
            if (!state.immersive) PhoneNavBar(state, Modifier.align(Alignment.BottomCenter))
        }
    }
}

