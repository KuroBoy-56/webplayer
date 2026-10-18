# MPX Player para Android TV y Google TV (rama `android-tv`)

**Marca:** la app se llama **MPX Player** (`app_name`; el paquete sigue siendo `com.latmpx.player` para que se actualice sobre la instalada). Logo, icono, banner de TV e imágenes de las plataformas (Netflix, Disney+, HBO Max, Prime Video, Marvel, Apple TV+, Paramount+, DC, Navidad, Halloween) están en `res/drawable-nodpi`, `res/mipmap-xxxhdpi` y `res/drawable-*`.

App nativa en Kotlin exclusiva para televisor, con la misma lógica y el mismo diseño que el reproductor web (rama `main`).
La app para celular y tablet está en la rama `android`. Las dos se pueden instalar a la vez (esta usa el id `com.latmpx.player.tv`).

- **Menú arriba** como el reproductor web: Inicio, Series, Películas, TV en vivo, Deportes, Mi lista, Buscar y Cuenta.
- **Atrás:** desde una ficha vuelve a la sección; desde la sección sube al menú; en el menú pregunta si quieres salir.
- **Cartelera** grande con fondo de TMDB, sinopsis y botones Reproducir / Más información / Mi lista.
- **Foco** visible para el control remoto (borde blanco o del color del distribuidor, y zoom), guía de canales al costado, arriba/abajo o CH+/CH- para cambiar de canal.
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
   - `check_mac` y `auto_demo` mandan `"enc": 1`: el panel responde la línea (usuario y contraseña) cifrada como `fetch_dns` y la app la descifra; un panel viejo sigue respondiendo JSON.
   - `fetch_dns`: lista de servidores (respuesta cifrada) para el selector "Servidor 1, 2…".
   - `submit_url`: activa el equipo con usuario + contraseña + servidor.
   - `auto_demo`: botón **Autodemo** (la duración la decide el panel: `demo_duration`). Una sola demo por equipo para siempre: `403` muestra el mensaje y desactiva el botón; `429` (más de 3 demos por conexión al día) y `400` muestran el mensaje del panel.
     **Autodemo con código de revendedor:** si en **Contraseña** hay un código de 6 letras y números (con al menos una letra, p. ej. `RV7K2M`), va en mayúsculas como `reseller` y la demo queda a nombre de ese revendedor en el panel. Solo números nunca se envía (es un número de distribuidor). Un código que no existe responde `404`: se muestra el aviso y la demo sigue disponible.
3. Con la línea elegida la app usa el `player_api.php` del servidor IPTV (Xtream Codes).

En la pantalla de activación se ve el código MAC para que el distribuidor lo active en el panel, y el botón **Comprobar activación** vuelve a preguntar.

**Siempre con el panel (sin usuario ni contraseña guardados):** la sesión vive solo en memoria. Cada vez que se abre la app se le pide la línea al panel (`auth.php` / `check_mac`) y se comprueba en el servidor IPTV (`user_info`: usuario y contraseña correctos y cuenta activa); solo así entra sola. Si el equipo no está registrado, la línea venció o el panel no responde, se queda en el inicio de sesión con el aviso. Al volver a la app (como mucho cada 15 min) se vuelve a preguntar: si el dueño quitó la línea del equipo, vuelve al inicio de sesión. Las versiones anteriores guardaban la sesión en el equipo: se borra al actualizar.

**PIN parental (siempre activo):** es el del panel (`check_mac` → `pin`, o `parent_control` de `auth.php`; 0000 de fábrica). En **Cuenta → Control Parental** se pide el PIN; **Cambiar PIN** lo guarda en el panel (`login.php` acción `set_pin`, cifrada, con el PIN actual) y solo si el panel lo acepta cambia en el equipo, así el dueño ve en Clientes MAC el PIN que puso el cliente y puede volverlo a 0000. Ya no se puede desactivar.

**Inicio de sesión:** en el celular el logo queda arriba, la caja de inicio de sesión en el medio de la pantalla y la firma del distribuidor (© año nombre) abajo; con el teclado abierto la página se desplaza.

## Distribuidor (número de 6 dígitos)

