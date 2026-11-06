# MPX Player para Fire TV con Vega OS

**Marca:** la app se llama **MPX Player** (`title` en `manifest.toml` y `APP_NAME` en `src/lib/tenant.ts`; el id sigue siendo `com.latmpx.player.tv`). Logo, icono (`app_icon.png`) e imágenes de las plataformas (Netflix, Disney+, HBO Max, Prime Video, Marvel, Apple TV+, Paramount+, DC, Navidad, Halloween) están en `assets/image/`.

App de la webplayer para los Fire TV nuevos con **Vega OS** (Fire TV Stick 4K Select y
siguientes). Está hecha en React Native para Vega y usa el mismo panel y el mismo diseño
Netflix que la web, Android, Android TV, Windows y Roku.

**Descarga:** pestaña **Releases › vega-latest** de este repositorio (archivos `.vpkg`).
GitHub Actions la compila sola en cada cambio de la rama `vega-os`.

## Qué trae

- **Inicio de sesión** solo con usuario y contraseña: se prueba a la vez en todos los DNS
  del panel y entra en el que coincida. Si el panel tiene una cuenta asignada a este equipo
  aparece un botón para entrar con ella. Fondo con carteles de estreno (TMDB del panel).
- **Manda el panel (lo que se aprendió en Roku):** al abrir se pide primero `check_mac` (la línea que el panel le
  da hoy a esta MAC, demo vigente incluida con su marca DEMO); `auth.php` solo sin llave o si `check_mac` no da
  línea. Cada servidor tiene hasta **30 s** para contestar. Si la línea del panel (o de la Autodemo) no contesta, la
  misma cuenta se prueba en los DNS del panel y, si ningún servidor la **rechazó** (solo no contestaron), se entra
  con ella igual. Solo un rechazo del servidor deja en el inicio de sesión.
- **Cualquier formato:** si el equipo no abre el archivo (contenedor o códec que no reconoce), el **motor del
  panel** lo convierte (video sin cambios, audio en AAC) desde donde iba antes de dar el error (solo si la línea
  tiene permiso del motor; sin permiso, el error normal).
- **El progreso se guarda siempre** con su duración: con el motor del panel (que no la sabe) se usa la del servidor.
- **Botón DNS** (como Android e iOS): Automático, Cloudflare, Google, Quad9, AdGuard, NextDNS u OpenDNS.
  Si el DNS de la red no encuentra el servidor IPTV (bloqueo del proveedor de internet), la app lo resuelve
  con DNS sobre HTTPS y se conecta a esa IP: catálogo, inicio de sesión y reproductor (una vez por video).
  Solo para servidores http (https necesita el nombre para el certificado). `src/lib/securedns.ts`.
  Si las opciones no caben en la pantalla, la lista se desplaza (con las flechas del control).
- **Botón Autodemo**: solo si el panel tiene una demo en «Configurar Demo» (`login.php` acción
  `features`, `features.demo`, al abrir el inicio de sesión). Sin respuesta o con un panel viejo:
  con distribuidor vale `tenant_config.features.demo`; con *Omitir* se muestra. Sin llave, nunca.
- **Autodemo con código de revendedor**: si en *Contraseña* hay un código de 6 letras y números
  (con al menos una letra, p. ej. `RV7K2M`), *Autodemo* lo envía en mayúsculas (`reseller` dentro de
  `auto_demo`) y la demo queda a nombre de ese revendedor en el panel. Solo números o cualquier otra
  cosa no se envía. Código que no existe: se muestra el aviso del panel y la demo sigue disponible.
- **Autodemo, entrada**: se entra con la línea de `auto_demo` (usuario, contraseña y `url`, el servidor de la demo) más las líneas del equipo y los DNS del panel. `503` = el panel no pudo confirmar la demo con el servidor IPTV (no se registra nada).
- **http / https**: el panel (https) manda los servidores IPTV con `https://` y muchos solo responden en http. `loginAll` prueba cada servidor con los dos protocolos a la vez y la sesión se queda con el que respondió.
- **Modo DEMO**: la sesión es DEMO si salió del botón *Autodemo* o si el panel responde `"demo": true`
  (en `check_mac`, en el `auth` de `progress.php` o en su GET `?v=2`); un inicio de sesión normal lo
  quita. En la DEMO nunca se muestran el usuario ni la contraseña de la línea (*Cuenta* dice
  «Usuario: DEMO» con la marca «Cuenta DEMO»; el código del equipo sí se ve), no hay Continuar viendo
  ni Mi lista y no se envía nada a `progress.php` (`save`, `delete`, `fav_add`, `fav_remove`): al
  pulsar *Mi lista* o *Agregar a favoritos* sale el aviso «No disponible en la DEMO».
- **Vencimiento de la DEMO**: *Cuenta* solo muestra «Vence:» con el fin que dice el panel
  (`demo_expires` de `check_mac` / `auto_demo`, fecha y hora exactas) y «Cuenta DEMO · 2 horas»
  (`demo_duration`); nunca el servidor, la fecha ni las conexiones de la línea demo del servidor IPTV.
  No hay textos de «24 horas»: la duración siempre sale del panel.
- **Fondo del inicio de sesión**: carátulas de TMDB pedidas por `api/tmdb.php` del panel (clave del
  distribuidor o del dueño); sin clave no hay carrusel (fondo liso, nada guardado ni otra clave).
- **Borrado de caché desde el panel** (`cache_clear.php`): `check_mac` lleva `cc` (última orden
  aplicada, `cache_clear_seen` por distribuidor) y responde `cache_clear` (orden más nueva). Sin nada
  guardado se guarda en silencio; si llega una mayor se guarda, sale 3 s «Tu proveedor actualizó la
  aplicación…», se borra la caché (catálogo, EPG, TMDB, deportes, motor, lista de servidores, clave
  TMDB) y la app arranca otra vez (Vega: se vuelve a montar la raíz; web: `location.reload()`) y entra
  sola. Se quedan sesión, distribuidor, ajustes y PIN. `src/lib/cacheclear.ts`.
- **Audio y subtítulos del panel**: `media_vega.php?do=status&token=` — si el dueño desactivó ffmpeg
  para el distribuidor de la línea, el panel responde `ffmpeg:false` y se queda el audio original.
  La respuesta se guarda por línea (una pregunta por sesión). Sin permiso (`ffmpeg:false`,
  `features.ffmpeg: false` de `tenant_config` o un 503 del motor), al elegir una pista que necesita el motor
  sale una vez por video el texto del panel («Sin permisos» / «No compatible con el dispositivo») y el
  video sigue directo: sin recargar, sin «preparando», sin reintentos ni pasos automáticos por el motor.
- **Botones iguales a Roku, Windows y la web**: un solo componente en toda la app (inicio de sesión,
  distribuidor, avisos, diálogos, Cuenta y menú del reproductor). Principal = color del distribuidor
  (rojo sin distribuidor) con texto de contraste; secundario = blanco translúcido con borde fino; con
  el foco del control, borde de 3 px y crece un poco con una animación corta. El foco (bordes y
  realce) es blanco sin distribuidor y su color de acento con distribuidor (aclarado si casi no se ve
  sobre su fondo).
- **Inicio, Películas y Series como Roku y Netflix**: la portada grande queda fija arriba y solo se
  mueven las filas (arriba/abajo/lados); al enfocar una carátula la portada muestra ese título (fondo,
  nombre, año y sinopsis). Orden de Inicio igual que Roku: plataformas, Continuar viendo, Mi lista,
  «Top 10 de hoy» (películas y series juntas), Películas agregadas recientemente, Series nuevas,
  «Lo mejor de…» de las plataformas, Series para ti, géneros (Acción, Suspenso, Aventura, Anime,
  Drama…) y Películas para ti. En Películas el Top 10 es solo de películas y en Series solo de series.
  Cada fila (también Continuar viendo y Mi lista) termina con «Ver todo». Plataformas en mosaicos 16:9
  como Roku (imagen entera, fondo oscuro y borde fino). La interfaz se escala al tamaño que mide la
  vista raíz de la app (base 1920×1080; no se dibuja nada hasta medirla): al volver a abrir la app el
  equipo podía informar mal `Dimensions` y todo se veía enorme. En la portada, en lugar de la «N»
  de Netflix va la inicial de la marca (distribuidor; con *Omitir*, «M» de MPX Player) en su color de
  acento. Con `features.platforms: false` (`tenant_config`) no hay fila ni filas de plataformas. Al
  cambiar de sección o abrir una plataforma/género la última portada queda de fondo (nunca negro).
- **Perfil** (ícono de la derecha del menú), como Roku: a la izquierda la línea (inicial, usuario, cuenta activa /
  vence pronto / DEMO, vencimiento, conexiones, desde, servidor, canales, películas, series, distribuidor y el
  código del equipo) y a la derecha los ajustes (idioma de la app, audio, subtítulos, control parental, adultos,
  registrar el equipo, recargar, distribuidor, cerrar sesión).
