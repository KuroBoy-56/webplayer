# MPX Player para Samsung Smart TV (Tizen OS)

**Es la misma app de Vega OS** (`src/`, React Native) corriendo en el navegador del televisor Samsung con
[react-native-web](https://necolas.github.io/react-native-web/). Solo cambian las piezas propias de cada
equipo, que viven en `web/`: el reproductor (AVPlay), el control remoto, el botón Atrás y el
almacenamiento. Mismo panel, mismo diseño Netflix y mismas funciones que la web, Android, Android TV,
Windows, Roku y Vega OS. Un cambio en `src/` de la rama `vega-os` se trae aquí con un `git merge`.

**Descarga:** pestaña **Releases › tizen-latest** de este repositorio (`MPXPlayer.wgt`). GitHub Actions la
compila sola en cada cambio de la rama `tizenOS` (workflow `App Tizen OS (Samsung)`), con la llave del panel
del secreto `PANEL_KEY` (la misma de Vega OS e iOS).

## Qué trae

- **Inicio de sesión** solo con usuario y contraseña: se prueba a la vez en todos los DNS
  del panel y entra en el que coincida. Si el panel tiene una cuenta asignada a este equipo
  aparece un botón para entrar con ella. Fondo con carteles de estreno (TMDB del panel).
- **Manda el panel (lo que se aprendió en Roku):** al abrir se pide primero `check_mac` (la línea que el panel le
  da hoy a esta MAC, demo vigente incluida con su marca DEMO); `auth.php` solo sin llave o si `check_mac` no da
  línea. Cada servidor tiene hasta **30 s** para contestar. Si la línea del panel (o de la Autodemo) no contesta, la
  misma cuenta se prueba en los DNS del panel y, si ningún servidor la **rechazó** (solo no contestaron), se entra
  con ella igual. Solo un rechazo del servidor deja en el inicio de sesión.
- **Cualquier formato:** si el televisor no abre el archivo (contenedor o códec que no reconoce), el **motor del
  panel** lo convierte (video sin cambios, audio en AAC) desde donde iba antes de dar el error (solo si la línea
  tiene permiso del motor; sin permiso, el error normal).
- **El progreso se guarda siempre** con su duración: con el motor del panel (que no la sabe) se usa la del servidor.
- **Televisores 2018–2020** (Tizen 4.0–5.5): `web/polyfills.ts` les da `globalThis`, `padStart`, `Promise.finally`
  y un `AbortController` que sí corta las peticiones (sin eso la app no abría en esos modelos).
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
  TMDB) y la app arranca otra vez (`window.location.reload()`) y entra
  sola. Se quedan sesión, distribuidor, ajustes y PIN. `src/lib/cacheclear.ts` (`tools/cacheclear.test.js`).
- **Audio y subtítulos del panel**: `media_tizen.php?do=status&token=` — si el dueño desactivó ffmpeg
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
- **Reproductor del televisor (AVPlay de Samsung)**: MP4, MKV, AVI, MOV, MPEG-TS y HLS sin límite de
  resolución ni de bitrate (4K si el televisor y el archivo lo tienen): continuar donde quedó, ◀▶ 10 s, OK pausa,
  ▼ o MENÚ para audio y subtítulos, siguiente episodio solo. Audio como Roku: todo título empieza con su audio predeterminado, directo
  del servidor IPTV; el panel prepara otro idioma solo cuando el usuario lo elige, y esa elección se recuerda
  para ese título (Continuar viendo). La barra de avance se pinta en píxeles.
- **Audio y subtítulos como en Roku**: se lee la cabecera del MKV/MP4 para listar todas las pistas
  con su idioma (Español latino, Inglés…) y su códec. El cambio de audio se comprueba en el
  reproductor; si el equipo no lo toma o no decodifica ese audio (DTS, TrueHD…), lo prepara el
  **motor del panel** (`api/media_tizen.php`: video sin cambios + ese audio en AAC, HLS que AVPlay abre
  directo desde el segundo actual). Los subtítulos de texto del archivo se eligen en el
  reproductor o, si el equipo no los muestra, el panel los convierte a WebVTT y se dibujan encima del
  video. *Desactivados* los quita. El panel necesita ffmpeg (Guía EPG).
- **TV en vivo**: categorías, canales, guía EPG (proveedor y, si no hay, la del panel),
  favoritos, cambio de canal con ▲▼ dentro del reproductor.
