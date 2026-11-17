package com.latmpx.player.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
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
 * Con el control: crece un poco y muestra un borde (blanco o el acento del distribuidor), como en Netflix para TV.
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
            .then(if (focused) Modifier.border(3.dp, com.latmpx.player.ui.theme.NfFocus, shape) else Modifier)
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

/**
 * TV (1.5.0): campo de texto que el control recorre sin abrir el teclado. En algunos Fire TV el teclado del sistema se
 * abría solo apenas el foco entraba al campo (aunque [tvKeyboard] pide no mostrarlo: el sistema lo muestra al empezar a
 * escribir en un campo) y el foco quedaba atrapado: en Buscar, «Siguiente» llevaba al menú de arriba y al bajar el teclado
 * volvía a abrirse; en el inicio de sesión, subir desde «Iniciar sesión» abría el teclado de la contraseña. Ahora el foco
 * del control queda en un recuadro que se ve igual que el campo enfocado; OK empieza a escribir (el foco pasa al campo y
 * se abre el teclado) y al salir del campo vuelve a ser solo el recuadro. En el celular no cambia nada.
 */
@Stable
class TvField {
    val box = FocusRequester()
    val field = FocusRequester()
    /** para el campo (interactionSource): se ve enfocado también con el foco en el recuadro */
    val interaction = MutableInteractionSource()
    internal var editing by mutableStateOf(false)
    internal var ask by mutableIntStateOf(0)
    internal var boxFocused = false
    internal var shown: FocusInteraction.Focus? = null

    /** empieza a escribir en este campo: el foco pasa al campo y se abre el teclado */
    fun edit() {
        editing = true
        ask++
    }

    /** deja de escribir: el foco vuelve al recuadro (sin teclado) */
    fun leave() {
        runCatching { box.requestFocus() }
    }
}

@Composable
fun rememberTvField(): TvField = remember { TvField() }

/**
 * Envuelve un campo de texto (ver [TvField]). [modifier] es el del lugar que ocupa el campo; el campo recibe en
 * [content] el modifier que tiene que usar (en el celular, [modifier] tal cual: nada cambia).
 */
@Composable
fun TvTextFieldBox(tf: TvField, modifier: Modifier = Modifier, content: @Composable (fieldModifier: Modifier) -> Unit) {
    if (!LocalIsTv.current) {
        content(modifier)
        return
    }
    val kb = LocalSoftwareKeyboardController.current
    LaunchedEffect(tf.ask) {
        if (tf.ask == 0) return@LaunchedEffect
        runCatching { tf.field.requestFocus() }
        kb?.show()
        // otra vez en el cuadro siguiente: algunos equipos abren el teclado recién con el campo ya conectado
        withFrameNanos { }
        if (tf.editing) kb?.show()
    }
    Box(
        modifier
            .onPreviewKeyEvent { e ->
                // OK con el foco en el recuadro: a escribir (con el campo en uso, OK lo atiende el campo: abre el teclado)
                val ok = e.key == Key.DirectionCenter || e.key == Key.Enter || e.key == Key.NumPadEnter
                if (!ok || tf.editing || !tf.boxFocused) false
                else {
                    if (e.type == KeyEventType.KeyUp) tf.edit()
                    true
                }
            }
            .onFocusChanged { st ->
                tf.boxFocused = st.isFocused
                val held = tf.shown
                if (st.isFocused && held == null) {
                    val f = FocusInteraction.Focus()
                    tf.shown = f
                    tf.interaction.tryEmit(f)
                } else if (!st.isFocused && held != null) {
                    tf.interaction.tryEmit(FocusInteraction.Unfocus(held))
                    tf.shown = null
                }
            }
            .focusRequester(tf.box)
            .focusable(),
    ) {
        content(
            Modifier.fillMaxWidth()
                .focusRequester(tf.field)
                // el control nunca entra solo al campo: solo después de OK (edit)
                .focusProperties { canFocus = tf.editing }
                .onFocusChanged { if (!it.isFocused && !it.hasFocus) tf.editing = false }
                .tvTextInput(),
        )
    }
}
