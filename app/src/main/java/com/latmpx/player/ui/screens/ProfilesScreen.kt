package com.latmpx.player.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import com.latmpx.player.BuildConfig
import com.latmpx.player.R
import com.latmpx.player.data.Profiles
import com.latmpx.player.tr
import com.latmpx.player.ui.AppState
import com.latmpx.player.ui.components.AppButton
import com.latmpx.player.ui.components.ChainImage
import com.latmpx.player.ui.components.FocusBox
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.components.LogoHeader
import com.latmpx.player.ui.theme.NfBg
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfOnRed
import com.latmpx.player.ui.theme.NfRed
import kotlinx.coroutines.launch
import org.json.JSONObject

/** pedido de PIN: para entrar al perfil o para editarlo */
private data class PinAsk(val p: Profiles.Profile, val edit: Boolean)

/** editor abierto: p = null para agregar; pin = el de un perfil bloqueado (ya comprobado) */
private data class EditTarget(val p: Profiles.Profile?, val pin: String)

/**
 * «¿Quién está viendo?» (docs/PERFILES.md del panel, sección 6). Horizontal (TV, tableta o celular girado): perfiles en
 * columna a la izquierda, «Salir» arriba a la izquierda, logo arriba a la derecha y «Administrar perfiles» debajo de los
 * perfiles. Vertical (celular): el destacado arriba, el título sobre los perfiles, dos por fila y el quinto centrado. De
 * fondo el destacado de la semana de TMDB (solo nombre y calificación) y la versión abajo a la izquierda.
 */
