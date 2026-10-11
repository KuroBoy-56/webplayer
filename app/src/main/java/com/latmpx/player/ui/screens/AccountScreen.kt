package com.latmpx.player.ui.screens

import kotlinx.coroutines.launch

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.OndemandVideo
import androidx.compose.material.icons.filled.ArrowForwardIos
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.border
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.BuildConfig
import com.latmpx.player.Device
import com.latmpx.player.data.Cloud
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.Route
import com.latmpx.player.ui.components.DnsButton
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.components.PosterCard
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

@Composable
fun AccountScreen(state: AppState, onLogout: () -> Unit, onChangeDistributor: () -> Unit = {}) {
    val s = state.session ?: return
    val progressList = remember(state.refresh, Cloud.rev) { Cloud.progressList() }
    
    var streamFormat by remember { mutableStateOf(com.latmpx.player.data.Store.streamFormat) }
    var extPlayer by remember { mutableStateOf(com.latmpx.player.data.Store.externalPlayer) }
    var pinDialog by remember { mutableStateOf(false) }
    var pinValue by remember { mutableStateOf("") }
    
    // PIN parental siempre activo: es el del panel (0000 de fábrica); un cambio se guarda en el panel
    var pinStep by remember { mutableStateOf("ENTER") }
    var tempPin by remember { mutableStateOf("") }
    var pinError by remember { mutableStateOf(false) }
    var pinMsg by remember { mutableStateOf<String?>(null) }
    var pinBusy by remember { mutableStateOf(false) }
    var currentPin by remember { mutableStateOf("") }
    val pinScope = androidx.compose.runtime.rememberCoroutineScope()
    var blockedCatsState by remember { mutableStateOf(com.latmpx.player.data.Store.blockedCats) }
    
    if (pinDialog) {
        androidx.compose.ui.window.Dialog(onDismissRequest = { pinDialog = false; tempPin = "" }, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.widthIn(max = 560.dp).fillMaxWidth(0.6f).background(Brush.verticalGradient(listOf(Color(0xE61A1A1A), Color(0xF2000000))), RoundedCornerShape(16.dp)).border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(16.dp)).padding(24.dp)) {
                Column(Modifier.fillMaxWidth()) {
                    Text(when(pinStep) { "CREATE" -> "Nuevo PIN"; "ENTER" -> "Ingresar PIN"; "SETTINGS" -> "Control Parental"; "CATS" -> "Carpetas Bloqueadas"; else -> "" }, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 16.dp))
                    
                    when (pinStep) {
                        "CREATE", "ENTER" -> {
                            Text(if (pinStep == "CREATE") "Escribe el nuevo PIN de 4 números (se guarda también en el panel):" else "Ingresa tu PIN (el de fábrica es 0000):", color = Color.White)
                            Spacer(Modifier.height(8.dp))
                            com.latmpx.player.ui.components.PinPad(tempPin, onChange = { tempPin = it; pinError = false; pinMsg = null }, error = pinError, onDone = {
                                if (pinBusy || tempPin.length != 4) return@PinPad
                                if (pinStep == "ENTER") {
                                    if (tempPin == com.latmpx.player.data.Store.parentalPin) { currentPin = tempPin; tempPin = ""; pinStep = "SETTINGS" }
                                    else { pinError = true; tempPin = "" }
                                } else {
                                    val newPin = tempPin
                                    pinBusy = true; pinMsg = "Guardando en el panel…"
                                    pinScope.launch {
                                        val r = com.latmpx.player.data.Panel.setPin(com.latmpx.player.data.Store.deviceIdOrEmpty(), currentPin, newPin)
                                        pinBusy = false
                                        if (r.value != null) { currentPin = newPin; tempPin = ""; pinMsg = null; pinStep = "SETTINGS" }
                                        else { pinError = true; tempPin = ""; pinMsg = r.error ?: "No se pudo guardar el PIN en el panel" }
                                    }
                                }
                            })
                            pinMsg?.let { Text(it, color = if (pinBusy) Color(0xFFB3B3B3) else Color(0xFFFF8A80), fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp)) }
                        }
                        "SETTINGS" -> {
                            val firstRow = remember { androidx.compose.ui.focus.FocusRequester() }
                            LaunchedEffect(Unit) { runCatching { firstRow.requestFocus() } }
                            com.latmpx.player.ui.components.TvSettingsRow(Icons.Filled.Lock, "Cambiar PIN", "Actualizar el PIN actual", Modifier.focusRequester(firstRow)) { pinStep = "CREATE"; tempPin = "" }
                            Divider(color = Color(0xFF333333))
                            com.latmpx.player.ui.components.TvSettingsRow(Icons.Filled.OndemandVideo, "Carpetas Bloqueadas", "${blockedCatsState.size} carpetas ocultas") { pinStep = "CATS" }
                            Divider(color = Color(0xFF333333))
                            com.latmpx.player.ui.components.TvSettingsRow(Icons.Filled.Lock, "Mostrar todas las carpetas", "Quita las carpetas bloqueadas (el PIN sigue activo)") {
                                com.latmpx.player.data.Store.blockedCats = emptySet()
                                blockedCatsState = emptySet()
                                state.refresh++
                            }
                        }
                        "CATS" -> {
                            val allCats = remember { (state.movieCats + state.seriesCats + state.liveCats).distinctBy { it.id }.sortedBy { it.name } }
                            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                                allCats.forEach { cat ->
                                    com.latmpx.player.ui.components.FocusBox(onClick = {
                                        val m = blockedCatsState.toMutableSet()
                                        if (m.contains(cat.id)) m.remove(cat.id) else m.add(cat.id)
                                        blockedCatsState = m
                                    }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), focusScale = 1.01f) { f ->
                                        Row(Modifier.fillMaxWidth().background(if (f) Color(0x33FFFFFF) else Color.Transparent).padding(vertical = 6.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Checkbox(checked = blockedCatsState.contains(cat.id), onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = NfRed))
                                            Spacer(Modifier.width(8.dp))
                                            Text(cat.name, color = Color.White, fontWeight = if (f) FontWeight.Bold else FontWeight.Normal)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // en TV el PIN se confirma con la tecla ✓ del teclado; aquí quedan Cancelar / Guardar / Cerrar
                    Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
                        if (pinStep != "SETTINGS") {
                            com.latmpx.player.ui.components.TvDialogButton("Cancelar", primary = false) {
                                if (pinStep == "CATS") { pinStep = "SETTINGS"; blockedCatsState = com.latmpx.player.data.Store.blockedCats }
                                else { pinDialog = false; tempPin = ""; pinMsg = null }
                            }
                        }
                        if (pinStep == "CATS") {
                            com.latmpx.player.ui.components.TvDialogButton("Guardar", primary = true) {
                                com.latmpx.player.data.Store.blockedCats = blockedCatsState
                                pinStep = "SETTINGS"
                                state.refresh++
                            }
                        } else if (pinStep == "SETTINGS") {
                            com.latmpx.player.ui.components.TvDialogButton("Cerrar", primary = true) { pinDialog = false }
                        }
                    }
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().background(NfBg).verticalScroll(rememberScrollState()).padding(sidePad())) {
        LogoHeader(height = 50.dp)
        Spacer(Modifier.height(24.dp))
        
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(64.dp).background(NfRed, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                Text(s.user.take(1).uppercase(), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(16.dp))
            Column {
                Text(s.user, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Text("Suscripción Activa", color = Color(0xFF4CAF50), fontSize = 14.sp)
            }
        }
        
        Spacer(Modifier.height(32.dp))
        
        if (progressList.isNotEmpty()) {
            Text("Continuar viendo", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 12.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(progressList) { p ->
                    val it = state.itemFromProgress(p)
                    if (it != null) {
                        PosterCard(it.copy(poster = p.poster.ifEmpty { it.poster }), posterWidth(), onClick = { state.push(Route.Detail(it)) }, progress = if (p.duration > 0) p.position.toFloat() / p.duration else 0f)
                    }
                }
            }
            Spacer(Modifier.height(32.dp))
        }

        Text("Detalles de la cuenta", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 12.dp))
        Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color(0xFF2A2A2A), Color(0xFF1A1A1A))), RoundedCornerShape(12.dp)).border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(12.dp)).padding(16.dp)) {
            Row2("Vencimiento", s.expires)
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(vertical = 12.dp))
            Row2("Conexiones", "${s.activeCons} / ${s.maxCons}")
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(vertical = 12.dp))
            Row2("Servidor DNS", s.dnsName)
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(vertical = 12.dp))
            Row2("Miembro desde", s.createdAt)
        }

        Spacer(Modifier.height(32.dp))
        
        Text("Configuración de la aplicación", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 12.dp))
        Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color(0xFF2A2A2A), Color(0xFF1A1A1A))), RoundedCornerShape(12.dp)).border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(12.dp)).padding(vertical = 8.dp)) {
            SettingsItem(Icons.Filled.Lock, "Control Parental", "Activado · el PIN lo administra el panel") {
                pinValue = com.latmpx.player.data.Store.parentalPin
                // siempre se pide el PIN al abrir (antes se quedaba en el menú ya desbloqueado)
                pinStep = "ENTER"; pinError = false; pinMsg = null
                tempPin = ""
                pinDialog = true
            }
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
            SettingsItem(Icons.Filled.OndemandVideo, "Formato de Streaming", when(streamFormat) { "ts" -> "MPEG-TS (.ts)"; "auto" -> "Automático"; else -> "HLS (.m3u8)" }) {
                streamFormat = when(streamFormat) { "m3u8" -> "ts"; "ts" -> "auto"; else -> "m3u8" }
                com.latmpx.player.data.Store.streamFormat = streamFormat
            }
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
            SettingsItem(Icons.Filled.PlayCircle, "Reproductor", if (extPlayer) "Externo" else "Interno (ExoPlayer)") {
                extPlayer = !extPlayer
                com.latmpx.player.data.Store.externalPlayer = extPlayer
            }
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
            
            Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                DnsButton()
            }
            
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Versión", color = NfGray2, fontSize = 15.sp)
                Text(BuildConfig.VERSION_NAME, color = Color.White, fontSize = 15.sp)
            }
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Dirección MAC", color = NfGray2, fontSize = 15.sp)
                Text(Device.id(LocalContext.current), color = Color.White, fontSize = 15.sp)
            }
        }
        
        Spacer(Modifier.height(32.dp))
        // número de distribuidor, vencimiento y "Cambiar distribuidor" (también para quien eligió Omitir)
        DistributorAccountCard(onChangeDistributor)
        Spacer(Modifier.height(32.dp))
        HeroButton("Cerrar sesión", Icons.AutoMirrored.Filled.Logout, false, onClick = onLogout)
        Spacer(Modifier.height(60.dp))
    }
}

@Composable
private fun SettingsItem(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    // TV: la fila se pinta de blanco con el foco del control remoto
    com.latmpx.player.ui.components.TvSettingsRow(icon, title, subtitle, onClick = onClick)
}

@Composable
private fun Row2(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(k, color = NfGray2, fontSize = 15.sp)
        Text(v.ifBlank { "—" }, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}
