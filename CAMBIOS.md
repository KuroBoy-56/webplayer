# WebPlayer: resumen de cambios

Desde la actualización del 4 de octubre **todo se administra desde el panel** (ver la última sección). Las secciones de abajo describen la historia de cambios. Donde mencionan el administrador, `setup.php`, `dns.json`, `admin.json`, `progress.json`, `userdata.sqlite`, el proxy de video (`proxy.php`), la conversión con ffmpeg (`media.php`, `bin/`) o el botón DNS, eso ya no existe: el video va directo del servidor IPTV al navegador.

**Requisitos:** PHP 7.1 o superior con las extensiones `curl` y `openssl` (ffmpeg ya no se usa). La carpeta `includes/cache/` debe tener permisos de escritura. Hace falta `includes/panel_secret.php` (ver abajo).

## Sin demo automática (12 de octubre)
- La web player **no tiene demo automática**: no hay botón ni se pide una demo al panel. El panel tampoco la ofrece a la web (`tenant_config` responde `features.demo: false` para `app: web` y `auto_demo` con `platform: web` se rechaza). Una línea DEMO creada en el panel o en una app sigue entrando con su usuario y contraseña, en modo DEMO (ver abajo).
- Archivos: `includes/tenant.php` (ya no lee `features.demo`).

## Modo DEMO (12 de octubre)
- **Cómo se sabe.** El panel marca las líneas DEMO con `"demo": true` en la respuesta de `api/progress.php` (acción `auth`, que la web pide al iniciar sesión, y también en `GET ?v=2`). La web lo guarda en la sesión del servidor (`is_demo`); un inicio de sesión normal lo quita. No se guardan credenciales en ningún sitio nuevo. Con un panel anterior (sin el campo) todo sigue como antes.
- **Sin usuario ni contraseña a la vista.** Con una DEMO el menú de la cuenta dice **Cuenta DEMO** (avatar "D"), **Mi cuenta** muestra *Usuario: DEMO* con la etiqueta **Cuenta DEMO**, el aviso del panel (Alertas) cambia el usuario/contraseña por "DEMO" y el diagnóstico los oculta. Tampoco hay **Descargar contenido** ni **Abrir en VLC** / lista `.m3u` (`playlist.php` responde "No disponible en la DEMO"), porque esos enlaces llevan el usuario y la contraseña. El login no cambia.
- **Sin Continuar viendo ni Mi lista.** No se llama a `save`, `delete`, `fav_add` ni `fav_remove` del panel (ni desde el reproductor ni desde `save_favorite.php` / `save_progress.php` / `play.php`), las filas **Continuar viendo** y **Mi lista** no aparecen y el botón **Mi lista** (y la estrella de los canales) muestra "No disponible en la DEMO".
- Con la web en **http** el video de una DEMO sigue yendo directo del servidor IPTV (`/movie/usuario/contraseña/…`), igual que con cualquier línea: para que no se vea en el navegador, usa la web con SSL.
- Archivos: `includes/panel.php` (`wp_is_demo`, `wp_panel_set_demo`, `wp_demo_mask`), `login.php`, `header.php`, `myaccount.php`, `assets/nf/app.js`, `video_player.php`, `play.php`, `includes/handoff.php`, `tvguide.php`, `save_favorite.php`, `includes/progress_save.php`, `playlist.php`, `api.php`, `diag.php`.

## Deportes con canales y revisión de la línea (11 de octubre)
- **Canales que transmiten.** El panel ahora manda, para muchos eventos, los canales donde se ven (`tv`). La tarjeta los muestra ("📺 ESPN 2 · Fox Sports +3") y el botón pasa a **Ver canales**, que abre un menú: **Ver el evento** (prueba esos canales en orden y, si el cliente no tiene ninguno, busca por los equipos), cada canal con su país, y **Buscar por equipos**.
- **Canal correcto.** "ESPN 2" busca en la lista del cliente el canal que se llama igual sin calidad ni país ("MX: ESPN 2 HD", "ESPN2"); nunca da "ESPN" ni "ESPN 3". Si no lo tiene, avisa ("No tienes ESPN 2") y busca el partido por los equipos o el nombre del evento en la carpeta de eventos. Mismas reglas que Android, Android TV, Roku, Vega OS y Windows.
- Sin canales del panel todo sigue como antes (botón **TV en vivo**).
- **La línea se revisa sola.** Como mucho cada 15 minutos, las páginas con sesión preguntan al servidor IPTV si el usuario sigue activo. Contraseña cambiada, cuenta vencida, suspendida o borrada: se cierra la sesión y el login dice el motivo. Si el servidor no responde no se corta nada. La web nunca guarda la contraseña en el navegador (solo en la sesión del servidor). Archivo: `includes/line_guard.php`.

## Pantalla falsa, errores y estadísticas del panel (10 de octubre)
- **Pantalla falsa.** Si en el panel (Pantalla Falsa) está marcada la app **Web**, quien abre la web sin sesión ve la pantalla configurada (calculadora, carrusel, imagen, video o una página web dentro de un marco aislado) en vez del login. El código del panel seguido de **=** (o Enter; en imagen/video/web, mantener pulsado 3 s para escribirlo) abre el login. El código se comprueba en el servidor (nunca va en la página ni en la caché; 20 intentos cada 10 minutos) y el navegador queda desbloqueado un año con una cookie firmada; si el dueño cambia el código, la pantalla vuelve a salir. Quien ya tiene sesión no la ve. Archivos: `includes/fake_screen.php`, `includes/fake_screen_view.php`.
- **Errores al panel.** Los errores fatales de PHP y los videos que no se pudieron reproducir llegan cifrados a **Errores de las apps** del panel (solo el dueño), con usuario, navegador y hora; la contraseña nunca. El navegador los manda por `report.php` (solo con sesión iniciada, 30 cada 10 minutos). Archivo: `includes/error_report.php`.
- **Estadísticas.** El progreso y el inicio de sesión mandan `platform: web` y la IP del visitante, así la web cuenta en el mapa y en "clientes más activos" del Dashboard.
- Necesita el panel actualizado (acción `fake_screen` de `api/login.php`). Con un panel anterior todo sigue como antes.

