package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.PanelConfig
import com.latmpx.player.data.Panel
import com.latmpx.player.data.Session
import com.latmpx.player.data.Xtream
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.launch

/** Inicio de sesión: el usuario solo escribe usuario y contraseña; los DNS vienen del panel y se prueban en orden. */
@Composable
fun LoginScreen(config: PanelConfig?, onLogged: (Session) -> Unit) {
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var cfg by remember { mutableStateOf(config) }
    val scope = rememberCoroutineScope()

    fun go() {
        if (user.isBlank() || pass.isBlank()) { err = "Escribe tu usuario y contraseña"; return }
        busy = true; err = null
        scope.launch {
            val c = cfg ?: Panel.load().also { cfg = it }
            if (c == null || c.dns.isEmpty()) { busy = false; err = "No se pudo obtener la configuración del panel. Revisa tu conexión."; return@launch }
            when (val r = Xtream.login(c.dns, user.trim(), pass.trim())) {
                is Xtream.LoginResult.Ok -> onLogged(r.session)
                is Xtream.LoginResult.Fail -> err = r.message
            }
            busy = false
        }
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
        focusedLabelColor = Color.White, unfocusedLabelColor = NfGray2, cursorColor = NfRed, focusedContainerColor = Color(0xFF333333), unfocusedContainerColor = Color(0xFF333333),
    )
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 420.dp).fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(24.dp)
                .background(Color(0xCC000000), RoundedCornerShape(8.dp)).padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            LogoHeader(Modifier.align(Alignment.CenterHorizontally), height = 80.dp)
            Text("Iniciar sesión", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            config?.message?.takeIf { it.isNotBlank() }?.let { Text(it, color = NfGray2, fontSize = 13.sp) }
            OutlinedTextField(
                value = user, onValueChange = { user = it }, label = { Text("Usuario") }, singleLine = true, colors = fieldColors,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = pass, onValueChange = { pass = it }, label = { Text("Contraseña") }, singleLine = true, colors = fieldColors,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { go() }), modifier = Modifier.fillMaxWidth(),
            )
            err?.let { Text(it, color = Color(0xFFE87C03), fontSize = 14.sp) }
            Button(
                onClick = { go() }, enabled = !busy, shape = RoundedCornerShape(4.dp),
                colors = ButtonDefaults.buttonColors(containerColor = NfRed, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                if (busy) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.height(22.dp))
                else Text("Iniciar sesión", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}
