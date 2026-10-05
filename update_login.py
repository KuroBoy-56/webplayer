import os
import re

approot_path = r"C:\Users\Yjamp\.gemini\antigravity\scratch\webplayer-android\app\src\main\java\com\latmpx\player\ui\screens\LoginScreen.kt"

with open(approot_path, "r", encoding="utf-8") as f:
    content = f.read()

# I want to redesign the LoginScreen.
# I will just write a new version of the layout using the existing variables.

new_ui = r'''
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = Color.White, unfocusedBorderColor = Color(0xFF555555), focusedTextColor = Color.White, unfocusedTextColor = Color.White,
        focusedLabelColor = Color.White, unfocusedLabelColor = NfGray2, cursorColor = NfRed, focusedContainerColor = Color(0xFF333333), unfocusedContainerColor = Color(0xFF333333),
    )
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        PosterWall(posters, columns = if (tv) 8 else 4)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = sidePad(), vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                LogoHeader(height = 46.dp)
                Spacer(Modifier.weight(1f))
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                Column(
                    Modifier.widthIn(max = 400.dp).fillMaxWidth()
                        .background(Color(0xBF000000), RoundedCornerShape(6.dp)).padding(horizontal = if (tv) 32.dp else 24.dp, vertical = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    if (!PanelCrypto.hasKey()) {
                        ErrorBanner("Esta versión de la app no tiene la llave del panel (PANEL_MASTER_KEY). La activación no funcionará hasta instalar una versión configurada.")
                    }
                    if (lines.size > 1) {
                        Text("Elige tu servicio", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                        lines.forEachIndexed { i, l ->
                            HeroButton(l.name.ifBlank { "Servicio " }, Icons.Filled.PlayArrow, i == 0, if (i == 0) Modifier.focusRequester(firstFocus) else Modifier) {
                                act { connect(l) }
                            }
                        }
                    } else {
                        Text("Iniciar sesión", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start)
                        err?.let { ErrorBanner(it) }
                        
                        // MAC in central box
                        Column(Modifier.fillMaxWidth().background(Color(0xFF222222), RoundedCornerShape(4.dp)).padding(12.dp)) {
                            Text("Código MAC (Para activación remota)", color = NfGray2, fontSize = 12.sp)
                            Text(deviceId, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace)
                        }
                        
                        OutlinedTextField(
                            value = user, onValueChange = { user = it }, label = { Text("Usuario") }, singleLine = true, colors = fieldColors,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = pass, onValueChange = { pass = it }, label = { Text("Contraseña") }, singleLine = true, colors = fieldColors,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { }), modifier = Modifier.fillMaxWidth(),
                        )
                        
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            RedButton("Entrar", Modifier.weight(1f).focusRequester(firstFocus)) {
                                act {
                                    if (user.isBlank() || pass.isBlank()) { err = "Escribe tu usuario y contraseña"; return@act }
                                    if (dns.isEmpty()) Panel.fetchDns().let { d -> d.value?.let { dns = it }; if (d.value == null) err = d.error }
                                    val server = dns.getOrNull(dnsIdx) ?: dns.firstOrNull()
                                    if (server == null) { if (err == null) err = "El panel no tiene servidores disponibles"; return@act }
                                    status = "Activando…"
                                    val r = Panel.submitUrl(deviceId, user.trim(), pass.trim(), server)
                                    if (r.value == null) { err = r.error; return@act }
                                    if (!resolve() && err == null) connect(Panel.Line("Servidor ", Xtream.normalize(server), user.trim(), pass.trim()))
                                }
                            }
                            HeroButton(if (demoUsed) "Demo" else "Demo (24h)", Icons.Filled.CardGiftcard, false, Modifier.weight(1f)) {
                                if (demoUsed) { err = "La demo ya se usó"; return@HeroButton }
                                act {
                                    status = "Creando demo…"
                                    val r = Panel.autoDemo(deviceId)
                                    val cred = r.value
                                    if (cred == null) {
                                        err = r.error
                                        if (r.code == 403) { demoUsed = true; Store.demoUsed = true }
                                        return@act
                                    }
                                    Store.demoUsed = true; demoUsed = true
                                    if (!resolve() && err == null) {
                                        val d = dns.ifEmpty { Panel.fetchDns().value.orEmpty() }
                                        val first = d.firstOrNull()
                                        if (first != null) connect(Panel.Line("Demo", Xtream.normalize(first), cred.first, cred.second))
                                        else err = "Demo creada, pero el panel no devolvió el servidor."
                                    }
                                }
                            }
                        }
                        
                        if (dns.size > 1 || true) {
                            Spacer(Modifier.height(8.dp))
                            DnsButton()
                        }
                    }
                    if (busy) {
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = NfRed, strokeWidth = 2.dp)
                            Text(status, color = NfGray2, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp), textAlign = TextAlign.Center)
                        }
                    }
                    if (lines.size > 1) err?.let { ErrorBanner(it) }
                }
            }
            Text("©  Garevyn TV", color = Color(0xFF999999), fontSize = 14.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 28.dp).background(Color(0x99000000)).padding(20.dp))
        }
    }
'''

pattern = re.compile(r'val fieldColors = OutlinedTextFieldDefaults\.colors\(.*?    }\n', re.DOTALL)
new_content = pattern.sub(new_ui, content)

with open(approot_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("LoginScreen updated.")
