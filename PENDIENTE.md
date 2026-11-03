# Pendientes del web player — 3 de noviembre de 2026

Revisión de lo que tiene el web player (rama `main`) comparado con Roku, Vega OS 1.0.55, webOS 1.3.0, Tizen 1.1.0,
Android / Android TV, Windows y lo que el panel (`panelweb` `main`) ya ofrece. **Solo documentación: nada de esto está
hecho todavía; se ejecuta cuando el dueño lo ordene.** El historial de lo ya hecho está en `CAMBIOS.md`.

## Lo que ya tiene

| Función | Estado | Dónde |
| --- | --- | --- |
| Pedidos a `login.php` del panel con `ts` antirrepetición (lista de DNS, distribuidor, pantalla falsa) y reintento si el reloj está corrido | ✅ | `includes/panel.php`, `includes/tenant.php`, `includes/fake_screen.php` |
| Inicio de sesión con la línea comprobada por el panel, freno de intentos por IP | ✅ | `login.php`, `wp_rate_limited` en `includes/core.php` |
| Distribuidor (número, marca, colores), pantalla falsa, DEMO marcada por el panel (sin progreso ni Mi lista) | ✅ | `includes/tenant*.php`, `includes/fake_screen.php` |
| Aviso del panel (Alertas) con varias imágenes cada 3 s o video corto | ✅ | `api.php`, `assets/nf/alert.js` |
| Progreso y Mi lista sincronizados con las apps (`progress.php`) | ✅ | `includes/progress_save.php` |
| Carátulas y fondos por la caché del panel (`imgc` → `img.php` → original → TMDB) | ✅ | `includes/panel_img.php`, `img.php` |
| Deportes: agenda, Tablas, Selecciones, Equipos | ✅ | `sportsschedule.php`, `includes/sports_panel.php` |
| Idiomas compartidos con el panel (`tracks.php`): los pide al abrir la ficha y deja lo leído para los demás equipos | ✅ | `tracks.php`, `includes/file_tracks.php` |
| Conversión de audio / subtítulos / video en el motor del panel (`media_web.php`, solo VPS / VDS, con los permisos e interruptores del dueño y del distribuidor) | ✅ | `includes/media_core.php`, `assets/nf/player.js` |
| MP4 con varios audios: cambio de idioma en el navegador sin servidor (lector MSE propio, `mp4box.js`) | ✅ | `assets/nf/mp4mse.js` |
| SSL sin cargar el hosting (https directo → VPS / VDS → http → hosting al final) | ✅ | `play.php`, `GUIA.md` |
| Direcciones con token aleatorio (`w-<token>`), dominio propio opcional con Worker de Cloudflare | ✅ | `route.php`, `includes/route_token.php`, `includes/edge.php` |
| Siguiente episodio con cuenta regresiva, menú de idiomas solo con el idioma | ✅ | `assets/nf/player.js` |
| 4 idiomas (es / en / pt / fr) | ✅ | `includes/lang/` |
| Reportes de error | ✅ | `report.php`, `includes/error_report.php` |

**No aplican en la web:** borrado de caché remoto con reinicio (no hay app instalada; la caché del hosting se maneja
aparte), pantalla de control remoto, teclado en pantalla.

## Lo que le falta

### 1. Restringir el acceso a la web (prioridad alta) — el plan ya presentado
Hoy cualquiera con un usuario y contraseña válidos de la línea entra desde cualquier navegador, y el panel no puede
bloquear «este navegador» (la web no tiene id de equipo ni pasa por `check_mac`). Falta:
- **Id del navegador** (aleatorio, guardado en una cookie firmada y en `localStorage`), enviado al panel al entrar.
- **Sesión firmada por el panel**: el panel aprueba el login (línea + navegador) y devuelve un token corto que la web
  revisa en cada página; el panel puede cortarla (lista negra, línea quitada, DEMO vencida).
- **Lista negra** por usuario o por navegador (la misma página «Lista negra» del distribuidor; `kind = web`), con el
  aviso «Este equipo está bloqueado…».
- **Turnstile de Cloudflare** en el login y freno de intentos por IP y por usuario.
- Panel: `login.php` (acción nueva para la web), `includes/blacklist.php` (navegador), página de Clientes.

### 2. Top 10 de la semana (prioridad alta)
Hoy «Top 10 de hoy» se arma con la calificación del catálogo (`api.php?action=row&sort=top`). Falta usar
`api/top10.php` del panel (lo más popular de la semana en TMDB cruzado con el catálogo por título y año ±1; lo que falte
con lo mejor calificado, distinto cada semana), guardado 12 h en `includes/cache/`. Títulos «Top 10 de la semana».
Archivos: `homex.php`, `api.php`, `includes/core.php`, `includes/lang/*.php`.

### 3. Control parental con el PIN del panel (prioridad media)
Las apps ocultan siempre el contenido para adultos y lo desbloquean con el PIN del panel (`pin` de la línea; 0000 de
fábrica) y lo cambian con `set_pin`. La web **no tiene control parental**: categorías y títulos de adultos se ven
siempre. Falta el filtro (mismas palabras que las apps), el diálogo de PIN y «Cambiar PIN» en Mi cuenta.

### 4. Lector MKV en el navegador (prioridad media) — el servidor como último recurso
El MP4 ya cambia de idioma en el navegador; un **MKV** con varios audios o con subtítulos de texto todavía necesita el
motor del panel. Falta llevar el lector MKV de Vega 1.0.49–1.0.55 (`src/player/mkvparse.ts` + `mkvmse.ts`: MKV →
MP4 fragmentado por MSE con el audio elegido; subtítulos SRT / ASS / WebVTT leídos por la app) a `assets/nf/mkvmse.js`.
Solo audios que el navegador decodifica (AAC, MP3, Opus; AC-3 / E-AC-3 en Edge y Safari); DTS / TrueHD siguen yendo al
motor. Con el motor apagado: aviso «es necesario encender el servidor», como las TV.

### 5. Lector MP4 más rápido con servidores lentos (prioridad media)
`mp4mse.js` todavía no tiene lo aprendido en Vega 1.0.52–1.0.54 con servidores XUI: índice (`moov`) al final leído en
partes de 1 MB de a 3 a la vez y guardado; principio del video pedido junto con el índice (y de a uno si la línea
rechaza pedidos a la vez); plazos por pedido (12 s para contestar, 15 s + 40 KB/s para bajar) y detección del servidor
que ignora el final del `Range`; primer tramo de 1,5 s para empezar enseguida.

### 6. Deportes: canal del partido por la guía (prioridad baja)
Vega y Roku piden `api/sports_epg.php` (el panel dice qué canales tienen el partido en su programación). La web solo
busca por el nombre de los canales que transmiten y por equipos. Falta pedirlo en `includes/sports_panel.php`.

### 7. Autodemo (opcional, solo después del punto 1)
Las apps tienen botón Autodemo (con código de revendedor). La web no, y no conviene ponerlo sin el id del navegador y
Turnstile del punto 1 (cualquiera podría pedir demos sin límite).

## Orden propuesto
1 → 2 → 4 → 5 → 3 → 6 → 7. Cada punto con su lista de archivos para subir al hosting (y al panel cuando toque) en
`CAMBIOS.md`. El punto 1 es el único que también cambia el panel.
