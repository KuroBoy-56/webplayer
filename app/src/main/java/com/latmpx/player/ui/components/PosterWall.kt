package com.latmpx.player.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage

/**
 * Fondo del inicio de sesión como la web (.nf-login-wall): cuadrícula de pósters inclinada -8°,
 * que sube despacio sin fin (120 s por vuelta), con la sombra negra encima.
 */
@Composable
fun PosterWall(posters: List<String>, columns: Int, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(Color.Black).clipToBounds()) {
        if (posters.isNotEmpty()) {
            val anim = rememberInfiniteTransition(label = "wall")
            val p by anim.animateFloat(0f, 1f, infiniteRepeatable(tween(120_000, easing = LinearEasing), RepeatMode.Restart), label = "wallY")
            var h by remember { mutableIntStateOf(0) }
            val safePosters = remember(posters, columns) { posters.take(posters.size - (posters.size % columns)) }
            val rows = remember(safePosters, columns) { (safePosters + safePosters).chunked(columns) }
            Box(Modifier.fillMaxSize().graphicsLayer { rotationZ = -8f; scaleX = 1.3f; scaleY = 1.3f }) {
                Column(
                    Modifier.fillMaxWidth().wrapContentHeight(align = Alignment.Top, unbounded = true)
                        .onSizeChanged { h = it.height }
                        .graphicsLayer { translationY = -p * h / 2f },
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    rows.forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { url ->
                                AsyncImage(
                                    model = url, contentDescription = null, contentScale = ContentScale.Crop,
                                    modifier = Modifier.weight(1f).aspectRatio(2f / 3f).clip(RoundedCornerShape(4.dp)).background(Color(0xFF111111)),
                                )
                            }
                            repeat(columns - row.size) { Box(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
        // .nf-login-shade
        Box(Modifier.fillMaxSize().background(Color(0x8C000000)))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xD9000000), Color(0x59000000), Color(0xD9000000)))))
    }
}
