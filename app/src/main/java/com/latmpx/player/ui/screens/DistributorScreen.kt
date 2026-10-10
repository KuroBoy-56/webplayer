package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.Device
import com.latmpx.player.data.PanelCrypto
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.data.Tmdb
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.components.PosterWall
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfOnRed
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.launch

private const val CODE_LEN = 6

/**
 * Primera pantalla: "Número de distribuidor" (6 dígitos) con Continuar / Omitir.
 * Mismo diseño que el inicio de sesión. En TV se escribe con el teclado numérico en pantalla
 * (o con los números del control remoto).
 */
@Composable
fun DistributorScreen(message: String?, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val deviceId = remember { Device.id(ctx) }
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf(message) }
    var posters by remember { mutableStateOf<List<String>>(emptyList()) }
    val firstFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        if (tv) runCatching { firstFocus.requestFocus() }
        posters = Tmdb.nowPlaying(Store.tmdbKey)
    }

    fun typeDigit(d: String) { if (!busy && code.length < CODE_LEN) { code += d; err = null } }
    fun back() { if (!busy) code = code.dropLast(1) }

    fun submit() {
        if (busy) return
        if (code.length != CODE_LEN) { err = "Escribe los 6 dígitos del número de distribuidor"; return }
        if (!PanelCrypto.hasKey()) { err = "Esta versión de la app no tiene la llave del panel"; return }
        err = null
        busy = true
        scope.launch {
            when (val r = Tenant.fetch(code, deviceId)) {
                is Tenant.Check.Ok -> {
                    val b = r.brand
                    if (b.expired()) err = Tenant.expiredMessage(b)
                    else { Tenant.choose(b); onDone() }
                }
                is Tenant.Check.Denied -> err = r.message
                is Tenant.Check.Problem -> err = r.message
                is Tenant.Check.Offline -> err = r.message
            }
            busy = false
        }
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black).onPreviewKeyEvent { e ->
            // números del control remoto o de un teclado físico
            if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            val kc = e.nativeKeyEvent.keyCode
            when {
                !tv -> false
                kc in android.view.KeyEvent.KEYCODE_0..android.view.KeyEvent.KEYCODE_9 -> { typeDigit((kc - android.view.KeyEvent.KEYCODE_0).toString()); true }
                kc in android.view.KeyEvent.KEYCODE_NUMPAD_0..android.view.KeyEvent.KEYCODE_NUMPAD_9 -> { typeDigit((kc - android.view.KeyEvent.KEYCODE_NUMPAD_0).toString()); true }
                kc == android.view.KeyEvent.KEYCODE_DEL -> { back(); true }
                else -> false
            }
        },
    ) {
        PosterWall(posters, columns = if (tv) 8 else 4)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = sidePad(), vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                LogoHeader(height = 46.dp)
                Spacer(Modifier.weight(1f))
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                Column(
                    Modifier.widthIn(max = if (tv) 460.dp else 400.dp).fillMaxWidth()
                        .background(Color(0xBF000000), RoundedCornerShape(6.dp)).padding(horizontal = if (tv) 32.dp else 24.dp, vertical = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Número de distribuidor", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start)
                    Text(
                        "Escribe el número de 6 dígitos que te dio tu distribuidor. Si no tienes uno, elige Omitir.",
                        color = NfGray2, fontSize = 14.sp, lineHeight = 19.sp, modifier = Modifier.fillMaxWidth(),
                    )
                    err?.let { DistError(it) }
                    if (tv) {
                        CodeBoxes(code)
                        NumPad(firstFocus, onDigit = { typeDigit(it) }, onBack = { back() })
                    } else {
                        OutlinedTextField(
                            value = code,
                            onValueChange = { v -> code = v.filter { it.isDigit() }.take(CODE_LEN); err = null },
                            label = { Text("Número de distribuidor") }, singleLine = true, enabled = !busy,
                            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 22.sp, fontFamily = FontFamily.Monospace, letterSpacing = 6.sp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                                focusedLabelColor = Color.White, unfocusedLabelColor = NfGray2, cursorColor = NfRed,
                                focusedContainerColor = Color(0xFF333333), unfocusedContainerColor = Color(0xFF333333),
                            ),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { submit() }),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    DistButton("Continuar", primary = true, modifier = Modifier.fillMaxWidth()) { submit() }
                    DistButton("Omitir", primary = false, modifier = Modifier.fillMaxWidth()) {
                        if (!busy) { Tenant.skip(); onDone() }
                    }
                    if (busy) {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = NfRed, strokeWidth = 2.dp)
                            Text("Comprobando el número…", color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                        }
                    }
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

/** Sin conexión con el panel por más de 72 h (o error que no borra el número): reintentar o cambiar de distribuidor. */
@Composable
fun TenantRetryScreen(message: String, busy: Boolean, onRetry: () -> Unit, onChange: () -> Unit) {
    val tv = LocalIsTv.current
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (tv) runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(24.dp)
                .background(Color(0xBF000000), RoundedCornerShape(6.dp)).padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LogoHeader(height = 46.dp)
            Text("No se pudo comprobar tu distribuidor", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            DistError(message)
            if (busy) CircularProgressIndicator(color = NfRed, strokeWidth = 2.dp)
            DistButton("Reintentar", primary = true, modifier = Modifier.fillMaxWidth().focusRequester(first)) { if (!busy) onRetry() }
            DistButton("Cambiar distribuidor", primary = false, modifier = Modifier.fillMaxWidth()) { if (!busy) onChange() }
        }
    }
}

/** Cuenta: "Distribuidor: <nombre> (<número>)", "Vence: DD/MM/AAAA (hora de Panamá)" y "Cambiar distribuidor". */
@Composable
fun DistributorAccountCard(onChange: () -> Unit) {
    val b = Tenant.brand
    Text("Distribuidor", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 12.dp))
    Column(
        Modifier.fillMaxWidth().background(Color(0xFF1F1F1F), RoundedCornerShape(12.dp)).border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(12.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (b != null) {
            InfoRow("Distribuidor", "${b.name.ifBlank { "Distribuidor" }} (${b.code})")
            InfoRow("Vence", if (b.expiresText.isNotEmpty()) "${b.expiresText} (hora de Panamá)" else "Sin vencimiento")
        } else {
            InfoRow("Distribuidor", "Ninguno")
        }
        HeroButton("Cambiar distribuidor", Icons.Filled.SwapHoriz, false, onClick = onChange)
    }
}

@Composable
private fun InfoRow(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(k, color = NfGray2, fontSize = 15.sp)
        Spacer(Modifier.size(12.dp))
        Text(v, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.End, modifier = Modifier.weight(1f, fill = false))
    }
}

