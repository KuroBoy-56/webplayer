package com.latmpx.player.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke

/**
 * Fondo de la tarjeta en vivo: la cancha del deporte vista desde arriba, en miniatura y apaisada (fútbol, básquet,
 * fútbol americano, béisbol, hockey, tenis / vóley / bádminton); otro deporte, un degradado oscuro. Se dibuja (no son
 * imágenes): se ve igual en cualquier pantalla y no pesa nada.
 */
@Composable
fun SportField(sport: String, modifier: Modifier) {
    val kind = fieldKind(sport)
    Canvas(modifier) {
        when (kind) {
            "soccer" -> soccer()
            "basketball" -> basketball()
            "american" -> american()
            "baseball" -> baseball()
            "hockey" -> hockey()
            "court" -> court()
            else -> drawRect(Brush.linearGradient(listOf(Color(0xFF232B3A), Color(0xFF0E1118))))
        }
    }
}

private fun fieldKind(sport: String): String = when (sport.lowercase()) {
    "soccer", "futsal", "beach soccer" -> "soccer"
    "basketball" -> "basketball"
    "american football", "australian football", "rugby", "rugby league", "rugby union" -> "american"
    "baseball" -> "baseball"
    "ice hockey", "field hockey" -> "hockey"
    "tennis", "volleyball", "badminton", "table tennis" -> "court"
    else -> ""
}

/**
 * Torneo grande: un degradado leve con sus colores encima de la cancha (Champions en azul, Libertadores en dorado…).
 * null = sin color especial.
 */
fun competitionTheme(league: String): List<Color>? {
    val l = league.lowercase()
    return when {
        "champions league" in l && "afc" !in l && "caf" !in l -> listOf(Color(0xB30A1A6B), Color(0x8C1B3FB0), Color(0x660A1A6B))
        "europa league" in l || "conference league" in l -> listOf(Color(0x99F26B1D), Color(0x66000000))
        "libertadores" in l -> listOf(Color(0x99C9A227), Color(0x803B2A00))
        "sudamericana" in l -> listOf(Color(0x9900529F), Color(0x66C9A227))
        "world cup" in l || "mundial" in l -> listOf(Color(0x995C0A1A), Color(0x80C9A227))
        "copa america" in l || "copa américa" in l -> listOf(Color(0x990B3D91), Color(0x80C8102E))
        "euro" in l && "championship" in l -> listOf(Color(0x990B3D91), Color(0x66FFFFFF))
        l == "nba" || l.startsWith("nba ") -> listOf(Color(0x9917408B), Color(0x80C9082A))
        "premier league" in l && "english" in l || l == "english premier league" -> listOf(Color(0x993D195B), Color(0x6600FF85))
        else -> null
    }
}

private val LINE = Color(0xCCFFFFFF)

private fun DrawScope.lines(w: Float = 2f) = Stroke(width = w)

private fun DrawScope.soccer() {
    // césped a franjas
    val stripes = 10
    val sw = size.width / stripes
    for (i in 0 until stripes) drawRect(if (i % 2 == 0) Color(0xFF2E7D32) else Color(0xFF388E3C), Offset(i * sw, 0f), Size(sw + 1f, size.height))
    val m = size.minDimension * 0.08f
    val f = Rect(m, m, size.width - m, size.height - m)
    val s = lines(2.2f)
    drawRect(LINE, f.topLeft, f.size, style = s)
    drawLine(LINE, Offset(f.center.x, f.top), Offset(f.center.x, f.bottom), 2.2f)
    drawCircle(LINE, f.height * 0.18f, f.center, style = s)
    drawCircle(LINE, 3f, f.center)
    // áreas grande y chica de los dos lados
    val bigW = f.width * 0.13f
    val bigH = f.height * 0.56f
    val smallW = f.width * 0.05f
    val smallH = f.height * 0.26f
    for (left in listOf(true, false)) {
        val x = if (left) f.left else f.right
        val dir = if (left) 1 else -1
        drawRect(LINE, Offset(if (left) x else x - bigW, f.center.y - bigH / 2), Size(bigW, bigH), style = s)
        drawRect(LINE, Offset(if (left) x else x - smallW, f.center.y - smallH / 2), Size(smallW, smallH), style = s)
        drawCircle(LINE, 2.5f, Offset(x + dir * f.width * 0.09f, f.center.y))
    }
}

