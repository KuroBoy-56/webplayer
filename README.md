# MPX Player para Fire TV con Vega OS

**Marca:** la app se llama **MPX Player** (`title` en `manifest.toml` y `APP_NAME` en `src/lib/tenant.ts`; el id sigue siendo `com.latmpx.player.vega`). Logo, icono (`app_icon.png`) e imágenes de las plataformas (Netflix, Disney+, HBO Max, Prime Video, Marvel, Apple TV+, Paramount+, DC, Navidad, Halloween) están en `assets/image/`.

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
  si el audio por defecto es el idioma preferido suena así, sin pasar por el panel. En las páginas de
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
  ▼ o MENÚ para audio y subtítulos, idioma preferido automático y siguiente episodio solo.
- **Plataformas** (Netflix, Disney+, Prime Video, HBO Max, Marvel, Navidad, Halloween…) muestran solo lo que tiene el
  servidor IPTV: los títulos de sus categorías cuyo nombre coincide, cada uno una vez. El póster de TMDB que pone el
  panel cuando el servidor no tiene carátula es solo del mismo título (nombre y año ±1); las direcciones del panel
  llevan `?v=2` para no mostrar las imágenes equivocadas guardadas antes.
- **Carátulas del panel directo y una por título**: la app calcula el nombre exacto de la copia pública del panel
  (`canonKey` en `src/lib/images.ts`, igual que `img_key` / `img_idkey` de `api/img.php`) y la pide sin pasar por PHP;
  antes usaba otro nombre y dependía de enlaces del hosting (si no los permite, cada carátula pasaba por `img.php`:
  lento). Si el servidor manda el id de TMDB (`tmdb` / `tmdb_id`, `Item.tm`), una carátula por título para todos los
  servidores IPTV (`&t=`).
- **Continuar viendo por pasos** (como Roku): 1) directo en el segundo guardado; 2) si no suena (error o 15 s), 4 s
  después el motor del panel lo prepara desde ese segundo (`panelOpen` en `src/player/playback.ts`); 3) si tampoco,
  otra vez directo 10 s después; si nada funciona, el aviso «No se pudo continuar donde quedó». **Nunca empieza solo
  desde el principio** (para eso está «Desde el principio»). Mientras no suena no se guarda avance.
- **Cuando un video no abre** (`src/screens/Player.tsx` + `src/player/streamcheck.ts`): vigilante de 20 s (15 s en
  Continuar viendo); una vez se le pregunta al servidor qué pasa: código HTTP, cuenta (`user_info`) y si la película
  sigue (`get_vod_info`). 404 / ya no está → «Video no disponible»; otra extensión → se abre con la de verdad; cuenta
  no activa → «Línea no activa»; 403 → se esperan 10 s (el servidor suelta la conexión anterior) y se vuelve a
  probar una vez. Un 403 con la cuenta activa y la película existente es un rechazo del proveedor: la app no lo puede
  arreglar. Los reintentos esperan 2 s; el reporte al panel lleva cada intento y lo que contestó el servidor.
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
  idiomas (se deja de intentar si el archivo no es MKV/MP4). Cuando el archivo trae más idiomas de los que da el
  reproductor, el menú muestra arriba **Audio predeterminado** (el video directo) y debajo **todos** los idiomas,
  también el que suena por defecto, preparados por el **motor del panel** (`api/media_vega.php`: video sin cambios +
  ese audio en AAC, HLS por Media Source Extensions desde el segundo actual): volver al idioma por defecto ya no deja
  el video sin sonido. Si el equipo no abre el video directo, «Audio predeterminado» es el primer audio del archivo
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
  letras o más; categorías de deportes primero).
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
   `com.latmpx.player.vega` (en `manifest.toml`).
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
   vega run-app latmpxvega_x86_64.vpkg com.latmpx.player.vega.main -d VirtualDevice
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
vega device launch-app --appName com.latmpx.player.vega
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
