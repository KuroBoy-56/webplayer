package com.latmpx.player.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LiveTv
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.R
import com.latmpx.player.data.Profiles
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.ui.screens.PHONE_BAR_H
import com.latmpx.player.ui.screens.ProfileAvatar
import com.latmpx.player.ui.theme.NfRed

/**
 * Celular: barra de abajo flotante como la app de Netflix (cápsula oscura con la opción elegida resaltada): Inicio,
 * TV en vivo, Buscar y Perfil (el avatar del perfil). Series, Películas, Deportes y Mi lista están arriba, en Inicio,
 * así que con esas abiertas sigue resaltado Inicio. Perfil abre Cuenta (cambiar o administrar perfiles, descargas,
 * ajustes). El espacio que ocupa lo da [com.latmpx.player.ui.screens.phoneBarSpace].
 */
@Composable
fun PhoneNavBar(state: AppState, modifier: Modifier = Modifier) {
    // perfil infantil sin canales de niños: sin TV en vivo
    val tabs = listOf(Tab.HOME, Tab.LIVE, Tab.SEARCH, Tab.ACCOUNT).filter { it != Tab.LIVE || !state.hideLive }
    val cur = when (state.tab) { Tab.LIVE, Tab.SEARCH, Tab.ACCOUNT -> state.tab; else -> Tab.HOME }
    Row(
        modifier.navigationBarsPadding().padding(start = 22.dp, end = 22.dp, bottom = 12.dp).widthIn(max = 520.dp).fillMaxWidth().height(PHONE_BAR_H)
            .shadow(18.dp, CircleShape).clip(CircleShape).background(Color(0xF2232323)).border(1.dp, Color(0x1AFFFFFF), CircleShape).padding(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEach { t ->
            val sel = t == cur
            val tint = if (sel) Color.White else Color(0xFFA6A6A6)
            val label = if (t == Tab.ACCOUNT) stringResource(R.string.profile) else t.label
            Column(
                Modifier.weight(1f).fillMaxHeight().clip(CircleShape).background(if (sel) Color(0xFF3D3D3D) else Color.Transparent)
                    .selectable(selected = sel, role = Role.Tab) { state.stack.clear(); state.tab = t },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                when (t) {
                    Tab.ACCOUNT -> BarAvatar(state)
                    else -> Icon(
                        when (t) { Tab.LIVE -> Icons.Outlined.LiveTv; Tab.SEARCH -> Icons.Outlined.Search; else -> Icons.Outlined.Home },
                        null, tint = tint, modifier = Modifier.size(25.dp),
                    )
                }
                Text(label, color = tint, fontSize = 11.sp, fontWeight = if (sel) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp, start = 2.dp, end = 2.dp))
            }
        }
    }
}

/** avatar del perfil elegido; sin perfiles, la inicial del usuario en el color de la app */
@Composable
private fun BarAvatar(state: AppState) {
    val prof = Profiles.current
    if (prof != null) { ProfileAvatar(prof, 26.dp, 6.dp, badge = null); return }
    val dark = if (Tenant.brand?.colors == null) Color(0xFF8E0B12) else lerp(NfRed, Color.Black, 0.4f)
    Box(Modifier.size(26.dp).clip(RoundedCornerShape(6.dp)).background(Brush.linearGradient(listOf(NfRed, dark))), contentAlignment = Alignment.Center) {
        Text(Store.shownUser(state.session).take(1).uppercase().ifEmpty { "U" }, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}
