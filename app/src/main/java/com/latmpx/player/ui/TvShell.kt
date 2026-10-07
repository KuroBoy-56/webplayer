package com.latmpx.player.ui

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/** Secciones del menú superior de TV, en el mismo orden que el reproductor web. */
private val tvTabs = listOf(Tab.HOME, Tab.SERIES, Tab.MOVIES, Tab.LIVE, Tab.SPORTS, Tab.MYLIST)

/**
 * Estructura de la app de TV: menú arriba como el reproductor web y el contenido debajo.
 * Atrás: cierra la ficha abierta; en una sección sube al menú; en el menú pregunta si salir.
 */
@Composable
fun TvShell(state: AppState, content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val tabFocus = remember { Tab.entries.associateWith { FocusRequester() } }
    var menuFocused by remember { mutableStateOf(false) }
    var contentFocused by remember { mutableStateOf(false) }
    var askExit by remember { mutableStateOf(false) }
    val top = state.stack.lastOrNull()

    // al volver de una ficha (o cambiar de sección) el foco nunca queda perdido: si nada lo tomó, va al menú
    LaunchedEffect(top, state.tab) {
        kotlinx.coroutines.delay(350)
        if (!menuFocused && !contentFocused) runCatching { tabFocus.getValue(state.tab).requestFocus() }
    }

    BackHandler {
        when {
            state.stack.isNotEmpty() -> state.pop()
            !menuFocused -> runCatching { tabFocus.getValue(state.tab).requestFocus() }
            else -> askExit = true
        }
    }

    Box(Modifier.fillMaxSize().background(NfBg)) {
        Column(Modifier.fillMaxSize()) {
            // la ficha de un contenido ocupa toda la pantalla, sin menú
            if (top == null) {
                TvTopBar(state, tabFocus, Modifier.onFocusChanged { menuFocused = it.hasFocus })
            }
            Box(Modifier.weight(1f).fillMaxWidth().onFocusChanged { contentFocused = it.hasFocus }) { content() }
        }
    }

    if (askExit) ExitDialog(onStay = { askExit = false }, onExit = { (ctx as? Activity)?.finishAffinity() })
}

@Composable
private fun TvTopBar(state: AppState, tabFocus: Map<Tab, FocusRequester>, modifier: Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color(0xFF000000), Color(0xF0080808))))
            .padding(horizontal = 36.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LogoHeader(height = 30.dp)
        Spacer(Modifier.width(28.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            tvTabs.forEach { t -> TopTab(t.label, state.tab == t, Modifier.focusRequester(tabFocus.getValue(t))) { state.tab = t } }
        }
        Spacer(Modifier.weight(1f))
        FocusBox(
            onClick = { state.tab = Tab.SEARCH }, modifier = Modifier.focusRequester(tabFocus.getValue(Tab.SEARCH)),
            shape = CircleShape, focusScale = 1.12f,
        ) { f ->
            Box(Modifier.size(40.dp).background(if (f) Color.White else if (state.tab == Tab.SEARCH) Color(0x33FFFFFF) else Color.Transparent, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Search, "Buscar", tint = if (f) Color.Black else Color.White, modifier = Modifier.size(24.dp))
            }
        }
        Spacer(Modifier.width(14.dp))
        FocusBox(
            onClick = { state.tab = Tab.ACCOUNT }, modifier = Modifier.focusRequester(tabFocus.getValue(Tab.ACCOUNT)),
            shape = RoundedCornerShape(6.dp), focusScale = 1.12f,
        ) { f ->
            Box(
                Modifier.size(38.dp)
                    .background(Brush.linearGradient(listOf(Color(0xFFE50914), Color(0xFF8E0B12))), RoundedCornerShape(6.dp))
                    .then(if (f || state.tab == Tab.ACCOUNT) Modifier.border(2.dp, Color.White, RoundedCornerShape(6.dp)) else Modifier),
                contentAlignment = Alignment.Center,
            ) {
                Text(state.session?.user?.take(1)?.uppercase() ?: "U", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
        }
    }
}

@Composable
private fun TopTab(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(20.dp), focusScale = 1.06f) { f ->
        val bg by animateColorAsState(if (f) Color.White else Color.Transparent, label = "tab")
        Column(
            Modifier.background(bg, RoundedCornerShape(20.dp)).padding(horizontal = 14.dp, vertical = 7.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                label, fontSize = 15.sp, maxLines = 1,
                color = if (f) Color.Black else if (selected) Color.White else Color(0xFFB3B3B3),
                fontWeight = if (selected || f) FontWeight.Bold else FontWeight.Medium,
            )
            // la sección actual lleva una línea roja debajo, como en la web
            Box(Modifier.padding(top = 3.dp).width(if (selected && !f) 18.dp else 0.dp).height(3.dp).background(NfRed, RoundedCornerShape(2.dp)))
        }
    }
}

/** Pregunta antes de cerrar la app (segundo "atrás" desde el menú). */
@Composable
private fun ExitDialog(onStay: () -> Unit, onExit: () -> Unit) {
    val stay = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { stay.requestFocus() } }
    Dialog(onDismissRequest = onStay, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xCC1A0003), Color(0xF2000000)), radius = 1400f)),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier.widthIn(max = 520.dp)
                    .background(Brush.verticalGradient(listOf(Color(0xFF1F1F1F), Color(0xFF121212))), RoundedCornerShape(18.dp))
                    .border(1.dp, Color(0x22FFFFFF), RoundedCornerShape(18.dp))
                    .padding(horizontal = 40.dp, vertical = 34.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                LogoHeader(height = 42.dp)
                Spacer(Modifier.height(22.dp))
                Text("¿Quieres salir?", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
                Text(
                    "Tu progreso y tu lista quedan guardados para cuando vuelvas.",
                    color = NfGray2, fontSize = 15.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp),
                )
                Spacer(Modifier.height(28.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    DialogButton("Seguir viendo", primary = true, Modifier.focusRequester(stay), onStay)
                    DialogButton("Salir", primary = false, Modifier, onExit)
                }
            }
        }
    }
}

@Composable
private fun DialogButton(text: String, primary: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(8.dp), focusScale = 1.08f) { f ->
        val bg = when {
            f && primary -> Color.White
            f -> NfRed
            else -> Color(0xFF333333)
        }
        Text(
            text, color = if (f && primary) Color.Black else Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.background(bg, RoundedCornerShape(8.dp)).widthIn(min = 170.dp).padding(horizontal = 26.dp, vertical = 13.dp),
            textAlign = TextAlign.Center,
        )
    }
}