private fun DrawScope.basketball() {
    drawRect(Brush.horizontalGradient(listOf(Color(0xFFC9803F), Color(0xFFD99252), Color(0xFFC9803F))))
    // tablas del parqué
    val planks = 14
    for (i in 1 until planks) drawLine(Color(0x22000000), Offset(0f, size.height * i / planks), Offset(size.width, size.height * i / planks), 1f)
    val m = size.minDimension * 0.07f
    val f = Rect(m, m, size.width - m, size.height - m)
    val s = lines(2.2f)
    drawRect(LINE, f.topLeft, f.size, style = s)
    drawLine(LINE, Offset(f.center.x, f.top), Offset(f.center.x, f.bottom), 2.2f)
    drawCircle(LINE, f.height * 0.17f, f.center, style = s)
    val keyW = f.width * 0.19f
    val keyH = f.height * 0.36f
    for (left in listOf(true, false)) {
        val x = if (left) f.left else f.right
        drawRect(Color(0x55A33B1E), Offset(if (left) x else x - keyW, f.center.y - keyH / 2), Size(keyW, keyH))
        drawRect(LINE, Offset(if (left) x else x - keyW, f.center.y - keyH / 2), Size(keyW, keyH), style = s)
        // línea de 3
        val r = f.height * 0.46f
        drawArc(LINE, if (left) -90f else 90f, 180f, false, Offset(x - r, f.center.y - r), Size(r * 2, r * 2), style = s)
        drawCircle(LINE, 3f, Offset(x + (if (left) 1 else -1) * f.width * 0.05f, f.center.y))
    }
}

private fun DrawScope.american() {
    drawRect(Color(0xFF2F7D32))
    val m = size.minDimension * 0.07f
    val f = Rect(m, m, size.width - m, size.height - m)
    val end = f.width * 0.08f
    drawRect(Color(0xFF1B5E20), Offset(f.left, f.top), Size(end, f.height))
    drawRect(Color(0xFF1B5E20), Offset(f.right - end, f.top), Size(end, f.height))
    drawRect(LINE, f.topLeft, f.size, style = lines(2.2f))
    val inner = f.width - end * 2
    for (i in 0..10) {
        val x = f.left + end + inner * i / 10f
        drawLine(LINE, Offset(x, f.top), Offset(x, f.bottom), if (i == 5) 2.6f else 1.6f)
        // marcas de cada yarda
        for (k in 1..4) {
            val xx = x + inner / 50f * k
            if (i < 10) {
                drawLine(Color(0x88FFFFFF), Offset(xx, f.top + f.height * 0.34f), Offset(xx, f.top + f.height * 0.38f), 1f)
                drawLine(Color(0x88FFFFFF), Offset(xx, f.bottom - f.height * 0.38f), Offset(xx, f.bottom - f.height * 0.34f), 1f)
            }
        }
    }
}

