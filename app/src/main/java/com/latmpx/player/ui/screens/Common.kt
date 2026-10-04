package com.latmpx.player.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Progress
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

@Composable
fun posterWidth(): Dp = if (LocalIsTv.current) 128.dp else 108.dp

@Composable
fun sidePad(): Dp = if (LocalIsTv.current) 36.dp else 14.dp

@Composable
fun Loading(msg: String = "Cargando…") {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        CircularProgressIndicator(color = NfRed)
        Text(msg, color = NfGray2, modifier = Modifier.padding(top = 12.dp))
    }
}

@Composable
fun Empty(msg: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(msg, color = NfGray2, fontSize = 16.sp, textAlign = TextAlign.Center)
    }
}

/** Busca la película o serie completa a partir de una entrada de "Continuar viendo" ("movie:12" o "series:5:301"). */
fun AppState.itemFromProgress(p: Progress): Item? {
    val parts = p.key.split(":")
    val id = parts.getOrNull(1)?.toIntOrNull() ?: return null
    return when (parts[0]) {
        "movie" -> movies.firstOrNull { it.id == id } ?: Item(id, p.title, p.poster, Kind.MOVIE, categoryId = p.categoryId)
        "series" -> series.firstOrNull { it.id == id } ?: Item(id, p.title, p.poster, Kind.SERIES, categoryId = p.categoryId)
        else -> null
    }
}