- **Menú superior** como Roku: Inicio, Series, Películas, TV en vivo, Deportes y Mi lista; a la derecha la lupa del
  buscador, el ícono del perfil (color del distribuidor) y la hora. *Atrás* dentro de una sección sube al menú (a la
  sección actual); *Atrás* en el menú pregunta si quieres salir («¿Salir de …?», «Puedes volver cuando quieras.»,
  Salir / Cancelar). En el reproductor *Atrás* cierra el menú de audio o pregunta si salir del video.
  Todo el Atrás pasa por `BackHandler` de React Native: `useKeplerBackHandler` crea un segundo receptor que, sin
  manejadores propios, cerraba la app con cada Atrás aunque la pantalla ya lo hubiera atendido (no usarlo).
- **Portada que sigue al foco** (como Roku): en Inicio, Series y Películas la portada muestra el título enfocado; si el
  servidor no trae fondo se busca tras una pausa breve (`get_vod_info` / `get_series_info` y, si no hay, TMDB por el
  panel; `src/data/heroart.ts`), se guarda en el equipo 7 días y la próxima vez sale al instante. El destacado de
  cada sección también busca su fondo; un título sin fondo usa su propia carátula agrandada y oscurecida (nunca el
  fondo de otro título). Continuar viendo y Mi lista salen solo en Inicio.
- **Degradados de la portada como Roku**: a la izquierda (1500×1080 al 92 %) y abajo (1920×520) con el color de
  fondo del tema (el del distribuidor o el original), para que los textos se lean sobre cualquier imagen; el fondo
  sigue siendo el Full HD del panel. Con ancho y alto fijos: Vega dibujaba el degradado a su tamaño real (4 px).
- **Destacados que van pasando** (como Roku): Inicio toma 4 películas y 4 series nuevas al azar (Películas / Series, 8
  de ese tipo), busca su fondo uno tras otro y se queda con hasta 6 que lo tengan; cambian cada 8 s mientras la portada
  está a la vista, con puntos a la derecha.
- **Ficha como Roku**: la imagen arriba a la derecha (1440×810), color liso a la izquierda con degradado sobre la
  imagen, degradado abajo y color liso debajo; usa el fondo ya encontrado por la portada si el servidor no trae.
- **Carátulas que siempre cargan**: si una dirección no carga en 6 s se pasa a la siguiente (copia del panel →
  `img.php` → original); en Vega una imagen que no existe a veces no avisa el error y la tarjeta quedaba en blanco.
- **Tablas › equipo**: mientras el panel trae la ficha sale «Cargando…» y, sin datos, «No hay información de este
  equipo» (antes no se veía nada).
- **«¿Salir del video?» siempre al frente** con fondo oscuro y el foco en sus botones (antes el aviso de error se
  dibujaba encima y los textos se mezclaban). Una página del servidor sin código de XUI ya no corta: se siguen
  probando las otras formas y su texto va en el reporte.
- **Abrir una película o capítulo es inmediato**: ya no se espera a los idiomas (antes hasta 3 s); llegan a la vez y
  el video suena con su audio predeterminado, directo del servidor IPTV, sin pasar por el panel. En las páginas de
  plataformas el fondo es liso (sin la portada fija de Inicio).
- **Plataformas** con ancho y alto fijos (Vega dibuja las imágenes del paquete a su tamaño real si solo se estiran)
  e **ícono de la app** con el logo centrado en la franja 16:9 que muestra el Fire TV (512×512).
- **Usuario y contraseña con el teclado de la app** (como Roku, `src/components/KeyboardModal.tsx`): los campos son
  botones y al pulsarlos sale un teclado en pantalla (letras, números, símbolos, mayúsculas, espacio, ⌫, Borrar,
  Mostrar/Ocultar y Listo). En algunos Fire TV y en el simulador un TextInput enfocado se quedaba con las flechas: el
  foco no llegaba al ojito, Ingresar, DNS ni Cambiar distribuidor, y al salir del campo sonaba el teclado del sistema.
  El ojito va al lado del campo de la contraseña (no encima).
- **Inicio de sesión** con la caja centrada en la pantalla y el texto de Usuario / Contraseña centrado
  a lo alto del campo.
- **Ficha** con sinopsis, reparto, temporadas, episodios con su avance y "Más títulos como este".
- **Actores**: en la ficha, el reparto (fotos de TMDB) abre la página del actor con su filmografía, solo los títulos que el servidor tiene (título normalizado y año ±1, como la app de Windows y la web). Clave TMDB del panel o la incorporada.
- **Reproductor nativo de Vega** (MP4, MKV, AVI, MOV, MPEG-TS) sin límite de resolución ni de
  bitrate (4K si el equipo y el archivo lo tienen): continuar donde quedó, ◀▶ 10 s, OK pausa,
  ▼ o MENÚ para audio y subtítulos y siguiente episodio solo.
- **Audio como Roku (desde 1.0.23)**: todo título empieza directo del servidor IPTV con su audio predeterminado (nunca
  se convierte solo por un idioma preferido). Con dos o más idiomas, el panel (VPS / VDS) prepara otro idioma solo
  cuando el usuario lo elige en el menú; esa elección se recuerda para ese título y se usa al volver a abrirlo
  («Continuar viendo» sigue en ese idioma). «Audio predeterminado» la borra. Un título nuevo siempre empieza con el
  predeterminado. Ajustes ya no tiene «Idioma de audio preferido». **Desde 1.0.33** el panel ya no convierte solo por
  un audio que «no decodifica» (la consulta era la de MSE y el video directo no va por MSE: títulos nuevos salían
  «preparando con el panel»); solo entra solo cuando el archivo no abre directo o para Continuar viendo, y entonces el
  menú marca «Audio predeterminado» (antes marcaba el idioma, p. ej. «Inglés»). Un Continuar viendo por el panel ya no
  deja el título como «solo por el panel» (abría por el panel también desde el principio); las memorias de las
  versiones de prueba se olvidan (`panel_route_2`, `title_audio_2`).
- **Barra de avance del reproductor (1.0.33)**: relleno rojo y resto son dos partes de una fila repartidas con `flex`
  (sin medir ni porcentajes). Sobre el video de Vega un ancho en porcentaje no se aplicaba y el ancho medido
  (`onLayout`, 1.0.24) no llegaba: la barra se veía vacía aunque el tiempo avanzara. **1.0.34 (la causa real):** el
  reproductor de Vega no da la duración de muchos videos (MKV directo, el panel antes de terminar), así que el avance
  era siempre 0 %. Ahora la barra usa la duración del servidor (`QueueEntry.dur`, o la guardada con el avance), como
  ya hacía Continuar viendo. **1.0.35:** barra y relleno con anchos fijos en píxeles (sin porcentajes, flex ni
  medir) y un **punto rojo grande** donde va el video. **Continuar viendo** ya no recuerda por servidor que va por el
  panel (1.0.30 lo hacía y desde entonces gastaba la VPS con el audio predeterminado): siempre prueba primero directo
  del servidor IPTV; el panel entra solo si ese video no salta al segundo guardado.
- **Canales sin el corte de cada segmento (desde 1.0.25)**: en Vega el audio y el video de cada segmento no terminan
  juntos y lo entregado acababa unas décimas antes del segmento siguiente (`buf=[0.0-9.6,9.7-19.2,…]`): el reproductor
  se frenaba en cada unión y saltar ese hueco era un corte de ~1 s cada ~10 s. Ahora, si el segmento nuevo dejaría un
  hueco de hasta medio segundo, se pega al final de lo entregado (`src/player/livehls.ts`, `place`). El reporte del canal
  cuenta esas uniones (`pegados=`); `huecos=` debería quedar en 0.
- **Lista negra del panel (1.0.47)**: si el distribuidor (o el dueño con Omitir) bloqueó este equipo, `login.php` responde
  403 `device_blocked`: el inicio de sesión muestra «Este equipo está bloqueado. Contacta a tu proveedor.», no usa líneas
  guardadas ni la pantalla falsa, no registra la cuenta escrita ni la demo, y una sesión abierta se cierra en la próxima
  consulta al panel (cada 10 min o al volver a la app). `deviceBlocked()` en `src/api/panel.ts`.
- **Reproductor más rápido y fluido (1.0.48)**: películas y series muestran en el centro ◀◀ 10, pausa / reproducir y
  10 ▶▶ (como Android; ◀ ▶ y OK del control los usan y el botón se ilumina). En los canales ya no está el botón «Audio»
  de arriba (▲▼ cambian de canal y MENÚ abre idiomas y subtítulos). El círculo de carga gira (`Loader` en
  `src/components/ui.tsx`, también en el inicio de sesión y las pantallas que cargan). Las filas de Inicio, Películas y
  Series cambian sin animación al subir o bajar. El canal empieza con el primer segmento cuando la lista ya tiene otros
  dos listos (`livehls.ts`); Shaka arranca con 1 s bajado; los idiomas del archivo se leen a los 1,5 s o apenas suena.
  Si el distribuidor apaga el motor del panel para Vega (su Guía EPG), `features.ffmpeg` llega en false y la app usa
  solo los audios que el equipo lee.
