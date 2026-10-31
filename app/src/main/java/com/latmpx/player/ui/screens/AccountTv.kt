package com.latmpx.player.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.BuildConfig
import com.latmpx.player.Device
import com.latmpx.player.R
import com.latmpx.player.data.Session
import com.latmpx.player.data.Store
import com.latmpx.player.data.Tenant
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.DnsButton
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.languageChoiceLabel
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfBg2
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfOnRed
import com.latmpx.player.ui.theme.NfRed

/**
 * Cuenta y ajustes en Android TV, como Roku y Vega: a la izquierda la tarjeta de la línea (usuario, estado, vencimiento,
 * conexiones, servidor, cuánto contenido tiene, distribuidor y el código del equipo); a la derecha «Ajustes», una fila
 * por ajuste con su valor, todo con el foco del control remoto. El celular sigue con su pantalla (AccountScreen).
 */
@Composable
fun AccountTv(
    state: AppState,
    s: Session,
    streamFormat: String,
    extPlayer: Boolean,
    onLang: () -> Unit,
    onParental: () -> Unit,
    onStreamFormat: () -> Unit,
    onPlayer: () -> Unit,
    onChangeDistributor: () -> Unit,
    onLogout: () -> Unit,
) {
    val user = Store.shownUser(s)
    val b = Tenant.brand
    fun count(l: List<*>) = if (l.isEmpty() && (state.catalogLoading || state.loading)) "…" else l.size.toString()
    Row(Modifier.fillMaxSize().background(NfBg).padding(start = sidePad(), top = 75.dp)) {
        // tarjeta de la línea
        Box(Modifier.width(310.dp).height(430.dp).background(NfBg2, RoundedCornerShape(8.dp)).padding(horizontal = 20.dp).padding(top = 20.dp)) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(80.dp).background(NfRed, CircleShape), contentAlignment = Alignment.Center) {
                    Text(user.take(1).uppercase(), color = NfOnRed, fontSize = 40.sp, fontWeight = FontWeight.ExtraBold)
                }
                Text(user, color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 11.dp))
                Text(
                    if (Store.demo) stringResource(R.string.demo_account) + Store.demoLength().let { if (it.isEmpty()) "" else " · $it" } else stringResource(R.string.subscription_active),
                    color = if (Store.demo) Color(0xFFF5C518) else Color(0xFF46D369), fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp),
                )
                Column(Modifier.fillMaxWidth().padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    // DEMO: solo el fin que dice el panel (hora exacta); nada de la línea demo del servidor
                    if (Store.demo) {
                        Line(stringResource(R.string.expiration), Store.demoEndText().ifEmpty { "—" })
                    } else {
                        Line(stringResource(R.string.expiration), s.expires)
                        Line(stringResource(R.string.connections), "${s.activeCons} / ${s.maxCons}")
                        if (s.createdAt.isNotBlank()) Line(stringResource(R.string.member_since), s.createdAt)
                        Line(stringResource(R.string.dns_server), s.dnsName)
                    }
                    Line(stringResource(R.string.live_channels), count(state.live))
                    Line(stringResource(R.string.movies), count(state.movies))
                    Line(stringResource(R.string.series), count(state.series))
                    if (b != null) Line(stringResource(R.string.distributor), "${b.name.ifBlank { b.code }} (${b.code})")
                }
            }
            // código del equipo abajo de la tarjeta
            Column(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 15.dp).fillMaxWidth().height(65.dp)
                    .background(Color(0x14FFFFFF), RoundedCornerShape(6.dp)),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Text(stringResource(R.string.mac_address), color = Color(0xFF808080), fontSize = 12.sp)
                Text(Device.id(LocalContext.current), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 3.dp))
            }
        }
        // ajustes (margen a la izquierda y arriba: la fila enfocada crece un poco y no se corta)
        Column(Modifier.weight(1f).padding(start = 13.dp).verticalScroll(rememberScrollState()).padding(start = 12.dp, top = 3.dp, bottom = 50.dp, end = sidePad())) {
            Text(stringResource(R.string.settings), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 9.dp))
            Setting(stringResource(R.string.app_language), languageChoiceLabel(), onLang)
            Setting(stringResource(R.string.parental_control), stringResource(R.string.parental_control_desc), onParental)
            Setting(stringResource(R.string.stream_format), when (streamFormat) { "ts" -> "MPEG-TS (.ts)"; "auto" -> stringResource(R.string.automatic); else -> "HLS (.m3u8)" }, onStreamFormat)
            Setting(stringResource(R.string.player), stringResource(if (extPlayer) R.string.player_external else R.string.player_internal), onPlayer)
            DnsButton(Modifier.padding(bottom = 6.dp)) { f, label -> SettingRow("DNS", label, f) }
            Setting(stringResource(R.string.change_distributor), if (b != null) "${b.name.ifBlank { b.code }} (${b.code})" else stringResource(R.string.none), onChangeDistributor)
            Setting(stringResource(R.string.logout), "", onLogout)
            Text("${stringResource(R.string.version)} ${BuildConfig.VERSION_NAME}", color = Color(0xFF808080), fontSize = 11.sp, modifier = Modifier.padding(top = 20.dp))
        }
    }
}

@Composable
private fun Line(k: String, v: String) {
    Text(
        androidx.compose.ui.text.buildAnnotatedString {
            append("$k ")
            pushStyle(androidx.compose.ui.text.SpanStyle(color = Color.White, fontWeight = FontWeight.Bold))
            append(v.ifBlank { "—" })
            pop()
        },
        color = Color(0xFFB3B3B3), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

/** una fila de ajuste (como el botón de Vega / Roku): nombre a la izquierda, valor a la derecha; con el foco, más clara */
@Composable
private fun Setting(label: String, value: String, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = Modifier.padding(bottom = 6.dp), shape = RoundedCornerShape(6.dp), focusScale = 1.02f) { f -> SettingRow(label, value, f) }
}

@Composable
private fun BoxScope.SettingRow(label: String, value: String, f: Boolean) {
    Row(
        Modifier.width(520.dp).height(38.dp).background(Color.White.copy(alpha = if (f) 0.25f else 0.15f), RoundedCornerShape(6.dp)).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.weight(1f))
        if (value.isNotEmpty()) Text(value, color = if (f) Color.White else NfGray2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 12.dp))
    }
}
