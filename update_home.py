import os, re

p = r"C:\Users\Yjamp\.gemini\antigravity\scratch\webplayer-android\app\src\main\java\com\latmpx\player\ui\screens\HomeScreen.kt"
with open(p, "r", encoding="utf-8") as f: content = f.read()

# I will add the necessary imports
if "import androidx.compose.foundation.clickable" not in content:
    content = content.replace("import androidx.compose.foundation.layout.Row", "import androidx.compose.foundation.layout.Row\nimport androidx.compose.foundation.clickable\nimport androidx.compose.foundation.shape.CircleShape\nimport androidx.compose.material.icons.filled.Search\nimport androidx.compose.material.icons.filled.AccountCircle\nimport androidx.compose.ui.draw.clip\nimport androidx.compose.material3.AlertDialog\nimport androidx.compose.material3.TextButton\nimport com.latmpx.player.ui.Tab\n")

# Replace the start of LazyColumn to wrap it in a Box and add the top bar.
pattern_lazy = r'    LazyColumn\(Modifier\.fillMaxSize\(\)\.background\(NfBg\)\) \{'

top_bar = r'''    var showProfileDialog by remember { mutableStateOf(false) }

    if (showProfileDialog) {
        AlertDialog(
            onDismissRequest = { showProfileDialog = false },
            title = { Text("Perfil", color = Color.White) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Usuario: " + (state.session?.user ?: ""), color = Color.White)
                    Text("Servidor: " + (state.session?.dnsName ?: ""), color = NfGray2)
                    Text("Mi cuenta", color = Color.White, modifier = Modifier.clickable { showProfileDialog = false; state.tab = Tab.ACCOUNT })
                    Text("Ajustes", color = Color.White, modifier = Modifier.clickable { showProfileDialog = false })
                    Text("Deportes", color = Color.White, modifier = Modifier.clickable { showProfileDialog = false; state.tab = Tab.SPORTS })
                }
            },
            confirmButton = {
                TextButton(onClick = { showProfileDialog = false }) { Text("Cerrar", color = NfRed) }
            },
            containerColor = Color(0xFF222222)
        )
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().background(NfBg)) {'''

content = re.sub(pattern_lazy, top_bar, content)

# End of LazyColumn
pattern_end = r'        item \{ Spacer\(Modifier\.height\(40\.dp\)\) \}\n    \}'
content = re.sub(pattern_end, r'        item { Spacer(Modifier.height(40.dp)) }\n    }\n    if (!tv) {\n        Row(Modifier.fillMaxWidth().padding(horizontal = pad, vertical = 16.dp).background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent))), verticalAlignment = Alignment.CenterVertically) {\n            Box(Modifier.weight(1f).height(40.dp).background(Color(0x80333333), RoundedCornerShape(20.dp)).clickable { state.tab = Tab.SEARCH }.padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {\n                Row(verticalAlignment = Alignment.CenterVertically) {\n                    Icon(Icons.Filled.Search, null, tint = NfGray2, modifier = Modifier.size(20.dp))\n                    Spacer(Modifier.width(8.dp))\n                    Text("Buscar...", color = NfGray2, fontSize = 14.sp)\n                }\n            }\n            Spacer(Modifier.width(16.dp))\n            Icon(Icons.Filled.AccountCircle, null, tint = Color.White, modifier = Modifier.size(36.dp).clip(CircleShape).clickable { showProfileDialog = true })\n        }\n    }\n}', content)

with open(p, "w", encoding="utf-8") as f: f.write(content)

print("HomeScreen Top Bar updated.")
