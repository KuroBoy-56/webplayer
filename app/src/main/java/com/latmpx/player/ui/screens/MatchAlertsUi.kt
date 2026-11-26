package com.latmpx.player.ui.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material.icons.filled.ViewCarousel
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.latmpx.player.R
import com.latmpx.player.data.MatchAlerts
import com.latmpx.player.data.Profiles
import com.latmpx.player.data.SportEvent
import com.latmpx.player.data.SportsLive
import com.latmpx.player.data.SportsPanel
import com.latmpx.player.data.Store
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** pide el permiso de notificaciones (Android 13+) la primera vez que se activa un aviso */
@Composable
fun rememberNotifPermission(): () -> Unit {
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    return {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            runCatching { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
    }
}

private fun sportLabel(sp: String): String = SportsLive.CHOICES.firstOrNull { it.first == sp }?.second ?: sp

/**
 * Ajustes › Deporte preferido (fila «En vivo ahora» de Inicio: sin elegir, todos) y Equipos favoritos: el deporte, la
 * liga o las selecciones y el equipo, de los próximos partidos del panel. Por línea y perfil.
 */
@Composable
fun SportPrefsSection() {
    if (!(SportsLive.available && Profiles.current != null && !Profiles.kids)) return
    val ctx = LocalContext.current
    var prefOpen by remember { mutableStateOf(false) }
    var pickOpen by remember { mutableStateOf(false) }
    var pref by remember(Profiles.current) { mutableStateOf(Store.preferredSport) }
    val rev = MatchAlerts.rev
    val teams = remember(rev, Profiles.current) { MatchAlerts.teams() }
    val askNotif = rememberNotifPermission()
    val choices = SportsLive.CHOICES
    SettingsItem(Icons.Filled.SportsSoccer, stringResource(R.string.sl_pref), choices.firstOrNull { it.first == pref }?.second ?: stringResource(R.string.sl_all)) { prefOpen = true }
    HorizontalDivider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
    // tarjetas de plataformas debajo de «En vivo ahora» (solo si el distribuidor tiene las plataformas)
    if (com.latmpx.player.data.Tenant.platformsEnabled) {
        var plat by remember(Profiles.current) { mutableStateOf(Store.platformCards) }
        SettingsItem(Icons.Filled.ViewCarousel, stringResource(R.string.sl_plat), stringResource(if (plat) R.string.sl_plat_on else R.string.sl_plat_off)) {
            plat = !plat
            Store.platformCards = plat
        }
        HorizontalDivider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
    }
    SettingsItem(Icons.Filled.Shield, stringResource(R.string.ma_teams),
        if (teams.isEmpty()) stringResource(R.string.ma_teams_none) else teams.joinToString(" · ") { it.label.ifBlank { it.name } }) { pickOpen = true }
    if (teams.isNotEmpty()) Column(Modifier.padding(start = 56.dp, end = 16.dp, bottom = 8.dp)) {
        teams.forEach { t ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                TeamBadge(t.badge, t.label.ifBlank { t.name }, 28.dp)
                Spacer(Modifier.width(10.dp))
                Text(t.label.ifBlank { t.name }, color = Color.White, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Filled.Close, stringResource(R.string.ma_remove), tint = NfGray2,
                    modifier = Modifier.size(40.dp).clip(CircleShape).clickable { MatchAlerts.setTeams(teams - t) }.padding(10.dp))
            }
        }
    }
    // notificaciones apagadas para la app en el celular: los avisos no llegarían a la barra; se abren sus ajustes
    val notifOn = remember(rev) { androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled() }
    if (teams.isNotEmpty() && !notifOn) {
        SettingsItem(Icons.Filled.Notifications, stringResource(R.string.ma_allow), stringResource(R.string.ma_allow_desc)) {
            runCatching { ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)) }
        }
    }
    if (teams.isNotEmpty() && !MatchAlerts.exactAllowed() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        SettingsItem(Icons.Filled.Alarm, stringResource(R.string.ma_exact), stringResource(R.string.ma_exact_desc)) {
            runCatching { ctx.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.packageName))) }
        }
    }
    HorizontalDivider(color = Color(0xFF333333), modifier = Modifier.padding(horizontal = 16.dp))
    if (prefOpen) ChoiceDialog(stringResource(R.string.sl_pref), listOf("" to stringResource(R.string.sl_all)) + choices, pref, { prefOpen = false }) {
        pref = it; Store.preferredSport = it; prefOpen = false
    }
    if (pickOpen) TeamPicker(pref, { pickOpen = false }) { t ->
        pickOpen = false
        if (teams.none { it.name == t.name }) { MatchAlerts.setTeams(teams + t); askNotif() }
    }
}