- **MKV leído por la app, audio cambiado en el equipo (1.0.49)**: el modo directo de Vega abre el MKV pero no informa sus
  pistas, así que todo cambio de idioma iba al servidor. Ahora la app lee el MKV como ExoPlayer en Android
  (`src/player/mkvmse.ts` + `mkvparse.ts`: cabecera, índice Cues y Cluster con pedidos Range al servidor IPTV) y entrega
  video H.264 / H.265 y el audio elegido (AAC, AC-3, E-AC-3, MP3) como MP4 fragmentado al reproductor nativo por MSE:
  ▼ abre los idiomas y el cambio es local, desde el mismo segundo. Solo si el equipo no decodifica ese audio (DTS,
  TrueHD, o E-AC-3 en algunos Fire TV) se usa el servidor; apagado, la app dice «Audio no compatible con este equipo: es
  necesario encender el servidor.» y lo reporta al panel (Reportes, «Audio no compatible sin servidor»). Si el lector
  propio no puede con el archivo, sigue el modo directo de siempre. Ya no hay botón «Audio» arriba (▲ solo muestra la
  barra). Canales: con segmentos largos (≥ 8 s) el convertidor a MP4 espera 2 segmentos (antes 3) antes de entregar el
  MPEG-TS, y el vigilante da 15 s más si el canal sigue bajando video.
- **Controles de reproductor normales (1.0.50)**: en el centro, dibujados con formas (sin números ni símbolos de texto):
  ◀◀ atrasar, pausa / reproducir y ▶▶ adelantar; en series además |◀ capítulo anterior y ▶| siguiente. ◀ ▶ y OK los usan
  directo (el botón se ilumina); con ▲ se eligen con el control (◀ ▶ para moverse, OK para usar, ▼ o Atrás vuelven).
- **Subtítulos en el equipo y arranque más rápido (1.0.51)**: los subtítulos de texto del MKV (SRT, ASS / SSA, WebVTT)
  los lee la app junto con el video (`MkvMse.subCues`, sin servidor; se conservan al cambiar de audio) y se dibujan
  sobre el video. El servidor solo para subtítulos que la app no puede leer (MP4, modo directo); apagado, «Subtítulo no
  compatible con este equipo: es necesario encender el servidor.» y reporte al panel. Más rápido al abrir: el primer
  pedido del video (lista del canal, cabecera del MKV / MP4) sale mientras el reproductor de Vega se inicia
  (`src/player/prefetch.ts`); el MP4 encuentra su índice en 1-2 pedidos (antes uno por caja); el índice del MKV para
  Continuar viendo en un pedido; el primer tramo del MKV ya leído no se pide dos veces; sin lecturas de cabecera aparte
  que compitan con el video; el canal pide sus dos primeros segmentos a la vez.
- **Top 10 de la semana y videos que siempre intentan abrir (1.0.52)**: el Top 10 ya no es lo mejor calificado del
  catálogo (no cambiaba nunca): es lo más popular de la semana en TMDB que manda el panel (`api/top10.php`,
  `src/data/top10.ts`, cada 12 h) cruzado con el catálogo por título y año (`catalog.weekTop10`), completado con lo
  mejor calificado distinto cada semana (también sin clave de TMDB). Lectores propios (MP4 / MKV): pedidos con plazo
  para contestar (12 s) y para bajar según el tamaño, `Connection: close` tras un pedido sin respuesta, y si el servidor
  ignora el final del Range (manda el resto del archivo) se pasa enseguida al modo directo (`src/player/rangeget.ts`);
  sin el índice en 20 s también (antes 45 s cargando). Si nada abre y el servidor está apagado: «Este video no se puede
  abrir en este equipo: es necesario encender el servidor.»
- **MP4 con el índice al final en servidores lentos y audio de canales sin grumos (1.0.53)**: XUI entrega las películas a
  la velocidad del video y el índice (`moov`) de muchos MP4 está al final y pesa varios MB (3 audios en 2 h: ~5 MB);
  el corte de 20 s de 1.0.52 lo interrumpía. Ahora el índice se pide en partes de 1 MB, de a 3 a la vez (una que el
  servidor rechaza se pide otra vez sola), sin volver a bajar lo ya leído; Player espera mientras el servidor siga
  entregando (hasta ~2 min, `mp4Busy`) y el índice queda guardado para Continuar viendo y el cambio de audio (los 3
  últimos MP4). Plazo de bajada de cada pedido: 15 s + 40 KB/s. Probado con un MP4 de 1 h (índice de 4,7 MB, 3
  audios): 7,4 s a 400 KB/s, 12,8 s con una sola conexión; reabrirlo 0,1 s. Canales: el convertidor a MP4 tolera
  4 cuadros de audio (~85 ms) de desfase antes de corregir con silencio o descartes (antes 1,5: los canales con marcas
  irregulares tenían microcortes).
- **Empieza a verse apenas llega lo mínimo (1.0.54)**: el lector MP4 nunca bajaba el archivo entero (lleva ~40 s de
  ventaja y sigue bajando de a 4 s), pero su primer tramo esperaba al cuadro clave siguiente (hasta 15 s de video,
  varios MB). Ahora el primer tramo es de 1,5 s y los cortes van donde no se parte un grupo de cuadros B (todo lo
  anterior se muestra antes que lo siguiente: sin huecos), sin esperar cuadros clave. En los MP4 con el índice al
  final, el principio del video (2 MB) se pide a la vez que el índice; si la línea rechaza pedidos a la vez, ese
  adelanto se cancela y todo sigue de a uno (`oneConn`).
- **Películas y series: arranque estable e idiomas antes (1.0.64)**: **con 5 s bajados**: los lectores propios (MP4 y MKV)
  empezaban a sonar con 1,5 s y se detenían enseguida si el tramo siguiente tardaba. Ahora esperan 5 s bajados (o el
  archivo entero si dura menos; con un servidor lento, a los 6 s con al menos 1,5 s) y siguen bajando por delante (40 s)
  sin cortar lo que suena (`src/player/startgate.ts`). Al cambiar de idioma alcanzan 2 s, y si el video estaba en pausa
  sigue en pausa. **Un pedido menos al abrir**: mientras el reproductor de Vega se inicia se pide la cabecera (256 KB MKV /
  64 KB MP4: los idiomas) y, apenas llega, el principio del video (hasta 4 MB MKV / 2,25 MB MP4), de a un pedido;
  cualquier lectura que caiga dentro sale de ahí (`prefetchRange` / `takeRange` / `takeRangeFrom` en
  `src/player/prefetch.ts`; el MKV toma lo que haya desde un punto y pide solo lo que falta). Al cerrar el reproductor
  se corta. Con Continuar viendo solo la cabecera, y el índice del MKV (Cues, al final del archivo) se pide mientras se
  abre el reproductor. **Idiomas al menú apenas se lee la cabecera** (`onHeader`), sin esperar a que el reproductor
  esté listo.
- **Canales cifrados y con saltos de marcas sin cortes (1.0.63)**, por dos reportes «Canal en vivo se detiene seguido»:
  **descifrado nativo**: LAS ESTRELLAS (AES-128, segmentos de 13 s) tardaba `descifrado=8991ms` por segmento con el AES en
  JavaScript (@noble) y el canal se quedaba sin datos. Ahora se descifra con el módulo nativo de Vega (`WebCrypto` de
  react-native-w3cmedia, el que usa Shaka; `src/lib/aesnative.ts`): milisegundos. Si el nativo falta o lo que devuelve no es
  MPEG-TS y el de JavaScript sí, se usa el de JavaScript el resto de la sesión. El reporte dice `cifrado=aes128(nativo)` o
  `(js)`. **Audio sin huecos**: HBO MUNDI salta sus marcas en cada segmento (`cosidos=5`) y su audio salta distinto que el
  video; desde 2 s el convertidor dejaba un hueco en el audio y lo entregado quedaba partido (`buf=[0.2-3.6,4.8-12.1,…]`):
  el canal se detenía en cada hueco. Ahora (AAC) se rellena con silencio hasta 30 s y se descartan hasta 10 s siguiendo las
  marcas (audio y video igual de sincronizados); un salto mayor se cose (`TsMux.aShift`). Con MP2 / AC-3 (sin cuadro de
  silencio) sigue como antes. Probado con canales generados con ffmpeg (saltos de +3 s, +12 s y -4 s): sin huecos; un
  canal normal sale idéntico.
