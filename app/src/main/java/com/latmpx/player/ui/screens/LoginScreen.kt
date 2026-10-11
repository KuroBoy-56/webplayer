package com.latmpx.player.ui.screens

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
fun LoginScreen(onLogged: (Session) -> Unit) {
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val deviceId = remember { Device.id(ctx) }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(true) }
    var status by remember { mutableStateOf("Comprobando el equipo en el panel…") }
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

    suspend fun connect(line: Panel.Line) {
        status = "Conectando con ${line.name}…"
        when (val r = Xtream.login(listOf(line.name to line.base), line.user, line.pass)) {
            is Xtream.LoginResult.Ok -> onLogged(r.session)
            is Xtream.LoginResult.Fail -> err = r.message
        }
    }

    suspend fun resolve(): Boolean {
        busy = true; status = "Comprobando el equipo en el panel…"
        val a = Panel.playlists(deviceId)
        var found = a.value.orEmpty()
        var problem = a.error
        if (found.isEmpty()) {
            val c = Panel.checkMac(deviceId)
            c.value?.let { found = listOf(it) }
            if (problem == null) problem = c.error
        }
        lines = found
        if (found.size == 1) connect(found.first())
        else if (found.isEmpty() && problem != null) err = problem
        busy = false
        return found.isNotEmpty()
    }

    fun act(block: suspend () -> Unit) {
        if (busy) return
        err = null
        scope.launch { busy = true; block(); busy = false }
    }

    LaunchedEffect(Store.tmdbKey) { posters = Tmdb.nowPlaying(Store.tmdbKey) }
    LaunchedEffect(Unit) {
        resolve()
        if (lines.isEmpty() && !Store.fakeUnlocked) fake = Panel.fakeScreen
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
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                Column(
                    Modifier.widthIn(max = 400.dp).fillMaxWidth()
                        .background(Color(0xBF000000), RoundedCornerShape(6.dp)).padding(horizontal = if (tv) 32.dp else 24.dp, vertical = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    if (!PanelCrypto.hasKey()) {
                        ErrorBanner("Esta versión de la app no tiene la llave del panel (PANEL_MASTER_KEY). La activación no funcionará hasta instalar una versión configurada.")
                    }
                    if (lines.size > 1) {
                        Text("Elige tu servicio", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                        lines.forEachIndexed { i, l ->
                            HeroButton(l.name.ifBlank { "Servicio ${i + 1}" }, Icons.Filled.PlayArrow, i == 0, if (i == 0) Modifier.focusRequester(firstFocus) else Modifier) {
                                act { connect(l) }
                            }
                        }
                    } else {
                        Text("Iniciar sesión", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start)
                        err?.let { ErrorBanner(it) }
                        
                        OutlinedTextField(
                            value = user, onValueChange = { user = it }, label = { Text("Usuario") }, singleLine = true, colors = fieldColors,
                            keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(imeAction = ImeAction.Next)), modifier = Modifier.fillMaxWidth().then(Modifier.tvTextInput()),
                        )
                        OutlinedTextField(
                            value = pass, onValueChange = { pass = it }, label = { Text("Contraseña") }, singleLine = true, colors = fieldColors,
                            visualTransformation = if (showPass) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = {
                                androidx.compose.material3.IconButton(onClick = { showPass = !showPass }, modifier = Modifier.focusRequester(eyeFocus)) {
                                    androidx.compose.material3.Icon(
                                        if (showPass) androidx.compose.material.icons.Icons.Filled.VisibilityOff else androidx.compose.material.icons.Icons.Filled.Visibility,
                                        if (showPass) "Ocultar contraseña" else "Ver contraseña", tint = Color.White,
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
                        
                        Column(Modifier.fillMaxWidth().background(Color(0x33FFFFFF), RoundedCornerShape(4.dp)).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Código MAC (Activación remota)", color = NfGray2, fontSize = 12.sp)
                            Text(deviceId, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                        }
                        
                        RedButton("Iniciar sesión", Modifier.fillMaxWidth().focusRequester(firstFocus)) {
                            act {
                                if (user.isBlank() || pass.isBlank()) { err = "Escribe tu usuario y contraseña"; return@act }
                                if (dns.isEmpty()) Panel.fetchDns().let { d -> d.value?.let { dns = it }; if (d.value == null) err = d.error }
                                val server = dns.getOrNull(dnsIdx) ?: dns.firstOrNull()
                                if (server == null) { if (err == null) err = "El panel no tiene servidores disponibles"; return@act }
                                status = "Activando…"
                                val r = Panel.submitUrl(deviceId, user.trim(), pass.trim(), server)
                                if (r.value == null) { err = r.error; return@act }
                                if (!resolve() && err == null) connect(Panel.Line("Servidor ${dnsIdx + 1}", Xtream.normalize(server), user.trim(), pass.trim()))
                            }
                        }
                        
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            // el distribuidor puede no tener demo (sin DNS): entonces no se muestra el botón
                            if (Tenant.demoEnabled) HeroButton(if (demoUsed) "Autodemo" else "Autodemo", Icons.Filled.CardGiftcard, false, Modifier.weight(1f).height(48.dp)) {
                                // el panel decide (si el dueño borró el registro, el equipo puede pedir otra demo)
                                act {
                                    status = "Creando demo…"
                                    // un código de revendedor escrito en Contraseña deja la demo a su nombre
                                    val r = Panel.autoDemo(deviceId, pass)
                                    val cred = r.value
                                    if (cred == null) {
                                        err = r.error
                                        if (r.code == 403) { demoUsed = true; Store.demoUsed = true }
                                        return@act
                                    }
                                    Store.demoUsed = false; demoUsed = false
                                    if (!resolve() && err == null) {
                                        val d = dns.ifEmpty { Panel.fetchDns().value.orEmpty() }
                                        val first = d.firstOrNull()
                                        if (first != null) connect(Panel.Line("Demo", Xtream.normalize(first), cred.first, cred.second))
                                        else err = "Demo creada, pero el panel no devolvió el servidor."
                                    }
                                }
                            }
                            
                            if (dns.size > 1 || true) {
                                Box(Modifier.weight(1f)) {
                                    DnsButton()
                                }
                            } else {
                                Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    if (busy) {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = NfRed, strokeWidth = 2.dp)
                            Text(status, color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp), textAlign = TextAlign.Center)
                        }
                    }
                    if (lines.size > 1) err?.let { ErrorBanner(it) }
                }
            }
            Text("© ${java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)} ${Tenant.nameOr("Garevyn TV")}", color = Color(0xFF999999), fontSize = 14.sp,
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
