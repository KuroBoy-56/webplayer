# WebPlayer: resumen de cambios

Desde la actualización del 4 de octubre **todo se administra desde el panel** (ver la última sección). Las secciones de abajo describen la historia de cambios. Donde mencionan el administrador, `setup.php`, `dns.json`, `admin.json`, `progress.json`, `userdata.sqlite`, el proxy de video (`proxy.php`), la conversión con ffmpeg (`media.php`, `bin/`) o el botón DNS, eso ya no existe: el video va directo del servidor IPTV al navegador.

**Requisitos:** PHP 7.1 o superior con las extensiones `curl` y `openssl` (ffmpeg ya no se usa en el hosting: la conversión la hace el motor del panel en la VPS / VDS). La carpeta `includes/cache/` debe tener permisos de escritura. Hace falta `includes/panel_secret.php` (ver abajo).

## Sin la carpeta bin/ (28 de octubre)
- Se quitaron `bin/` (ffmpeg y ffprobe) e `instalar_ffmpeg.php`: el hosting ya no convierte ni analiza nada (lo hace el motor del panel en la VPS / VDS). Puedes borrarlos del hosting. `estado.php` ya no muestra «ffmpeg: NO instalado». La regla de `.htaccess` que bloquea `bin/` se queda por si quedó algo.

## Dominio propio con un Worker de Cloudflare (28 de octubre)
- **Opcional:** el cliente entra por un dominio nuevo y el dominio original da **403 Forbidden**. El Worker (`cloudflare/edge-worker.js`) manda un secreto; la web (`includes/edge.php`, cargado por `includes/core.php`) solo atiende con él y usa el dominio que ve el cliente y su IP real (login, cookies, redirecciones y el freno de intentos funcionan igual). Varios dominios, uno por distribuidor, cada uno con su secreto y, si quieres, fijo en su número (sin «Número de distribuidor» ni «Cambiar distribuidor»). Se activa con `'edge_keys'` en `includes/panel_secret.php` (`'edge_block' => false` para probar sin cerrar el original); sin eso nada cambia. El panel sigue llegando a `media_admin.php` (firmado). Guía: `docs/GUIA-WORKER.html`. Archivos: `includes/edge.php` (nuevo), `includes/core.php`, `includes/tenant.php`, `includes/tenant_login.php`, `includes/tenant_guard.php`, `login.php`, `media.php`, `oops.php`, `.htaccess`, `includes/panel_secret.sample.php`, `cloudflare/edge-worker.js` y `docs/GUIA-WORKER.html` (nuevos).

## Aviso de bienvenida con varias imágenes (28 de octubre)
- Con varias imágenes en **Alertas** del panel, el aviso las muestra todas en el mismo lugar y cambian cada 3 segundos (con un fundido; todas cargan de inicio). El encabezado no cambia; con una sola imagen o con el video, igual que antes. Archivos: `api.php`, `assets/nf/alert.js` (`v=5`), `assets/nf/app.css` (`v=11`), `header.php`, `login.php`, `play.php`, `video_player.php`, `includes/tenant_guard.php`.

## Aviso de bienvenida con video corto (27 de octubre, noche)
- El aviso del panel (Alertas) muestra la imagen por enlace y, si el panel tiene uno, un **video corto** (sin sonido, en bucle, con la imagen de portada; si el video no carga, queda la imagen). Archivos: `api.php`, `assets/nf/alert.js` (`v=4`), `header.php`.

## SSL sin cargar el hosting y direcciones con tokens (27 de octubre, tarde)

**SSL (Hostinger)**
- **Corregido:** con la web en https, todo video de un servidor IPTV http pasaba por `proxy.php` (el hosting reenviaba cada película y cada canal). Ahora el orden es: https directo del servidor IPTV → **la VPS / VDS de la línea** (`api/media_web.php?do=link` del panel firma el enlace; servidor IPTV → VPS / VDS → navegador, con permiso CORS: también sirve para elegir el idioma en el navegador; la VDS propia del distribuidor si la eligió, si no la del dueño) → `play.php` por http (solo con "Forzar HTTPS" apagado) → el hosting solo como último recurso. **El video nunca pasa por Cloudflare**: se quitó el relay de Cloudflare (`cloudflare/relay-worker.js`, `includes/https_relay.sample.php`); Cloudflare queda solo para los dominios.
- Con la VPS / VDS en https se puede activar **SSL y Forzar HTTPS** en hPanel. Probado: película por rangos y canal en vivo HLS por una VPS local; el navegador solo habló con la web y la VPS.
- `play.php` vuelve a http bien aunque la dirección sea un token, y el reproductor retoma el segundo con `?t=` en cualquier dirección.
- Ver GUIA.md: SSL con la VPS / VDS y Cloudflare solo para los dominios.

