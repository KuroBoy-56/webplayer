package com.latmpx.player.ui.screens

import androidx.compose.ui.res.stringResource
import com.latmpx.player.R
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
    // nombres normalizados una vez por catálogo y fuera del hilo de la interfaz (antes se normalizaba todo en cada tecla)
    val index by androidx.compose.runtime.produceState(emptyList<Pair<String, com.latmpx.player.data.Item>>(), state.movies, state.series) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { (state.movies + state.series).map { Platforms.fold(it.name) to it } }
    }
    val results = remember(q, index) {
        val f = Platforms.fold(q.trim())
        if (f.length < 2) emptyList()
        else index.filter { it.first.contains(f) }
            .sortedWith(compareByDescending<Pair<String, com.latmpx.player.data.Item>> { it.first.startsWith(f) }.thenByDescending { it.second.added }).take(120).map { it.second }
    }
    Column(Modifier.fillMaxSize().background(NfBg)) {
        OutlinedTextField(
            value = q, onValueChange = { q = it }, singleLine = true, placeholder = { Text(stringResource(R.string.search_hint)) },
            leadingIcon = { Icon(Icons.Filled.Search, null) }, keyboardOptions = com.latmpx.player.ui.components.tvKeyboard(KeyboardOptions(imeAction = ImeAction.Search)),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF444444), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                focusedContainerColor = Color(0xFF2A2A2A), unfocusedContainerColor = Color(0xFF2A2A2A), unfocusedPlaceholderColor = NfGray2, focusedPlaceholderColor = NfGray2,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = sidePad(), vertical = 14.dp).then(Modifier.tvTextInput()),
        )
        if (q.trim().length >= 2) Grid(state, results) else Empty(stringResource(R.string.search_empty))
    }
}
