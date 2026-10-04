package com.latmpx.player.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.latmpx.player.data.SecureDns
import com.latmpx.player.data.Store
import com.latmpx.player.ui.theme.NfBg2
import com.latmpx.player.ui.theme.NfGray2
import com.latmpx.player.ui.theme.NfRed

/** Botón "DNS: …" que abre la lista de DNS seguros. Sirve con el dedo y con el control remoto. */
@Composable
fun DnsButton(modifier: Modifier = Modifier, onChanged: () -> Unit = {}) {
    var open by remember { mutableStateOf(false) }
    var current by remember { mutableStateOf(SecureDns.current) }
    FocusBox(onClick = { open = true }, modifier = modifier, shape = RoundedCornerShape(4.dp), focusScale = 1.05f) { f ->
        Row(
            Modifier.background(if (f) Color(0xCCFFFFFF) else Color(0x806D6D6E)).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val c = if (f) Color.Black else Color.White
            Icon(Icons.Filled.Dns, null, tint = c, modifier = Modifier.size(18.dp))
            Text("DNS: ${current.label}", color = c, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 6.dp))
        }
    }
    if (open) {
        val first = remember { FocusRequester() }
        AlertDialog(
            onDismissRequest = { open = false },
            confirmButton = {},
            dismissButton = { FocusBox(onClick = { open = false }) { Text("Cerrar", color = Color.White, modifier = Modifier.padding(10.dp)) } },
            containerColor = NfBg2,
            title = { Text("DNS", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text("Cambia el DNS si algún canal o servidor no abre en tu red. Se aplica a toda la app.", color = NfGray2, fontSize = 13.sp,
                        modifier = Modifier.padding(bottom = 8.dp))
                    SecureDns.options.forEachIndexed { i, o ->
                        val sel = o.key == current.key
                        FocusBox(
                            onClick = { Store.dns = o.key; current = SecureDns.current; open = false; onChanged() },
                            focusScale = 1.02f,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp).then(if (i == 0) Modifier.focusRequester(first) else Modifier),
                        ) { f ->
                            Row(Modifier.fillMaxWidth().background(if (f) Color(0xFF333333) else Color(0xFF1F1F1F)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(o.label, color = Color.White, fontSize = 16.sp, fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal)
                                    Text(o.note, color = NfGray2, fontSize = 12.sp)
                                }
                                if (sel) Icon(Icons.Filled.Check, null, tint = NfRed)
                            }
                        }
                    }
                }
            },
        )
        LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    }
}