@Composable
private fun ChoiceDialog(title: String, items: List<Pair<String, String>>, selected: String?, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Color(0xFF1F1F1F),
        title = { Text(title, color = Color.White) },
        text = {
            Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState())) {
                items.forEach { (k, label) ->
                    if (k.startsWith("#")) { // título de grupo
                        Text(label, color = NfGray2, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp))
                        return@forEach
                    }
                    Row(Modifier.fillMaxWidth().clickable { onPick(k) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (selected != null) {
                            RadioButton(selected = selected == k, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = NfRed, unselectedColor = NfGray2))
                            Spacer(Modifier.width(12.dp))
                        }
                        Text(label, color = Color.White, fontSize = 16.sp)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close), color = NfGray2) } },
    )
}

/** deporte (si no hay preferido) → liga o selecciones → equipo, de los próximos 21 días del panel y sus tablas */
@Composable
private fun TeamPicker(preferred: String, onDismiss: () -> Unit, onPick: (MatchAlerts.Team) -> Unit) {
    val fx by produceState(SportsPanel.cachedFixtures(), Unit) {
        withContext(Dispatchers.IO) { SportsPanel.fixtures(0) }.fx?.let { value = it }
    }
    var sport by remember { mutableStateOf(preferred) }
    var league by remember { mutableStateOf("") }
    val f = fx
    val loading = stringResource(R.string.ma_loading)
    when {
        f == null || f.leagues.isEmpty() -> ChoiceDialog(stringResource(R.string.ma_add_team), listOf("#" to if (f == null) loading else stringResource(R.string.ma_no_data)), null, onDismiss) { }
        sport.isEmpty() || f.leagues.values.none { it.sport == sport } -> {
            val sports = f.leagues.values.map { it.sport }.filter { it.isNotBlank() }.distinct().sortedBy { sportLabel(it) }
            ChoiceDialog(stringResource(R.string.ma_pick_sport), sports.map { it to sportLabel(it) }, null, onDismiss) { sport = it }
        }
        league.isEmpty() -> {
            val ls = f.leagues.filter { it.value.sport == sport }.entries.sortedBy { it.value.name }
            val nat = ls.filter { it.value.region == "nat" }
            val clubs = ls.filter { it.value.region != "nat" }
            val items = (if (nat.isNotEmpty()) listOf("#n" to stringResource(R.string.ma_nations)) + nat.map { it.key to it.value.name } else emptyList()) +
                (if (clubs.isNotEmpty()) listOf("#c" to stringResource(R.string.ma_clubs)) + clubs.map { it.key to it.value.name } else emptyList())
            ChoiceDialog(stringResource(R.string.ma_pick_league) + " · " + sportLabel(sport), items, null, { if (preferred.isEmpty()) sport = "" else onDismiss() }) { league = it }
        }
        else -> {
            val teams = remember(f, league) { teamsOf(f, league) }
            ChoiceDialog(stringResource(R.string.ma_pick_team) + " · " + (f.leagues[league]?.name ?: ""),
                teams.ifEmpty { listOf(MatchAlerts.Team("#", stringResource(R.string.ma_no_teams), "", "", "")) }.map { it.name to it.label.ifBlank { it.name } },
                null, { league = "" }) { n -> teams.firstOrNull { it.name == n }?.let(onPick) }
        }
    }
}

