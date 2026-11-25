package com.latmpx.player.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
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
import kotlinx.coroutines.delay

/**
 * Aviso del panel (bienvenida o vencimiento) con el diseño de la app.
 * Un solo botón "Entendido" (enfocado de inicio para el control remoto); atrás también lo cierra.
 * Siempre entra entero en la pantalla (TV de 720p, 1080p o 4K: Android TV las muestra todas con ~960x540 dp): la tarjeta
 * se mide con la pantalla, la imagen ocupa lo que queda (más chica si hace falta) y el botón siempre se ve. Antes la
 * tarjeta medía más que la pantalla de la TV y la imagen y el botón quedaban afuera.
 */
@Composable
fun PanelAlertDialog(alert: Alerts.Alert, onClose: () -> Unit) {
    val tv = LocalIsTv.current
    val ok = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { ok.requestFocus() } }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        BoxWithConstraints(
            Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xCC1A0003), Color(0xF2000000)), radius = 1400f)),
            contentAlignment = Alignment.Center,
        ) {
            // pantallas bajas (TV de 540 dp, celular acostado): todo un poco más chico
            val small = maxHeight < 600.dp
            val margin = if (tv) 24.dp else 16.dp
            // TV: compacta, como mucho el 80 % del alto y ~42 % del ancho (entre 300 y 440 dp); celular: como siempre
            val cardMaxH = if (tv) minOf(maxHeight - margin * 2, maxHeight * 0.8f) else maxHeight - margin * 2
            val cardW = if (tv) minOf(maxOf(maxWidth * 0.42f, 300.dp), 440.dp, maxWidth - margin * 2) else minOf(maxWidth - margin * 2, 480.dp)
            val accent = if (alert.expiry) Brush.horizontalGradient(listOf(NfRed, NfRed))
            else Brush.horizontalGradient(listOf(NfRed, Color(0xFFF5C518)))
            Column(
                Modifier.width(cardW).heightIn(max = cardMaxH)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Brush.verticalGradient(listOf(Color(0xFF1F1F1F), Color(0xFF121212))))
                    .border(1.dp, Color(0x22FFFFFF), RoundedCornerShape(14.dp)),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.fillMaxWidth().height(4.dp).background(accent))
                Column(
                    Modifier.padding(horizontal = if (tv) 24.dp else 20.dp, vertical = if (small) 14.dp else 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    LogoHeader(height = if (small) 26.dp else 32.dp)
                    Spacer(Modifier.height(if (small) 8.dp else 12.dp))
                    Text(
                        alert.title, color = if (alert.expiry) NfRed else Color.White,
                        fontSize = if (small) 19.sp else 22.sp, lineHeight = if (small) 23.sp else 27.sp,
                        fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    )
                    // un mensaje largo se desplaza dentro de su espacio (nunca empuja el botón fuera de la pantalla)
                    if (alert.message.isNotBlank()) Text(
                        alert.message, color = NfGray2, fontSize = if (small) 14.sp else 16.sp, lineHeight = if (small) 19.sp else 22.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 6.dp).heightIn(max = cardMaxH * 0.28f).verticalScroll(rememberScrollState()),
                    )
                    // la imagen: lo que queda de alto (weight), entera y sin recortar (Fit)
                    if (alert.images.isNotEmpty()) AlertImages(alert.images, alert.interval, Modifier.weight(1f, fill = false).padding(top = if (small) 10.dp else 14.dp))
                    Spacer(Modifier.height(if (small) 12.dp else 18.dp))
                    AppButton(
                        alert.button.uppercase(), Modifier.fillMaxWidth().focusRequester(ok), primary = true,
                        minHeight = if (small) 40.dp else 46.dp, fontSize = if (small) 15.sp else 17.sp, onClick = onClose,
                    )
                }
            }
        }
    }
}

/**
 * Imágenes del aviso (Alertas del panel): una sola, fija; varias, cambian cada [interval] s en el mismo lugar con un
 * fundido. Todas se cargan de inicio (encimadas), así el cambio nunca deja el recuadro vacío.
 */
@Composable
private fun AlertImages(images: List<String>, interval: Int, modifier: Modifier) {
    var idx by remember(images) { mutableIntStateOf(0) }
    if (images.size > 1) LaunchedEffect(images, interval) {
        while (true) {
            delay(interval.coerceAtLeast(1) * 1000L)
            idx = (idx + 1) % images.size
        }
    }
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
        images.forEachIndexed { i, u ->
            val a by animateFloatAsState(if (i == idx) 1f else 0f, tween(400), label = "alertImg")
            // (Coil la pide del tamaño en píxeles del recuadro: en una TV 4K se ve en 4K)
            AsyncImage(model = u, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().alpha(a))
        }
    }
}