**Direcciones con tokens (como el panel)**
- Después del login la barra nunca muestra el nombre de una página `.php`: cada enlace es `w-<token>`, **distinto y aleatorio cada vez** (AES-256-GCM con un IV al azar y la llave propia del hosting), con la página, sus parámetros, la hora y la línea de la sesión. Un token alterado, de otra sesión o de más de 7 días lleva al inicio.
- Una página abierta por su nombre (enlace viejo, favorito, `homex`) se cambia sola a un token nuevo. Las redirecciones (`Location`), los enlaces, los formularios y la configuración del reproductor salen con token. Las llamadas internas (`api.php`, `img.php`, `report.php`, `tracks.php`…) no aparecen en la barra y siguen igual (como la API del panel).
- Filtros de Explorar y canal de TV en vivo: la barra conserva el token y agrega los filtros (`?_r=1&…`).
- Archivos: `route.php` (nuevo), `includes/route_token.php` (nuevo), `.htaccess` (regla `w-<token>`), `session.php`, `index.php`, `home.php`, `login.php`, `play.php`, `browse.php`, `tvguide.php`, `sportsschedule.php`, `video_player.php`, `includes/core.php`, `includes/handoff.php`, `assets/nf/player.js` (`v=33`), `GUIA.md`.
- Probado: cada enlace un token distinto; token alterado → inicio; token de otra sesión no sirve; una página abierta por nombre → token; `Location: homex.php` → token; los fetch de JavaScript y las direcciones que arma el JavaScript no se tocan; `&` de la configuración JSON respetado.

## Conversión por el motor del panel, carátulas del panel, Deportes nuevo, idiomas compartidos y TV en vivo estable (27 de octubre)

**Conversión de audio, subtítulos y video: ya no usa el hosting**
- La web ya no ejecuta ffmpeg ni ffprobe en el hosting: `media.php` quedó apagado (responde "motor no disponible") y `tracks.php` ya no usa ffprobe. La conversión la hace el **motor del panel** (`api/media_web.php`), igual que las apps, y **solo en una VPS / VDS**:
  - distribuidor con **su propia VDS** elegida en Distribuidores → convierte **solo en su VDS** (si no responde, el video sigue directo; nunca usa la VPS del dueño);
  - distribuidor en «Por defecto» u Omitir → la máquina del dueño (Guía EPG: VPS o VDS). Con Guía EPG en «Hosting», la web no convierte.
  - El permiso sigue siendo el del dueño (Distribuidores › motores › Web player) y el interruptor «Web player» de Guía EPG.
- **Más rápido y fluido:** el panel entrega HLS en fMP4 (hls.js en Chrome/Edge/Firefox/Android, HLS nativo en iPhone/Safari) y responde con el primer segmento (antes esperaba dos). Si el contenido tiene audio Dolby/DTS y los idiomas ya se saben, la conversión arranca **sin abrir antes el video directo** (en la prueba: ~1,7 s desde el punto guardado, con el idioma del navegador). Adelantar o retroceder **dentro de lo ya convertido es instantáneo** (no vuelve a convertir).
- **Audio siempre sincronizado:** al empezar en un punto que no es fotograma clave, audio y video arrancan juntos en el fotograma clave (`-noaccurate_seek`) y el motor anota el segundo exacto (`#EXT-X-MPX-START`), así el reloj, la barra y los subtítulos cuadran. (Antes el navegador dejaba el audio hasta ~2 s adelantado.)
- **Subtítulos del archivo** desde el motor del panel: se muestran mientras el panel todavía los está leyendo y se completan solos.
- **Solucionar** pregunta al motor del panel (no al hosting) y, si el formato no abre en el navegador, pide también el video convertido (`v=1`, solo VPS / VDS).
- Para que funcione hay que actualizar el panel y **copiar 3 archivos a la VPS y a cada VDS** (ver abajo). Mientras tanto la web sigue con el video directo, como si el motor estuviera apagado. Con la web en https, la VPS / VDS también necesita https.

