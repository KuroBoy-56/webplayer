# LatMpx para Android TV y Google TV (rama `android-tv`)

App nativa en Kotlin exclusiva para televisor, con la misma lógica y el mismo diseño que el reproductor web (rama `main`).
La app para celular y tablet está en la rama `android`. Las dos se pueden instalar a la vez (esta usa el id `com.latmpx.player.tv`).

- **Menú arriba** como el reproductor web: Inicio, Series, Películas, TV en vivo, Deportes, Mi lista, Buscar y Cuenta.
- **Atrás:** desde una ficha vuelve a la sección; desde la sección sube al menú; en el menú pregunta si quieres salir.
- **Cartelera** grande con fondo de TMDB, sinopsis y botones Reproducir / Más información / Mi lista.
- **Foco** visible para el control remoto (borde blanco y zoom), guía de canales al costado, arriba/abajo o CH+/CH- para cambiar de canal.
- **Control parental** con teclado numérico en pantalla.
- Descarga: Releases > `apk-tv-latest` (se compila sola con cada cambio en esta rama).
- **Reproductor:** ExoPlayer (Media3) con decodificador FFmpeg. Reproduce Dolby AC3/E-AC3, DTS, TrueHD, MKV, AVI, TS, HLS y más directo en el equipo, sin convertir en el hosting.
  - Selector de audio y subtítulos.
  - Idioma del equipo por defecto.
  - Continúa donde te quedaste y pasa solo al siguiente episodio.
  - Se reconecta si el servidor IPTV corta.
  - VLC solo como último recurso.
- Sin sección de administración: todo se configura desde el panel.

## Descargar el APK sin compilar

Cada vez que se sube un cambio a esta rama, GitHub compila el APK solo:

**Releases → `apk-latest` → `LatMpx.apk`**

https://github.com/KuroBoy-56/webplayer/releases/tag/apk-latest

### Secretos del repositorio

**Settings → Secrets and variables → Actions → New repository secret**

Solo hace falta uno: **`PANEL_MASTER_KEY`** = la llave maestra AES del panel (64 caracteres hex, la misma `master_key_hex` de `includes/secrets.php`).

### La llave maestra

- **No está en el código ni en el repositorio en ninguna forma** (ni cifrada ni escondida).
- La única fuente es `local.properties` → `panel.master_key=…`. Ese archivo está en `.gitignore` y nunca se sube.
- En tu PC la pones tú en `local.properties`. En GitHub, el workflow escribe `local.properties` con el secreto `PANEL_MASTER_KEY` solo durante la compilación.
- Si falta, la compilación igual termina (con un aviso) y la app abre, pero la pantalla de activación muestra que falta la llave y no puede hablar con `login.php`.

La dirección del panel ya viene dentro de la app (ver más abajo), así que no hay ningún secreto para la URL.

## Abrir en Android Studio → Run

1. **File → Open** y elige esta carpeta (rama `android`). El wrapper de Gradle ya viene incluido.
2. Si pregunta, acepta descargar el SDK de Android 36.
3. Copia `local.properties.example` como `local.properties` y pon `panel.master_key=` con la llave del panel.
4. Elige un teléfono, un Android TV o un emulador y pulsa **Run ▶**.
5. Para publicar: **Build → Generate Signed App Bundle / APK** con tu propia clave.

## Cómo entra la app (anillos de seguridad del panel)

Panel: `https://garevynpanels.latmpx.com/master/panel/`. La dirección no está en texto plano: en `data/PanelUrl.kt` va en hex (XOR con `KURO` → base64 → hex) y la app la decodifica al iniciar.
De ahí sale la carpeta `…/master/panel/api/` que usan todos los endpoints. No depende de ningún secreto del repositorio.

**Código del equipo (MAC):** el Android ID en 16 hex mayúsculas, 8 pares separados por `:` (ej. `A1:B2:C3:D4:E5:F6:07:18`).
Si es más corto se completa con ceros a la izquierda y se quita el `00:` inicial igual que `normalise_mac()` del panel, así lo que se ve en pantalla es lo mismo que guarda el panel.
Se envía siempre en el campo `mac_address`.

1. `api/auth.php` — `POST {"data": mope({"mac_address": "…"})}`. Responde `{"data": mope(json)}` con `urls` (listas `get.php?username=…&password=…`) y `tmdbKey`.
   Si el equipo tiene una lista entra solo; si tiene varias, se elige.
2. `api/login.php` — `POST action=… & data=base64(salt16 + iv12 + AES-256-GCM + tag16)` con llave HKDF-SHA256 de la llave maestra:
   - `check_mac`: respaldo para saber si el equipo ya está activado.
   - `fetch_dns`: lista de servidores (respuesta cifrada) para el selector "Servidor 1, 2…".
   - `submit_url`: activa el equipo con usuario + contraseña + servidor.
   - `auto_demo`: botón **Demo automática (24 h)**. Una sola demo por equipo para siempre: `403` muestra el mensaje y desactiva el botón; `429` (más de 3 demos por conexión al día) y `400` muestran el mensaje del panel.
3. Con la línea elegida la app usa el `player_api.php` del servidor IPTV (Xtream Codes).

En la pantalla de activación se ve el código MAC para que el distribuidor lo active en el panel, y el botón **Comprobar activación** vuelve a preguntar.

## Datos que viven en el panel

Todas estas llamadas usan un token: la app hace `POST progress.php {"action":"auth","user","pass"}` una vez y guarda solo el token (30 días). Si vence, pide otro.

| Endpoint | Uso en la app |
|---|---|
| `api/progress.php` | **Continuar viendo** y **Mi lista / canales favoritos**. `GET ?v=2` → `{progress, favorites}`; `POST` `save`, `delete`, `fav_add`, `fav_remove`. Mismo formato que la web: película por nombre (`type: movie`), serie una sola entrada por serie (`type: episode`, `id` del episodio, `seriesId`). Al 95 % se borra. Nada de esto queda solo en el equipo. |
| `api/epg.php` | Guía de respaldo: primero `get_short_epg` del proveedor; si un canal no trae guía, `POST {channels:[{id, epg, name}]}` en lotes de hasta 400 canales. |
| `api/sports.php` | Pestaña **Deportes**: partidos de hoy y mañana con el mismo diseño de la web (Hoy/Mañana, deportes con emoji, escudos, en vivo / marcador / final, botón **TV en vivo**). El canal se busca con las reglas `match` del panel (misma puntuación que la web). |

## DNS

Botón **DNS** en el inicio de sesión y en **Cuenta**: Automático (por defecto), Cloudflare, Google, Quad9, AdGuard (sin rastreo ni anuncios), NextDNS (anti-bloqueo geográfico) y OpenDNS.
Usa DNS sobre HTTPS (`okhttp-dnsoverhttps`) en el único cliente OkHttp de la app, así aplica a todo: panel, Xtream, imágenes y el reproductor. La elección se guarda en el equipo.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `data/` | Panel (`Panel.kt`, `PanelCrypto.kt`, `PanelUrl.kt`), progreso y favoritos (`Cloud.kt`), guía (`PanelEpg.kt`), deportes (`Sports.kt`), DNS (`SecureDns.kt`), API Xtream (`Xtream.kt`), preferencias del equipo (`Store.kt`) |
| `ui/` | Pantallas en Jetpack Compose: activación, inicio, películas, series, TV en vivo, deportes, mi lista, buscar, cuenta, detalle |
| `player/` | Reproductor ExoPlayer (`PlayerActivity.kt`) |
| `Device.kt` | Detección de TV o teléfono y código del equipo |