- **Pantalla grande al instante y filas fluidas (1.0.62)**: **de la miniatura a la pantalla grande** el canal ya no empieza
  de cero: la miniatura deja su lista (con el token del balanceador), sus últimos 6 segmentos ya descifrados (tope 24 MB)
  y sus llaves, y suelta la conexión en el momento (`LiveHls.handOff` / `adopt`, `Playback.handOffLive`, 15 s para
  tomarlos). La pantalla grande arranca con ellos sin pedir la lista (la que muchos XUI contestaban vacía justo al
  cerrarse la miniatura: 1-3 s de reintentos) ni volver a bajar nada; sigue bajando lo nuevo como siempre. El reporte del
  canal dice `miniatura=` (segmentos que llegaron de ella). **Bajar por Inicio, Series y Películas** ya no traba: la lista
  armaba la fila nueva justo al apretar ▼ (al subir no, porque ya estaban). Ahora todas las filas están (las lejanas solo
  con su título y su alto) y sus carátulas se montan antes de llegar, de a una en los momentos quietos: 5 abajo y 3
  arriba, máximo 12 (`src/lib/rowwindow.ts`). **Carátulas**: la copia del panel que no responde se deja a los 3 s (antes
  6) y la app recuerda, mientras está abierta, qué dirección cargó cada imagen y cuál dio error
  (`src/lib/imagememory.ts`): al volver a una fila la carátula sale de una vez de la caché del equipo.
- **Más rápido y fluido (1.0.61)**: en Vega el HLS de los canales solo entra por MSE (Roku y LG le dan el `.m3u8` a su
  reproductor; aquí la app baja, convierte y entrega cada segmento), así que se aligeró ese camino. **Canales:** el
  primer segmento se pide apenas llega la lista, mientras el reproductor de Vega se inicia (`src/player/prefetch.ts`,
  `liveStartSeg`; también la miniatura), y se baja solo con toda la conexión: antes se pedían a la vez los dos siguientes
  y los tres se repartían la red (la primera imagen tardaba hasta tres veces más); esos dos empiezan apenas llega el
  primero. Si el reproductor se cierra antes de usarlo, se corta (`dropPrefetch`). La conversión a MP4 busca los cortes
  del video con `indexOf` (nativo) en vez de byte por byte y la primera pasada del segmento se detiene al encontrar la
  tabla de programas: el primer segmento se convierte unas 3 veces más rápido (medido sin JIT: 67 → 21 ms por 6 s a
  6 Mb/s). **Navegación:** las filas montan una pantalla de carátulas a cada lado (antes dos) y la cuadrícula de «Ver
  todo» también; las direcciones de cada carátula se calculan una vez; el fondo encontrado para la portada se guarda en
  el equipo una vez por tanda (antes los 400 títulos a cada uno, y se trababa al recorrer las filas); Inicio, Series y
  Películas no se vuelven a dibujar detrás del reproductor cada vez que se guarda el avance (se ponen al día al volver).
  Pruebas: `npm run test:interface` (cortes del video iguales a los de antes, primer segmento solo, pedido adelantado
  usado una vez o cortado).
- **Imagen trabada: salto al cuadro clave siguiente (1.0.60)**: HBO OPC.2 se congelaba igual en MP4 propio y en
  MPEG-TS (`problema=imagen congelada con 33 s por delante`): empujar 0,5-2 s hacía que Vega decodificara otra vez
  desde el mismo cuadro clave y se trabara en el mismo cuadro. Ahora el lector salta al cuadro clave siguiente (MP4
  propio: `TsMux.keys`, todos los entregados; MPEG-TS: el comienzo de cada segmento) y deja atrás el tramo que lo
  trababa. Si aun así se congela 3 veces en 30 s, el canal se vuelve a abrir alternando MP4 propio y MPEG-TS hasta 6
  veces, sin ir a la pantalla de error (antes, a la tercera, probaba https y terminaba en error). La superficie de video
  solo se suelta si es la que está en uso.
- **Canales que se congelaban en pantalla grande con el audio sonando (1.0.59)**: HBO FAMILY OPC.2, WARNER TV… se veían
  bien en la miniatura y en pantalla grande la imagen quedaba quieta (`buf=[0.0-40.0] t=8.6 huecos=2`). La pantalla
  grande era la única con la capa de subtítulos de Vega y esos canales traen subtítulos ocultos (CC) dentro del video.
  Ahora, en vivo: sin capa de subtítulos, sin tocar las pistas de texto del equipo y el lector quita del video los SEI
  de CC (tipo 4). Si aun así la imagen se congela 3 veces en 30 s con video por delante, el canal se vuelve a abrir
  con un reproductor nuevo y, si vuelve a pasar, en MPEG-TS (solo ese canal; `problema=imagen congelada…`).
- **Foco al salir del canal (1.0.59)**: vuelve al canal que estaba sonando (aunque se haya cambiado con ▲▼ en pantalla
  grande), que pasa a la miniatura con el punto rojo; la lista va hasta él si quedó lejos.
- **TV en vivo con OK (1.0.58)**: pasar por los canales y las carpetas ya no cambia nada (antes cada paso abría la
  miniatura y pedía la guía: lag). OK en una carpeta muestra sus canales; OK en un canal lo pone en la miniatura con su
  guía y un punto rojo en su fila (sigue viéndose al cambiar de carpeta); OK otra vez en el canal del punto rojo lo abre
  en pantalla grande. Al cerrar el canal el foco vuelve a esa fila (antes caía en el menú de arriba). La miniatura
  conecta enseguida (antes esperaba 2,5 s quieto).
- **Canal que quedaba en pausa al pasar a pantalla grande (1.0.58)**: Vega a veces pausa el reproductor solo; el lector
  del canal solo vigilaba el video andando y quedaba en pausa para siempre. Ahora, si no fue el lector, sigue a los
  1,5 s (con video por delante; sin él espera margen). Si el video se queda quieto otra vez justo después de empujarlo,
  se adelanta 2 s en lugar de 0,5. El reporte dice `reanudados=`.
- **Canales con audio MP2 / MP3 / AC-3 (1.0.57)**: el lector de canales (`tsmux.ts`) solo convertía AAC; con otro
  audio (CINEMAX trae MP2, tipo 0x03) entregaba el MPEG-TS y Vega no mostraba imagen (`modo=ts`, `buf=[]`) ni en la
  miniatura ni en pantalla grande. Ahora convierte también MPEG audio (`mp4a.6B` / `mp4a.69`) y AC-3 (`ac-3`). Si el
  equipo no acepta el MP3 / MP2, el mismo canal va solo con el video; si lo acepta pero no hay imagen (en 15 s en la
  miniatura, al fallar en pantalla grande), se vuelve a abrir solo con el video (`liveRetryTs`). Un AC-3 que el equipo
  no acepta sigue en MPEG-TS como antes; E-AC-3 / LATM van solo con el video. Nunca se apaga el MP4 de toda la sesión
  por el audio de un canal. El reporte muestra los códecs entregados (`modo=mp4 "avc1…,mp4a.6B"`) y si va sin audio.
- **MKV con audio que no entra por MSE (1.0.57)**: E-AC-3, DTS, TrueHD… (sin elección del usuario) se abren primero con
  el lector nativo de Vega (la guía de Amazon da los archivos por URL y decodifica eAC-3 en MKV); si falla, vuelve el
  lector de la app con el video y el audio por el panel / aviso, como antes.
- **Canal que se ve en la miniatura y fallaba en pantalla grande (1.0.56)**: al abrir el canal en pantalla completa la
  lista se pide justo cuando se cierra la miniatura y muchos XUI contestan esa vez 200 con una página vacía
  (`text/html`) en lugar de la lista. `LiveHls.start` vuelve a pedirla hasta 3 veces (1 s, 2 s y 3 s) antes de dar el
  canal por perdido; un motivo claro de XUI (canal inexistente, vencida…) no se reintenta. El reporte dice qué llegó
  (tipo, tamaño y comienzo) y cuántos `reintentos` hubo.
- **Reproductor más limpio (1.0.55)**: sin los botones ◀◀ / pausa / ▶▶ en pantalla (◀ ▶ y OK del control lo hacen
  directo, sin redibujar nada); en series quedan solo capítulo anterior |◀ y siguiente ▶| (▲ los elige).
- **Motor Shaka, teclado y fluidez (1.0.46)**: películas y series en HLS / DASH con Shaka Player 4.16.13 con los parches
  de Amazon para Vega (`src/player/shaka.ts`, `vendor/`); MP4 por el lector MSE propio con cambio de audio local; MKV con
  las pistas del equipo y el panel solo como respaldo. Botón «Audio · idioma» en el reproductor. Teclado con teclas
  compactas (sin letras recortadas), ñ y borrado de un carácter completo. Menos redibujos en Inicio, canales y vista
  previa; la vista previa se cierra antes de abrir la pantalla completa. Los canales en vivo siguen con el lector propio
  sin huecos. Detalle en `INTEGRACION_REPRODUCTOR.md`; pruebas: `npm run test:player` y `npm run test:interface`.