Al abrir la app por primera vez sale **Número de distribuidor** (mismo diseño que el inicio de sesión; en TV con teclado numérico en pantalla o los números del control). La elección se guarda en el equipo y no se vuelve a preguntar: con sesión entra directo al inicio, sin sesión al login.

- **Omitir:** todo funciona exactamente como antes (no se envía nada nuevo al panel, logo, colores y nombre de la app).
- **Continuar:** `login.php` acción `tenant_config` con `{code, app, device}` cifrado (app = `android` o `android_tv` según `Device.TV_APP`). La respuesta (nombre, logo, colores, vencimiento, funciones) se guarda y se aplica antes de la primera pantalla.
- Con número, todas las llamadas llevan el distribuidor: `"tenant"` + `"app"` en los payload de `login.php` y en el `auth` de `progress.php` (el token, uno por número, sirve para `epg.php` y `sports.php`); `alerta.php?t=…&app=…`. `auth.php` solo conoce las listas del dueño, así que con número se usa `check_mac`.
- **Guardián** (`data/Tenant.kt`, `ui/AppRoot.kt`): al abrir la app y al volver a ella pasado `recheck_after` (6 h) se vuelve a pedir `tenant_config`. `tenant_invalid`, `tenant_expired`, `tenant_suspended` o `app_not_linked` (también si llegan en cualquier otra llamada) borran número, marca, sesión y token y vuelven a la pantalla del número con el mensaje. Sin conexión se sigue con la copia hasta 72 h; después, pantalla **Reintentar**. El vencimiento (`expires_at`, hora de Panamá) también se comprueba en el equipo.
- Funciones: `demo=false` oculta **Autodemo**, `alerts=false` no muestra el aviso, `sports=false` oculta **Deportes**, `platforms=false` oculta la fila/mosaicos de plataformas (Netflix, Disney+…) y sus filas «Lo mejor de» (por defecto se muestran). `ffmpeg` no se usa: el audio Dolby/DTS lo decodifica FFmpeg dentro del reproductor (Media3), sin el motor del panel.
- Marca: el logo (`logo_url`, con Coil) reemplaza a `LogoHeader`; un distribuidor sin logo (o si no carga) muestra su nombre, nunca el logo de la app; la paleta `{accent, bg, surface, text}` reemplaza a los colores `Nf*` de `ui/theme/Theme.kt` (texto sobre acento negro o blanco según luminancia, texto secundario al 65 %, tarjetas = superficie 8 % hacia el texto).
- **Botones iguales a Roku, Vega OS, Windows y la web** (`ui/components/AppButton.kt`, un solo botón en inicio de sesión, distribuidor, avisos, portada, ficha y Cuenta): principal = color del distribuidor (rojo sin distribuidor) con texto de contraste; secundario = blanco translúcido con borde fino; con el foco del control borde de 3 px (blanco; el principal siempre blanco) y crece un 5 % con una animación corta. El reproductor (barra, EN VIVO, carga) también usa el color del distribuidor.
- **TV:** los botones del destacado y de la ficha (`NfButton`), los diálogos (`TvDialogButton`, salir) usan el mismo `AppButton`; la TV en vivo estilo TiviMate toma fondo, paneles, foco y texto de los colores del distribuidor (sin distribuidor, la paleta oscura de siempre).
- **Panel (todas las llamadas):** `login.php` lleva `"platform"` (`android` / `android_tv`) para que Clientes MAC muestre en qué equipo está cada MAC; `progress.php` (auth y save) lleva `platform` y `device` para el mapa y las estadísticas del Dashboard.
- **Pantalla falsa** (`ui/screens/FakeScreenView.kt`): si `check_mac` responde `fake_screen.show` y el equipo no tiene línea, en lugar del inicio de sesión sale la calculadora (funciona de verdad), el carrusel, la imagen, el video o la página que eligió el dueño, con el ID del equipo pequeño abajo. El código del panel + «=» abre el inicio de sesión (y ya no vuelve a salir en ese equipo); cada 30 s se pregunta al panel y, si registran el equipo, la app entra sola.
- **Errores al panel** (`data/ErrorReport.kt` → `api/report.php`, cifrado): cierres inesperados (se mandan al volver a abrir la app) y errores de reproducción, con app, versión, equipo, modelo, Android, línea y servidor. El dueño los ve en «Errores de las apps».
- **Modo DEMO:** con una línea demo (botón Autodemo, o el panel responde `"demo": true` en `check_mac` o `progress.php`) la app muestra **DEMO** en lugar del usuario (inicio, perfil, Mi cuenta), nunca la contraseña, y no guarda ni muestra "Continuar viendo" ni "Mi lista": agregar a Mi lista avisa "No disponible en la DEMO". El panel tampoco guarda nada de una línea demo. En **Mi cuenta** la demo solo muestra su **Vencimiento**: el fin que dice el panel (`demo_expires` de `check_mac` / `auto_demo`) con la hora exacta, y la duración (`demo_duration`: 1 hora, 2 horas…) junto a «Cuenta DEMO»; nunca la fecha, las conexiones, el servidor ni el alta de la línea demo del servidor IPTV.
- **Varias líneas para el equipo:** se entra solo con la primera que funciona (ya no aparece "Elige tu servicio").
- **Autodemo:** el botón ya no se bloquea en el equipo: el panel decide (si el dueño borró el registro, se puede pedir otra demo).
- **Descargas para ver sin internet (solo celular):** en la ficha de una película, **Descargar** junto a Mi lista; en una serie, un icono pequeño abajo a la derecha de la miniatura de cada episodio (muestra el avance y queda verde al terminar). **Cuenta › Mis descargas** separa Películas (carátula y título) y Series (cada serie abre sus episodios descargados); se reproducen sin internet en el reproductor de la app (con imagen en imagen), siguen donde se dejaron y se pueden eliminar (se borra el archivo). Todo queda en la carpeta privada de la app (`filesDir/downloads`), sin abrir otras apps ni mostrar la dirección del servidor. Una descarga a la vez, se reanuda donde iba si la conexión se corta (`Range`), comprueba el espacio libre y sigue con la app en segundo plano (`DownloadService`, notificación con el progreso; Android 13+ pide permiso de notificaciones en la primera descarga). HLS (`.m3u8`) no se descarga. Sin internet (o si el panel no responde), el inicio de sesión muestra el botón **Mis descargas**. Código: `data/Downloads.kt`, `data/DownloadService.kt`, `ui/screens/DownloadsScreen.kt`.
- **Autodemo, entrada:** la app entra con la línea que devuelve `auto_demo` (usuario, contraseña y `url`, el servidor de la demo) y después prueba los DNS del panel; solo si ninguno responde vuelve a pedir las líneas del equipo (`auth.php` / `check_mac`). `503` = el panel no pudo confirmar la demo con el servidor IPTV (no se registra nada).
- **http / https:** el panel está en https y manda las direcciones de los servidores IPTV con `https://`. Muchos servidores solo responden en http (p. ej. puerto 8080): si un servidor no contesta, `Xtream.login` prueba el otro protocolo y la sesión se queda con el que respondió (antes salía "No se pudo conectar con el servidor").
- **Destacado (TV):** la letra antes de SERIE / PELÍCULA es la inicial del distribuidor (o «M» de MPX Player) en su color de acento; al cambiar de sección el último destacado queda de fondo mientras llegan los nuevos (nunca pantalla negra).
- **Foco del control:** el borde de foco (`NfFocus` en `ui/theme/Theme.kt`: tarjetas, mosaicos, botones, reproductor) es blanco sin distribuidor y el acento del distribuidor con paleta (aclarado si es muy oscuro).
- **Mi cuenta:** además de vencimiento, conexiones, servidor y alta muestra la cantidad del catálogo cargado: Canales en vivo, Películas y Series («…» mientras se baja).
- **Cuenta → Cambiar distribuidor:** muestra distribuidor, número y vencimiento; borra todo, cierra sesión y vuelve a pedir el número.

