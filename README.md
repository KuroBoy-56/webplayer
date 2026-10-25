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
- **Inicio estilo Netflix**: portada grande, Continuar viendo, Mi lista, Top 10,
  plataformas (Netflix, Disney+, HBO Max, Prime, Marvel, Navidad, Halloween…) y géneros
  (Acción, Suspenso, Aventura, Anime, Drama…), igual que la web. En la portada, en lugar de la «N»
  de Netflix va la inicial de la marca (distribuidor; con *Omitir*, «M» de MPX Player) en su color de
  acento. Con `features.platforms: false` (`tenant_config`) no hay fila ni filas de plataformas. Al
  cambiar de sección o abrir una plataforma/género la última portada queda de fondo (nunca negro).
- **Cuenta** muestra también cuánto contenido tiene el servidor: canales en vivo, películas y series
  («…» mientras se carga esa lista).
- **Menú superior**: Inicio, Series, Películas, TV en vivo, Deportes, Mi lista, Buscar, Cuenta.
  *Atrás* vuelve a Inicio y, en Inicio, pregunta si quieres salir.
- **Ficha** con sinopsis, reparto, temporadas, episodios con su avance y "Más títulos como este".
- **Actores**: en la ficha, el reparto (fotos de TMDB) abre la página del actor con su filmografía, solo los títulos que el servidor tiene (título normalizado y año ±1, como la app de Windows y la web). Clave TMDB del panel o la incorporada.
- **Reproductor nativo de Vega** (MP4, MKV, AVI, MOV, MPEG-TS) sin límite de resolución ni de
  bitrate (4K si el equipo y el archivo lo tienen): continuar donde quedó, ◀▶ 10 s, OK pausa,
  ▼ o MENÚ para audio y subtítulos, idioma preferido automático y siguiente episodio solo.
- **Audio y subtítulos como en Roku**: los idiomas (del panel, `api/tracks.php`, o de la cabecera) se buscan **antes de
  abrir el video**, como mucho 6 s (`load` en `src/player/playback.ts`): a la vez que el video fallaban en servidores con
  una sola conexión por línea y solo quedaba el audio predeterminado. Se lee la cabecera del MKV/MP4 para listar todas las pistas
  con su idioma (Español latino, Inglés…) y su códec. El cambio de audio se comprueba en el
  reproductor; si el equipo no lo toma o no decodifica ese audio (DTS, TrueHD…), lo prepara el
  **motor del panel** (`api/media_vega.php`: video sin cambios + ese audio en AAC, HLS por Media
  Source Extensions desde el segundo actual). Los subtítulos de texto del archivo se eligen en el
  reproductor o, si el equipo no los muestra, el panel los convierte a WebVTT y se dibujan encima del
  video. *Desactivados* los quita. El panel necesita ffmpeg (Guía EPG).
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

## Subir a la Amazon Appstore

1. Descarga los `.vpkg` de **Releases › vega-latest** (`latmpxvega_armv7.vpkg` y `latmpxvega_aarch64.vpkg`; el `x86_64` es solo para el simulador).
2. En la [Amazon Developer Console](https://developer.amazon.com/apps-and-games/console/apps/list.html)
   crea una app nueva para **Fire TV (Vega OS)**.
3. En *Archivos de la app* sube los `.vpkg`. El identificador del paquete es
   `com.latmpx.player.vega` (en `manifest.toml`).
4. Completa ficha, capturas, icono (`assets/image/app_icon.png`, 512×512) y clasificación, y envía a revisión.
   La firma la pone Amazon al publicar.

Para cambiar el número de versión que ve la tienda, edita `version` en `manifest.toml` y en `package.json`.

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
2. Descarga `latmpxvega_x86_64.vpkg` de **Releases › vega-latest** (el x86_64 es el del simulador).
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

- La TV en vivo usa MPEG-TS (`.ts`), que el reproductor de Vega abre directo; si un canal falla se prueba
  `.m3u8` y luego la dirección corta sin `/live/` (`LIVE_FORMATS` en `src/api/xtream.ts`; LG empieza por `.m3u8`). HLS (`.m3u8`) del
  proveedor necesitaría integrar Shaka Player; no hace falta mientras el proveedor sirva `.ts`. El
  HLS del motor del panel (audio cambiado) se reproduce con un lector propio por MSE (`src/player/hls.ts`).
- Autodemo, registrar el equipo y la activación por código MAC usan `login.php` con la llave
  maestra, que no va en el código: se agrega al compilar (ver [config/README.md](config/README.md)).
  Sin llave esos botones no aparecen. `check_mac` y `auto_demo` piden la respuesta cifrada
  (`"enc": 1`): el usuario y la contraseña de la línea llegan con AES-GCM, nunca en claro (con un
  panel antiguo se sigue aceptando el JSON normal).
- La app no se ha probado en un Fire TV real todavía: se compiló y se revisó el código,
  pero el contenedor de desarrollo no llega al panel ni tiene un equipo Vega.