private fun DrawScope.baseball() {
    drawRect(Brush.radialGradient(listOf(Color(0xFF43A047), Color(0xFF2E7D32)), Offset(size.width / 2, size.height), size.width))
    val home = Offset(size.width / 2, size.height * 0.92f)
    val d = size.height * 0.36f
    // tierra del cuadro interior
    val dirt = Path().apply {
        moveTo(home.x, home.y + 6f)
        lineTo(home.x - d * 1.15f, home.y - d * 0.95f)
        quadraticTo(home.x, home.y - d * 2.45f, home.x + d * 1.15f, home.y - d * 0.95f)
        close()
    }
    drawPath(dirt, Color(0xFFB9773C))
    // diamante de pasto y bases
    val first = Offset(home.x + d, home.y - d)
    val second = Offset(home.x, home.y - d * 2)
    val third = Offset(home.x - d, home.y - d)
    val diamond = Path().apply { moveTo(home.x, home.y); lineTo(first.x, first.y); lineTo(second.x, second.y); lineTo(third.x, third.y); close() }
    drawPath(diamond, Color(0xFF43A047))
    drawPath(diamond, LINE, style = lines(2f))
    drawLine(LINE, home, Offset(home.x + size.width, home.y - size.width), 2f)
    drawLine(LINE, home, Offset(home.x - size.width, home.y - size.width), 2f)
    for (b in listOf(first, second, third, home)) drawRect(Color.White, Offset(b.x - 4f, b.y - 4f), Size(8f, 8f))
    drawCircle(Color(0xFFB9773C), d * 0.16f, Offset(home.x, home.y - d))
}

private fun DrawScope.hockey() {
    // hielo un poco oscurecido: los nombres en blanco se leen encima
    drawRect(Brush.verticalGradient(listOf(Color(0xFF8FA6BC), Color(0xFF6D879F))))
    val m = size.minDimension * 0.07f
    val f = Rect(m, m, size.width - m, size.height - m)
    val r = f.height * 0.3f
    drawRoundRect(Color(0xCCFFFFFF), f.topLeft, f.size, CornerRadius(r, r), style = lines(2.4f))
    drawLine(Color(0xFFD32F2F), Offset(f.center.x, f.top), Offset(f.center.x, f.bottom), 4f)
    for (x in listOf(f.left + f.width * 0.33f, f.left + f.width * 0.67f)) drawLine(Color(0xFF1565C0), Offset(x, f.top), Offset(x, f.bottom), 4f)
    for (x in listOf(f.left + f.width * 0.07f, f.right - f.width * 0.07f)) drawLine(Color(0xFFD32F2F), Offset(x, f.top + r * 0.3f), Offset(x, f.bottom - r * 0.3f), 2f)
    drawCircle(Color(0xFF1565C0), f.height * 0.15f, f.center, style = lines(2f))
    for (x in listOf(f.left + f.width * 0.18f, f.right - f.width * 0.18f)) for (y in listOf(f.top + f.height * 0.28f, f.bottom - f.height * 0.28f)) {
        drawCircle(Color(0xFFD32F2F), f.height * 0.12f, Offset(x, y), style = lines(1.6f))
        drawCircle(Color(0xFFD32F2F), 3f, Offset(x, y))
    }
}

private fun DrawScope.court() {
    drawRect(Color(0xFF2E6E4E))
    val m = size.minDimension * 0.1f
    val f = Rect(m * 1.6f, m, size.width - m * 1.6f, size.height - m)
    drawRect(Color(0xFF2F5C8A), f.topLeft, f.size)
    val s = lines(2.2f)
    drawRect(LINE, f.topLeft, f.size, style = s)
    // dobles y servicio
    val alley = f.height * 0.12f
    drawLine(LINE, Offset(f.left, f.top + alley), Offset(f.right, f.top + alley), 2f)
    drawLine(LINE, Offset(f.left, f.bottom - alley), Offset(f.right, f.bottom - alley), 2f)
    val svc = f.width * 0.23f
    drawLine(LINE, Offset(f.center.x - svc, f.top + alley), Offset(f.center.x - svc, f.bottom - alley), 2f)
    drawLine(LINE, Offset(f.center.x + svc, f.top + alley), Offset(f.center.x + svc, f.bottom - alley), 2f)
    drawLine(LINE, Offset(f.center.x - svc, f.center.y), Offset(f.center.x + svc, f.center.y), 2f)
    // red
    drawLine(Color.White, Offset(f.center.x, f.top - m * 0.4f), Offset(f.center.x, f.bottom + m * 0.4f), 3.5f)
}
