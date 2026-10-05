import os
import re

p = r"C:\Users\Yjamp\.gemini\antigravity\scratch\webplayer-android\app\src\main\java\com\latmpx\player\ui\screens\AccountScreen.kt"

content = r'''package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
fun AccountScreen(state: AppState, onLogout: () -> Unit) {
    val s = state.session ?: return
    val progressList = remember(state.refresh, Cloud.rev) { Cloud.progressList() }

    Column(Modifier.fillMaxSize().background(NfBg).verticalScroll(rememberScrollState()).padding(sidePad())) {
        LogoHeader(height = 50.dp)
        Spacer(Modifier.height(16.dp))
        
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(60.dp).background(Color.Gray, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                Text(s.user.take(1).uppercase(), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(16.dp))
            Column {
                Text(s.user, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Text("Estado: Activo", color = Color(0xFF4CAF50), fontSize = 14.sp)
            }
        }
        
        Spacer(Modifier.height(24.dp))
        
        // Historial
        if (progressList.isNotEmpty()) {
            Text("Historial de visualización", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(progressList) { p ->
                    val it = state.itemFromProgress(p)
                    if (it != null) {
                        PosterCard(it.copy(poster = p.poster.ifEmpty { it.poster }), posterWidth(), onClick = { state.push(Route.Detail(it)) }, progress = if (p.duration > 0) p.position.toFloat() / p.duration else 0f)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }

        // Datos de la cuenta
        Column(Modifier.fillMaxWidth().background(Color(0xFF1A1A1A), RoundedCornerShape(8.dp)).padding(16.dp)) {
            Text("Detalles de suscripción", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Row2("Vence", s.expires)
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(vertical = 8.dp))
            Row2("Conexiones", "1 / 1")
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(vertical = 8.dp))
            Row2("Servidor", s.dnsName)
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(vertical = 8.dp))
            Row2("Cliente desde", "2024")
        }

        Spacer(Modifier.height(16.dp))
        
        Column(Modifier.fillMaxWidth().background(Color(0xFF1A1A1A), RoundedCornerShape(8.dp)).padding(16.dp)) {
            Text("Ajustes", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Row2("Código MAC", Device.id(LocalContext.current))
            Divider(color = Color(0xFF333333), modifier = Modifier.padding(vertical = 8.dp))
            Row2("Versión", BuildConfig.VERSION_NAME)
            Spacer(Modifier.height(12.dp))
            DnsButton()
        }
        
        Spacer(Modifier.height(24.dp))
        HeroButton("Cerrar sesión", Icons.Filled.Logout, false, onClick = onLogout)
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun Row2(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(k, color = NfGray2, fontSize = 15.sp)
        Text(v.ifBlank { "—" }, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}
'''

with open(p, "w", encoding="utf-8") as f:
    f.write(content)

print("AccountScreen updated.")
