package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.latmpx.player.data.Platforms
import com.latmpx.player.ui.components.tvTextInput
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2

@Composable
fun SearchScreen(state: AppState) {
    var q by rememberSaveable { mutableStateOf("") }
    val results = remember(q, state.movies, state.series) {
        val f = Platforms.fold(q.trim())
        if (f.length < 2) emptyList()
        else (state.movies + state.series).filter { Platforms.fold(it.name).contains(f) }
            .sortedWith(compareByDescending<com.latmpx.player.data.Item> { Platforms.fold(it.name).startsWith(f) }.thenByDescending { it.added }).take(120)
    }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        OutlinedTextField(
            value = q, onValueChange = { q = it }, singleLine = true, placeholder = { Text("Títulos, películas, series") },
            leadingIcon = { Icon(Icons.Filled.Search, null) }, keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(imeAction = ImeAction.Search)),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF444444), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                focusedContainerColor = Color(0xFF2A2A2A), unfocusedContainerColor = Color(0xFF2A2A2A), unfocusedPlaceholderColor = NfGray2, focusedPlaceholderColor = NfGray2,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = sidePad(), vertical = 14.dp).then(Modifier.tvTextInput()),
        )
        if (q.trim().length >= 2) Grid(state, results) else Empty("Busca por nombre entre todas las películas y series")
    }
}