@Composable
fun ProfilesScreen(state: AppState, onChosen: (Profiles.Profile?) -> Unit, onBack: () -> Unit, onLogout: () -> Unit) {
    val tv = LocalIsTv.current
    val conf = LocalConfiguration.current
    val wide = tv || conf.screenWidthDp > conf.screenHeightDp
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var data by remember { mutableStateOf(state.profilesData) }
    var manage by remember { mutableStateOf(state.profilesOpen == true) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var pinAsk by remember { mutableStateOf<PinAsk?>(null) }
    var forgot by remember { mutableStateOf<Profiles.Profile?>(null) }
    var edit by remember { mutableStateOf<EditTarget?>(null) }
    var askLogout by remember { mutableStateOf(false) }
    val featured by produceState<Profiles.Featured?>(null) { value = runCatching { Profiles.featured() }.getOrNull() }

    fun toast(msg: String) = android.widget.Toast.makeText(ctx, msg, android.widget.Toast.LENGTH_SHORT).show()

    fun setData(st: Profiles.State) {
        data = st
        state.profilesData = st
        // apagados por el dueño (o la línea con una conexión): todo al principal, como siempre
        if (!st.enabled || st.max <= 1) { onChosen(null); return }
        // «Cambiar perfil»: el de ahora pudo cambiar de nombre o avatar (o eliminarse)
        Profiles.current?.let { cur -> st.profiles.firstOrNull { it.id == cur.id }?.let { Profiles.choose(it) } }
    }

    // desde Cuenta (o sin datos): la lista otra vez del panel
    LaunchedEffect(Unit) {
        if (state.profilesFromAccount || data == null) {
            busy = true
            when (val r = Profiles.load(state.session?.maxCons?.toIntOrNull() ?: 0)) {
                is Profiles.Result.Ok -> setData(r.state)
                is Profiles.Result.Fail -> err = r.message
            }
            busy = false
        }
    }
    BackHandler {
        when {
            edit != null -> edit = null
            manage -> manage = false
            else -> onBack()
        }
    }

    fun openProfile(p: Profiles.Profile) {
        if (manage) {
            if (p.locked) pinAsk = PinAsk(p, edit = true) else edit = EditTarget(p, "")
        } else {
            if (p.locked) pinAsk = PinAsk(p, edit = false) else onChosen(p)
        }
    }

    val list = data?.profiles.orEmpty()
    val canAdd = data?.canCreate == true && list.size < 5
    val focusId = Profiles.current?.id ?: com.latmpx.player.data.Store.lastProfile
    // el foco al abrir: ese perfil o, si ya no está, el primero
    val focusIdx = list.indexOfFirst { it.id == focusId }.let { if (it < 0) 0 else it }
    val firstFocus = remember { FocusRequester() }
    val rows = list.size + (if (canAdd) 1 else 0)

    Box(Modifier.fillMaxSize().background(NfBg)) {
        // fondo: lo más destacado de la semana (horizontal: toda la pantalla; vertical: arriba)
        featured?.let { f ->
            val mod = if (wide) Modifier.fillMaxSize() else Modifier.fillMaxWidth().height((conf.screenHeightDp * 0.34f).dp)
            Box(mod) {
                ChainImage(remember(f.image) { com.latmpx.player.data.PanelImg.backdropSources(f.image) }, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent, Color(0xCC141414), NfBg))))
                if (wide) Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color(0xF2141414), Color(0x99141414), Color.Transparent))))
                // solo su nombre y su calificación, abajo a la derecha, sin tapar nada
                Column(Modifier.align(Alignment.BottomEnd).padding(horizontal = 24.dp, vertical = if (wide) 22.dp else 10.dp), horizontalAlignment = Alignment.End) {
                    Text(f.name, color = Color.White, fontSize = if (wide) 20.sp else 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (f.rating.isNotEmpty()) Text("★ ${f.rating}", color = Color(0xFFF5C518), fontSize = if (wide) 15.sp else 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        // arriba: «Salir» a la izquierda, el título al centro (en horizontal) y el logo a la derecha
        Row(Modifier.fillMaxWidth().padding(horizontal = sidePad() + 6.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            AppButton(stringResource(R.string.exit), minHeight = 40.dp, fontSize = 14.sp) { askLogout = true }
            Spacer(Modifier.weight(1f))
            LogoHeader(height = if (wide) 34.dp else 28.dp)
        }
        if (wide) Text(
            stringResource(if (manage) R.string.prof_manage else R.string.prof_who), color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 22.dp),
        )

        // perfiles grandes: en horizontal los 5 caben en la altura (con el título arriba y «Administrar perfiles» abajo)
        val tileSize: Dp = if (wide) (((conf.screenHeightDp - 162) / rows.coerceAtLeast(1)) - 12).dp.coerceIn(56.dp, 140.dp)
            else ((conf.screenWidthDp - 96) / 2).dp.coerceIn(96.dp, 150.dp)
        if (wide) {
            // perfiles en columna a la izquierda y «Administrar perfiles» debajo (si no caben, se desplaza: nunca se cortan)
            Box(Modifier.fillMaxHeight().padding(start = sidePad() + 24.dp, top = 70.dp, bottom = 36.dp), contentAlignment = Alignment.CenterStart) {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    list.forEachIndexed { i, p ->
                        val req = if (i == focusIdx) Modifier.focusRequester(firstFocus) else Modifier
                        ProfileRow(p, tileSize, manage, req) { openProfile(p) }
                    }
                    if (canAdd) AddRow(tileSize) { edit = EditTarget(null, "") }
                    Spacer(Modifier.height(12.dp))
                    AppButton(stringResource(if (manage) R.string.prof_done else R.string.prof_manage), minHeight = 44.dp, fontSize = 15.sp) { manage = !manage }
                }
            }
        } else {
            // celular en vertical: dos por fila y el quinto centrado
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = (conf.screenHeightDp * 0.30f).dp, bottom = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(if (manage) R.string.prof_manage else R.string.prof_who), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(bottom = 18.dp))
                val tiles: List<Profiles.Profile?> = list + (if (canAdd) listOf(null) else emptyList())
                tiles.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.padding(bottom = 18.dp)) {
                        pair.forEach { p ->
                            if (p == null) AddTile(tileSize) { edit = EditTarget(null, "") }
                            else ProfileTile(p, tileSize, manage, if (list.indexOf(p) == focusIdx) Modifier.focusRequester(firstFocus) else Modifier) { openProfile(p) }
                        }
                    }
                }
                AppButton(stringResource(if (manage) R.string.prof_done else R.string.prof_manage), minHeight = 44.dp, fontSize = 15.sp) { manage = !manage }
            }
        }
        // la versión abajo a la izquierda, chica
        Text(
            stringResource(R.string.prof_version, BuildConfig.VERSION_NAME), color = Color(0xFF8C8C8C), fontSize = 11.sp,
            modifier = Modifier.align(Alignment.BottomStart).padding(start = sidePad() + 6.dp, bottom = 10.dp),
        )
        if (busy) CircularProgressIndicator(color = NfRed, modifier = Modifier.align(Alignment.Center))
        err?.let { Text(it, color = Color(0xFFFF6B6B), fontSize = 14.sp, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 34.dp)) }

        edit?.let { t ->
            ProfileEditor(
                target = t, avatars = data?.avatars.orEmpty(),
                onClose = { st, msg ->
                    edit = null
                    if (st != null) setData(st)
                    if (msg != null) toast(msg)
                },
            )
        }
    }
    // foco al abrir (TV): el último perfil usado en este equipo (o el de ahora, desde Cuenta)
    LaunchedEffect(data, edit, manage) {
        if (edit == null && list.isNotEmpty()) { kotlinx.coroutines.delay(150); runCatching { firstFocus.requestFocus() } }
    }

    pinAsk?.let { a ->
        PinDialog(
            title = stringResource(R.string.prof_pin_of, a.p.name),
            showForgot = true,
            onDismiss = { pinAsk = null },
            onForgot = { pinAsk = null; forgot = a.p },
            check = { pin ->
                when (val r = Profiles.act("pin_check", JSONObject().put("id", a.p.id).put("pin", pin))) {
                    is Profiles.Result.Ok -> {
                        pinAsk = null
                        if (a.edit) edit = EditTarget(a.p, pin) else onChosen(a.p)
                        null
                    }
                    is Profiles.Result.Fail -> r.message
                }
            },
        )
    }
    forgot?.let { p ->
        var pass by remember(p.id) { mutableStateOf("") }
        var msg by remember(p.id) { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { forgot = null },
            containerColor = Color(0xFF1F1F1F),
            title = { Text(stringResource(R.string.prof_forgot), color = Color.White) },
            text = {
                Column {
                    Text(stringResource(R.string.prof_forgot_desc), color = NfGray2, fontSize = 14.sp, modifier = Modifier.padding(bottom = 10.dp))
                    ProfTextField(pass, { pass = it; msg = null }, stringResource(R.string.prof_line_pass), password = true, modifier = Modifier.fillMaxWidth())
                    msg?.let { Text(it, color = Color(0xFFFF6B6B), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (pass.isBlank()) return@TextButton
                    scope.launch {
                        when (val r = Profiles.act("pin_reset", JSONObject().put("id", p.id).put("pass", pass))) {
                            is Profiles.Result.Ok -> { forgot = null; setData(r.state); toast(tr(R.string.prof_pin_removed_of, p.name)) }
                            is Profiles.Result.Fail -> msg = r.message
                        }
                    }
                }) { Text(stringResource(R.string.prof_remove_pin), color = Color.White, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { forgot = null }) { Text(stringResource(R.string.cancel), color = NfGray2) } },
        )
    }
    if (askLogout) AlertDialog(
        onDismissRequest = { askLogout = false },
        containerColor = Color(0xFF1F1F1F),
        title = { Text(stringResource(R.string.prof_logout_q), color = Color.White) },
        text = { Text(stringResource(R.string.prof_logout_desc), color = NfGray2) },
        confirmButton = { TextButton(onClick = { askLogout = false; onLogout() }) { Text(stringResource(R.string.logout), color = Color.White, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = { askLogout = false }) { Text(stringResource(R.string.cancel), color = NfGray2) } },
    )
}

/** avatar del perfil (imagen del panel) con la etiqueta «Niños» si es infantil; también lo usa la barra superior */
@Composable
fun ProfileAvatar(p: Profiles.Profile, size: Dp) {
    Box(Modifier.size(size), contentAlignment = Alignment.BottomCenter) {
        AsyncImage(
            model = p.avatar, contentDescription = p.name, contentScale = ContentScale.Crop,
            modifier = Modifier.size(size).clip(RoundedCornerShape(6.dp)).background(Color(0xFF333333)),
        )
        if (p.kids) Text(
            stringResource(R.string.prof_kids), color = NfOnRed, fontSize = (size.value * 0.16f).coerceIn(9f, 16f).sp, fontWeight = FontWeight.Bold, maxLines = 1,
            modifier = Modifier.padding(bottom = 4.dp).background(NfRed, RoundedCornerShape(4.dp)).padding(horizontal = 5.dp),
        )
    }
}

/** avatar con el lápiz (administrar) y el candado (bloqueado con PIN) */
@Composable
private fun AvatarBox(p: Profiles.Profile, size: Dp, manage: Boolean) {
    Box(Modifier.size(size)) {
        ProfileAvatar(p, size)
        if (manage) Box(Modifier.size(size).background(Color(0x99000000), RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Edit, stringResource(R.string.prof_edit), tint = Color.White, modifier = Modifier.size(size * 0.32f))
        }
        if (p.locked) Box(Modifier.align(Alignment.TopEnd).padding(5.dp).size(size * 0.24f).background(Color(0xCC000000), CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Lock, null, tint = Color.White, modifier = Modifier.size(size * 0.14f))
        }
    }
}

/** horizontal: avatar y nombre en una fila */
@Composable
private fun ProfileRow(p: Profiles.Profile, size: Dp, manage: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(10.dp), focusScale = 1.05f) { f ->
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            AvatarBox(p, size, manage)
            Text(
                p.name, color = if (f) Color.White else Color(0xFFB3B3B3), fontSize = (size.value * 0.2f).coerceIn(16f, 26f).sp,
                fontWeight = if (f) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 18.dp, end = 12.dp).widthIn(max = 360.dp),
            )
        }
    }
}

