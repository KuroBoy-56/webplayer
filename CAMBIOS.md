# WebPlayer: resumen de cambios

Desde la actualización del 4 de octubre **todo se administra desde el panel** (ver la última sección). Las secciones de abajo describen la historia de cambios. Donde mencionan el administrador, `setup.php`, `dns.json`, `admin.json`, `progress.json`, `userdata.sqlite`, el proxy de video (`proxy.php`), la conversión con ffmpeg (`media.php`, `bin/`) o el botón DNS, eso ya no existe: el video va directo del servidor IPTV al navegador.

**Requisitos:** PHP 7.1 o superior con las extensiones `curl` y `openssl` (ffmpeg ya no se usa). La carpeta `includes/cache/` debe tener permisos de escritura. Hace falta `includes/panel_secret.php` (ver abajo).

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
- Las notificaciones locales se quitaron (el reproductor no las mostraba). El aviso de vencimiento del panel (`api/alerta.php`) es una pantalla para las apps y no se usa aquí.
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
