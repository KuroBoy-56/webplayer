package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.BuildConfig
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2

@Composable
fun AccountScreen(state: AppState, onLogout: () -> Unit) {
    val s = state.session ?: return
    Column(Modifier.fillMaxSize().background(NfBg).padding(sidePad()).widthIn(max = 560.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LogoHeader(height = 60.dp)
        Text("Mi cuenta", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Row2("Usuario", s.user)
        Row2("Vence", s.expires)
        Row2("Servidor", s.dnsName)
        Row2("Películas", state.movies.size.toString())
        Row2("Series", state.series.size.toString())
        Row2("Versión", BuildConfig.VERSION_NAME)
        HeroButton("Cerrar sesión", Icons.Filled.Logout, false, onClick = onLogout)
    }
}

@Composable
private fun Row2(k: String, v: String) {
    Column {
        Text(k, color = NfGray2, fontSize = 13.sp)
        Text(v.ifBlank { "—" }, color = Color.White, fontSize = 17.sp)
    }
}
