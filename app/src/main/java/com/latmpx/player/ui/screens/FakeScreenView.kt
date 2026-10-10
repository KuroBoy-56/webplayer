package com.latmpx.player.ui.screens

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import com.latmpx.player.data.FakeScreen
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import kotlinx.coroutines.delay
import java.math.BigDecimal
import java.math.MathContext

/**
 * Pantalla falsa a pantalla completa (equipo nuevo en una app elegida en el panel).
 * La calculadora funciona de verdad; escribir el código del panel y "=" abre el inicio de sesión (onUnlock).
 * Abajo, pequeño, el ID del equipo para que el distribuidor lo registre: al registrarse, la app se abre sola.
 */
@Composable
fun FakeScreenView(screen: FakeScreen, deviceId: String, onUnlock: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xFF111827))) {
        when (screen.type) {
            "carrusel" -> Carousel(screen.images, screen.intervalS)
            "image" -> AsyncImage(model = screen.url, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            "video" -> LoopVideo(screen.url)
            "web" -> WebPage(screen.url)
            else -> Calculator(screen.unlock, onUnlock)
        }
        Text(
            "ID $deviceId", color = Color(0x55FFFFFF), fontSize = 10.sp, fontFamily = FontFamily.Monospace,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp),
        )
    }
}

@Composable
private fun Carousel(images: List<String>, intervalS: Int) {
    var i by remember { mutableIntStateOf(0) }
    LaunchedEffect(images) {
        while (images.size > 1) {
            delay(intervalS * 1000L)
            i = (i + 1) % images.size
        }
    }
    images.getOrNull(i)?.let { AsyncImage(model = it, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
}

@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
@Composable
private fun LoopVideo(url: String) {
    AndroidView(
        factory = { ctx ->
            val p = ExoPlayer.Builder(ctx).build().apply {
                setMediaItem(MediaItem.fromUri(url))
                repeatMode = Player.REPEAT_MODE_ALL
                volume = 0f
                prepare()
                playWhenReady = true
            }
            PlayerView(ctx).apply { useController = false; player = p }
        },
        onRelease = { v -> v.player?.release(); v.player = null },
        modifier = Modifier.fillMaxSize(),
    )
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun WebPage(url: String) {
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                webViewClient = WebViewClient() // los enlaces se quedan dentro de la página
                loadUrl(url)
            }
        },
        onRelease = { it.destroy() },
        modifier = Modifier.fillMaxSize(),
    )
}

/* ---------------- calculadora ---------------- */

private val KEYS = listOf(
    listOf("C", "(", ")", "÷"),
    listOf("7", "8", "9", "×"),
    listOf("4", "5", "6", "-"),
    listOf("1", "2", "3", "+"),
    listOf("0", ".", "="),
)

@Composable
private fun Calculator(unlock: String, onUnlock: () -> Unit) {
    val tv = LocalIsTv.current
    var display by remember { mutableStateOf("") }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (tv) runCatching { first.requestFocus() } }
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier.widthIn(max = 380.dp).fillMaxWidth().background(Color(0xFF1F2937), RoundedCornerShape(20.dp)).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                display.ifEmpty { "0" }, color = Color.White, fontSize = 40.sp, maxLines = 1, textAlign = TextAlign.End,
                modifier = Modifier.fillMaxWidth().background(Color(0xFF374151), RoundedCornerShape(10.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
            )
            KEYS.forEachIndexed { r, row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { k ->
                        val wide = k == "0"
                        val color = when (k) { "C" -> Color(0xFFEF4444); "÷", "×", "-", "+", "=" -> Color(0xFFF59E0B); else -> Color(0xFF4B5563) }
                        FocusBox(
                            onClick = {
                                when (k) {
                                    "C" -> display = ""
                                    "=" -> {
                                        if (unlock.isNotEmpty() && display == unlock) { display = ""; onUnlock() }
                                        else display = calc(display)
                                    }
                                    else -> display = (if (display == "Error") "" else display) + k
                                }
                            },
                            modifier = Modifier.weight(if (wide) 2f else 1f).height(58.dp)
                                .then(if (r == 1 && k == "7") Modifier.focusRequester(first) else Modifier),
                            shape = RoundedCornerShape(10.dp), focusScale = 1.06f,
                        ) { _ ->
                            Box(Modifier.fillMaxSize().background(color), contentAlignment = Alignment.Center) {
                                Text(k, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** + - × ÷ y paréntesis, sin librerías */
private fun calc(src: String): String = runCatching {
    val t = Regex("""\d+(\.\d+)?|[()+\-×÷]""").findAll(src).map { it.value }.toList()
    if (t.isEmpty()) return ""
    val p = CalcParser(t)
    val v = p.add()
    if (p.pos != t.size) error("sobra")
    v.stripTrailingZeros().toPlainString()
}.getOrDefault("Error")

private class CalcParser(val t: List<String>) {
    var pos = 0
    fun num(): BigDecimal {
        val x = t.getOrNull(pos++) ?: error("fin")
        return when (x) {
            "(" -> { val v = add(); pos++; v }
            "-" -> num().negate()
            else -> BigDecimal(x)
        }
    }
    fun mul(): BigDecimal {
        var v = num()
        while (t.getOrNull(pos) == "×" || t.getOrNull(pos) == "÷") {
            val o = t[pos++]; val r = num()
            v = if (o == "×") v.multiply(r) else v.divide(r, MathContext.DECIMAL64)
        }
        return v
    }
    fun add(): BigDecimal {
        var v = mul()
        while (t.getOrNull(pos) == "+" || t.getOrNull(pos) == "-") {
            val o = t[pos++]; val r = mul()
            v = if (o == "+") v.add(r) else v.subtract(r)
        }
        return v
    }
}