- **Canales de corrido: MP4 propio (desde 1.0.26)**: aun pegando los segmentos, el lector MPEG-TS de Vega dejaba
  micro-huecos en algunas uniones (`buf=[42.0-59.0,59.0-89.6]`) y saltarlos era un corte. Ahora cada segmento H.264 +
  AAC se convierte en la app a MP4 fragmentado (`src/lib/tsdemux.ts`, `tsmux.ts`, `mp4box.ts`): cada cuadro de video
  dura hasta el siguiente (aunque esté en el segmento que viene) y el audio va cuadro tras cuadro; si al canal le falta
  audio se rellena con silencio y si le sobra se descarta, sin desincronizar; un salto de marcas (servidor reiniciado,
  segmento saltado, vuelta de las marcas de 33 bits) se cose. Lo entregado queda en un solo tramo, sin huecos que saltar.
  Con H.265, AC-3 u otro códec, o si el equipo no acepta el MP4, se entrega el MPEG-TS como antes; si el reproductor
  rechaza el MP4, el canal se vuelve a abrir solo en MPEG-TS el resto de la sesión (y se avisa al panel). Canales con
  varios idiomas: el menú de audio los lista y al elegir uno el canal se vuelve a abrir con ese audio. El reporte dice
  `modo=mp4|ts`, `silencio=`, `descartados=` y `cosidos=`.
- **Plataformas** (Netflix, Disney+, Prime Video, HBO Max, Marvel, Navidad, Halloween…) muestran solo lo que tiene el
  servidor IPTV: los títulos de sus categorías cuyo nombre coincide, cada uno una vez. El póster de TMDB que pone el
  panel cuando el servidor no tiene carátula es solo del mismo título (nombre y año ±1); las direcciones del panel
  llevan `?v=2` para no mostrar las imágenes equivocadas guardadas antes.
- **Carátulas del panel directo y una por título**: la app calcula el nombre exacto de la copia pública del panel
  (`canonKey` en `src/lib/images.ts`, igual que `img_key` / `img_idkey` de `api/img.php`) y la pide sin pasar por PHP;
  antes usaba otro nombre y dependía de enlaces del hosting (si no los permite, cada carátula pasaba por `img.php`:
  lento). Si el servidor manda el id de TMDB (`tmdb` / `tmdb_id`, `Item.tm`), una carátula por título para todos los
  servidores IPTV (`&t=`).
- **Tema de prueba (estilo IBO Player, 1.0.28)**: si el panel lo ofrece (Pantalla Falsa › «Tema de prueba», solo con
  **Omitir**: `features.review`, `panelFeatures` en `src/api/panel.ts`), el inicio de sesión queda sencillo (usuario,
  contraseña, Ingresar y Autodemo; sin DNS ni código del equipo). **Autodemo** o una cuenta del tema
  (`panelReview`, `login.php review_login`) abren `src/screens/Review.tsx`: Películas a la izquierda, Series al lado y
  Ajustes (solo «Cerrar sesión»), con los videos de la carpeta player del panel en un reproductor sencillo (sin sesión,
  progreso ni caché). No registra nada en el panel ni vence. Un usuario y contraseña que no son del tema entran como
  siempre (línea IPTV).
- **Continuar viendo por pasos** (como Roku): 1) directo en el segundo guardado; 2) si no suena (error o 15 s), 4 s
  después el motor del panel lo prepara desde ese segundo (`panelOpen` en `src/player/playback.ts`); 3) si tampoco,
  otra vez directo 10 s después; si nada funciona, el aviso «No se pudo continuar donde quedó». **Nunca empieza solo
  desde el principio** (para eso está «Desde el principio»). Mientras no suena no se guarda avance.
  **El salto, cuando ya suena (1.0.27):** el reproductor de Vega se queda cargando si se le pide el segundo guardado
  antes de que el video empiece (en `loadedmetadata`): el paso 1 abría directo, no sonaba y el panel quedaba en
  «Preparando desde donde quedó…» sin fin. Ahora se abre el video y apenas suena se salta una sola vez al segundo
  guardado (`seekAfter` / `seekTo`, `onPlaying` y `onTime` en `src/player/playback.ts`); lo que suena antes del salto
  no cuenta como «ya sonó» ni se guarda. Si en 15 s no llegó a ese segundo, se pausa y siguen los pasos
  (`resumeFailed`: el panel desde ese segundo). El panel tiene ahora 60 s para empezar a sonar; si no, se deja
  (`panelStop`) y sigue el último paso (otra vez directo y, si no, el aviso), nunca queda pegado.
  **1.0.29 (cargando sin fin):** al saltar, el reproductor avisa `timeupdate` al instante con el segundo pedido aunque
  se quede cargando; la 1.0.27 lo tomaba como «ya suena», apagaba el vigilante y quedaba cargando para siempre. Ahora
  solo cuenta cuando el video **avanza** pasado ese segundo (`onTime` → `arrived`); si en 15 s no avanza, siguen los
  pasos. Lo que suena antes del salto va sin sonido. Un archivo que se abre directo por el panel (porque así se vio
  antes) tiene 60 s para empezar (`startDog` en `Player.tsx`); si no, se deja, se olvida esa ruta y siguen los pasos.
  **1.0.30 (Continuar viendo no cargaba nada):** el reporte decía `directo: 4` (el reproductor de Vega no salta dentro
  del archivo de ese servidor: «formato no compatible») y el paso del panel tampoco sonaba: el panel entrega MPEG-TS y
  el lector MPEG-TS de Vega no lo toma bien (lo mismo que con los canales hasta la 1.0.26). Ahora el HLS del panel
  (`src/player/hls.ts`) convierte cada segmento a MP4 fragmentado con el mismo convertidor de los canales
  (`src/lib/tsmux.ts`) y el SourceBuffer es MP4; sin H.264 + AAC (HEVC copiado) sigue el MPEG-TS como antes, y si el
  reproductor rechazara el MP4 el resto de la sesión va en MPEG-TS. Un salto dentro de lo convertido rehace la conversión
  con el segmento puesto en su segundo. Además, en un servidor donde Continuar viendo solo salió por el panel, la
  próxima vez va directo por el panel (`resume_panel`, 7 días): sin el intento directo que falla, la consulta ni la
  espera. Un video desde el principio sigue directo. *(Quitado en 1.0.35: gastaba la VPS en todo Continuar viendo.)*
  **1.0.31:** el lector del panel (`hls.ts`) no tenía el vigilante del lector de canales: el reproductor de Vega no
  empieza si lo bajado no arranca justo en el segundo actual (el video del panel empieza en ~1,4 s) y se queda quieto en
  los huecos entre segmentos, así que el **cambio de idioma** y Continuar viendo por el panel quedaban cargando sin fin.
  Ahora cada 300 ms salta al tramo con datos (`unstick`, como `livehls.ts`). **Menú de audio:** «Audio predeterminado»
  arriba (el audio que el archivo trae marcado, directo del servidor IPTV al empezar) y debajo los idiomas del archivo;
  elegir uno lo prepara el panel sin cortar. Volver a «Audio predeterminado» con la película avanzada sigue por el
  panel con la pista **marcada** del archivo (antes la primera, y volvía al directo, que obliga a saltar dentro del
  archivo: error 4 en Vega y no se podía elegir); al principio vuelve al directo.
- **Cuando un video no abre** (`src/screens/Player.tsx` + `src/player/streamcheck.ts`): vigilante de 20 s (15 s en
  Continuar viendo); una vez se le pregunta al servidor qué pasa: código HTTP, cuenta (`user_info`) y si la película
  sigue (`get_vod_info`). 404 / ya no está → «Video no disponible»; otra extensión → se abre con la de verdad; cuenta
  no activa → «Línea no activa»; 403 → se esperan 10 s (el servidor suelta la conexión anterior) y se vuelve a
  probar una vez. Un 403 con la cuenta activa y la película existente es un rechazo del proveedor: la app no lo puede
  arreglar. Los reintentos esperan 2 s; el reporte al panel lleva cada intento y lo que contestó el servidor.
  **1.0.36:** el reporte también dice qué trae el archivo (`archivo=mp4 video=… audio=… moov=inicio|final`, leído
  después del error) y del servidor el tipo, tamaño, `Accept-Ranges`, si redirige a otro servidor y las conexiones de la
  cuenta: para saber por qué el reproductor de Vega no abre un video directo (error 4) sin el panel.
