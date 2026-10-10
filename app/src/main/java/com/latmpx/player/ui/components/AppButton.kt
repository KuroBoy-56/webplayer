package com.latmpx.player.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.ui.theme.NfOnRed
import com.latmpx.player.ui.theme.NfRed
import com.latmpx.player.ui.theme.NfText

/**
 * Botón de la app (igual que Roku, Vega OS, Windows y la web):
 *  - principal: color del distribuidor (rojo sin distribuidor) con texto de contraste
 *  - secundario: blanco translúcido con borde fino
 *  - con el foco del control (o al tocarlo): borde de 3 px y crece un 5 % con una animación corta
 * El tamaño lo da [modifier] (fillMaxWidth, weight…); sin tamaño se ajusta al texto.
 */
@Composable
fun AppButton(
    text: String,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    icon: ImageVector? = null,
    minHeight: Dp = 48.dp,
    fontSize: TextUnit = 16.sp,
    onClick: () -> Unit,
) {
    val src = remember { MutableInteractionSource() }
    val focused by src.collectIsFocusedAsState()
    val sc by animateFloatAsState(if (focused) 1.05f else 1f, tween(130), label = "appButton")
    val shape = RoundedCornerShape(6.dp)
    val text0 = NfText
    val bg = when {
        primary -> NfRed
        focused -> text0.copy(alpha = 0.30f)
        else -> text0.copy(alpha = 0.15f)
    }
    val ring = when {
        focused -> Color.White
        primary -> Color.Transparent
        else -> text0.copy(alpha = 0.35f)
    }
    val fg = if (primary) NfOnRed else text0
    Box(
        modifier
            .scale(sc)
            .clip(shape)
            .background(bg)
            .border(if (focused) 3.dp else 1.dp, ring, shape)
            .clickable(interactionSource = src, indication = null, onClick = onClick)
            .heightIn(min = minHeight),
        contentAlignment = Alignment.Center,
    ) {
        Row(Modifier.padding(horizontal = 18.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) Icon(icon, null, tint = fg, modifier = Modifier.size(22.dp).padding(end = 2.dp))
            Text(
                text, color = fg, fontSize = fontSize, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = if (icon != null) Modifier.padding(start = 6.dp) else Modifier,
            )
        }
    }
}