**Idiomas compartidos con el panel (como Roku)**
- Orden: lo que el hosting ya sabe (30 días) → lo que el panel recuerda de ese video (`api/tracks.php`, ≤ 2 s, sin tocar el servidor IPTV) → la cabecera del archivo (unos KB por rangos, sin ffmpeg). Lo leído **se le deja al panel** para los demás equipos (mismo formato que Roku, Vega y LG).
- La ficha de la película (o el episodio que se va a ver) **pide los idiomas apenas se abre** (solo al panel): al pulsar Reproducir ya se saben.
- Lectura de cabecera más liviana: pocos pedidos grandes (MKV en 1 pedido, MP4 con el índice al final en 2).
- Menú de audio y subtítulos solo con el idioma ("Español latino", "Inglés"; si se repite, "Inglés 2"), como las apps.

**Carátulas y fondos por la caché del panel (como Roku, Vega, Android, Windows e iPhone)**
- Carátula: copia pública del panel (`api/imgc/<sha1>.jpg`) → `api/img.php` (la achica y, si el servidor no tiene, busca el póster en TMDB por título) → la original → TMDB por el hosting solo si todo falla. Mismos nombres que las apps: una sola copia por título para todos.
- Fondos de TMDB en Full HD hechos por el panel (`img.php?w=1920`) en la cartelera y las fichas; si no cargan, el de siempre.
- Si el dueño apaga la caché (`"img": false` de `progress.php ?v=2`) todo va directo, como antes.
- "Mi lista" guarda la carátula del servidor (la misma que usan las apps para la caché del panel).

**Deportes: Tablas, Selecciones y Equipos**
- Pestañas **Agenda / Tablas / Selecciones / Equipos** cuando el panel las ofrece (`tables.on`, `fixtures.on`, `fixtures.nat` de `api/sports.php`).
- **Tablas:** región (Copas, Selecciones, Europa, América, Resto del mundo), división (1.ª, 2.ª… y Liga femenina) y liga; tabla con PJ, G, E, P, GF, GC, DG, PTS, últimos resultados y zonas (clasificación, otra copa o ascenso, repechaje, descenso). Al tocar un equipo: su ficha (fundación, estadio, liga, títulos, descripción) con «Entendido» y «Más detalles». En celular: PJ, DG y PTS.
- **Selecciones:** partidos de selecciones por empezar o en vivo, por competición y «Selección femenina».
- **Equipos:** buscador por equipo (también en español: «Alemania» = «Germany») o por país, próximos 21 días, con los últimos 5 buscados. El botón de TV en vivo funciona igual que en la agenda.
- El hosting guarda **una sola copia por distribuidor e idioma** para todos (tablas hasta 7 días, partidos 12 h o hasta que el panel anuncie otra versión). Si el panel todavía está armando, se vuelve a preguntar solo.

**TV en vivo estable**
- Si el canal se corta mientras se mira (token XUI que vence, servidor que cierra o deja de mandar 15 s), se **reconecta solo y sin aviso** desde el enlace original (con token nuevo), con espera creciente.
- hls.js y mpegts.js con un margen de seguridad y puesta al día acelerando un poco (sin saltos que cortan el audio).

**Borrado de caché remoto:** no aplica a la web (el panel nunca le manda órdenes; la web no guarda datos en el equipo).

**Archivos de la web:** `media.php`, `tracks.php`, `video_player.php`, `play.php`, `tvguide.php`, `sportsschedule.php`, `Movie_description.php`, `seriesvideo.php`, `homex.php`, `api.php`, `header.php` (`app.js?v=8`), `includes/core.php`, `includes/panel.php`, `includes/panel_img.php` (nuevo), `includes/sports_panel.php` (nuevo), `includes/file_tracks.php` (nuevo), `includes/audio_probe.php`, `includes/media_core.php`, `includes/media_admin.php`, `includes/ui.php`, `includes/lang/{en,pt,fr}.php`, `assets/nf/player.js` (`v=32`), `assets/nf/app.js`, `assets/nf/sports.js` y `assets/nf/sports.css` (nuevos). Se pueden borrar del hosting `bin/` (ffmpeg) e `instalar_ffmpeg.php`.

**Archivos del panel:** `api/media_web.php` (nuevo), `api/media.php`, `api/media_worker.php`, `includes/media_engine.php`, `includes/media_convert.php`, `epg_manager.php`, `tools/vps/README.md`. **En la VPS y en cada VDS** (carpeta del motor, `/var/www/motor`): `api/media_worker.php`, `includes/media_engine.php`, `includes/media_convert.php`.