## Conversión de audio que no terminaba (10 de octubre)
- **Antes:** al elegir otro idioma (o con audio Dolby/DTS) el video quedaba "Convirtiendo" para siempre cuando el servidor IPTV dejaba de mandar datos: ffmpeg esperaba sin límite, `media.php` esperaba a ffmpeg sin límite y el reproductor nunca recibía el video. El ffmpeg colgado seguía vivo en el hosting aunque se cerrara el video.
- **Ahora:** ffmpeg corta una lectura sin datos a los 15 s y se reconecta en el mismo punto (`-rw_timeout` + `-reconnect`), así la conversión sigue aunque el servidor se trabe. `media.php` lee sin bloquearse: si ffmpeg no entrega nada en 40 s (o se queda 45 s sin datos a mitad del video) lo detiene y responde un error, y el reproductor pasa al modo compatible o vuelve al video directo. No quedan procesos colgados.
- El fotograma clave de inicio se calcula antes de abrir la conversión (una sola conexión al servidor IPTV a la vez); el reproductor lo lee de la caché cuando ya llegan datos (`do=kf&c=1`).
- Probado con un servidor de prueba que se traba cada 20 MB (antes: colgado para siempre; ahora: la película completa), uno que nunca responde (antes: colgado; ahora: error a los ~70 s y vuelve al video directo) y uno que acepta una sola conexión.

## Seguridad (10 de octubre)
- **Clave de TMDB fuera del código.** Ya no está escrita en `includes/core.php`. Se lee de `'tmdb_key'` en `includes/panel_secret.php` (no se sube a GitHub) y, si falta, se usa la clave TMDB que manda el panel. **Cambia la clave vieja en tu cuenta de TMDB**: quedó en el historial de GitHub y en los `webplayer.zip` anteriores.
- **Estado (`estado.php`) solo muestra lo tuyo.** "Últimos guardados de progreso" lista solo los guardados del usuario que tiene la sesión abierta (cada entrada lleva una huella del usuario, no su nombre). La lista de procesos del hosting y el botón para detener todas las conversiones salieron de esta página: se manejan desde el panel (Guía EPG › motor multimedia).
- Con la web player en **http** (sin SSL) el navegador sigue leyendo el video directo del servidor IPTV con la dirección `/movie/usuario/contraseña/…`, igual que cualquier app Xtream: así el video no pasa por el hosting. Con **https** el video va por el enlace firmado y no se ve. Para que no se vea, usa la web con SSL.

## 1. Login con varias DNS
- El formulario muestra solo usuario, contraseña e Ingresar. Ya no aparece el selector de DNS.
- Al ingresar se consultan **todas las DNS en paralelo** y se entra con la primera que acepta los datos (en las pruebas tardó 0,16 s con 3 servidores).
- Mensajes claros para cada caso: contraseña incorrecta, cuenta vencida, cuenta bloqueada o ningún servidor disponible.
- Límite de 15 intentos cada 5 minutos para frenar ataques de fuerza bruta.
- El acceso de administrador ahora queda guardado en la sesión del servidor.

## 2. HTTPS
- Se detecta HTTPS también detrás de un proxy o Cloudflare (`X-Forwarded-Proto`).
- Si la página está en HTTPS y el servidor IPTV es HTTP, el video pasa por `proxy.php` y los pósters por `img.php`, así el navegador no bloquea contenido mixto. Las URLs van firmadas, por lo que nadie puede usar el proxy para otras direcciones.
- Si la página está en HTTP, el video se reproduce directo desde el servidor, sin gastar ancho de banda del hosting.

## 3. Fluidez
- Las respuestas del servidor Xtream quedan en caché en disco, y si el servidor tarda se usa la copia anterior.
- La sesión ya no bloquea las peticiones simultáneas.
- Las filas se cargan a medida que se hace scroll, y las páginas se precargan al pasar el mouse por encima.
- Las transiciones entre páginas son suaves.
- Se quitó la redirección `?loaded=1`, que obligaba a cargar cada página dos veces.

## 4. Reproductor
- Nuevo reproductor estilo Netflix con estos controles: reanudar, ±10 s, audio, subtítulos, velocidad, PiP, pantalla completa, siguiente episodio con cuenta regresiva, atajos de teclado y doble toque en el celular.
- Si un formato falla, prueba automáticamente el siguiente: MP4, luego la extensión original y por último HLS (m3u8). Para TS en vivo usa hls.js y mpegts.js. Las librerías están incluidas en el zip y no dependen de un CDN.
- Se mantienen las opciones Descargar, Abrir en VLC y el modo VLC de Ajustes.
- **Límite honesto:** el navegador no puede decodificar algunos códecs por sí mismo, como HEVC/H.265 en algunos equipos, audio AC3/DTS o AVI antiguos. Si el servidor no entrega una versión MP4 o HLS de ese contenido, la única opción es VLC.

## 5. Filtros inteligentes
- Desde homex, cada plataforma (Netflix, Disney+, Max, Prime Video, Marvel, Apple TV+, Paramount+, DC, Navidad y Halloween) abre todo su contenido de películas y series.
- Dentro de cada plataforma se puede filtrar por género: acción, suspenso, aventura, anime, drama, comedia, terror, ciencia ficción, fantasía, romance, crimen, animación, infantil, documental, bélica, doramas, novelas y otros.
- Para encontrar coincidencias se combinan el nombre de la categoría, el género que informa el servidor y el cruce por título entre categorías. También se puede ordenar por recientes, A‑Z o calificación.

## 6. Diseño Netflix
- Se aplicaron los colores, la tipografía y el estilo de Netflix: hero rotativo, Top 10, filas con desplazamiento, "Continuar viendo", "Mi lista" y páginas de detalle con elenco y tráiler.
- En el celular en vertical se ve como la app de Netflix: póster central, botones de categoría arriba y barra de pestañas abajo.

## 7. Seguridad
- **Corregido:** cualquier persona podía entrar al panel de administración con la cookie `admin=true`. Ahora se valida en la sesión del servidor.
- **Corregido:** había inyección SQL en las páginas de administración y XSS en los mensajes.
- **Corregido:** `proxy.php` era un proxy abierto y `portal.php` exponía las DNS. Además, la contraseña del usuario se guardaba en una cookie. Ya no.
- `.htaccess` bloquea el acceso directo a los archivos `.json`, `.sqlite`, `.log` y otros archivos de datos, a `includes/` y a `api/`. También agrega cabeceras de seguridad y compresión.
- En el navegador se bloquean el clic derecho, F12, Ctrl+U y Ctrl+S.
- **Hay que saberlo:** el HTML, el CSS y el JavaScript siempre llegan al navegador, así que nadie puede ocultarlos al 100%. Los bloqueos solo frenan a usuarios comunes. El código PHP y los datos nunca son visibles desde afuera.
- **Opcional:** en `includes/core.php`, `define('WP_FORCE_PROXY', true)` hace que todo el video pase por el proxy para ocultar las DNS, pero consume ancho de banda del hosting.
- **Pendiente:** la contraseña del administrador sigue guardada en texto plano dentro de `admin.json`. El archivo está protegido por `.htaccess`, pero conviene usar una contraseña única.
- Si el hosting usa **nginx** en lugar de Apache, `.htaccess` no tiene efecto. En ese caso hay que agregar esta regla:
  ```
  location ~* \.(json|sqlite|db|log|lock|txt)$ { deny all; }
  location ~ ^/(includes|api)/ { deny all; }
  ```

