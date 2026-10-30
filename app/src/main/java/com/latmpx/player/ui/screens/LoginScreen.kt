package com.latmpx.player.ui.screens
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.Device
import com.latmpx.player.data.Panel
import com.latmpx.player.data.PanelCrypto
import com.latmpx.player.data.Session
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.data.Tmdb
import com.latmpx.player.data.Xtream
import com.latmpx.player.ui.components.tvTextInput
import com.latmpx.player.ui.components.AppButton
import com.latmpx.player.ui.components.Chip
import com.latmpx.player.ui.components.DnsButton
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.PosterWall
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfOnRed
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LoginScreen(onDownloads: () -> Unit = {}, onChangeDistributor: () -> Unit = {}, onReview: (Panel.Review) -> Unit = {}, onLogged: (Session) -> Unit) {
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val deviceId = remember { Device.id(ctx) }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(true) }
    var status by remember { mutableStateOf(tr(R.string.login_checking_device)) }
    var err by remember { mutableStateOf<String?>(null) }
    var lines by remember { mutableStateOf<List<Panel.Line>>(emptyList()) }
    var dns by remember { mutableStateOf<List<String>>(emptyList()) }
    var dnsIdx by remember { mutableIntStateOf(0) }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    // ojito: ver la contraseña en texto o volver a ocultarla
    var showPass by remember { mutableStateOf(false) }
    val eyeFocus = remember { FocusRequester() }
    var demoUsed by remember { mutableStateOf(Store.demoUsed) }
    val firstFocus = remember { FocusRequester() }
    var posters by remember { mutableStateOf<List<String>>(emptyList()) }
    // pantalla falsa del panel (equipo nuevo): hasta escribir el código o hasta que lo registren
    var fake by remember { mutableStateOf<com.latmpx.player.data.FakeScreen?>(null) }
    /** primera consulta al panel (línea del equipo y pantalla falsa) todavía en curso */
    var checking by remember { mutableStateOf(true) }

    // Autodemo: el panel dice si hay demo configurada (features); null = no respondió (se usa lo de antes)
    var demoConfigured by remember { mutableStateOf<Boolean?>(null) }

    // la línea que se va a abrir viene del botón Autodemo (aunque el panel no lo diga)
    var fromAutodemo by remember { mutableStateOf(false) }

    /** true si entró; la demo (Autodemo o el panel dice "demo") se abre en modo DEMO */
    suspend fun tryLine(line: Panel.Line): Boolean {
        status = tr(R.string.login_connecting_to, line.name)
        return when (val r = Xtream.login(listOf(line.name to line.base), line.user, line.pass)) {
            is Xtream.LoginResult.Ok -> { Store.setDemo(line.demo || fromAutodemo, line.demoExpires, line.demoDuration); onLogged(r.session); true }
            is Xtream.LoginResult.Fail -> { err = r.message; false }
        }
    }

    suspend fun connect(line: Panel.Line) { tryLine(line) }

    /** Demo recién creada: su servidor (el que dijo el panel) y luego los DNS del panel, hasta que uno responda. */
    suspend fun tryDemo(demo: Panel.Demo, servers: List<String>): Boolean {
        status = tr(R.string.login_connecting_demo)
        val list = servers.filter { it.isNotBlank() }.map(Xtream::normalize).distinct()
        if (list.isEmpty()) { err = tr(R.string.login_demo_no_server); return false }
        return when (val r = Xtream.login(list.mapIndexed { i, s -> (if (i == 0) "Demo" else tr(R.string.server_n, i + 1)) to s }, demo.user, demo.pass)) {
            is Xtream.LoginResult.Ok -> { Store.setDemo(true, demo.expires, demo.duration); onLogged(r.session); true }
            is Xtream.LoginResult.Fail -> { err = r.message; false }
        }
    }

    /**
     * Varias líneas o servidores para este equipo: se entra con la primera que funciona, sin preguntar
     * (antes se mostraba la lista "Elige tu servicio").
     */
    suspend fun connectFirst(found: List<Panel.Line>) {
        var lastErr: String? = null
        for (l in found) {
            err = null
            if (tryLine(l)) return
            lastErr = err
        }
        err = lastErr
    }

    suspend fun resolve(): Boolean {
        busy = true; status = tr(R.string.login_checking_device)
        val a = Panel.playlists(deviceId)
        var found = a.value.orEmpty()
        var problem = a.error
        if (found.isEmpty()) {
            val c = Panel.checkMac(deviceId)
            c.value?.let { found = listOf(it) }
            if (problem == null) problem = c.error
        } else {
            // las listas vinieron de auth.php: check_mac igual, en segundo plano, por la orden de borrado de caché
            scope.launch { Panel.checkMac(deviceId) }
        }
        lines = found
        if (found.isNotEmpty()) connectFirst(found)
        else if (problem != null) err = problem
        busy = false
        return found.isNotEmpty()
    }

    fun act(block: suspend () -> Unit) {
        if (busy) return
        err = null
        scope.launch { busy = true; block(); busy = false }
    }

    LaunchedEffect(Tenant.code) { posters = Tmdb.nowPlaying() }
    // tema de prueba del panel (Pantalla Falsa, solo con Omitir): caja sencilla con usuario, contraseña, Entrar y Auto-Demo
    var review by remember { mutableStateOf(false) }
    LaunchedEffect(Tenant.code) { demoConfigured = Panel.demoConfigured(deviceId); review = Panel.reviewOffered }
    LaunchedEffect(Unit) {
        resolve()
        if (lines.isEmpty() && !Store.fakeUnlocked) fake = Panel.fakeScreen
        // la pantalla falsa (si el panel la tiene activada) es lo primero que se ve: el inicio de sesión
        // no aparece hasta que el panel respondió
        checking = false
        if (lines.isEmpty() && PanelCrypto.hasKey()) Panel.fetchDns().value?.let { dns = it }
        if (tv && fake == null) runCatching { firstFocus.requestFocus() }
    }
    // con la pantalla falsa se pregunta cada 30 s: si el distribuidor registra el equipo, la app se abre sola
    LaunchedEffect(fake) {
        while (fake != null) {
            kotlinx.coroutines.delay(30_000)
            val c = Panel.checkMac(deviceId)
            val line = c.value
            if (line != null) { fake = null; connect(line); break }
            if (c.error == null && Panel.fakeScreen == null) fake = null
        }
    }
    fake?.let { f ->
        com.latmpx.player.ui.screens.FakeScreenView(f, deviceId) { Store.fakeUnlocked = true; fake = null }
        return
    }
    // primera consulta al panel en curso: fondo negro con la rueda (nunca el inicio de sesión antes de saber
    // si va la pantalla falsa)
    if (checking) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            androidx.compose.material3.CircularProgressIndicator(color = NfRed)
        }
        return
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
        focusedLabelColor = Color.White, unfocusedLabelColor = NfGray2, cursorColor = NfRed, focusedContainerColor = Color(0xFF333333), unfocusedContainerColor = Color(0xFF333333),
    )
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val viewport = maxHeight
        PosterWall(posters, columns = if (tv) 8 else 4)
        // celular: logo arriba, la caja de inicio de sesión en el medio y la firma del distribuidor abajo
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding()
                .then(if (tv) Modifier else Modifier.heightIn(min = viewport)),
            verticalArrangement = if (tv) Arrangement.Top else Arrangement.SpaceBetween,
        ) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = sidePad(), vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                LogoHeader(height = 46.dp)
                Spacer(Modifier.weight(1f))
            }
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Column(
                    Modifier.widthIn(max = 400.dp).fillMaxWidth()
                        .background(Color(0xBF000000), RoundedCornerShape(6.dp)).padding(horizontal = if (tv) 32.dp else 24.dp, vertical = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    if (!PanelCrypto.hasKey()) {
                        ErrorBanner(stringResource(R.string.login_no_key))
                    }
                    // varias líneas para este equipo: se entra con la primera que funciona (ya no se pregunta)
                    Text(stringResource(R.string.sign_in), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start)
                    err?.let { ErrorBanner(it) }
                    // celular sin internet (o el panel no responde): lo descargado se puede ver igual
                    val online = com.latmpx.player.data.rememberOnline()
                    if (!review && !tv && (!online || err.let { it == tr(R.string.err_panel_offline) || it == tr(R.string.err_panel_offline_short) || it == tr(R.string.err_server_offline) })) {
                        if (!online) Text(stringResource(R.string.no_internet), color = NfGray2, fontSize = 13.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start)
                        com.latmpx.player.ui.components.AppButton(stringResource(R.string.my_downloads), Modifier.fillMaxWidth(), primary = !online,
                            icon = Icons.Filled.Download, onClick = onDownloads)
                    }
                    
                    OutlinedTextField(
                        value = user, onValueChange = { user = it }, label = { Text(stringResource(R.string.username)) }, singleLine = true, colors = fieldColors,
                        keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(imeAction = ImeAction.Next)), modifier = Modifier.fillMaxWidth().then(Modifier.tvTextInput()),
                    )
                    OutlinedTextField(
                        value = pass, onValueChange = { pass = it }, label = { Text(stringResource(R.string.password)) }, singleLine = true, colors = fieldColors,
                        visualTransformation = if (showPass) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            androidx.compose.material3.IconButton(onClick = { showPass = !showPass }, modifier = Modifier.focusRequester(eyeFocus)) {
                                androidx.compose.material3.Icon(
                                    if (showPass) androidx.compose.material.icons.Icons.Filled.VisibilityOff else androidx.compose.material.icons.Icons.Filled.Visibility,
                                    stringResource(if (showPass) R.string.hide_password else R.string.show_password), tint = Color.White,
                                )
                            }
                        },
                        keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done)),
                        keyboardActions = KeyboardActions(onDone = { }),
                        modifier = Modifier.fillMaxWidth()
                            // TV: derecha desde la contraseña va al ojito (el campo se queda con las flechas)
                            .then(if (tv) Modifier.onPreviewKeyEvent { e ->
                                if (e.key == androidx.compose.ui.input.key.Key.DirectionRight && e.type == androidx.compose.ui.input.key.KeyEventType.KeyDown) {
                                    runCatching { eyeFocus.requestFocus() }; true
                                } else false
                            } else Modifier)
                            .then(Modifier.tvTextInput()),
                    )
                    
                    if (!review) Column(Modifier.fillMaxWidth().background(Color(0x33FFFFFF), RoundedCornerShape(4.dp)).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.mac_code_remote), color = NfGray2, fontSize = 12.sp)
                        Text(deviceId, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                    }
                    
                    RedButton(stringResource(R.string.sign_in), Modifier.fillMaxWidth().focusRequester(firstFocus)) {
                        act {
                            if (user.isBlank() || pass.isBlank()) { err = tr(R.string.login_enter_credentials); return@act }
                            if (review) {
                                // una cuenta del tema de prueba entra al tema; cualquier otra sigue como siempre (línea IPTV)
                                status = tr(R.string.login_activating)
                                Panel.reviewLogin(user.trim(), pass.trim(), false).value?.let { onReview(it); return@act }
                            }
                            if (dns.isEmpty()) Panel.fetchDns().let { d -> d.value?.let { dns = it }; if (d.value == null) err = d.error }
                            val server = dns.getOrNull(dnsIdx) ?: dns.firstOrNull()
                            if (server == null) { if (err == null) err = tr(R.string.login_no_servers); return@act }
                            fromAutodemo = false
                            // la línea se valida desde este equipo (el DNS elegido primero y después los demás, como Roku y
                            // Samsung): el hosting del panel puede no llegar al servidor IPTV (lo bloquea o tarda) y antes eso
                            // dejaba fuera con «No se pudo validar la línea con el servidor IPTV»
                            status = tr(R.string.login_connecting_to, tr(R.string.server_n, dnsIdx + 1))
                            val order = (listOf(server) + dns).map(Xtream::normalize).distinct()
                            val v = Xtream.login(order.map { s -> tr(R.string.server_n, dns.map(Xtream::normalize).indexOf(s).coerceAtLeast(0) + 1) to s }, user.trim(), pass.trim())
                            if (v is Xtream.LoginResult.Fail) { err = v.message; return@act }
                            val ses = (v as Xtream.LoginResult.Ok).session
                            status = tr(R.string.login_activating)
                            // validated: el panel la registra aunque él no reciba respuesta del servidor IPTV; 503 = no la
                            // registró por eso (panel viejo), se entra igual con la línea que este equipo ya validó
                            val r = Panel.submitUrl(deviceId, user.trim(), pass.trim(), ses.base, validated = true, expTs = ses.expTs)
                            if (r.value == null && r.code != 503) { err = r.error; return@act }
                            if (!resolve() && err == null) connect(Panel.Line(ses.dnsName, ses.base, user.trim(), pass.trim()))
                        }
                    }
                    
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        // solo si hay demo configurada en el panel (features); si el panel no respondió: con distribuidor
                        // lo de tenant_config, con Omitir como siempre. Sin la llave del panel no hay botón.
                        // tema de prueba: Auto-Demo entra al tema (no crea ni registra ninguna demo)
                        if (review && PanelCrypto.hasKey()) HeroButton(stringResource(R.string.autodemo), Icons.Filled.CardGiftcard, false, Modifier.weight(1f).height(48.dp)) {
                            act {
                                status = tr(R.string.login_creating_demo)
                                val r = Panel.reviewLogin("", "", true)
                                r.value?.let { onReview(it) } ?: run { err = r.error }
                            }
                        }
                        else if (PanelCrypto.hasKey() && (demoConfigured ?: Tenant.demoEnabled)) HeroButton(stringResource(R.string.autodemo), Icons.Filled.CardGiftcard, false, Modifier.weight(1f).height(48.dp)) {
                            // el panel decide (si el dueño borró el registro, el equipo puede pedir otra demo)
                            act {
                                status = tr(R.string.login_creating_demo)
                                // un código de revendedor escrito en Contraseña deja la demo a su nombre
                                val r = Panel.autoDemo(deviceId, pass)
                                val demo = r.value
                                if (demo == null) {
                                    err = r.error
                                    if (r.code == 403) { demoUsed = true; Store.demoUsed = true }
                                    return@act
                                }
                                Store.demoUsed = false; demoUsed = false
                                fromAutodemo = true
                                // se entra con la línea que acaba de dar el panel (antes se volvía a pedir con auth.php /
                                // check_mac y, si ese servidor no respondía en https, la demo quedaba creada sin acceso)
                                val d = dns.ifEmpty { Panel.fetchDns().value.orEmpty() }
                                if (!tryDemo(demo, listOf(demo.url) + d)) {
                                    // último intento: las líneas que el panel tiene para el equipo
                                    val first = err
                                    err = null
                                    val found = resolve()
                                    if (err != null || !found) err = first ?: err
                                }
                            }
                        }
                        
                        if (review) Spacer(Modifier.weight(1f))
                        else if (dns.size > 1 || true) {
                            Box(Modifier.weight(1f)) {
                                DnsButton()
                            }
                        } else {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                    if (busy) {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = NfRed, strokeWidth = 2.dp)
                            Text(status, color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp), textAlign = TextAlign.Center)
                        }
                    }
                }
                // siempre visible (con número o con Omitir): vuelve a «Número de distribuidor»
                FocusBox(onClick = { if (!busy) onChangeDistributor() }, modifier = Modifier.padding(top = 12.dp), shape = RoundedCornerShape(4.dp), focusScale = 1.05f) { f ->
                    Text(stringResource(R.string.change_distributor), color = if (f) Color.Black else Color.White, fontSize = 15.sp,
                        textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                        modifier = Modifier.background(if (f) Color.White else Color(0x99000000)).padding(horizontal = 14.dp, vertical = 10.dp))
                }
            }
            Text("© ${java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)} ${Tenant.nameOr("MPX Player")}", color = Color(0xFF999999), fontSize = 14.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 28.dp).background(Color(0x99000000)).padding(20.dp).navigationBarsPadding())
        }
    }
}

@Composable
private fun ErrorBanner(text: String) {
    Text(text, color = Color.White, fontSize = 14.sp, lineHeight = 19.sp,
        modifier = Modifier.fillMaxWidth().background(Color(0xFFE87C03), RoundedCornerShape(4.dp)).padding(horizontal = 16.dp, vertical = 12.dp))
}

@Composable
private fun RedButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    AppButton(text, modifier.fillMaxWidth(), primary = true, onClick = onClick)
}