**Pruebas:** reproductor con el motor del panel nuevo (ffmpeg 6.1) y un "servidor IPTV" local: MKV con audio AC3 + AAC, desde el segundo 30 → arranca en ~1,7 s con el audio en inglés convertido, reloj exacto (fotograma clave 28), retroceso dentro de lo convertido sin reconvertir. Canal en vivo con token que vence a los 20 s → se reconecta solo y sigue. Lectura de idiomas de MKV y MP4 (índice al final). Carátulas con los mismos nombres que las apps. Deportes: pestañas, divisiones, ficha, selecciones, búsqueda en español y vista de celular.

## Login: fondo de pósters solo con clave TMDB (18 de octubre)
- **Fondo de pósters:** se ve solo si el panel lo entrega (`api/tmdb.php` con `t` = distribuidor, o sin él con Omitir). Con `tmdb_key_not_set` o un error del panel el fondo queda negro: ya no se muestran pósters viejos guardados (se quitó la copia de respaldo de 6 h) y la caché es de 10 min por distribuidor e idioma, así quitar o poner la clave en el panel se nota pronto. El carrusel sigue infinito y ahora vuelve al inicio sin el pequeño salto (filas completas).
- **«Cambiar distribuidor»** sigue siempre visible debajo de la caja de inicio de sesión (con número o con Omitir) y lleva a la pantalla «Número de distribuidor»; ahora con borde de foco para teclado.
- **No aplica a la web:** el botón Autodemo (el panel responde `demo: false` para la app web y la web no lo tiene) y el selector DNS (se quitó de la web, ver `includes/doh.php`).
- Archivos: `login.php`.

## Distribuidor: motor sin permiso, marca en el banner, plataformas y Mi cuenta (18 de octubre)
- **Motor de audio y subtítulos sin permiso (`features.ffmpeg` del panel):** sin permiso, con el motor apagado o sin ffmpeg, la página del video no ofrece el motor (`wp_media_off_text()` en `includes/media_admin.php`) y `media.php` responde 503 con `{"ffmpeg":false,"error":"Sin permisos"}` (mismo formato que el motor del panel; `?do=status` responde `{"ffmpeg":true}`). El reproductor no pasa por el motor de forma automática (formato no soportado → error normal o VLC) y `tracks.php` ya no usa ffprobe. Si el motor responde 503 a mitad del video, el reproductor muestra el texto **una vez**, deja de pedirle cosas en esa página y el video sigue directo, sin recargar ni spinner. Antes de soltar el video directo por una conversión que nada confirmó, se pregunta una sola vez (`do=status`). Con varios audios que el navegador no separa, el menú muestra *Otros idiomas*: al elegirlo solo aparece el aviso.
- **Subtítulos:** al volver de una conversión al video directo los subtítulos se re-ubican (antes quedaban corridos por el desfase de la conversión). "Automático (Nativo)" volvía a abrir el video con una dirección inválida; ahora vuelve al directo en el mismo punto.
- **Banner:** la "N" de los destacados es la inicial de la marca del distribuidor (`wp_brand_initial()`; con Omitir o sin nombre, la "M" de MPX Player) en su color de acento. Si una imagen del banner no carga, queda la anterior; al entrar a Inicio, Películas o Series se muestra el último banner visto mientras llegan los nuevos (nunca negro).
- **Foco con el color del distribuidor:** con paleta, el borde/realce de foco (tarjetas, plataformas, géneros, botones, campos) usa el acento, aclarado si hace falta para que se vea sobre el fondo oscuro (`wp_focus_color()`). Sin paleta, como siempre.
- **`features.platforms` = false:** `wp_platforms()` queda vacío: no hay tiles, filas "Lo mejor de…", chips ni páginas de plataforma; quedan géneros, categorías y "nuevas".
- **Mi cuenta:** "Canales en vivo", "Películas" y "Series" con la cantidad del servidor (`api.php?action=counts`, se carga aparte con "…").
- **Fluidez:** la rejilla de Explorar descarta la respuesta de un filtro anterior (antes, al cambiar rápido de género, podía mostrar resultados viejos y quedarse sin cargar más) y calcula el scroll una vez por cuadro; `wp_available_platforms()` se calcula una vez por página.
- Archivos: `media.php`, `video_player.php`, `tracks.php`, `api.php`, `browse.php`, `myaccount.php`, `header.php` (`app.js?v=7`), `play.php` y `tvguide.php` (`player.js?v=31`), `includes/media_admin.php`, `includes/tenant.php`, `includes/tenant_brand.php`, `includes/ui.php`, `includes/core.php`, `includes/lang/{en,pt,fr}.php`, `assets/nf/player.js`, `assets/nf/app.js`.