## Pruebas realizadas
Se probó en Chromium, en PC y en celular, con un servidor Xtream simulado y en los modos HTTP y HTTPS. Pasaron estas pruebas: el login con varias DNS, todas las páginas sin errores PHP, el filtro Netflix + Acción, la reproducción de películas (MKV redirigido a MP4 y AVI con respaldo), episodios con salto al siguiente, TV en vivo con HLS, y el guardado del progreso y los favoritos. No se pudo probar con tu servidor IPTV real.

## Configuración inicial (nuevo)
- En una instalación desde cero, sin `includes/admin/admin.json`, el login te lleva a `setup.php`. Ahí creas el usuario y la contraseña del administrador, y opcionalmente la primera DNS.
- Para administrar las DNS, inicia sesión en el login normal con ese usuario y contraseña. Entrarás directo al panel de DNS (`includes/dns/edit_dns.php`).
- Cuando el administrador ya existe, `setup.php` queda bloqueado y redirige al login.

## Actualización 3 de octubre (reproducción, TMDB, deportes)

**Reproducción con HTTPS (sin volver a HTTP)**
- En iPhone y Safari el video ahora arranca en silencio cuando el navegador bloquea el sonido automático, igual que Netflix, y aparece el botón **Activar sonido**. Antes el reproductor esperaba y probaba otro formato hasta mostrar un error.
- Los enlaces del proxy son firmados y caducan a las 12 horas, y ya no dependen de la cookie de sesión. El reproductor del iPhone a veces pide el video sin enviarla.
- El proxy corrige el tipo de archivo cuando tu servidor IPTV responde `application/octet-stream`, porque Safari no reproduce en ese caso. También responde a peticiones HEAD.
- Si tu servidor IPTV tiene puerto HTTPS (`https_port` en su información), el video va directo del servidor al navegador sin pasar por el hosting. Si ese puerto no responde, en 9 segundos pasa al proxy.
- En iPhone y Safari se usa el HLS nativo. Los canales en vivo con HTTPS usan el flujo `.ts` continuo, que es más estable por el proxy que pedir cada segmento. El búfer es más amplio para evitar cortes.
- Nuevo botón **Diagnóstico** en la pantalla de error del reproductor (`diag.php`). Muestra cómo responde tu servidor IPTV a cada formato: código, tipo, si permite saltos en el video y tiempo de respuesta.

**Contenido**
- "Continuar viendo" y "Mi lista" solo muestran títulos que existen en el servidor IPTV con el que entraste.
- Se agregó tu clave de TMDB en `includes/core.php` (`WP_TMDB_KEY`). Las tarjetas cambian a carátulas de TMDB en alta calidad, con 30 días de caché. El detalle usa la carátula, el fondo, el elenco y el tráiler de TMDB, buscando por `tmdb_id` cuando el servidor lo envía.
- Los filtros de género se quitaron del inicio en PC (en el celular siguen) y la línea "Géneros" se quitó del detalle.

**Plataformas**
- Para usar logos propios, sube estas imágenes a la carpeta `img/`, en formato .webp de 275×183 px como las demás: `appletv.webp`, `paramount.webp` y `dc.webp`. Mientras no existan, se muestra el nombre de la plataforma.

**Deportes**
- La página es nueva: partidos de hoy y mañana en tu hora local, sección "En vivo ahora" con marcador, filtros por deporte, buscador y tarjetas por liga. En PC se ve en cuadrícula y en el celular en tarjetas compactas. Los datos vienen de TheSportsDB con 15 minutos de caché. Si no hay datos, se muestran las tablas de antes.

## Actualización 3 de octubre (pulido final)

**Reproducción**
- El diagnóstico mostró que tu servidor anuncia HTTPS en el puerto 443, pero desde una IP sin certificado válido. Ahora el reproductor solo usa la conexión HTTPS directa cuando el certificado es válido, y si no, va directo al proxy seguro sin esperar 9 segundos. Las películas de tu servidor no existen en formato m3u8, así que el diagnóstico lo muestra como "No disponible en este formato" y el reproductor lo descarta enseguida.
- **Audio e idiomas:** en el menú de audio aparecen todas las pistas del archivo (Español, Inglés...) y en el de subtítulos los subtítulos internos. Se recuerda el idioma que elijas.
- **Audio Dolby en 4K:** cuando el navegador no decodifica el audio (AC3, E-AC3, DTS), el servidor lo convierte al vuelo a AAC estéreo sin tocar el video, así el 4K se escucha en Chrome. Si el archivo no abre en el navegador (MKV, HEVC en equipos sin soporte), también se intenta la conversión antes de dar error.
- Esto necesita **ffmpeg** en el hosting. En `diag.php` aparece si está disponible. Si no lo está, sube los archivos `ffmpeg` y `ffprobe` estáticos para Linux a la carpeta `bin/` con permiso 755. Sin ffmpeg, el reproductor avisa que ese contenido se escucha en Safari, Edge o VLC.

**VLC**
- En el celular, "Abrir en VLC" abre la app directamente (Android e iPhone).
- En la PC se descarga una lista `.m3u` que abre VLC, y el botón de descarga lleva a la Microsoft Store en Windows o a videolan.org en Mac y Linux.

**Guía de TV (EPG)**
- Tu repositorio `KuroBoy-56/epg` es una copia de las herramientas de iptv-org, pero no tiene ningún archivo de guía. Por eso se integraron guías XMLTV públicas (epgshare01 y epg.pw) como respaldo automático.
- Los canales sin guía del servidor la toman de ahí, emparejados por id o por nombre. Se actualiza sola cada 12 horas en segundo plano.
- Puedes cambiar las fuentes en `includes/admin/epg_sources.json`, con una lista de URLs.

**Deportes**
- El botón **TV en vivo** de cada partido busca el canal que lo transmite, primero en las carpetas de eventos (EVENTOS, PPV, etc.), y abre el canal con más coincidencias.
- Si el partido no es de hoy, muestra "El evento no está en línea". Si ya terminó, avisa que el evento terminó.