- **MP4 leído por la app, sin la VPS (1.0.37, `src/player/mp4mse.ts`)**: el modo directo de Vega (src = dirección) da
  error 4 con los MP4 que traen el índice (`moov`) al final, lo normal en los servidores IPTV (reporte: `archivo=mp4
  video=avc1 audio=mp4a moov=final`, servidor 206). Ahora todo `.mp4/.m4v/.mov` se lee con pedidos Range al mismo
  servidor IPTV: el índice (al final o al principio), luego de a ~4 s las muestras del video y del audio predeterminado
  (pista activa del archivo), entregadas como MP4 fragmentado por MSE (`mp4box.ts`, igual que los canales), 40 s por
  adelantado. Respeta la lista de edición (video y audio igual de sincronizados que en el archivo). Continuar viendo
  y ◀▶ empiezan desde el cuadro clave anterior, sin el salto que fallaba. Solo H.264 + AAC: con otro códec (AC-3, HEVC…)
  o si el reproductor rechaza lo entregado, ese video sigue con el modo directo de siempre y después el panel. La VPS
  solo se usa al elegir otro idioma (o para lo que el equipo no abre).
  **1.0.38:** la consulta `isTypeSupported` ya no descarta (manda `addSourceBuffer`), la duración total ya no es
  obligatoria, el primer tramo empieza al momento aunque arranque unas décimas después, 45 s para empezar (no 20) y,
  si no sigue, el reporte dice por qué (`(lector MP4: …)` en el intento).
  **1.0.39:** también con audio **Dolby** (E-AC-3 `ec-3` / AC-3 `ac-3`): su descripción del archivo (con `dec3`/`dac3`)
  va tal cual al reproductor (`initSegment(v, a, aEntry)`). Con FFmpeg apagado el menú de audio queda igual
  («Audio predeterminado» marcado y debajo los idiomas); elegir un idioma avisa «No compatible…» cada vez, no cambia lo
  marcado y no se recuerda para Continuar viendo.
  **1.0.40:** todo título empieza siempre con el audio predeterminado directo del servidor IPTV, también con FFmpeg
  encendido y en Continuar viendo: ya no se vuelve a pedir al panel el idioma elegido la vez anterior. El panel solo
  convierte cuando se elige un idioma en el menú (p. ej. si el predeterminado no se escucha). Se olvidan los títulos
  recordados como «solo por el panel» (`panel_route_3`): los MP4 ahora los lee la app.
  **1.0.41:** el reproductor de Vega no acepta E-AC-3 por MSE (`addSourceBuffer type is not supported`): esos MP4 se
  reproducen **solo con el video** (sin sonido) y un aviso; los idiomas quedan en el menú (con FFmpeg el panel los
  convierte; sin él, «No compatible…»).
  **1.0.42 (micro cortes del audio):** los tramos del video empiezan siempre en un cuadro clave (como mucho 15 s):
  cortar a mitad de un grupo con cuadros B dejaba huecos de milésimas entre tramos. El vigilante de huecos ya no salta
  0,5 s antes de cada final de tramo (+0,1 s): solo si el video de verdad se quedó quieto en un hueco (400 ms), y
  justo al otro lado (+0,02 s).
  **1.0.43 («doble voz» / micro cortes):** los tiempos van con la escala del propio archivo (video: la de su `mdhd`,
  p. ej. 1/24000; audio: la suya, casi siempre su frecuencia), sin pasar a 90 kHz: antes cada cuadro quedaba ±1 con el
  redondeo y el reproductor de Vega estiraba o encimaba trocitos de audio en las uniones. Probado: cuadros de audio
  de 1024 exactos, sin huecos ni encimados; video con las mismas duraciones del archivo. El salto de un hueco espera
  1 s quieto (el tiempo del reproductor avanza a saltos).
  **1.0.44:** la lista de edición también con **tramos vacíos** al principio (`media_time = -1`: la pista empieza N s
  después, en la escala de `mvhd`): antes se ignoraban y ese audio sonaba N s adelantado al video.
- **Audio convertido por el panel en sincronía (1.0.45, `tsmux.ts` `padStart`, solo el lector del panel `hls.ts`):** el
  panel corta el video en el cuadro clave anterior al segundo pedido y el audio empieza justo en ese segundo (0,5-1 s
  después: el MPEG-TS lo dice bien, medido 0,96 s). El reproductor de Vega no respetaba ese hueco inicial y el audio
  quedaba atrasado; ahora el audio empieza con el video, con silencio AAC hasta su primer cuadro (probado: el sonido real
  sigue en su lugar exacto). Los canales en vivo no cambian.
- **El panel cuando el equipo no abre el video** (MKV/MP4 que el reproductor rechaza): el panel lo prepara (HLS);
  si su certificado falla, por http (`plain=1`); si tampoco, el video convertido a H.264 (`v=1`, solo en la VPS / VDS
  y con el interruptor del dueño o del distribuidor encendido).
- **Audio y subtítulos como en Roku**: los idiomas se piden al panel (`api/tracks.php`, lo que ya leyó cualquier equipo
  de ese distribuidor) apenas se abre la ficha de la película o la serie (el episodio de Continuar o el primero, y el
  episodio que queda enfocado) y el siguiente episodio mientras suena el actual (`warmTracks`). En el equipo solo se
  recuerdan en memoria mientras la app está abierta (como el `tmp:` de Roku); lo que dura lo guarda el panel por
  distribuidor (de 1 mes a nunca el dueño, hasta 3 meses un distribuidor). Al pulsar Reproducir, si ya llegaron el
  video empieza con el idioma elegido; si no, se espera ese pedido como mucho 2 s (como Roku). Antes de abrir el video
  solo se pregunta lo ya sabido: leer el archivo antes bloqueaba líneas de pocas conexiones. Con el video abierto
  se lee la cabecera del MKV/MP4 (256 KB) a los 3 s y se reintenta a los 3, 6, 10 s y luego cada 15 s hasta tener los
  idiomas (se deja de intentar si el archivo no es MKV/MP4). Cuando el archivo trae dos o más idiomas (desde 1.0.32
  siempre; antes solo si el reproductor no los informaba todos y si no el idioma se cambiaba dentro del reproductor,
  que salta dentro del archivo: error 4 en algunos servidores), el menú muestra arriba **Audio predeterminado** (el
  video directo del servidor IPTV, sin la VPS) y debajo **todos** los idiomas,
  también el que suena por defecto, preparados por el **motor del panel** (`api/media_vega.php`: video sin cambios +
  ese audio en AAC, HLS por Media Source Extensions desde el segundo actual): volver al idioma por defecto ya no deja
  el video sin sonido. El idioma elegido (aunque sea el que suena por defecto) se recuerda para ese título y
  «Continuar viendo» lo vuelve a pedir al panel; «Audio predeterminado» lo borra y el título vuelve a ir directo. Si el equipo no abre el video directo, «Audio predeterminado» es el primer audio del archivo
  por el panel. Los subtítulos de texto del archivo se eligen en el reproductor o, si el equipo no los muestra, el
  panel los convierte a WebVTT y se dibujan encima del video. *Desactivados* los quita. El panel necesita ffmpeg (Guía EPG).
- **Borrado de caché del panel**: `check_mac` trae la orden (`cache_clear`) y cuándo se envió (`cache_clear_at`). Sin
  número guardado (reinstalada) una orden de los últimos 3 días se aplica igual; la consulta de cada 10 min va con
  `poll: 1` (no cuenta como otra apertura) y, si se está viendo un video, la orden espera a que se cierre el reproductor.
- **Canales estables**: el lector en vivo empieza 5 segmentos antes del final (unos 25-30 s de margen; con 3 cualquier
  demora dejaba el canal sin datos), arranca con 2 segmentos entregados y baja el siguiente mientras entrega el actual.
  Si el canal se detiene 3 veces, va un aviso al panel con lo que tarda bajar y descifrar cada segmento.
- **Foco en el reproductor**: un botón invisible a pantalla completa tiene el foco mientras no hay menú ni aviso; al
  abrir un canal desde la lista el foco se quedaba en la lista oculta y OK / ▲▼ no llegaban al reproductor.
- **Películas más rápidas**: si el servidor entrega el video y el equipo no lo abre (formato), va directo al panel
  (sin el otro protocolo, el DNS ni otra vuelta; antes el panel lo preparaba hasta 3 veces). El equipo recuerda qué
  archivos solo pudo ver por el panel (copia o video convertido, 7 días) y la próxima vez los abre de una por ahí.
- **Cambiar de idioma con el video por el panel**: lo que suena sigue sonando mientras el panel prepara el otro idioma
  y se cambia cuando está listo; si no se puede, se queda el de ahora (antes se cortaba y no pasaba nada).
- **TV en vivo como Roku**: al quedarse 2,5 s sobre un canal empieza a sonar en el cuadro de la derecha
  (`src/components/LivePreview.tsx`, donde estaba el logo); OK lo abre a pantalla completa (antes se apaga la vista
  previa: nunca dos conexiones de la línea a la vez). En el reproductor de un canal solo funcionan OK (lista de canales
  de la carpeta a la izquierda, con el que suena marcado), ▲▼ (cambiar de canal) y MENÚ; pausa, ◀▶ y adelantar no
  hacen nada (pausar un canal en vivo lo dejaba trabado). El lector en vivo salta los huecos de décimas entre segmentos
  (el canal se quedaba quieto al final del primero, a los 5-6 s), empuja la imagen si no avanza en 8 s y vuelve al
  final de la lista si el servidor reinicia la numeración o no trae segmentos nuevos.
- **TV en vivo**: categorías, canales, guía EPG (proveedor y, si no hay, la del panel),
  favoritos, cambio de canal con ▲▼ dentro del reproductor.