## Idiomas de la app: español, inglés, portugués y francés (14 de octubre)
- **Automático:** sin elección, la web usa el idioma principal del navegador (Accept-Language). Si no es español, inglés, portugués o francés, queda en español.
- **Elegir idioma:** menú del perfil y **Mi cuenta** → *Idioma de la app* (Automático / Español / English / Português / Français); también arriba a la derecha en el login y el número de distribuidor. Se guarda en la cookie `wp_lang` (5 años) y la página se recarga en el idioma elegido.
- **Qué se traduce:** todas las páginas (login, distribuidor, inicio, explorar, fichas, reproductor, TV en vivo, deportes, actor, Mi cuenta, Ajustes), los textos del reproductor y de los menús de audio/subtítulos, los avisos y los mensajes que la web genera (errores de inicio de sesión, distribuidor, DEMO). Fechas y horas en el idioma elegido.
- **Qué no se traduce:** títulos y nombres del servidor IPTV y de TMDB, categorías, textos del panel (alertas, pantalla falsa), marcas y la etiqueta "DEMO". Las palabras que reconocen plataformas y géneros en las categorías del servidor siguen en español; solo cambia el nombre que se muestra. `diag.php` y `estado.php` (diagnóstico técnico) siguen en español.
- **Panel:** cada llamada al panel lleva el idioma (`?lang=`, `Accept-Language` y `lang` dentro del JSON y de los datos cifrados), así el panel responde sus mensajes traducidos; los códigos de error se manejan igual. La agenda de deportes se guarda en caché por idioma.
- **TMDB:** la búsqueda de títulos sigue en es-MX (para encontrar el mismo contenido); la ficha (descripción, tráiler), la biografía del actor y el fondo del login llegan en el idioma elegido (es-MX, en-US, pt-BR, fr-FR), con caché por idioma.
- **Sinopsis en el idioma de la app:** en inglés, portugués o francés la ficha de película o serie y el destacado del inicio muestran la sinopsis de TMDB en ese idioma (la búsqueda sigue en es-MX); si TMDB no la tiene en ese idioma, no hay clave o no encuentra el título, se muestra la del servidor. En español no cambia nada (la del servidor y, si no trae, la de TMDB). Los episodios siguen con la del servidor. Archivos: `includes/core.php` (`wp_tmdb_plot`, caché `tmdbd4` por idioma), `Movie_description.php`, `seriesvideo.php`, `api.php`.
- **Para traducir un texto nuevo:** en PHP `t('Texto en español')`, en los JS de `assets/nf` `tr('Texto en español')`, y se agrega la traducción en `includes/lang/en.php`, `pt.php` y `fr.php` (la clave es el texto en español). Ver `includes/i18n.php`.
- Archivos: `includes/i18n.php` y `includes/lang/` (nuevos), `includes/core.php`, `includes/panel.php`, `includes/tenant.php`, `includes/tenant_login.php`, `includes/tenant_guard.php`, `includes/line_guard.php`, `includes/ui.php`, `includes/ondemand.php`, `includes/actor.php`, `includes/media_core.php`, `header.php`, `login.php`, `homex.php`, `browse.php`, `Movie_description.php`, `seriesvideo.php`, `video_player.php`, `play.php`, `tvguide.php`, `sportsschedule.php`, `actor.php`, `myaccount.php`, `settings.php`, `api.php`, `playlist.php`, `save_favorite.php` y `assets/nf/app.js?v=6`, `alert.js?v=3`, `player.js?v=30`, `mp4mse.js?v=2`, `app.css?v=10`.