**Otros**
- Top 10: el número 10 ya se ve completo.
- Logos de canales: pasan por el servidor con caché, así cargan también los de servidores que bloquean el enlace directo. Si el logo no existe, se muestra el logo del webplayer.

## Actualización 3 de octubre (audio 4K y diagnóstico)

- **Audio 4K:** antes de abrir el video, el reproductor revisa sus pistas. Si el audio es Dolby o DTS, arranca directo con la conversión, sin abrir antes una conexión directa. Muchas cuentas IPTV permiten una sola conexión, y esa conexión extra hacía que el servidor rechazara la conversión, que es la causa más probable de que no se escuchara.
- La conversión reintenta sola si el servidor IPTV la rechaza al principio. Si se corta a mitad de la película, se retoma donde iba.
- Ya no importa si la reproducción arrancó en silencio por el bloqueo de sonido automático: el reproductor sigue revisando si el audio realmente suena.
- **Diagnóstico:** nueva sección "Conversión de audio (ffmpeg)". Muestra si el hosting permite ejecutar programas, si los archivos de `bin/` tienen permiso y qué versión de ffmpeg arranca. El botón **Probar conversión con este contenido** convierte 15 segundos y mide la velocidad. También aparece el último error del reproductor. Se abre desde el menú ⋯ del reproductor: "¿Sin audio o no carga? Diagnóstico".
- **EPG:** en hostings con LiteSpeed (como Hostinger), la actualización de la guía de respaldo hacía esperar a la página del canal. Ahora corre aparte (`epgjob.php`).
- Los títulos de la guía del servidor se decodifican aunque vengan con saltos de línea.
- En el diagnóstico de un canal se ve si el servidor envía guía, si hay guía de respaldo y el resultado de cada fuente pública.
- **Top 10:** el ancho del 10 se mide con la fuente real del equipo, así el 0 nunca queda debajo de la carátula.

## Actualización 3 de octubre (hosting sin proc_open)

- Si el hosting bloquea `proc_open` (como Hostinger), la conversión con ffmpeg prueba sola las otras formas que tiene PHP para ejecutar programas: `popen`, `exec` o `shell_exec`. Basta con que una esté permitida. Se probaron las cuatro: pistas, conversión de audio y subtítulos funcionan con cualquiera de ellas.
- El diagnóstico muestra cuáles de esas cuatro funciones permite tu hosting.

## Actualización 3 de octubre (entrega final del reproductor)

**Pistas de audio y subtítulos**
- El menú de audio y subtítulos muestra todas las pistas del archivo, aunque haya una sola, y siempre se puede elegir cualquiera.
- Antes, si la consulta de pistas tardaba más de unos segundos, el resultado se perdía y el menú decía "no hay pistas". Ahora se aplica igual cuando llega, y si el servidor la rechaza se reintenta.
- Mientras se consultan, el menú dice "Buscando pistas…".
- Los subtítulos se extraen en segundo plano para que el límite de tiempo del hosting no los corte. El reproductor avisa con "Preparando subtítulos…" y los activa solos cuando están listos. La primera vez tarda porque hay que leer el archivo completo; después quedan guardados.
- Los subtítulos de imagen (PGS de Blu-ray 4K) aparecen marcados como "(imagen)". El navegador no puede mostrarlos, solo VLC.

**Que todo reproduzca**
- El orden ahora es: formatos directos, luego conversión de audio, luego conversión completa del video a H.264 720p (para HEVC de 10 bits, XviD, MPEG-2 y similares en equipos que no los soportan). El mensaje de error solo aparece si todo eso falla.

**Diagnóstico**
- Botón **Volver a la reproducción** arriba y abajo de la página. El diagnóstico es solo una prueba: el reproductor usa la conversión solo cuando hace falta.

**TMDB (carátulas, elenco, descripción)**
- Los nombres del servidor IPTV se limpian antes de buscar: prefijos ("ES -", "|LAT|", "4K |"), calidad (4K, HDR, 1080p, HEVC...), idioma (LAT, DUAL, SUBT...) y año, que se usa para afinar.
- Se elige el resultado que más se parece por título, año y popularidad, en vez del primero de la lista. Si nada se parece, no se muestra una carátula equivocada.
- Si no aparece, se intenta sin año, con el título antes de ":" y como serie o película. Si el `tmdb_id` del servidor está mal, se busca por nombre.
- Los "no encontrado" se vuelven a intentar a los 2 días (antes quedaban 30). Si TMDB no respondió, no se guarda nada.
- Descripción en español de México, luego de España y luego en inglés. Elenco también para series.

## Actualización 3 de octubre (reproducir siempre en el navegador)

**Navegador primero, VLC como último recurso**
- Antes de mostrar un error, el reproductor prueba en orden: formato directo, conversión del audio, conversión completa a H.264 720p y un **modo seguro** a 480p con audio resincronizado, pensado para archivos dañados o con tiempos rotos.
- Todas las conversiones ignoran los paquetes dañados del archivo en vez de detenerse.
- Si todo eso falla, se busca una solución automáticamente ("Buscando una solución…"). Si la encuentra, muestra "Posible solución a la reproducción o el audio" con **▶ Volver a reproducir**, y si no lo tocas reproduce solo a los 4 segundos.
- Si vuelve a fallar, ese contenido ya no muestra la opción de solucionar. Quedan solo Reintentar, Abrir en VLC y Descargar.
- El botón Diagnóstico ya no aparece en el reproductor. En el menú ⋮ está "¿Sin audio o no carga? Solucionar", que hace lo mismo sin salir del video. `diag.php` sigue disponible por URL para el administrador.

**Idioma del audio**
- Si el contenido trae varios idiomas, se elige el del navegador (español si el navegador está en español). Si no está, se usa la pista predeterminada del archivo.
- Si eliges otro idioma a mano, se recuerda para los siguientes contenidos.
- Se reconocen spa, es, es-419, lat, "Español latino", "Castellano", etc.

**Pistas en Chrome**
- Chrome no muestra las pistas de los archivos por sí mismo, Safari sí. Ahora, si al abrir Audio y subtítulos todavía no se conocen las pistas, el reproductor las busca.
- Si el servidor IPTV rechaza la consulta porque el video ya ocupa la conexión, el reproductor suelta la conexión un segundo, lee las pistas y retoma en el mismo punto.