@Composable
private fun DistError(text: String) {
    Text(text, color = Color.White, fontSize = 14.sp, lineHeight = 19.sp,
        modifier = Modifier.fillMaxWidth().background(Color(0xFFE87C03), RoundedCornerShape(4.dp)).padding(horizontal = 16.dp, vertical = 12.dp))
}

@Composable
private fun DistButton(text: String, primary: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    com.latmpx.player.ui.components.AppButton(text, modifier, primary = primary, onClick = onClick)
}

/** TV: los 6 dígitos escritos */
@Composable
private fun CodeBoxes(code: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(CODE_LEN) { i ->
            val ch = code.getOrNull(i)?.toString().orEmpty()
            Box(
                Modifier.size(width = 44.dp, height = 54.dp).background(Color(0xFF333333), RoundedCornerShape(6.dp))
                    .border(2.dp, if (i == code.length) Color.White else Color(0xFF555555), RoundedCornerShape(6.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(ch, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

/** TV: teclado numérico que se recorre con el control remoto */
@Composable
private fun NumPad(first: FocusRequester, onDigit: (String) -> Unit, onBack: () -> Unit) {
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("", "0", "<"))
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEachIndexed { r, keys ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                keys.forEachIndexed { c, k ->
                    if (k.isEmpty()) {
                        Spacer(Modifier.size(width = 72.dp, height = 46.dp))
                    } else {
                        val mod = if (r == 0 && c == 0) Modifier.focusRequester(first) else Modifier
                        FocusBox(onClick = { if (k == "<") onBack() else onDigit(k) }, modifier = mod, shape = RoundedCornerShape(10.dp), focusScale = 1.1f) { f ->
                            Box(
                                Modifier.size(width = 72.dp, height = 46.dp).background(if (f) Color.White else Color(0xFF2A2A2A), RoundedCornerShape(10.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                val tint = if (f) Color.Black else Color.White
                                if (k == "<") Icon(Icons.AutoMirrored.Filled.Backspace, "Borrar", tint = tint, modifier = Modifier.size(22.dp))
                                else Text(k, color = tint, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}
