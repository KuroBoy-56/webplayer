package com.latmpx.player.ui.screens

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import com.latmpx.player.ui.components.TvTextFieldBox
import com.latmpx.player.ui.components.rememberTvField
import com.latmpx.player.ui.components.tvKeyboard
import com.latmpx.player.ui.theme.NfGray2

/**
 * Campo de texto de la pantalla de perfiles (nombre, contraseña de la línea). En TV con [TvTextFieldBox] (1.5.0): el
 * control pasa por el campo sin abrir el teclado y OK empieza a escribir. Las ramas de celular tienen su propia versión
 * de este archivo (un OutlinedTextField de siempre); ProfilesScreen.kt es el mismo en todas.
 */
@Composable
fun ProfTextField(value: String, onChange: (String) -> Unit, label: String, password: Boolean, modifier: Modifier = Modifier, onDone: () -> Unit = {}) {
    val tf = rememberTvField()
    TvTextFieldBox(tf, modifier) { fieldModifier ->
        OutlinedTextField(
            value = value, onValueChange = onChange, singleLine = true,
            label = { Text(label) },
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = tvKeyboard(KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Text, imeAction = ImeAction.Done)),
            keyboardActions = KeyboardActions(onDone = { tf.leave(); onDone() }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                focusedContainerColor = Color(0xFF2A2A2A), unfocusedContainerColor = Color(0xFF2A2A2A), focusedLabelColor = Color.White, unfocusedLabelColor = NfGray2,
            ),
            interactionSource = tf.interaction,
            modifier = fieldModifier,
        )
    }
}