**Abrir en VLC**
- **iPhone / Android:** abre la app VLC directamente. Si no está instalada, aparece una ventana con los botones de App Store y Google Play; el de tu equipo va primero. En Android, si falta VLC, se abre la Play Store sola.
- **Computadora:** intenta abrir VLC. Si no responde, se descarga una lista de reproducción que se abre con VLC, junto con botones para descargar VLC (Microsoft Store en Windows o videolan.org).
- Funciona igual desde la guía de TV y en pantalla completa.

## Actualización 4 de octubre (todo desde el panel)

**Configuración (lo único que hay que hacer en el hosting)**
- Copia `includes/panel_secret.sample.php` como `includes/panel_secret.php` y pon la llave maestra del panel (`master_key_hex`, la misma de `includes/secrets.php` del panel).
- Ese archivo está en `.gitignore`: nunca se sube a GitHub ni va dentro de `webplayer.zip`. Si falta, el login muestra "configura includes/panel_secret.php".
- La dirección del panel va codificada dentro del código, no en texto plano.

**Sin sección de administración**
- Se quitaron `setup.php`, `test.php`, `includes/admin/`, `includes/dns/`, `includes/notifications/`, `includes/admin_guard.php`, `includes/portal.php`, `database.php`, `epgjob.php` y el acceso de administrador del login.
- Las notificaciones locales se quitaron (el reproductor no las mostraba). El aviso del panel (`api/alerta.php`) ahora sí se muestra: ver "Aviso de bienvenida y vencimiento" al final.
- Puedes borrar del hosting los archivos viejos: `includes/admin/`, `includes/dns/`, `includes/notifications/`, `progress.json`, `api/history.json`, `api/live_favorites.json`, `includes/userdata.sqlite`, `setup.php`, `test.php`, `database.php` y `epgjob.php`.

**DNS desde el panel**
- La lista de DNS se pide al panel (`api/login.php`, acción `fetch_dns`, cifrada con la llave maestra). Se guarda 10 minutos en caché; si el panel no responde se usa la última lista buena.
- El login sigue probando todas las DNS en paralelo y entra con la primera que acepta al usuario con cuenta activa. Si el panel entrega la DNS como `https://`, también se prueba la versión `http://`.

**Continuar viendo y Mi lista en el panel**
- Al iniciar sesión se pide un token al panel (`api/progress.php`, acción `auth`) y queda en la sesión. Si caduca se renueva solo.
- "Continuar viendo", "Mi lista" y los canales favoritos se leen y guardan en el panel, así se comparten con la app Android y la de Windows. Ya no se guarda nada de esto en el hosting.
- En el panel, cada serie tiene una sola entrada (con el último episodio visto). Al llegar al 95 % el título sale de "Continuar viendo".
- "Mi cuenta" muestra lo que estás viendo (el historial local de vistos ya no existe).

**Guía EPG**
- Primero se usa la guía del servidor IPTV (`get_short_epg`). Si un canal no tiene, se pide al panel (`api/epg.php`) con 15 minutos de caché. Ya no se descargan guías XMLTV en el hosting.

**Deportes**
- Los partidos vienen del panel (`api/sports.php`, 10 minutos de caché). La búsqueda del canal en vivo sigue igual, con las mismas reglas que publica el panel.

## Actualización 4 de octubre (video directo, sin pasar por el hosting)

**El video ya no pasa por el hosting**
- Todo el video (películas, series y TV en vivo) va directo del servidor IPTV al navegador. El hosting compartido solo hace llamadas pequeñas: la API del servidor IPTV (`player_api`) y el panel.
- Se quitaron `proxy.php` (proxy de video), `media.php` (conversión con ffmpeg a MP4/HLS, pistas y subtítulos) y la carpeta `bin/`. Ya no hace falta ffmpeg en el hosting. Si los subiste, puedes borrar `bin/ffmpeg` y `bin/ffprobe`.
- Si la web está en HTTPS, los enlaces de video se arman en HTTPS hacia el servidor IPTV (`https_port` de su información, o el 443), así el navegador no bloquea contenido mixto. Tu servidor tiene certificado válido en el 443.
- "Descargar" lleva directo al archivo del servidor IPTV.
- `diag.php` ya no prueba ffmpeg. Muestra cómo responde cada formato y si el video sale en HTTPS directo.
- Se quitó el botón DNS y la resolución por DNS sobre HTTPS.

**Reproductor en PC y celulares**
- El reproductor detecta qué sabe hacer el navegador y elige solo:
  - hls.js donde hay MSE (Chrome, Edge, Firefox, Samsung Internet, Android).
  - HLS nativo en iPhone/Safari.
  - mpegts.js para TV en vivo `.ts` (MSE o ManagedMediaSource del iPhone con iOS 17.1 o superior).
  - MP4 directo con saltos (Range) para películas y series.
- TV en vivo en iPhone/Safari: se usa primero el m3u8 del servidor.
- Se mantiene la elección de audio y subtítulos con las pistas que muestra el navegador (Safari y HLS).
- Si un formato no se puede reproducir en ese navegador (por ejemplo MKV o HEVC en iPhone, o audio Dolby en Chrome), el reproductor lo dice y ofrece abrirlo en VLC o en otra app como último recurso.
- **Límite:** sin conversión en el hosting, lo que el navegador no decodifica (audio AC3/DTS en Chrome, MKV/HEVC en iPhone) solo se puede ver en VLC.

## Reproducción directa con la web en HTTPS (4 de octubre)
- Un navegador no deja que una página https reproduzca video http, y hls.js/mpegts.js necesitan permiso CORS del servidor IPTV. Por eso, sin proxy, no reproducía nada.
- Ahora la web prueba desde el hosting (solo unos bytes, con caché de 6 horas) si el servidor IPTV entrega el video por https con certificado válido. Si no, abre el reproductor `play.php` por http: el navegador lee el video directo del servidor IPTV, como cuando la web estaba en http. El video nunca pasa por el hosting.
- `play.php` no usa la cookie de sesión: recibe un enlace cifrado (AES-256-GCM, llave propia del hosting) que caduca en 12 horas. "Continuar viendo" se sigue guardando en el panel.
- Si el reproductor https falla con todas las fuentes, cambia solo a `play.php` y continúa desde el mismo segundo.
- TV en vivo: si el canal necesita http, en la guía aparece el botón **Ver canal**, que lo abre en `play.php`.
- `.htaccess` manda toda la web a https excepto `play.php` y `assets/`. En Hostinger hay que apagar **Forzar HTTPS**.
- Safari (iPhone) y Chrome cambian solos `http://` por `https://` cuando la web tiene SSL, y eso volvía a bloquear el video. `play.php` ahora regresa a http una vez: el navegador detecta el ciclo y se queda en http.
- Se probó volver al proxy del hosting, pero se descartó para no saturar el hosting compartido.

