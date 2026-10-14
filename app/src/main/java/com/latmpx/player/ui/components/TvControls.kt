package com.latmpx.player.ui.components
import androidx.compose.ui.res.stringResource
import com.latmpx.player.tr
import com.latmpx.player.R

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForwardIos
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Check
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/**
 * Teclado numérico para el PIN del control parental, hecho para el control remoto:
 * cuatro puntos arriba y las teclas 1-9, borrar, 0 y aceptar.
 */
@Composable
fun PinPad(value: String, onChange: (String) -> Unit, onDone: () -> Unit, error: Boolean = false) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(bottom = 18.dp)) {
            repeat(4) { i ->
                val filled = i < value.length
                Box(
                    Modifier.size(18.dp)
                        .background(if (filled) Color.White else Color.Transparent, CircleShape)
                        .border(2.dp, if (error) NfRed else if (filled) Color.White else NfGray2, CircleShape),
                )
            }
        }
        val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("<", "0", "ok"))
        rows.forEachIndexed { r, keys ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                keys.forEachIndexed { c, k ->
                    val mod = if (r == 0 && c == 0) Modifier.focusRequester(first) else Modifier
                    PadKey(k, mod) {
                        when (k) {
                            "<" -> onChange(value.dropLast(1))
                            "ok" -> onDone()
                            else -> if (value.length < 4) onChange(value + k)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PadKey(key: String, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(12.dp), focusScale = 1.1f) { f ->
        Box(
            Modifier.size(width = 76.dp, height = 54.dp).background(
                when {
                    f && key == "ok" -> NfRed
                    f -> Color.White
                    else -> Color(0xFF2A2A2A)
                },
                RoundedCornerShape(12.dp),
            ),
            contentAlignment = Alignment.Center,
        ) {
            val tint = if (f && key != "ok") Color.Black else Color.White
            when (key) {
                "<" -> Icon(Icons.AutoMirrored.Filled.Backspace, stringResource(R.string.delete), tint = tint, modifier = Modifier.size(24.dp))
                "ok" -> Icon(Icons.Filled.Check, stringResource(R.string.ok), tint = tint, modifier = Modifier.size(26.dp))
                else -> Text(key, color = tint, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** Fila de ajustes que se resalta con el foco del control remoto. */
@Composable
fun TvSettingsRow(icon: ImageVector, title: String, subtitle: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp), focusScale = 1.02f) { f ->
        Row(
            Modifier.fillMaxWidth().background(if (f) Color.White else Color.Transparent).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val main = if (f) Color.Black else Color.White
            Icon(icon, null, tint = if (f) Color.Black else NfGray2, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = main, fontSize = 16.sp, fontWeight = if (f) FontWeight.Bold else FontWeight.Normal)
                Text(subtitle, color = if (f) Color(0xFF444444) else NfGray2, fontSize = 13.sp)
            }
            Icon(Icons.AutoMirrored.Filled.ArrowForwardIos, null, tint = if (f) Color.Black else NfGray2, modifier = Modifier.size(16.dp))
        }
    }
}

/** Botón de diálogo para TV: blanco con el foco (o rojo si es la acción principal). */
@Composable
fun TvDialogButton(text: String, primary: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    AppButton(text, modifier, primary = primary, fontSize = 15.sp, onClick = onClick)
}