/** equipos de una liga: los de sus próximos partidos y los de su tabla de posiciones (si el panel la tiene) */
private fun teamsOf(f: com.latmpx.player.data.Fixtures, league: String): List<MatchAlerts.Team> {
    val sp = f.leagues[league]?.sport.orEmpty()
    val out = LinkedHashMap<String, MatchAlerts.Team>()
    f.events.filter { it.leagueId == league }.forEach { e ->
        if (e.home.isNotBlank()) out.getOrPut(e.home) { MatchAlerts.Team(e.home, e.homeLabel, e.homeBadge, league, sp) }
        if (e.away.isNotBlank()) out.getOrPut(e.away) { MatchAlerts.Team(e.away, e.awayLabel, e.awayBadge, league, sp) }
    }
    SportsPanel.localTables(0)?.leagues?.firstOrNull { it.id == league }?.groups?.flatMap { it.rows }?.forEach { r ->
        if (r.team.isNotBlank()) out.getOrPut(r.team) { MatchAlerts.Team(r.team, "", r.badge, league, sp) }
    }
    return out.values.sortedBy { it.label.ifBlank { it.name }.lowercase() }
}

/** mantener presionada la tarjeta de un partido: activar o quitar sus avisos */
@Composable
fun EventAlertDialog(e: SportEvent, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val askNotif = rememberNotifPermission()
    val on = remember(MatchAlerts.rev) { MatchAlerts.isMarked(e.id) }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Color(0xFF1F1F1F),
        title = { Text(MatchAlerts.title(e), color = Color.White) },
        text = {
            Row(Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(8.dp)).clickable {
                val now = MatchAlerts.toggle(e)
                if (now) askNotif()
                android.widget.Toast.makeText(ctx, ctx.getString(if (now) R.string.ma_on_toast else R.string.ma_off_toast), android.widget.Toast.LENGTH_LONG).show()
                onDismiss()
            }.background(Color(0x22FFFFFF)).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Notifications, null, tint = if (on) NfGray2 else NfRed)
                Spacer(Modifier.width(12.dp))
                Text(stringResource(if (on) R.string.ma_notify_off else R.string.ma_notify_on), color = Color.White, fontSize = 16.sp)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close), color = NfGray2) } },
    )
}

/** la campanita de la barra de arriba: las notificaciones de las últimas 24 h (con un punto rojo si hay nuevas) */
@Composable
fun BellButton() {
    var open by remember { mutableStateOf(false) }
    val unread = remember(MatchAlerts.rev) { MatchAlerts.unread() }
    Box(Modifier.size(44.dp).clip(CircleShape).clickable { open = true; MatchAlerts.markRead() }, contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.Notifications, stringResource(R.string.ma_bell), tint = Color.White, modifier = Modifier.size(26.dp))
        if (unread > 0) Box(Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 8.dp).size(10.dp).background(NfRed, CircleShape))
    }
    if (open) {
        val list = remember { MatchAlerts.bell() }
        AlertDialog(
            onDismissRequest = { open = false }, containerColor = Color(0xFF1F1F1F),
            title = { Text(stringResource(R.string.ma_bell), color = Color.White) },
            text = {
                Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (list.isEmpty()) Text(stringResource(R.string.ma_bell_empty), color = NfGray2, fontSize = 15.sp)
                    list.forEach { b ->
                        Column {
                            Text(b.title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            Text(b.text, color = Color(0xFFDDDDDD), fontSize = 14.sp)
                            Text(ago(b.at), color = NfGray2, fontSize = 12.sp)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.close), color = NfGray2) } },
        )
    }
}

@Composable
private fun ago(at: Long): String {
    val min = ((System.currentTimeMillis() - at) / 60_000L).toInt()
    return when {
        min < 1 -> stringResource(R.string.ma_now)
        min < 60 -> stringResource(R.string.ma_mins_ago, min)
        else -> stringResource(R.string.ma_hours_ago, min / 60)
    }
}
