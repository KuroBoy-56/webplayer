# LatMpx TV+ para iPhone y iPad (rama `ios`)

La misma app de Android para celular, hecha para iOS (SwiftUI + VLCKit). Funciona en iPhone y iPad (iOS 16 o superior).

## Qué hace

- **Registro por MAC.** Cada equipo tiene un código con formato MAC (`A1:B2:C3:D4:E5:F6:07:18`) que se crea la primera vez y se guarda en el llavero de iOS (se conserva aunque se borre la app). Es el que se registra en el panel (Clientes MAC; el dispositivo aparece como **iPhone / iPad**).
- **Inicio de sesión con el panel, sin datos guardados.** La app nunca guarda el usuario ni la contraseña. Cada vez que se abre pregunta al panel por este equipo (`auth.php` / `check_mac`) y comprueba la línea en el servidor IPTV antes de entrar. Al volver a la app (como mucho cada 15 min) repite la comprobación: si el equipo ya no está en el panel, la contraseña cambió o la línea venció, vuelve al inicio de sesión. Sin conexión no se cierra nada.
- **Activación manual:** usuario + contraseña + Iniciar sesión (`submit_url` con el primer servidor de `fetch_dns`).
- **Autodemo:** botón Autodemo (`auto_demo`). El **código de un revendedor** escrito en la casilla Contraseña deja la demo a su nombre.
- **Distribuidor:** la primera vez pide el número de distribuidor (Continuar / Omitir), aplica su nombre, logo y colores, y lo vuelve a comprobar con el panel en segundo plano.
- **Control parental:** siempre activo con el PIN del panel (`0000` de fábrica). Cambiarlo pide el PIN actual y se guarda en el panel (`set_pin`), donde el dueño lo ve y lo puede volver a `0000`. Las carpetas bloqueadas se ocultan en toda la app.
- **Pantalla falsa** del panel para equipos nuevos (calculadora, carrusel, imagen, video o web; el código + `=` en la calculadora, o mantener pulsado 3 s en los demás, abre el inicio de sesión). Si el distribuidor registra el equipo, la app se abre sola.
- **Sincronizado con el panel:** Continuar viendo y Mi lista (`progress.php`), guía de respaldo (`epg.php`), aviso de bienvenida / vencimiento (`alerta.php`) y errores de reproducción (`report.php`).
- **Deportes:** agenda de hoy y mañana (`sports.php`). Cada tarjeta muestra los canales que transmiten el partido; **Ver canales** abre un menú: el evento (prueba esos canales y luego los equipos), cada canal o buscar por equipos. "ESPN 2" busca en la lista del cliente el canal que se llama igual sin calidad ni país; si no lo tiene, busca el partido en la carpeta de eventos.
- **Reproductor VLCKit:** MKV, MP4, HLS, TS, audio AC3/E-AC3/DTS, cambio de idioma y subtítulos, sigue donde se dejó, siguiente episodio automático, cambio de canal deslizando arriba/abajo.
- **Inicio de sesión centrado** con la firma del distribuidor abajo.
- **Misma interfaz que Android celular:** barra superior con Series / Películas / Deportes / Mi lista y perfil (Mi cuenta, Ajustes, Deportes, Mi lista); Películas y Series con destacados, recientes, Top 10 y una fila por categoría.
- **TV en vivo como Android:** miniatura del canal elegido arriba (con "EN VIVO" y lo que se emite), favorito, guía de programas, selector de categorías, buscador y lista de canales con su programa actual. Mantener pulsado un canal lo agrega o quita de favoritos. La pantalla completa se abre con su botón o al girar el teléfono (volver a vertical regresa a la miniatura).
- **Orientación:** en iPhone la app va en vertical y el reproductor en horizontal (lo presenta UIKit con su propia orientación, sin forzar la escena: así los toques siempre responden). En iPad gira libre.
- **DNS** (botón en el inicio de sesión y en Ajustes): Automático, Cloudflare, Google, Quad9, AdGuard, NextDNS u OpenDNS. iOS no deja cambiar el DNS del sistema, así que la app resuelve los servidores IPTV (http) con DNS sobre HTTPS y se conecta a esa IP; si no responde usa la dirección original. El panel y TMDB (https) siguen con el DNS del equipo.

## Instalar el .ipa en tu iPhone (modo desarrollador)

El `.ipa` de **Releases › ipa-latest** se compila sin firma (no hay cuenta de Apple Developer). Para instalarlo hay que firmarlo con tu Apple ID:

1. En la computadora instala **Sideloadly** (Windows o Mac, https://sideloadly.io) o **AltStore** (https://altstore.io).
2. Conecta el iPhone por cable, abre Sideloadly, arrastra `LatMpx.ipa`, escribe tu Apple ID y pulsa **Start**.
3. En el iPhone: **Ajustes › Privacidad y seguridad › Modo de desarrollador › Activar** (se reinicia) y después **Ajustes › General › VPN y gestión de dispositivos ›** tu Apple ID **› Confiar**.
4. Abre LatMpx TV+.

Con un Apple ID gratuito la firma dura **7 días**: vuelve a instalarlo con Sideloadly (o deja que AltStore lo renueve). Con una cuenta de Apple Developer (99 USD/año) dura un año y se puede publicar en TestFlight.

## Compilar

GitHub Actions (`.github/workflows/ios.yml`, en cada push a `ios`) compila en macOS y publica `LatMpx.ipa` en **Releases › ipa-latest**.

La llave maestra del panel no va en el código: el secreto **`PANEL_MASTER_KEY`** (Settings › Secrets and variables › Actions del repositorio) se escribe en `LatMpx/Data/PanelKey.swift` (ignorado por git) solo durante la compilación. Sin el secreto la app compila pero no puede activar equipos (lo avisa en el inicio de sesión).

En una Mac:

```sh
brew install xcodegen cocoapods
PANEL_MASTER_KEY=<64 hex> sh tools/write-panel-key.sh
xcodegen generate && pod install
open LatMpx.xcworkspace
```

## Archivos

- `LatMpx/Data/` — panel (cifrado AES-256-GCM + HKDF y mope, igual que Android), Xtream, distribuidor, sincronización, deportes, TMDB.
- `LatMpx/UI/` — pantallas (inicio, películas, series, TV en vivo, deportes, cuenta, inicio de sesión, distribuidor, pantalla falsa).
- `LatMpx/Player/` — reproductor VLCKit (`PlayerPresenter` lo presenta en horizontal) y la miniatura de TV en vivo (`LivePreview`).
- `project.yml` (XcodeGen) y `Podfile` (MobileVLCKit).