## Conversión con ffmpeg: audio sincronizado y sin carga infinita (13 de octubre)
- **Audio desfasado — causa:** al cambiar de idioma o adelantar, la conversión copia el video, que solo puede empezar en un fotograma clave (k, hasta 10 s antes del punto pedido t), pero el audio se recortaba exacto en t (`-ss t`). El audio quedaba (t − k) segundos corrido respecto al video: un hueco al inicio que el navegador no respeta igual en todos lados. Además, los huecos o solapes de tiempo del audio original (archivos IPTV mal cortados) hacían que el audio se fuera atrasando o adelantando a lo largo de la película.
- **Ahora:** con el video copiado la conversión arranca en el fotograma clave con video y audio juntos (`-ss k+0,5 -noaccurate_seek`; k es el mismo segundo que lee el reproductor con `do=kf`, así el tiempo y los subtítulos cuadran) y el audio pasa por `aresample=async=1` (rellena huecos con silencio y recorta solapes). Con el video convertido (modos compatible y seguro) el corte sigue exacto en t para los dos. Igual en el MP4 en flujo (`do=tc`) y en el HLS del iPhone (`do=hls`).
- **Carga infinita — causas:** (1) el arreglo del 12 de octubre cambió `assets/nf/player.js` sin subir su versión (`?v=28`) y el `.htaccess` guarda los `.js` 7 días en el navegador: muchos seguían con el reproductor viejo, sin vigilante. (2) El temporizador de arranque se apagaba con `loadedmetadata` (bastan los primeros cuadros) y el vigilante no actuaba mientras el video no hubiera avanzado nunca: si después no llegaba más, "Cargando" quedaba para siempre. (3) `media.php` mandaba la cabecera del MP4 apenas arrancaba ffmpeg, así la respuesta ya era un 200 y se esperaba 45 s más sin video; cada intento fallido encadenaba otros modos (hasta minutos). (4) HLS: una conversión colgada seguía "viva" mientras el iPhone pidiera la lista (el vigilante solo miraba los pedidos), un pid muerto podía parecer vivo si otro programa lo reusaba y una lista terminada sin segmentos se reusaba. (5) Subtítulos: si el hosting mataba el trabajo, el archivo `.job` decía "espera" durante 25 minutos.
- **Ahora:** la cabecera se guarda hasta el primer fragmento de video y audio; si ffmpeg no lo entrega en **25 s** (o muere) se detiene y `media.php` responde error 502. El reproductor deja de esperar y vuelve al **video original con su audio** desde el mismo punto (aviso "La conversión no respondió"); un error rápido (formato que ffmpeg no puede copiar) sigue probando los modos compatible y seguro. Respaldo en el navegador: sin ningún dato en 40 s también vuelve al original. Si la preparación (ffprobe) tarda más de 20 s ya no se abre ffmpeg, para no ocupar otra conexión de la cuenta IPTV.
- **HLS (iPhone):** el vigilante del hosting detiene ffmpeg si no hay primer segmento en 25 s o si la lista deja de avanzar 60 s sin terminar; una conversión terminada sin segmentos o con un pid muerto (o reusado por otro programa) se vuelve a lanzar; la lista y los segmentos se escriben completos (`temp_file`).
- **Subtítulos:** el trabajo en segundo plano guarda el pid de ffmpeg; si el hosting lo mató, se vuelve a lanzar en vez de responder "espera" 25 minutos. ffmpeg también se reconecta ahí.
- Probado con ffmpeg 6.1 y un archivo de prueba con destello y pitido cada segundo (GOP de 10 s, audio AC3): antes, al empezar en el segundo 25 el audio arrancaba 5 s después del video; ahora destellos y pitidos coinciden. Servidor IPTV que no responde: error a los ~15 s y el reproductor vuelve al original (antes ~50 s y luego más intentos con otros modos).
- Archivos: `media.php`, `includes/media_admin.php` (`wp_media_pid_alive`), `assets/nf/player.js` (`tcWatch`, `tcGiveUp`) y `video_player.php`, `play.php`, `tvguide.php` (`player.js?v=29`, para que el navegador cargue el reproductor nuevo).

## Conversión que no se queda "Convirtiendo" para siempre (12 de octubre)
- **Antes:** si la conversión con ffmpeg ya había entregado algo de video y después el servidor IPTV o el hosting se trababa, el `<video>` no emitía ni `error` ni `ended`: el aviso "Convirtiendo" se quedaba infinito y nunca entregaba el video con los audios seleccionables. El único rescate solo actuaba cuando no cargaban ni los primeros datos.
- **Ahora:** un vigilante (`tcWatch`) revisa cada 5 s que la conversión siga avanzando (el tiempo o lo que se va almacenando). Si ya arrancó y deja de avanzar 25 s, la da por colgada y la rescata de forma acotada: reintenta desde el mismo punto (hasta 3 veces), luego el modo seguro (480p) y, si aún así no, pasa al video http directo / VLC o al aviso de error. Nunca gira sin fin. Una conversión lenta pero que sigue entregando no se corta. Elegir otro idioma pasa por el mismo vigilante.
- Archivos: `assets/nf/player.js` (`tcWatch`, `recoverTc`).

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
