package com.latmpx.player.ui.screens

import androidx.compose.foundation.layout.safeDrawingPadding
import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.R
import com.latmpx.player.data.PlayIntegrity
import com.latmpx.player.ui.components.AppButton
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import kotlinx.coroutines.launch

/**
 * Copia instalada por fuera de Google Play (o modificada): Play Integrity con el modo «Bloquear copias» del panel
 * (data/PlayIntegrity.kt). «Obtener en Google Play» muestra el aviso de Google (o abre la ficha de la app);
 * «Reintentar» pregunta otra vez (después de instalarla desde Google Play); «Salir» cierra la app.
 */
@Composable
fun PlayIntegrityScreen() {
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (tv) runCatching { first.requestFocus() } }
    // todo dentro de la parte visible (barra de estado, muesca y barra de navegación)
    Box(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(24.dp)
                .background(Color(0xBF000000), RoundedCornerShape(6.dp)).padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LogoHeader(height = 46.dp)
            Text(stringResource(R.string.pi_title), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(stringResource(R.string.pi_text), color = Color(0xFFB3B3B3), fontSize = 15.sp, lineHeight = 21.sp, textAlign = TextAlign.Center)
            AppButton(stringResource(R.string.pi_get), Modifier.fillMaxWidth().focusRequester(first), primary = true) {
                val a = ctx as? Activity
                scope.launch { if (a != null) PlayIntegrity.fix(a) else PlayIntegrity.openStore(ctx) }
            }
            AppButton(stringResource(R.string.retry), Modifier.fillMaxWidth()) { scope.launch { PlayIntegrity.retry(ctx) } }
            AppButton(stringResource(R.string.exit), Modifier.fillMaxWidth()) { (ctx as? Activity)?.finishAffinity() }
        }
    }
}

