package com.latmpx.player.ui.screens

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import com.latmpx.player.ui.components.tvKeyboard
import com.latmpx.player.ui.components.tvTextInput
import com.latmpx.player.ui.theme.NfGray2

/**
 * Campo de texto de la pantalla de perfiles (nombre, contraseña de la línea). Versión de las ramas de celular: un
 * OutlinedTextField de siempre (en las ramas de TV este archivo usa TvTextFieldBox); ProfilesScreen.kt es el mismo en las 6.
 */
@Composable
fun ProfTextField(value: String, onChange: (String) -> Unit, label: String, password: Boolean, modifier: Modifier = Modifier, onDone: () -> Unit = {}) {
    val fm = LocalFocusManager.current
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true,
        label = { Text(label) },
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = tvKeyboard(KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Text, imeAction = ImeAction.Done)),
        keyboardActions = KeyboardActions(onDone = { fm.clearFocus(); onDone() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
            focusedContainerColor = Color(0xFF2A2A2A), unfocusedContainerColor = Color(0xFF2A2A2A), focusedLabelColor = Color.White, unfocusedLabelColor = NfGray2,
        ),
        modifier = modifier.tvTextInput(),
    )
}