@Composable
private fun AddRow(size: Dp, onClick: () -> Unit) {
    FocusBox(onClick = onClick, shape = RoundedCornerShape(10.dp), focusScale = 1.05f) { f ->
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(size).background(Color(0xFF2A2A2A), RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Add, null, tint = Color.White, modifier = Modifier.size(size * 0.4f))
            }
            Text(stringResource(R.string.prof_add), color = if (f) Color.White else Color(0xFFB3B3B3), fontSize = (size.value * 0.2f).coerceIn(16f, 26f).sp, fontWeight = if (f) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.padding(start = 18.dp))
        }
    }
}

/** vertical: avatar grande con el nombre debajo */
@Composable
private fun ProfileTile(p: Profiles.Profile, size: Dp, manage: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(10.dp)) { f ->
        Column(Modifier.width(size + 8.dp).padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            AvatarBox(p, size, manage)
            Text(p.name, color = if (f) Color.White else Color(0xFFB3B3B3), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun AddTile(size: Dp, onClick: () -> Unit) {
    FocusBox(onClick = onClick, shape = RoundedCornerShape(10.dp)) { f ->
        Column(Modifier.width(size + 8.dp).padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(size).background(Color(0xFF2A2A2A), RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Add, null, tint = Color.White, modifier = Modifier.size(size * 0.4f))
            }
            Text(stringResource(R.string.prof_add), color = if (f) Color.White else Color(0xFFB3B3B3), fontSize = 15.sp, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/**
 * PIN de 4 números con un teclado en pantalla (control remoto y dedo). check devuelve null si el PIN sirvió o el mensaje
 * del panel (PIN incorrecto, demasiados intentos…).
 */
@Composable
private fun PinDialog(title: String, showForgot: Boolean, onDismiss: () -> Unit, onForgot: () -> Unit, check: suspend (String) -> String?) {
    var pin by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun submit() {
        if (busy || pin.length != 4) return
        busy = true
        val p = pin
        scope.launch {
            val m = check(p)
            busy = false
            // con error, otra vez; sin error (primer PIN de «confirmar»), la casilla vacía para el siguiente
            msg = m
            pin = ""
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xE6000000)), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 420.dp).background(Color(0xFF1F1F1F), RoundedCornerShape(14.dp)).padding(26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 6.dp))
                Text(msg ?: " ", color = Color(0xFFFF6B6B), fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 10.dp))
                ProfPinPad(pin, onChange = { pin = it; msg = null; if (it.length == 4) submit() }, onDone = { submit() })
                if (showForgot) TextButton(onClick = onForgot) { Text(stringResource(R.string.prof_forgot), color = NfGray2) }
                if (busy) CircularProgressIndicator(color = NfRed, modifier = Modifier.padding(top = 6.dp).size(26.dp))
            }
        }
    }
}

