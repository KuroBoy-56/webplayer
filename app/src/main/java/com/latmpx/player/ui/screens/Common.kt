package com.latmpx.player.ui.screens

import androidx.compose.ui.res.stringResource
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.size
import com.latmpx.player.R
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

/**
 * Celular: flecha «Atrás» (ficha, categoría, actor, Ver todo). Vuelve a la pantalla anterior, que sigue donde estaba.
 * overlay: círculo oscuro para ir encima de la imagen de la ficha.
 */
@Composable
fun PhoneBackButton(state: AppState, modifier: Modifier = Modifier, overlay: Boolean = false) {
    Box(
        modifier.size(44.dp).clip(androidx.compose.foundation.shape.CircleShape)
            .background(if (overlay) androidx.compose.ui.graphics.Color(0x8C000000) else androidx.compose.ui.graphics.Color.Transparent)
            .clickable { state.pop() },
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.material3.Icon(
            androidx.compose.material.icons.Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back),
            tint = androidx.compose.ui.graphics.Color.White,
        )
    }
}

@Composable
fun Loading(msg: String = stringResource(R.string.loading)) {
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

/** índice id → título que se rehace solo cuando cambia la lista (antes cada tarjeta recorría todo el catálogo) */
private class IdIndex {
    private var src: List<Item>? = null
    private var map: Map<Int, Item> = emptyMap()

    @Synchronized
    fun get(list: List<Item>, id: Int): Item? {
        if (src !== list) { map = list.associateBy { it.id }; src = list }
        return map[id]
    }
}

private val movieIndex = IdIndex()
private val seriesIndex = IdIndex()

/** Busca la película o serie completa a partir de una entrada de "Continuar viendo" ("movie:12" o "series:5:301"). */
fun AppState.itemFromProgress(p: Progress): Item? {
    val parts = p.key.split(":")
    val id = parts.getOrNull(1)?.toIntOrNull() ?: return null
    return when (parts[0]) {
        "movie" -> movieIndex.get(movies, id) ?: Item(id, p.title, p.poster, Kind.MOVIE, categoryId = p.categoryId)
        "series" -> seriesIndex.get(series, id) ?: Item(id, p.title, p.poster, Kind.SERIES, categoryId = p.categoryId)
        else -> null
    }
}