- **Deportes** (igual que Roku; pantallas en `src/screens/Sports*.tsx`, datos en `src/data/sports.ts` y
  `src/data/sportsPanel.ts`): **Hoy / Mañana** y, si el panel los ofrece, **Tablas**, **Selecciones** y **Equipos**.
  La agenda se guarda por usuario, distribuidor e idioma (sale al instante y la del panel la reemplaza al llegar)
  y la hora de cada partido se lee una sola vez (el panel manda `s`). Orden: en vivo, por hora y al final los
  terminados; otro día u otra disciplina empiezan arriba. Canal de cada partido: el que lo transmite (`tv`) si el
  cliente lo tiene (por su nombre sin calidad ni país, «M+» = Movistar, exacto, por palabras o pegadas; `ESPN 2`
  nunca da `ESPN`), el de la guía del panel (`api/sports_epg.php`) o el de los equipos; el índice de canales se
  arma una vez por catálogo. Con «Solo los canales del servidor IPTV» (`chan: iptv`) solo se nombran los que el
  cliente tiene. El menú del partido pinta en **verde** los canales de su lista y trae «Buscar canales: «Equipo»»
  por cada equipo y «Buscar canal, equipo o evento…» (teclado; todas las palabras primero, si no, alguna de 4
  letras o más; categorías de deportes primero). **Foco (1.0.32):** al cerrar el canal el foco vuelve al mismo
  evento; si Atrás llevó al menú de arriba, al bajar otra vez se llega a ese evento (no a las fichas). Otro día u otra
  disciplina lo olvidan, y otra sección del menú (TV en vivo, Películas…) vuelve a empezar Deportes de cero.
- **Deportes › Tablas** (`tables.on`): región (Todas, Copas, Selecciones, Europa, **América** —Latinoamérica,
  Norteamérica y Suramérica juntas— y Resto del mundo), división (1.ª por defecto, las que habilitó el panel y al
  final **Liga femenina**, ligas con `w`), ligas a la izquierda y la tabla a la derecha con PJ G E P GF GC DG PTS,
  racha y la zona con su leyenda. Primero la copia guardada (7 días) y la nueva por detrás; se piden apenas llega
  la agenda; si el panel está armando (`p: 1`) se ve lo que hay y se vuelve a preguntar cada 20 s. OK sobre un
  equipo abre su ficha en el idioma de la app (`api/sports_team.php`) con **ENTENDIDO** (marcado) y **MÁS
  DETALLES**: texto completo con todos los títulos (arriba / abajo desplazan).
- **Deportes › Equipos** (`fixtures.on`): próximos partidos de un equipo (también en español con los alias del
  panel) o de un país escrito completo; recuerda los últimos 5. **Selecciones** (`fixtures.nat`): «Todas», cada
  competición y al final **Selección femenina**. Del JSON de 21 días del panel (`api/sports_fixtures.php`,
  guardado en el equipo). Solo se abre lo que está en vivo.
- **Carátulas desde el panel** (`src/lib/images.ts`, `ChainImage`): la copia pública ya achicada
  (`api/imgc/<sha1>.jpg`, sin PHP), después `api/img.php` (con el título: si el servidor IPTV no tiene carátula, el
  panel busca el póster en TMDB) y al final la original. Fondos de TMDB en Full HD hechos por el panel
  (`w=1920`). Si el dueño apaga la caché (Tmdb Settings; `img: false` de `progress.php ?v=2`), todo va directo
  al servidor IPTV y a TMDB, sin avisar nada.
- **Progreso y Mi lista sincronizados** con `api/progress.php`: lo que ves en la TV sigue en la web y el móvil, aunque cada app haya entrado por otra DNS del mismo servicio (el panel los une). Se vuelven a leer al regresar a la app.
- **Aviso del panel al abrir la app** (`api/alerta.php?format=json`, página **Alertas** del panel): bienvenida con el texto general y la imagen, o aviso de vencimiento con el texto de 3, 2, 1 o 0 días. Una vez por arranque y otra vez tras iniciar sesión; botón **Entendido** enfocado, *Atrás* también lo cierra.
- **Número de distribuidor** (primera vez, sin pantalla de inicio antes: el logo de inicio es el del distribuidor elegido, o el de la app con *Omitir*): 6 dígitos con teclado en pantalla. Con número, la
  app usa el logo, el nombre y los colores de ese distribuidor (`login.php` acción
  `tenant_config`, app `vega`) y todas las llamadas al panel llevan `tenant` + `app` (DNS,
  demo, registro, progreso, EPG, deportes y `alerta.php?t=`). **Omitir** deja la app como
  siempre. No vuelve a preguntar: abre en el inicio de sesión o directo en Inicio. Al abrir, al
  volver a la app y cada 6 h se revisa el número: si venció, está suspendido o ya no vale se
  borra (con la sesión) y vuelve a pedirlo con el motivo; sin conexión sigue con lo guardado
  hasta 72 h. **Cambiar distribuidor** (siempre abajo del inicio de sesión y en Cuenta) cierra
  sesión, olvida la marca y la clave TMDB del anterior y pide otro número. Necesita la
  llave del panel (sin llave, *Continuar* avisa y *Omitir* sigue funcionando).
  Con distribuidor, todo sigue su marca: pantalla de inicio (su fondo con su logo al centro; sin logo,
  su nombre), menú superior, inicio de sesión, Cuenta, avisos, reproductor, anillos de foco y barras
  de progreso. Con *Omitir* todo queda como siempre.
- **Control parental** (siempre activo): oculta adultos; se desbloquea con el PIN del panel (`check_mac` →
  `pin`, o `parent_control` de `auth.php`; 0000 de fábrica). **Cuenta › PIN de control parental** lo cambia:
  pide el actual y lo guarda en el panel (`login.php` acción `set_pin`); solo si el panel lo acepta cambia.
- **Sin usuario ni contraseña guardados**: la sesión vive solo en memoria. Cada vez que se abre la app se le
  pide la línea al panel y se comprueba en el servidor IPTV; con una sola línea entra sola. Si el equipo no
  está registrado o la línea venció, se queda en el inicio de sesión. Con la app abierta se pregunta otra vez
  cada 10 min (y al volver a la app, como mucho cada 15 min): si el dueño quitó la línea del equipo o la demo
  venció, vuelve al inicio de sesión; la demo además se corta a su hora exacta (`demo_expires`).
  Usuario y contraseña escritos a mano entran solo si el panel los registra (`submit_url`, Cuentas
  oficiales); si el panel los rechaza (línea demo de otro equipo, vencida…) no entra. La línea de Autodemo
  no se vuelve a registrar (el panel ya la tiene en el historial de demos).

## Idiomas

- La app está en **español, inglés, portugués (Brasil) y francés**. La primera vez (y con *Automático*)
  usa el idioma del Fire TV (`I18nManager.getSystemLocale()` de Vega, las 2 primeras letras); si no es
  uno de esos cuatro, español.
- **Cuenta › Idioma de la app**: Automático (idioma del equipo), Español, English, Português o Français.
  Se guarda en el equipo (`pref_app_lang`) y se aplica enseguida, sin cerrar sesión.
- Textos: `src/lib/i18n.ts` (`t('Texto en español')`, con `{x}` para los valores) y los diccionarios
  `src/i18n/en.ts`, `pt.ts` y `fr.ts`. `npm run typecheck` falla si a un diccionario le falta un texto.
- No se traducen los títulos y nombres del servidor o de TMDB (películas, series, canales, categorías),
  los textos del panel (avisos, errores, pantalla falsa) ni las marcas. Las palabras clave de
  plataformas y géneros (`src/data/catalog.ts`, `kw`) siguen en español porque buscan en los nombres de
  categoría del servidor; solo cambia el nombre que se ve.
- Cada pedido al panel lleva el idioma (`?lang=`; en `login.php`, `"lang"` dentro del JSON cifrado) para
  que el panel traduzca sus mensajes y el aviso de `alerta.php`. TMDB: la búsqueda y el emparejamiento con
  el catálogo siguen en es-MX; reparto, biografía y carátulas del inicio de sesión van en el idioma de la
  app (es-MX, en-US, pt-BR o fr-FR). En inglés, portugués o francés la ficha muestra la sinopsis de TMDB
  (`movie|tv/{id}` en ese idioma) en lugar de la del servidor; si TMDB no la tiene, no hay coincidencia o
  no hay clave, queda la del servidor. En español no cambia nada.

## Panel: dispositivo, pantalla falsa y errores