/** teclado de 4 números (1-9, borrar, 0, OK) con puntos que se llenan */
@Composable
private fun ProfPinPad(value: String, onChange: (String) -> Unit, onDone: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(bottom = 16.dp)) {
            repeat(4) { i ->
                Box(Modifier.size(16.dp).background(if (i < value.length) Color.White else Color(0xFF4D4D4D), CircleShape))
            }
        }
        listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("<", "0", "OK")).forEachIndexed { r, keys ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                keys.forEachIndexed { c, k ->
                    val mod = if (r == 0 && c == 0) Modifier.focusRequester(first) else Modifier
                    FocusBox(onClick = {
                        when (k) {
                            "<" -> onChange(value.dropLast(1))
                            "OK" -> onDone()
                            else -> if (value.length < 4) onChange(value + k)
                        }
                    }, modifier = mod, shape = RoundedCornerShape(10.dp), focusScale = 1.08f) { f ->
                        Box(Modifier.size(width = 72.dp, height = 50.dp).background(if (f) Color.White else Color(0xFF2A2A2A), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                            Text(if (k == "<") "⌫" else k, color = if (f) Color.Black else Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Agregar o editar un perfil: avatar (la lista «avatars» del panel), nombre, «Perfil infantil» (solo al crear), PIN
 * (bloquear, cambiar, quitar) y «Eliminar perfil» (nunca el principal). onClose(estado nuevo o null, aviso o null).
 */
@Composable
private fun ProfileEditor(target: EditTarget, avatars: List<String>, onClose: (Profiles.State?, String?) -> Unit) {
    val p = target.p
    val creating = p == null
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(p?.name.orEmpty()) }
    var avatar by remember { mutableStateOf(p?.avatar ?: avatars.randomOrNull().orEmpty()) }
    var kids by remember { mutableStateOf(false) }
    var locked by remember { mutableStateOf(p?.locked == true) }
    var pin by remember { mutableStateOf(target.pin) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var newPin by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }
    // estado del panel después de cambiar el PIN (al cerrar sin guardar, la lista igual se pone al día)
    var last by remember { mutableStateOf<Profiles.State?>(null) }
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { firstFocus.requestFocus() } }

    fun nameOk(v: String) = v.trim().length in 1..20 && !v.contains('<') && !v.contains('>')

    fun send(action: String, fields: JSONObject, done: (Profiles.State) -> Unit) {
        busy = true; err = null
        scope.launch {
            when (val r = Profiles.act(action, fields)) {
                is Profiles.Result.Ok -> done(r.state)
                is Profiles.Result.Fail -> err = r.message
            }
            busy = false
        }
    }

    fun save() {
        if (!nameOk(name)) { err = tr(R.string.prof_name_rule); return }
        val n = name.trim()
        if (creating) {
            send("create", JSONObject().put("name", n).put("avatar", avatar).put("kids", kids)) { st -> onClose(st, tr(R.string.prof_created, n)) }
        } else {
            val f = JSONObject().put("id", p!!.id).put("name", n).put("avatar", avatar)
            if (locked && pin.isNotEmpty()) f.put("pin", pin)
            send("update", f) { st -> onClose(st, tr(R.string.prof_saved)) }
        }
    }

    Box(Modifier.fillMaxSize().background(NfBg)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = sidePad() + 18.dp, vertical = 22.dp),
        ) {
            Text(stringResource(if (creating) R.string.prof_add else R.string.prof_edit_title), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.Top) {
                FocusBox(onClick = { picking = true }, modifier = Modifier.focusRequester(firstFocus), shape = RoundedCornerShape(8.dp)) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        AsyncImage(
                            model = avatar, contentDescription = null, contentScale = ContentScale.Crop,
                            modifier = Modifier.size(120.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF333333)),
                        )
                        Text(stringResource(R.string.prof_change_avatar), color = NfGray2, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp, bottom = 4.dp))
                    }
                }
                Spacer(Modifier.width(22.dp))
                Column(Modifier.weight(1f)) {
                    ProfTextField(name, { name = it; err = null }, stringResource(R.string.prof_name), password = false, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(14.dp))
                    if (creating) {
                        // perfil infantil: solo al crear (después no se cambia)
                        FocusBox(onClick = { kids = !kids }, shape = RoundedCornerShape(8.dp), focusScale = 1.02f) {
                            Row(Modifier.fillMaxWidth().background(Color(0xFF2A2A2A), RoundedCornerShape(8.dp)).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.prof_kids_profile), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                Switch(checked = kids, onCheckedChange = null, colors = SwitchDefaults.colors(checkedTrackColor = NfRed, checkedThumbColor = Color.White))
                            }
                        }
                        Text(stringResource(R.string.prof_kids_desc), color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                    } else if (p?.kids == true) {
                        Text(stringResource(R.string.prof_kids_info), color = NfGray2, fontSize = 13.sp)
                    }
                    if (!creating) {
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (locked) {
                                AppButton(stringResource(R.string.prof_pin_change), minHeight = 42.dp, fontSize = 14.sp) { newPin = true }
                                AppButton(stringResource(R.string.prof_pin_remove), minHeight = 42.dp, fontSize = 14.sp) {
                                    send("pin_clear", JSONObject().put("id", p!!.id).put("pin", pin)) { st -> locked = false; pin = ""; last = st }
                                }
                            } else {
                                AppButton(stringResource(R.string.prof_pin_lock), minHeight = 42.dp, fontSize = 14.sp) { newPin = true }
                            }
                        }
                    }
                }
            }
            err?.let { Text(it, color = Color(0xFFFF6B6B), fontSize = 14.sp, modifier = Modifier.padding(top = 14.dp)) }
            Spacer(Modifier.height(22.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                AppButton(stringResource(R.string.save), primary = true, minHeight = 46.dp) { if (!busy) save() }
                AppButton(stringResource(R.string.cancel), minHeight = 46.dp) { onClose(last, null) }
                if (!creating && p?.main != true) {
                    // siempre en rojo, con o sin la paleta del distribuidor
                    FocusBox(onClick = { askDelete = true }, shape = RoundedCornerShape(6.dp), focusScale = 1.05f) { f ->
                        Text(
                            stringResource(R.string.prof_delete), color = if (f) Color.White else Color(0xFFFF4D4D), fontSize = 16.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.background(if (f) Color(0xFFD32F2F) else Color(0x22FF4D4D), RoundedCornerShape(6.dp)).padding(horizontal = 18.dp, vertical = 12.dp),
                        )
                    }
                }
                if (busy) CircularProgressIndicator(color = NfRed, modifier = Modifier.size(26.dp))
            }
        }
        // elegir avatar: la lista que da el panel
        if (picking) {
            BackHandler { picking = false }
            Column(Modifier.fillMaxSize().background(NfBg).padding(horizontal = sidePad() + 12.dp, vertical = 18.dp)) {
                Text(stringResource(R.string.prof_pick_avatar), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(bottom = 14.dp))
                val pickFocus = remember { FocusRequester() }
                LaunchedEffect(Unit) { kotlinx.coroutines.delay(120); runCatching { pickFocus.requestFocus() } }
                LazyVerticalGrid(GridCells.Adaptive(96.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(avatars) { u ->
                        val mod = if (u == avatar || (avatar.isEmpty() && u == avatars.firstOrNull())) Modifier.focusRequester(pickFocus) else Modifier
                        FocusBox(onClick = { avatar = u; picking = false }, modifier = mod, shape = RoundedCornerShape(8.dp)) {
                            AsyncImage(
                                model = u, contentDescription = null, contentScale = ContentScale.Crop,
                                modifier = Modifier.size(96.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF333333)),
                            )
                        }
                    }
                }
            }
        }
    }
    if (newPin) {
        var first by remember { mutableStateOf<String?>(null) }
        PinDialog(
            title = stringResource(if (first == null) R.string.prof_pin_new else R.string.prof_pin_confirm),
            showForgot = false,
            onDismiss = { newPin = false },
            onForgot = {},
            check = { v ->
                val one = first
                if (one == null) { first = v; null }
                else if (one != v) { first = null; tr(R.string.prof_pin_mismatch) }
                else {
                    val f = JSONObject().put("id", p!!.id).put("new_pin", v)
                    if (locked && pin.isNotEmpty()) f.put("pin", pin)
                    when (val r = Profiles.act("pin_set", f)) {
                        is Profiles.Result.Ok -> { locked = true; pin = v; last = r.state; newPin = false; null }
                        is Profiles.Result.Fail -> { first = null; r.message }
                    }
                }
            },
        )
    }
    if (askDelete) AlertDialog(
        onDismissRequest = { askDelete = false },
        containerColor = Color(0xFF1F1F1F),
        title = { Text(stringResource(R.string.prof_delete_q, p?.name.orEmpty()), color = Color.White) },
        text = { Text(stringResource(R.string.prof_delete_desc), color = NfGray2) },
        confirmButton = {
            TextButton(onClick = {
                askDelete = false
                val prof = p ?: return@TextButton
                val f = JSONObject().put("id", prof.id)
                if (locked && pin.isNotEmpty()) f.put("pin", pin)
                send("delete", f) { st -> onClose(st, tr(R.string.prof_deleted, prof.name)) }
            }) { Text(stringResource(R.string.prof_delete), color = Color(0xFFFF4D4D), fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text(stringResource(R.string.cancel), color = NfGray2) } },
    )
}