## Datos que viven en el panel

Todas estas llamadas usan un token: la app hace `POST progress.php {"action":"auth","user","pass"}` una vez y guarda solo el token (30 días). Si vence, pide otro.

| Endpoint | Uso en la app |
|---|---|
| `api/progress.php` | **Continuar viendo** y **Mi lista / canales favoritos**. `GET ?v=2` → `{progress, favorites}`; `POST` `save`, `delete`, `fav_add`, `fav_remove`. Mismo formato que la web: película por nombre (`type: movie`), serie una sola entrada por serie (`type: episode`, `id` del episodio, `seriesId`). Al 95 % se borra. Nada de esto queda solo en el equipo. |
| `api/epg.php` | Guía de respaldo: primero `get_short_epg` del proveedor; si un canal no trae guía, `POST {channels:[{id, epg, name}]}` en lotes de hasta 400 canales. |
| `api/sports.php` | Pestaña **Deportes**: partidos de hoy y mañana con el mismo diseño de la web (Hoy/Mañana, deportes con emoji, escudos, en vivo / marcador / final). Cada tarjeta muestra los canales que transmiten el partido (`tv`, los de la región primero); al tocarla sale el menú **Ver el evento** (automático), cada canal y **Buscar por equipos**. Un canal se busca por su nombre en la lista del cliente sin calidad ni país (`ESPN 2` encuentra `MX: ESPN 2 HD`, nunca `ESPN` ni `ESPN 3`); si el cliente no lo tiene, se busca el evento por equipos o nombre en las carpetas de eventos (reglas `match` del panel). |