- **Deportes**: partidos de hoy y mañana con el canal encontrado automáticamente
  (mismas reglas `match` de `api/sports.php`). Debajo de cada partido, **En TV:** los canales que lo
  transmiten (panel: `tv`). Al pulsarlo sale el menú **Ver el evento** (automático), cada canal y
  **Buscar por equipos**; un canal se busca por su nombre sin calidad ni país (`ESPN 2` encuentra
  `MX: ESPN 2 HD`, nunca `ESPN` ni `ESPN 3`) y, si no lo tienes, se busca el evento por equipos o nombre en
  las carpetas de eventos. Un índice de palabras de los canales evita comparar todos contra todos.
- **Progreso y Mi lista sincronizados** con `api/progress.php`: lo que ves en la TV sigue en la web y el móvil, aunque cada app haya entrado por otra DNS del mismo servicio (el panel los une). Se vuelven a leer al regresar a la app.
- **Aviso del panel al abrir la app** (`api/alerta.php?format=json`, página **Alertas** del panel): bienvenida con el texto general y las imágenes del registro de Alertas (varias cambian cada `interval` s, 3, en el mismo lugar), o aviso de vencimiento con el texto de 3, 2, 1 o 0 días. Una vez por arranque y otra vez tras iniciar sesión; botón **Entendido** enfocado, *Atrás* también lo cierra.
- **Número de distribuidor** (primera vez, sin pantalla de inicio antes: el logo de inicio es el del distribuidor elegido, o el de la app con *Omitir*): 6 dígitos con teclado en pantalla. Con número, la
  app usa el logo, el nombre y los colores de ese distribuidor (`login.php` acción
  `tenant_config`, app `tizen`) y todas las llamadas al panel llevan `tenant` + `app` (DNS,
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

## Tema de prueba (estilo IBO Player, 1.0.2)

Si el panel lo ofrece (Pantalla Falsa › «Tema de prueba», solo con **Omitir**: `features.review`, `panelFeatures` en
`src/api/panel.ts`), el inicio de sesión queda sencillo (usuario, contraseña, Ingresar y Autodemo; sin DNS ni código
del equipo). **Autodemo** o una cuenta del tema (`panelReview`, `login.php review_login`) abren `src/screens/Review.tsx`
(el mismo de Vega): Películas a la izquierda, Series al lado y Ajustes (solo «Cerrar sesión»), con los videos de la
carpeta player del panel en un reproductor sencillo (AVPlay por el adaptador de `web/shims/w3cmedia.tsx`; sin sesión,
progreso ni caché). No registra nada en el panel ni vence. Un usuario y contraseña que no son del tema entran como
siempre (línea IPTV).

## Idiomas

- La app está en **español, inglés, portugués (Brasil) y francés**. La primera vez (y con *Automático*)
  usa el idioma del televisor (`LOCALE` de `tizen.systeminfo` o `navigator.language`, las 2 primeras
  letras; shim `web/shims/kepler.ts`); si no es uno de esos cuatro, español.
- **Cuenta › Idioma de la app**: Automático (idioma del equipo), Español, English, Português o Français.
  Se guarda en el equipo (`pref_app_lang`) y se aplica enseguida, sin cerrar sesión.
- Textos: `src/lib/i18n.ts` (`t('Texto en español')`, con `{x}` para los valores) y los diccionarios
  `src/i18n/en.ts`, `pt.ts` y `fr.ts`. `npm run typecheck` falla si a un diccionario le falta un texto y
  `npm test` (`tools/i18n.test.js`) revisa el idioma automático, el elegido, las fechas y los `{valores}`.
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

- Todo lo que va a `login.php` lleva `"platform": "tizen"` (Clientes MAC › Dispositivo: «Samsung Smart TV
  (Tizen OS)»), `"enc": 1` y `"ts"` (verificador antihack); con distribuidor `"tenant"` + `"app": "tizen"`.
  `progress.php` lleva `platform` y `device`.
- **Código del equipo (MAC)**: `AA:BB:CC:DD:EE:FF` armado con el id del televisor
  (`webapis.productinfo.getDuid()`, SHA-256): es el mismo aunque se desinstale y se vuelva a instalar la
  app, así el registro del panel no se pierde (`src/lib/platform.ts`).
- **Pantalla falsa** (`src/components/FakeScreen.tsx`): calculadora (funciona de verdad), carrusel, imagen y,
  como el televisor sí tiene navegador y reproductor, también **video** (en bucle, sin sonido) y **web**.
- **Errores al panel** (`api/report.php`, cifrado) con el modelo real del televisor (`getRealModel`) y la
  versión de Tizen.

## Cómo está hecha

| Pieza de Vega | En Tizen (`web/`) |
| --- | --- |
| `react-native` | `react-native-web` + `BackHandler` con el botón Atrás del control (keyCode 10009) y `hasTVPreferredFocus` |
| `@amazon-devices/react-native-w3cmedia` (`VideoPlayer`) | `web/shims/w3cmedia.tsx`: el mismo `VideoPlayer` sobre **AVPlay** (`webapis.avplay`): pistas de audio y subtítulos del archivo (`getTotalTrackInfo` / `setSelectTrack`), subtítulos dibujados encima, `suspend`/`restore` al pasar a segundo plano y la página transparente sobre el video. En un navegador usa `<video>` |
| `@amazon-devices/react-native-kepler` | `useTVEventHandler` con las teclas del control (flechas, OK, ▶❚❚, ⏪⏩, CH+/CH−, INFO, TOOLS y colores, registradas con `tizen.tvinputdevice.registerKey`) |
| Foco del control (nativo en Vega) | `web/spatial.ts`: las flechas van al botón más cercano en esa dirección (misma fila o columna, sin saltos en diagonal), siempre hay algo con foco y al volver a una pantalla se vuelve al último botón |
| AsyncStorage | `localStorage` del televisor (se borra al desinstalar la app) |
| HLS del motor del panel por MSE | AVPlay lo abre directo (`src/player/hls.ts`, modo `nativeHls`) |

`tools/build-tizen.js` compila todo con esbuild en `dist/` (`app.js` para Chromium 56 = Tizen 4.0, televisores
2018 en adelante) y copia `tizen/index.html`, `tizen/config.xml` e `icon.png`. `tools/sign-tizen.sh` lo firma
como `.wgt` con la CLI de Tizen Studio.

## Instalarla en tu televisor Samsung

Samsung solo instala apps firmadas con un **certificado Samsung** que incluye el id (DUID) de tus televisores.
Es gratis con una cuenta de Samsung. Se hace una vez:

1. En el televisor: **Apps**, marca **1 2 3 4 5** con el control, activa **Developer mode** y escribe la IP de
   tu PC. Reinicia el televisor.
2. En el PC instala [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
   con la extensión **Samsung Certificate Extension** (Package Manager › Extension SDK).
3. **Device Manager** › conecta el televisor por IP. **Certificate Manager** › nuevo perfil **Samsung**
   (inicia sesión con tu cuenta; el DUID del televisor conectado se agrega solo).
4. Instala: `tizen install -n MPXPlayer.wgt -t <nombre del televisor>` (o arrastra el `.wgt` en Device Manager).
   Si el `.wgt` de GitHub no está firmado con tu certificado, vuelve a firmar `MPXPlayer-web.zip`
   (descomprímelo y `tizen package -t wgt -s <tu perfil> -- carpeta`).

**Para que GitHub la firme sola con tu certificado** (y el `.wgt` de Releases se instale directo), guarda en
el repositorio (*Settings › Secrets and variables › Actions*) estos secretos con los archivos de tu perfil
Samsung (están en `~/SamsungCertificate/<perfil>/`):

| Secreto | Valor |
| --- | --- |
| `TIZEN_AUTHOR_P12` | `author.p12` en base64 (`base64 -w0 author.p12`) |
| `TIZEN_AUTHOR_PASS` | contraseña del certificado de autor |
| `TIZEN_DISTRIBUTOR_P12` | `distributor.p12` en base64 |
| `TIZEN_DISTRIBUTOR_PASS` | contraseña del certificado de distribuidor |

Sin esos secretos GitHub firma con un certificado de autor nuevo y el distribuidor público de Tizen (sirve
para el emulador de Tizen o para volver a firmar).

## Compilar y probar en tu PC

```sh
npm ci
npm run typecheck && npm test
npm run build            # dist/ (con config/panel.key incluye Autodemo, DNS y registro del equipo)
```

`dist/index.html` se abre en Chrome para probar (flechas = cruceta, Enter = OK, Esc = Atrás; en el
navegador el video va por `<video>`). Para el televisor: `tools/sign-tizen.sh` con la CLI de Tizen Studio.

## Límites conocidos

- Probada en Chromium (con un servidor Xtream de prueba y un AVPlay simulado): inicio de sesión, inicio,
  ficha, reproductor, menú de audio y subtítulos, TV en vivo y el control remoto. **No se ha probado todavía
  en un televisor Samsung real.**
- Televisores de 2018 o más nuevos (Tizen 4.0+). Los de 2015–2017 tienen un navegador demasiado viejo.
- El tipo «Player» y «Obligar» de la pantalla falsa no aplican (igual que en Roku y la web player).
- TV en vivo: si un canal falla se prueba `.ts`, `.m3u8` y la dirección corta sin `/live/`
  (`LIVE_FORMATS` en `src/api/xtream.ts`; LG empieza por `.m3u8`).
