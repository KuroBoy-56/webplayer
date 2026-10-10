package com.latmpx.player.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import com.latmpx.player.data.Alerts
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/**
 * Aviso del panel (bienvenida o vencimiento) con el diseño de la app.
 * Un solo botón "Entendido" (enfocado de inicio para el control remoto); atrás también lo cierra.
 */
@Composable
fun PanelAlertDialog(alert: Alerts.Alert, onClose: () -> Unit) {
    val tv = LocalIsTv.current
    val ok = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { ok.requestFocus() } }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Box(
            Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xCC1A0003), Color(0xF2000000)), radius = 1400f)),
            contentAlignment = Alignment.Center,
        ) {
            val accent = if (alert.expiry) Brush.horizontalGradient(listOf(NfRed, NfRed))
            else Brush.horizontalGradient(listOf(NfRed, Color(0xFFF5C518)))
            Column(
                Modifier.padding(20.dp).widthIn(max = if (tv) 560.dp else 480.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Brush.verticalGradient(listOf(Color(0xFF1F1F1F), Color(0xFF121212))))
                    .border(1.dp, Color(0x22FFFFFF), RoundedCornerShape(16.dp)),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.fillMaxWidth().height(4.dp).background(accent))
                Column(
                    Modifier.verticalScroll(rememberScrollState()).padding(horizontal = if (tv) 40.dp else 24.dp, vertical = if (tv) 30.dp else 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    LogoHeader(height = if (tv) 40.dp else 34.dp)
                    Spacer(Modifier.height(18.dp))
                    Text(
                        alert.title, color = if (alert.expiry) NfRed else Color.White,
                        fontSize = if (tv) 26.sp else 22.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    )
                    if (alert.message.isNotBlank()) Text(
                        alert.message, color = NfGray2, fontSize = if (tv) 18.sp else 16.sp, lineHeight = if (tv) 27.sp else 24.sp,
                        textAlign = TextAlign.Center, modifier = Modifier.padding(top = 10.dp),
                    )
                    if (alert.image.isNotEmpty()) AsyncImage(
                        model = alert.image, contentDescription = null, contentScale = ContentScale.Fit,
                        modifier = Modifier.padding(top = 18.dp).fillMaxWidth().heightIn(max = if (tv) 220.dp else 260.dp).clip(RoundedCornerShape(8.dp)),
                    )
                    Spacer(Modifier.height(24.dp))
                    AppButton(alert.button.uppercase(), Modifier.fillMaxWidth().focusRequester(ok), primary = true, fontSize = 17.sp, onClick = onClose)
                }
            }
        }
    }
}