- El `.htaccess` ya **no** fuerza https. La web funciona en http y el video va directo del servidor IPTV. (Antes, al quitar el SSL, el propio `.htaccess` seguía redirigiendo a https y la web no abría.)
- Arreglado el login que se recargaba sin dar acceso en http: la cookie de sesion ya no se marca "secure" cuando la web esta en http (se fija por ini_set, sin depender del php.ini del hosting). Antes, si el hosting forzaba secure=1, el navegador descartaba la cookie.
- Audio y subtitulos seleccionables en cualquier navegador: en VOD, los navegadores que no exponen las pistas de un MP4 directo (Chrome, Firefox, Android) reproducen por HLS (hls.js), que si las expone. En Safari/iPhone se usa el archivo directo que ya trae esa funcion. Si el servidor no ofrece HLS para una pelicula, se reproduce igual el archivo directo (sin cambio de pista, como un MP4 normal).

## Audio dual sin doble audio y video por HTTPS (7 de octubre)
- **Motor MP4 propio (`assets/nf/mp4mse.js` + `assets/vendor/mp4box.min.js`):** cuando una película o episodio MP4 trae más de un audio (o subtítulos de texto), el navegador lee el archivo directo del servidor IPTV por partes, separa las pistas y reproduce **una sola**. El reproductor del navegador es el que manda: en iPhone ya no suenan dos idiomas a la vez, y en Chrome, Edge y Firefox de PC y Android por fin se puede elegir el idioma de un MP4 (antes solo Safari).
  - Cambiar de idioma continúa desde el mismo segundo. Adelantar o retroceder pide solo esa parte del archivo.
  - Arranca con el idioma que elegiste la última vez, o el del navegador.
  - Los subtítulos de texto que vienen dentro del MP4 aparecen en el menú de subtítulos.
  - Guarda en memoria solo lo necesario (borra lo ya visto) para que 4K funcione también en celulares.
  - Si el contenido tiene un solo audio, si el servidor no permite leerlo por partes (CORS/rangos) o el navegador no tiene MediaSource (iPhone con iOS menor a 17.1), se usa el reproductor de siempre.
- **iPhone:** la pantalla completa nunca abre el reproductor de iOS: se usa la pantalla completa propia del web player (con su menú de audio y subtítulos). Si iOS intenta abrir el suyo con un gesto, se vuelve al del navegador.
- **Video por HTTPS sin pasar por el hosting:** si pones la web en https, el orden es: 1) https directo del servidor IPTV (puerto https del servidor), 2) **relay https propio en Cloudflare** (`cloudflare/relay-worker.js`, gratis), 3) `play.php` en http. Con el relay, el video va servidor IPTV → Cloudflare → navegador. Ver GUIA.md.
- Corregidos textos con acentos rotos en el reproductor ("Capítulo anterior", "T1:E1 · título").
- La pantalla "No se pudo reproducir" muestra en letra pequeña por qué falló cada intento, si la página está en http o https y un enlace a **Diagnóstico**. Sirve para encontrar la causa con una captura.
- Después del motor MP4 se esperan 1,5 s antes de probar el reproductor normal, porque algunos servidores IPTV siguen contando esa conexión un momento y rechazan la siguiente.
- Relay de Cloudflare: si el servidor IPTV redirige una película o episodio a otro servidor (balanceador), el Worker sigue esa redirección él mismo. Así `ALLOWED_HOSTS` ya no lo bloquea. Hay que volver a pegar `cloudflare/relay-worker.js` en el Worker.
- `play.php` (el reproductor por http): Safari en iPhone vuelve a forzar https cuando la web tiene SSL, y entonces el video http quedaba bloqueado (error "native 4"). Ahora, si `play.php` termina abierto en https, usa las mismas fuentes https que la página normal: https directo del servidor IPTV o el relay de Cloudflare. **Con la web en https hace falta `includes/https_relay.php`** para el contenido que el servidor solo entrega por http.
- Con `includes/https_relay.php` creado, el relay de Cloudflare **siempre** queda como respaldo de cada formato. Antes, si la prueba del hosting decía que el https directo del servidor IPTV funcionaba, el relay nunca se usaba aunque el celular no pudiera abrirlo (caso Reacher: "mp4: native 4"). El motor de audio usa el relay de entrada, porque es el que da el permiso para leer las pistas. En la línea de detalle del error, los intentos por el relay dicen "relay".
- **Diagnóstico** ahora prueba también el relay de Cloudflare: si el Worker responde, qué contesta para cada formato (por ejemplo "host", "origin" o "upstream"), a qué servidor terminó yendo y si da el permiso CORS. El enlace "Diagnóstico" aparece también en el error de `play.php`.

## El hosting vuelve a entregar el video http (7 de octubre)
- **Regla:** si la DNS del servidor IPTV es `http://`, el video pasa por el hosting (`proxy.php`). Si es `https://`, va directo del servidor IPTV al navegador y el hosting no participa. El día que el proveedor entregue https, el hosting queda libre solo, sin tocar nada.
- Como el video llega desde tu mismo dominio, el navegador puede leer las pistas: el motor MP4 elige y cambia el idioma en el propio celular o PC (sin doble audio en iPhone), **sin usar ffmpeg**. El hosting solo reenvía bytes.
- `media.php` (ffmpeg) vuelve para el contenido http: lista de pistas, audio Dolby/DTS convertido a AAC y formatos que el navegador no abre (MKV, etc.). Con https no se usa.
- El relay de Cloudflare ya no hace falta: puedes borrar `includes/https_relay.php`.
- Archivos nuevos: `proxy.php`, `media.php`, `includes/media_core.php`, `includes/doh.php`, `bin/`.
- `instalar_ffmpeg.php`: abre esta página con tu sesión iniciada y toca "Descargar e instalar ffmpeg". El hosting descarga ffmpeg y ffprobe (versión estática 6.0 para Linux) directo a `bin/` y comprueba que funcionan. No hay que subir nada desde el celular. Después se puede borrar.
- Corregido: la DNS del proveedor es https, pero el video redirige a otro servidor por **http** (p. ej. `http://88.99.28.189`). El reproductor lo mandaba directo y el iPhone lo bloqueaba ("Load failed" / "native 4"). Ahora el hosting comprueba una vez (caché de 6 h) a dónde termina el enlace: si termina en http, el video pasa por `proxy.php`; si termina en https, va directo.

