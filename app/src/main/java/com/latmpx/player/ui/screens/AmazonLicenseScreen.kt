package com.latmpx.player.ui.screens

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
import com.latmpx.player.data.AmazonLicense
import com.latmpx.player.ui.components.AppButton
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import kotlinx.coroutines.launch

/**
 * Copia instalada por fuera de la Amazon Appstore (o modificada): licencia de la Amazon Appstore con el modo «Bloquear
 * copias» del panel (data/AmazonLicense.kt). «Obtener en Amazon Appstore» abre la ficha de la app en la tienda;
 * «Reintentar» pregunta otra vez (después de instalarla desde la tienda); «Salir» cierra la app.
 */
@Composable
fun AmazonLicenseScreen() {
    val ctx = LocalContext.current
    val tv = LocalIsTv.current
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (tv) runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(24.dp)
                .background(Color(0xBF000000), RoundedCornerShape(6.dp)).padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LogoHeader(height = 46.dp)
            Text(stringResource(R.string.lic_title), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(stringResource(R.string.lic_text), color = Color(0xFFB3B3B3), fontSize = 15.sp, lineHeight = 21.sp, textAlign = TextAlign.Center)
            AppButton(stringResource(R.string.lic_get), Modifier.fillMaxWidth().focusRequester(first), primary = true) { AmazonLicense.openStore(ctx) }
            AppButton(stringResource(R.string.retry), Modifier.fillMaxWidth()) { scope.launch { AmazonLicense.retry(ctx) } }
            AppButton(stringResource(R.string.exit), Modifier.fillMaxWidth()) { (ctx as? Activity)?.finishAffinity() }
        }
    }
}

