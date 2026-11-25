package com.latmpx.player.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.latmpx.player.BuildConfig
import com.latmpx.player.R
import com.latmpx.player.data.Profiles
import com.latmpx.player.ui.components.FocusBox

// colores de la parte de abajo, como la app de Netflix para celular: azul noche y el panel curvo azul pizarra
private val PfNavy = Color(0xFF1B2232)
private val PfArcTop = Color(0xFF2B3546)
private val PfArcBottom = Color(0xFF4A5873)
private val PfTile = Color(0x2EFFFFFF)
private val PfSoft = Color(0xFFB8BEC9)
private val TextShade = TextStyle(shadow = Shadow(Color(0x99000000), Offset(0f, 2f), 8f))

/**
 * «Elige tu perfil» en el celular en vertical, como la app de Netflix: el póster del destacado de la semana a pantalla
 * completa ([ProfileBackdrops]), su logo y «Película · ★ 7.8» encima de «Elige tu perfil», y los perfiles de a tres
 * sobre el panel curvo, con «Agregar» y «Editar» al final. Con «Editar» (administrar) los perfiles llevan el lápiz, el
 * último botón dice «Listo» y abajo quedan «Salir» (cerrar sesión) y la versión.
 */
@Composable
internal fun PhoneProfiles(
    featured: Profiles.Featured?,
    list: List<Profiles.Profile>,
    canAdd: Boolean,
    manage: Boolean,
    focusIdx: Int,
    firstFocus: FocusRequester,
    onOpen: (Profiles.Profile) -> Unit,
    onAdd: () -> Unit,
    onToggleManage: () -> Unit,
    onExit: () -> Unit,
) {
    val w = LocalConfiguration.current.screenWidthDp.toFloat()
    // medidas de la imagen de referencia: avatar ~18 % del ancho y tres columnas de ~30 %
    val cell = (w * 0.297f).dp
    val avatar = (w * 0.184f).dp.coerceIn(64.dp, 120.dp)
    val corner = avatar * 0.13f
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val screenH = maxHeight
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).heightIn(min = screenH)) {
            // todo pegado abajo; con muchos perfiles o letra grande se desplaza, nunca se corta
            Spacer(Modifier.weight(1f))
            Column(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(0f to Color.Transparent, 0.55f to PfNavy.copy(alpha = 0.7f), 1f to PfNavy))
                    .padding(top = 110.dp, bottom = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                FeaturedTitle(featured)
                Spacer(Modifier.height(30.dp))
                Text(stringResource(if (manage) R.string.prof_manage else R.string.prof_choose), color = PfSoft, fontSize = 17.sp)
            }
            Box(
                Modifier.fillMaxWidth().background(PfNavy).drawBehind {
                    // borde de arriba un poco curvo (más alto al centro), detrás de la primera fila de avatares
                    val top = avatar.toPx() * 0.3f
                    val depth = size.width * 0.04f
                    val path = Path().apply {
                        moveTo(0f, top + depth)
                        quadraticTo(size.width / 2f, top - depth, size.width, top + depth)
                        lineTo(size.width, size.height); lineTo(0f, size.height); close()
                    }
                    drawPath(path, Brush.verticalGradient(listOf(PfArcTop, PfArcBottom), startY = top, endY = size.height))
                },
            ) {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 34.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    val tiles: List<Profiles.Profile?> = list + (if (canAdd) listOf(null) else emptyList())
                    // el último lugar es «Editar» / «Listo»
                    val cells = tiles.size + 1
                    (0 until cells).chunked(3).forEach { row ->
                        Row(Modifier.padding(bottom = 14.dp)) {
                            row.forEach { i ->
                                val p = tiles.getOrNull(i)
                                when {
                                    i == tiles.size -> ActionCell(cell, avatar, corner, if (manage) Icons.Filled.Check else Icons.Outlined.Edit,
                                        stringResource(if (manage) R.string.prof_done else R.string.prof_edit), onToggleManage)
                                    p == null -> ActionCell(cell, avatar, corner, Icons.Filled.Add, stringResource(R.string.prof_add_short), onAdd)
                                    else -> FocusBox(
                                        onClick = { onOpen(p) }, shape = RoundedCornerShape(12.dp), focusScale = 1.04f,
                                        modifier = if (list.indexOf(p) == focusIdx) Modifier.focusRequester(firstFocus) else Modifier,
                                    ) {
                                        Column(Modifier.width(cell).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                            AvatarBox(p, avatar, manage, corner, Alignment.BottomEnd)
                                            CellLabel(p.name, true)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (manage) Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = onExit) { Text(stringResource(R.string.exit), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
                        Text(stringResource(R.string.prof_version, BuildConfig.VERSION_NAME), color = PfSoft, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

/** «Agregar» / «Editar» / «Listo»: recuadro claro con el ícono y el texto debajo */
@Composable
private fun ActionCell(cell: Dp, avatar: Dp, corner: Dp, icon: ImageVector, label: String, onClick: () -> Unit) {
    FocusBox(onClick = onClick, shape = RoundedCornerShape(12.dp), focusScale = 1.04f) {
        Column(Modifier.width(cell).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(avatar).background(PfTile, RoundedCornerShape(corner)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = Color.White, modifier = Modifier.size(avatar * 0.42f))
            }
            CellLabel(label, false)
        }
    }
}

@Composable
private fun CellLabel(text: String, strong: Boolean) {
    Text(
        text, color = if (strong) Color.White else Color(0xFFE3E7EE), fontSize = 16.sp, fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Normal,
        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 9.dp, start = 4.dp, end = 4.dp),
    )
}

/** logo del título (o su nombre si TMDB no tiene logo) y «Película · ★ 7.8», cambian con el fondo */
@Composable
private fun FeaturedTitle(f: Profiles.Featured?) {
    Crossfade(targetState = f, animationSpec = tween(500), label = "featTitle") { x ->
        if (x != null) Column(Modifier.fillMaxWidth().padding(horizontal = 36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            // el mismo pedido que el fondo (queda guardado en memoria)
            var art by remember(x) { mutableStateOf<Profiles.Art?>(null) }
            LaunchedEffect(x) { art = Profiles.art(x) }
            var logoFailed by remember(x) { mutableStateOf(false) }
            val logo = art?.logo.orEmpty()
            Box(Modifier.fillMaxWidth(0.74f).height(112.dp), contentAlignment = Alignment.BottomCenter) {
                when {
                    logo.isNotEmpty() && !logoFailed -> AsyncImage(
                        model = logo, contentDescription = x.name, contentScale = ContentScale.Fit, onError = { logoFailed = true },
                        modifier = Modifier.fillMaxSize(),
                    )
                    art != null -> Text(
                        x.name, color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                        maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 34.sp, style = TextShade,
                    )
                }
            }
            val kind = when (x.kind) { "movie" -> stringResource(R.string.prof_feat_movie); "tv" -> stringResource(R.string.prof_feat_show); else -> "" }
            val sub = listOf(kind, if (x.rating.isNotEmpty()) "★ ${x.rating}" else "").filter { it.isNotEmpty() }.joinToString("  ·  ")
            if (sub.isNotEmpty()) Text(sub, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, style = TextShade, modifier = Modifier.padding(top = 16.dp))
        }
    }
}