## El hosting solo trabaja con contenido de varios audios (7 de octubre, tarde)
- **Nueva regla (página en http):** el video va directo del servidor IPTV al navegador por http. Solo si la película o el episodio trae **más de una pista de audio** se agrega la fuente por el hosting (`proxy.php`), para poder elegir el idioma. Si esa fuente falla, sigue lo directo.
- Las pistas se cuentan **sin ffmpeg**: el hosting lee solo la cabecera del archivo (unos KB, MP4 y MKV) y guarda el resultado 30 días (`includes/audio_probe.php`).
- ffmpeg (`media.php`, "Solucionar") solo se ofrece en contenido con varios audios. Con un solo audio ya no aparece "No se pudo convertir".
- Más rápido: el reproductor ya no intenta el motor MP4 con un http directo (fallaba sin CORS y retrasaba el inicio), y con el motor MP4 no espera a ffmpeg antes de arrancar.
- Página en **https**: el navegador bloquea video http, así que ese video sigue pasando por el hosting. Para que el hosting quede libre, la web debe abrirse en http.
- Corregido "getaddrinfo() thread failed to start": cuando el hosting llega a su límite de procesos, curl no puede crear el hilo con el que busca la IP. Ahora la IP se busca con `gethostbyname()` (sin hilos), queda en caché 30 minutos y se le entrega a curl.
- `diag.php` muestra cuántos audios tiene el contenido, por dónde va el video y la IP resuelta del servidor IPTV.
- Corregido: al quitar el SSL el login parpadeaba y no entraba. El navegador conservaba la cookie de sesión "secure" de cuando la web era https y una página http no puede reemplazarla. Ahora la cookie de sesión se llama distinto en http (`WPSESS`) y en https (`WPSESS_S`).

## Progreso, doble audio en iPhone y pantalla completa (7 de octubre)
- **Progreso:** si el panel deja de responder por https (por ejemplo, al quitar el SSL del dominio), la web ahora prueba https sin revisar el certificado y luego http, y recuerda la forma que funcionó. Si el panel está caído, se espera solo una vez por minuto, así las páginas no se ponen lentas.
- **Doble audio en iPhone:** aunque el hosting no alcance a leer las pistas, el reproductor detecta en el propio iPhone que el MP4 trae varios audios y se cambia en el mismo segundo al motor MP4 por el hosting (un solo audio y menú de idiomas). Si eso falla, vuelve a lo directo.
- **Pantalla completa en iPhone:** con un solo audio se usa la pantalla completa real de iOS. Con varios audios sigue la pantalla completa propia (la de iOS mezclaría los audios).
- **Más rápido:** la lectura de pistas en el hosting tiene un tope de 3 segundos.
- Nuevo `estado.php`: muestra si el hosting llega al panel (https, https sin certificado, http), cuántos títulos de progreso tienes, los procesos del hosting y un botón para detener las conversiones de ffmpeg.
- **Pantalla completa real en iPhone también con selección de idioma:** con el motor MP4 o la conversión el video lleva un solo audio, así que se usa la pantalla completa de iOS (sin barra del navegador). Si iOS no la abre, queda la propia.
- **Contenido con varios audios donde el motor MP4 falla (p. ej. audio Dolby):** si el iPhone detecta varios audios en el reproductor normal, se leen las pistas en el hosting y ffmpeg entrega un solo audio (el elegido). Con un solo audio el hosting sigue sin trabajar (`media.lazy`).
- **Progreso más confiable:** al abrir un contenido el video arranca en 0 un instante antes de saltar al punto guardado (y al cambiar al motor MP4 se pausa). Esos primeros segundos se guardaban y borraban el progreso real. Ahora no se guarda nada antes de los 10 segundos, ni un punto muy anterior al guardado durante los primeros 2 minutos. Si el panel no confirma el guardado, se reintenta. Igual en http, https y `play.php`: el progreso vive en el panel, no en la web.
- `estado.php` muestra los últimos 30 intentos de guardar progreso (hora, contenido, posición y si el panel lo aceptó o por qué no) y si ffmpeg está instalado y puede ejecutarse.
- **Progreso que se guardaba pero no se veía:** si un mismo contenido estaba guardado más de una vez en el panel (por ejemplo, con otro título desde otra app), la web podía reanudar con la copia vieja. Ahora gana siempre el guardado más reciente. Además, la lectura del progreso pide al panel una respuesta sin caché, y `estado.php` muestra lo que el panel tiene guardado (título, posición y fecha).
- **Reacher salía como "1 audio":** el hosting tenía solo 3 segundos para leer las pistas y, en archivos grandes con el índice al final, se quedaba a medias y contaba 1. Ahora un conteo incompleto se toma como "no se sabe" (no se guarda como 1). Además, la página ya no espera ese conteo: si no se sabe, el reproductor arranca directo y lo pide en segundo plano (`tracks.php`, hasta 10 s). Si resultan varios audios, cambia al modo de elegir idioma, o a ffmpeg si ese modo no puede.
- Modo diagnóstico del reproductor: agrega `&debug=1` al enlace de `video_player.php` y se ve en pantalla qué fuente se prueba, cuántos audios ve el navegador, qué decide el motor MP4 y si entra ffmpeg.
- **Reacher en iPhone (visto con `&debug=1`):** Safari decía que el MP4 tenía 0 audios, pero sonaban los dos; por eso nunca se cambiaba al modo de un idioma. Ahora, en iPhone/iPad/Mac, si no se sabe cuántos audios tiene un contenido, el hosting los cuenta antes de abrir el video (solo la primera vez, luego queda en caché). Un conteo fallido ya no se guarda como definitivo. El motor MP4 ya no se intenta con el enlace directo del servidor IPTV (sin CORS fallaba tras 20 s de espera). Si el motor MP4 no puede, pasa a ffmpeg con un solo audio.
- Reacher seguía en "contó audios: 0": la lectura rápida de la cabecera no lograba leer ese archivo. Ahora cada lectura vuelve a pedir el enlace original del servidor IPTV y, si aun así no alcanza, `tracks.php` (en segundo plano) y `diag.php` preguntan a ffprobe cuántos audios hay. Solo se pregunta: no se convierte nada.
- **Aviso de carga para el usuario:** arriba del video aparece una línea en verde con puntitos que explica qué está pasando, una a la vez (la nueva reemplaza a la anterior): "Cargando el contenido", "Error de reproducción en este navegador" → "Probando otra forma de reproducir", "Este contenido tiene varios idiomas" → "Preparando la selección de idioma", "Tu navegador no es compatible con este formato" → "Convirtiendo a un archivo compatible" y, si tarda más de 15 s, "Ya casi: la conversión puede tardar unos segundos, no cierres el video". Desaparece apenas el video empieza a reproducirse. Los detalles técnicos siguen solo en `&debug=1`.
- **Listo para un proveedor con HTTPS y CORS (sin tocar código):** el hosting prueba solo, una vez cada 6 horas por servidor, si el video del proveedor llega por https y trae el permiso CORS para tu web (incluido el que pide el navegador para leer por partes). Si lo trae, los contenidos con varios idiomas van directo del servidor IPTV al navegador, que separa los idiomas por su cuenta, y tu hosting no transmite nada. Si no lo trae (como hoy), todo sigue igual que ahora. Funciona con la página en http o en https: el día que el proveedor lo active, solo instalas el SSL. El hosting solo se usaría como último recurso si el navegador no puede con el formato (conversión con ffmpeg).

