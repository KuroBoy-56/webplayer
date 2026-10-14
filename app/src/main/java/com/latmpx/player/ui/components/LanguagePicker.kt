package com.latmpx.player.ui.components

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.Lang
import com.latmpx.player.R
import com.latmpx.player.ui.theme.NfBg2
import com.latmpx.player.ui.theme.NfRed

/** cada idioma escrito en su propio idioma; "auto" se traduce */
private val NAMES = listOf("es" to "Español", "en" to "English", "pt" to "Português", "fr" to "Français")

/** lo elegido en Cuenta › Idioma de la app, para mostrarlo debajo del título */
@Composable
fun languageChoiceLabel(): String =
    NAMES.firstOrNull { it.first == Lang.setting }?.second ?: stringResource(R.string.lang_auto)

/** Lista de idiomas (dedo y control remoto). Al elegir uno se guarda y se recrea la pantalla, sin cerrar sesión. */
@Composable
fun LanguageDialog(onDismiss: () -> Unit) {
    val activity = LocalContext.current as? Activity
    val first = remember { FocusRequester() }
    val options = listOf("auto" to stringResource(R.string.lang_auto)) + NAMES
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {},
        dismissButton = { FocusBox(onClick = onDismiss) { Text(stringResource(R.string.close), color = Color.White, modifier = Modifier.padding(10.dp)) } },
        containerColor = NfBg2,
        title = { Text(stringResource(R.string.app_language), color = Color.White, fontWeight = FontWeight.Bold) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                options.forEachIndexed { i, (key, name) ->
                    val sel = key == Lang.setting
                    FocusBox(
                        onClick = {
                            onDismiss()
                            if (!sel) {
                                Lang.set(key)
                                Lang.reopenAccount = true
                                activity?.recreate()
                            }
                        },
                        focusScale = 1.02f,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp).then(if (i == 0) Modifier.focusRequester(first) else Modifier),
                    ) { f ->
                        Row(Modifier.fillMaxWidth().background(if (f) Color(0xFF333333) else Color(0xFF1F1F1F)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(name, color = Color.White, fontSize = 16.sp, fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.weight(1f))
                            if (sel) Icon(Icons.Filled.Check, null, tint = NfRed)
                        }
                    }
                }
            }
        },
    )
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
}