**Aviso al abrir la app** (`api/alerta.php?format=json&lang&user&pass&dns&title`, sin token; `lang` = idioma de la app, el panel devuelve el título y el botón en ese idioma): lo que se configura en **Alertas** del panel. Con 3, 2 o 1 días restantes sale el texto de ese día, con 0 días o vencida el de 0 días (título rojo, sin imagen); si no, la bienvenida con el texto general y la imagen de `img/alertas/`. Sale una vez cada vez que se abre la app y otra vez tras iniciar sesión, con un solo botón **Entendido** (enfocado para el control remoto; atrás también lo cierra). Código: `data/Alerts.kt`, `ui/components/PanelAlert.kt`.

## DNS

Botón **DNS** en el inicio de sesión y en **Cuenta**: Automático (por defecto), Cloudflare, Google, Quad9, AdGuard (sin rastreo ni anuncios), NextDNS (anti-bloqueo geográfico) y OpenDNS.
Usa DNS sobre HTTPS (`okhttp-dnsoverhttps`) en el único cliente OkHttp de la app, así aplica a todo: panel, Xtream, imágenes y el reproductor. La elección se guarda en el equipo.

## Idiomas

La app está en español (por defecto), inglés, portugués (Brasil) y francés: `res/values/strings.xml` (español) y `values-en`, `values-pt`, `values-fr`.
- **Automático** (por defecto): el idioma del equipo; si no es uno de los cuatro, español.
- **Cuenta › Idioma de la app**: Automático, Español, English, Português o Français. Se guarda en el equipo (`app_lang` en las preferencias) y se aplica al momento (se recrea la pantalla, sin cerrar sesión).
- Panel: cada pedido a `api/` lleva `Accept-Language: <idioma>` y el JSON cifrado de `login.php` lleva `"lang"`; el panel responde sus mensajes en ese idioma (los códigos de error no cambian).
- Código: `Lang.kt` (idioma elegido, `attachBaseContext` de cada actividad y del reproductor, `tr()` para textos fuera de Compose) y `ui/components/LanguagePicker.kt`.
- No se traducen los títulos del servidor IPTV ni de TMDB, los textos del panel (avisos, errores, pantalla falsa), las marcas ni la insignia «DEMO». Las palabras clave que reconocen plataformas y géneros en las categorías del servidor (`data/Platforms.kt`) siguen en español; solo cambia la etiqueta que se muestra.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `data/` | Panel (`Panel.kt`, `PanelCrypto.kt`, `PanelUrl.kt`), progreso y favoritos (`Cloud.kt`), guía (`PanelEpg.kt`), deportes (`Sports.kt`), DNS (`SecureDns.kt`), API Xtream (`Xtream.kt`), preferencias del equipo (`Store.kt`) |
| `ui/` | Pantallas en Jetpack Compose: activación, inicio, películas, series, TV en vivo, deportes, mi lista, buscar, cuenta, detalle |
| `player/` | Reproductor ExoPlayer (`PlayerActivity.kt`) |
| `Device.kt` | Detección de TV o teléfono y código del equipo |