## Continuar viendo y Mi lista entre DNS, y página de actor (8 de octubre)
- **Corregido: la web no mostraba el progreso ni Mi lista guardados en otras apps.** El login entra por la DNS que responde primero, así que cada vez podía ser otra DNS, y el panel guardaba los datos por usuario + DNS. Ahora el panel guarda por usuario + **servicio**: todas las DNS del mismo servicio comparten "Continuar viendo" y "Mi lista" (el panel lo detecta solo o con el campo "Servicio / grupo" de la página DNS del panel). La web no necesita configuración nueva.
- "Continuar viendo" y la cuenta se ordenan por la hora exacta del último guardado (antes, por segundos, dos guardados del mismo segundo podían salir en otro orden).
- **Actores:** en la ficha de una película o serie, tocar a alguien del elenco abre `actor.php` con su foto, biografía y **solo los títulos que tu servidor tiene** (filmografía de TMDB emparejada por título normalizado y año ±1, igual que la app de Windows). Al tocar un título se abre su ficha. Usa la clave TMDB del panel y, si falta o no sirve, la incorporada.

## Aviso de bienvenida y vencimiento (8 de octubre)
- Al entrar, la web muestra el aviso que se configura en **Alertas** del panel (`admin_alertas.php`), igual que las apps: si a la cuenta le quedan 3, 2 o 1 días sale el texto de ese día, si quedan 0 o está vencida el de 0 días; si no, la bienvenida con el texto general y la imagen.
- Sale una vez por sesión del navegador: al abrir la web y cada vez que se inicia sesión, con el diseño de la web y un botón **Entendido** (también se cierra con Esc o Enter).
- `api.php?action=alerta` le pide el aviso al panel (`api/alerta.php?format=json`) desde el hosting; la contraseña nunca pasa por el navegador. La imagen pasa por `img.php` si la web está en https y el panel en http.
- Necesita el `api/alerta.php` nuevo del panel (con `format=json`). Archivos: `api.php`, `header.php`, `assets/nf/alert.js`, `assets/nf/app.css`.

## Número de distribuidor (8 de octubre)
- **Primera visita:** antes del login aparece la pantalla **Número de distribuidor** (6 dígitos) con **Continuar** y **Omitir**. La elección queda guardada en el navegador (cookie `wp_dist` de 1 año): las siguientes veces se va directo al login, o al inicio si la sesión sigue abierta.
- **Omitir:** todo funciona exactamente como antes (datos del dueño del panel, logo, nombre y colores de siempre).
- **Continuar:** la web valida el número con el panel (`api/login.php` acción `tenant_config`, cifrada con la llave maestra) y aplica la marca del distribuidor: nombre (título, pie y menú), logo (cabecera, login, aviso y reproductor; si falla, el logo incorporado) y colores (`:root` del tema, botón con texto blanco o negro según el contraste). El navegador guarda una copia de logo, nombre y colores (`localStorage`).
- Con número, las peticiones al panel llevan `tenant` + `app: "web"`: lista de DNS (`fetch_dns`), token de progreso/Mi lista/guía/deportes (`progress.php`) y el aviso (`alerta.php?t=…&app=web`). La lista de DNS, la última lista buena (`dns_last_NNNNNN.json`), la clave TMDB y la agenda deportiva se guardan por número: dos distribuidores nunca se mezclan. El token del panel también es uno por número.
- **Guardián:** cada página revisa el distribuidor con el panel como mucho cada 10 minutos (copia compartida en el hosting). Si está vencido, suspendido, no es válido o no tiene habilitada la web, se cierra la sesión, se borra el número y se vuelve a pedir con el mensaje en español. Si el panel no responde se sigue con la última copia hasta 72 h; después aparece una pantalla para reintentar.
- Si el distribuidor apagó Deportes o Alertas en el panel, la web oculta Deportes o no muestra el aviso.
- **Mi cuenta:** muestra "Distribuidor: nombre (número)", "Vence: DD/MM/AAAA (hora de Panamá)" y el botón **Cambiar distribuidor** (cierra la sesión y vuelve a la pantalla del número; también sirve para poner un número si antes se eligió Omitir). En el login hay el mismo enlace.
- **Protección de la IP del hosting:** el panel cuenta los números no válidos por IP, y para el panel todas las visitas de la web vienen de la IP del hosting (10 en 15 min = espera; 30 en 24 h = IP bloqueada). La web corta antes: máximo 8 intentos por visitante cada 15 min y deja de preguntar números desconocidos tras 8 no válidos en 15 min o 25 en 24 h (los números ya validados siguen funcionando).
- Archivos: `includes/tenant.php`, `includes/tenant_brand.php`, `includes/tenant_guard.php`, `includes/tenant_login.php` (nuevos), `includes/panel.php`, `includes/actor.php`, `includes/handoff.php`, `includes/ui.php`, `login.php`, `logout.php`, `session.php`, `header.php`, `config.php`, `api.php`, `myaccount.php`, `sportsschedule.php`, `video_player.php`, `play.php`, `assets/nf/alert.js`. Opcional: `panel_url` en `includes/panel_secret.php` para apuntar a otro panel (pruebas).

## Motor multimedia controlado desde el panel (10 de octubre de 2026)
- `media_admin.php` + `includes/media_admin.php`: el panel (**Guía EPG › Web player**) ve si el motor (`media.php`, ffmpeg) está activado, cuántas conversiones hay en curso y puede **Detener conversiones**, **Activar** o **Desactivar**.
- Las órdenes van firmadas con la llave maestra del panel (la misma de `includes/panel_secret.php`); una orden sin firma válida se rechaza.
- Desactivado: la página del video ya no ofrece el motor y `media.php` responde 503, así que se reproduce el video directo del servidor IPTV.