- `login.php` lleva `"platform": "vega"` (Clientes MAC › Dispositivo) y `progress.php` lleva `platform` y `device` (mapa y estadísticas del Dashboard).
- **Pantalla falsa** (`src/components/FakeScreen.tsx`): si `check_mac` manda `fake_screen.show` y el equipo es nuevo, en lugar del inicio de sesión sale la calculadora (funciona de verdad), el carrusel o la imagen; «video» y «web» se muestran como la calculadora (Vega OS no tiene navegador). El código del panel + «=» abre el inicio de sesión; cada 30 s se revisa si registraron el equipo. Abajo, pequeño, el ID del equipo.
- **Errores al panel** (`src/api/report.ts` → `api/report.php`, cifrado): errores de JavaScript no atrapados y fallos de reproducción, con equipo, línea y servidor. El dueño los ve en «Errores de las apps».
- **Autodemo:** ya no se bloquea en el equipo; el panel decide (si el dueño borró el registro, se puede pedir otra demo).
- **Aviso del panel** (`src/api/alerts.ts`, `src/components/AlertDialog.tsx` → `api/alerta.php`): con varias imágenes en **Alertas** (`images`, en orden) cambian cada `interval` segundos (3) en el mismo lugar, todas cargadas de inicio; con una sola o con paneles anteriores (`image` / `image_path`), como antes. El encabezado no cambia (desde 1.0.22).

## Identificación de la app (User-Agent)

La app se identifica como `LatMpxFireTV/1.0 (Fire TV; Vega OS)` (`src/lib/http.ts`). Nunca debe llevar `Vega/`:
es la firma de un escáner de vulnerabilidades y el cortafuegos de Hostinger / LiteSpeed responde **403** a todo
pedido que la lleve (el panel parecía no tener servidores, sin carátulas ni Autodemo real).

## Subir a la Amazon Appstore

1. Descarga los `.vpkg` de **Releases › vega-latest** (`latmpxvega_armv7.vpkg` y `latmpxvega_aarch64.vpkg`; el `x86_64` es solo para el simulador).
2. En la [Amazon Developer Console](https://developer.amazon.com/apps-and-games/console/apps/list.html)
   crea una app nueva para **Fire TV (Vega OS)**.
3. En *Archivos de la app* sube los `.vpkg`. El identificador del paquete es
   `com.latmpx.player.tv` (en `manifest.toml`).
4. Completa ficha, capturas, icono (`assets/image/app_icon.png`, 512×512) y clasificación, y envía a revisión.
   La firma la pone Amazon al publicar.

Para cambiar el número de versión que ve la tienda, edita `version` en `manifest.toml`, `package.json` y `src/version.ts` (la que se ve en el inicio de sesión y en Cuenta).

## Probar sin Fire TV: simulador de Vega en Linux

Amazon trae un **Vega Virtual Device** (simulador de Fire TV) que corre en **Ubuntu 22.04 de 64 bits**
(Intel/AMD). Sirve también un Ubuntu "portable" en USB con persistencia, siempre que el PC tenga la
virtualización activada en la BIOS (Intel VT-x / AMD-V; con KVM va mucho más fluido).

1. Instala el SDK con el simulador (sin cuenta):
   ```sh
   sudo apt install -y curl lz4 jq
   curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash
   source ~/vega/env        # o abre una terminal nueva
   ```
2. Descarga `latmpxvega_x86_64.vpkg` de **Releases › vega-latest** (el x86_64 es el del simulador). Borra antes el
   que bajaste la vez anterior: el navegador guarda el nuevo como `latmpxvega_x86_64 (1).vpkg` y el comando de abajo
   seguiría instalando el viejo. La versión instalada se ve abajo en el inicio de sesión y en Cuenta.
3. Arranca el simulador y abre la app:
   ```sh
   vega virtual-device start --timeout 120
   vega run-app latmpxvega_x86_64.vpkg com.latmpx.player.tv.main -d VirtualDevice
   ```
   Con el teclado: flechas = cruceta, Enter = OK, Esc/Retroceso = Atrás.
   Si la imagen falla, prueba `vega virtual-device start --no-gl-accel`.
4. Para cerrarlo: `vega virtual-device stop`.

## Probar en un Fire TV con Vega OS

Con el SDK en el PC y el Fire TV en la misma red:

```sh
vega devmode login
vega devmode enable-device --code <código de 6 dígitos que muestra la TV>
vega device list
vega device install-app --packagePath latmpxvega_armv7.vpkg
vega device launch-app --appName com.latmpx.player.tv
```

## Compilar en tu PC

```sh
npm ci
npm run typecheck
npm run build:release     # necesita el SDK de Vega instalado
```

Con `config/panel.key` en tu PC (ver [config/README.md](config/README.md)) la compilación local
incluye Autodemo y registro del equipo. Los `.vpkg` quedan en `build/`.

## Límites conocidos

- **TV en vivo en Vega**: el modo directo del reproductor (src = dirección) **no abre MPEG-TS** (según Amazon solo MP4,
  MKV, MP3, FLV, OGG y FLAC; el HLS solo por MSE). Por eso los canales van primero por `.m3u8` con un lector propio por
  MSE (`src/player/livehls.ts`): sigue las redirecciones a mano (XUI manda la lista a un balanceador con token y los
  segmentos vienen relativos a esa dirección), elige la mejor calidad de una lista maestra, empieza cerca del final, y
  como los canales traen marcas de tiempo grandes (p. ej. 86000 s) salta al principio de lo entregado (si no, el video
  esperaba en el segundo 0 para siempre). Después `.ts` y la dirección corta (`LIVE_FORMATS`), el otro protocolo y el
  DNS elegido (en Vega solo `.m3u8`: el `.ts` y la dirección corta siempre fallan ahí). Los segmentos cifrados con
  AES-128 (`#EXT-X-KEY`, comunes en XUI) se descifran en la app con la llave de la lista; el MPEG-TS se busca dentro
  del segmento (0x47 cada 188 bytes) por si trae relleno al principio. La llave se lee siempre como bytes (XUI la
  manda desde PHP marcada como `text/html`), y también si viene escrita en hexadecimal. Cada intento espera hasta 25 s; al panel va el estado del lector (servidor, segmentos entregados, lo que
  tiene el reproductor y dónde está). Si ninguno abre se le pregunta al servidor y el aviso dice el motivo.
  Estabilidad: cada segmento va justo a continuación del anterior en la línea de tiempo (su primer PTS,
  `tsFirstPts`, + `timestampOffset`, en modo `segments`; el primero empieza en 0 y si uno no calza —el servidor
  reinició la numeración o se saltó un segmento— se pone al final de lo entregado): en modo `sequence` el equipo dejaba
  un hueco en cada unión y saltarlo era un corte de 1-1,5 s cada segmento. El descifrado AES-128 va por partes de 64 KB
  sin trabar la app. El token del balanceador de XUI vence a los pocos minutos: si los segmentos (o la lista) fallan
  o devuelven una página, la lista se pide otra vez desde la dirección del canal y se sigue (antes el canal se cortaba
  a los ~5 min con «El equipo no pudo abrir el video de este canal»). Un canal que ya se estaba viendo y se corta
  (error del reproductor, 45 s sin video nuevo) se vuelve a conectar solo, igual que estaba, hasta 5 veces seguidas
  («Reconectando…», un aviso al panel), sin pasar por los otros formatos. Los 2 segmentos siguientes se bajan
  mientras se entrega el actual; la lista se vuelve a pedir cada tercio
  de segmento cuando el canal está al día; un vigilante cada 300 ms salta los huecos entre tramos y empuja la imagen
  quieta a los 3 s; si se acaba lo bajado, pausa (se ve «cargando») hasta tener 3-6 s de margen (hasta 10 s si pasa
  seguido) en lugar de detenerse y seguir cada pocos segundos; un segmento que no llega se reintenta y a la tercera se
  salta; con la memoria llena borra lo ya visto y vuelve a intentar. En los canales el reproductor no se redibuja con
  el avance (no hay barra), así la app queda libre para bajar y descifrar. El HLS del
  motor del panel (audio cambiado) se reproduce con su propio lector por MSE (`src/player/hls.ts`).
- **Servidores XUI.one en «Debug Mode»** contestan **200 con una página HTML** en lugar del video cuando hay un problema
  (`INVALID_STREAM_ID`, `STREAM_OFFLINE`, `BLOCKED_USER_AGENT`, `EXPIRED`…). Al primer fallo la app hace una sola
  consulta (`streamCheck`, `xuiError` en `src/player/streamcheck.ts`), muestra el motivo con el código y no insiste:
  antes tomaba ese 200 como bueno y repetía 13 intentos seguidos, y la protección contra abusos del servidor podía
  bloquear el equipo un rato (luego tampoco abrían las películas). Canales: ts → m3u8 → directa, el otro protocolo
  y el DNS elegido; películas: una sola vuelta extra.
- Autodemo, registrar el equipo y la activación por código MAC usan `login.php` con la llave
  maestra, que no va en el código: se agrega al compilar (ver [config/README.md](config/README.md)).
  Sin llave esos botones no aparecen. `check_mac` y `auto_demo` piden la respuesta cifrada
  (`"enc": 1`): el usuario y la contraseña de la línea llegan con AES-GCM, nunca en claro (con un
  panel antiguo se sigue aceptando el JSON normal).
- La app no se ha probado en un Fire TV real todavía: se compiló y se revisó el código,
  pero el contenedor de desarrollo no llega al panel ni tiene un equipo Vega.
