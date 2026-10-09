package com.latmpx.player.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController

/** true cuando la app corre en un televisor */
val LocalIsTv = compositionLocalOf { false }

/**
 * Elemento que se puede elegir con el control remoto o con el dedo.
 * Con el control: crece un poco y muestra un borde blanco, como en Netflix para TV.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FocusBox(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(6.dp),
    focusScale: Float = 1.08f,
    onFocus: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    val src = remember { MutableInteractionSource() }
    val focused by src.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocus?.invoke() }
    val sc by animateFloatAsState(if (focused) focusScale else 1f, label = "focus")
    Box(
        modifier
            .scale(sc)
            .clip(shape)
            .then(if (focused) Modifier.border(3.dp, Color.White, shape) else Modifier)
            .combinedClickable(interactionSource = src, indication = null, onLongClick = onLongClick, onClick = onClick),
    ) { content(focused) }
}

/**
 * Campos de texto en TV: el teclado no se abre solo al pasar por el campo con el control
 * (antes aparecía en pantalla completa y atrapaba el foco); se abre con OK. En el celular no cambia nada.
 */
@Composable
fun tvKeyboard(opts: KeyboardOptions = KeyboardOptions.Default): KeyboardOptions =
    if (LocalIsTv.current) opts.copy(showKeyboardOnFocus = false) else opts

/** TV: OK sobre el campo de texto abre el teclado (usar junto con [tvKeyboard]) */
@Composable
fun Modifier.tvTextInput(): Modifier {
    if (!LocalIsTv.current) return this
    val kb = LocalSoftwareKeyboardController.current
    return this.onPreviewKeyEvent { e ->
        val ok = e.key == Key.DirectionCenter || e.key == Key.Enter || e.key == Key.NumPadEnter
        if (ok && e.type == KeyEventType.KeyUp) kb?.show()
        ok
    }
}
