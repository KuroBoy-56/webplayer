# MPX Player para LG Smart TV (webOS)

**Es la misma app de Vega OS y Tizen OS** (`src/`, React Native) corriendo en el navegador del televisor LG con
[react-native-web](https://necolas.github.io/react-native-web/). Salió de la rama `tizenOS`; solo cambian las
piezas propias del equipo, que viven en `web/`: el reproductor (`<video>` de webOS), el control remoto LG, el
botón Atrás, el id del televisor y el empaquetado. Mismo panel, mismo diseño Netflix y mismas funciones que la
web, Android, Android TV, iOS, Windows, Roku, Vega OS y Tizen OS. Un cambio en `src/` de `vega-os` / `tizenOS`
se trae aquí con un `git merge`.

**Descarga:** pestaña **Releases › webos-latest** de este repositorio (`MPXPlayer.ipk`). GitHub Actions la
compila sola en cada cambio de la rama `webOS` (workflow `App webOS (LG)`), con la llave del panel del secreto
`PANEL_KEY` (la misma de Vega OS, Tizen e iOS).

## Qué trae

- **Inicio de sesión** solo con usuario y contraseña: se prueba a la vez en todos los DNS
  del panel y entra en el que coincida. Si el panel tiene una cuenta asignada a este equipo
  aparece un botón para entrar con ella. Fondo con carteles de estreno (TMDB del panel).
- **Manda el panel (lo que se aprendió en Roku):** al abrir se pide primero `check_mac` (la línea que el panel le
  da hoy a esta MAC, demo vigente incluida con su marca DEMO); `auth.php` solo sin llave o si `check_mac` no da
  línea. Cada servidor tiene hasta **30 s** para contestar (XUI lentos). Si la línea del panel (o de la Autodemo)
  no contesta, la misma cuenta se prueba en los DNS del panel y, si ningún servidor la **rechazó** (solo no
  contestaron), se entra con ella igual: el catálogo lo vuelve a intentar. Solo un rechazo del servidor (usuario o
  contraseña, vencida, bloqueada) deja en el inicio de sesión.
- **Cualquier formato:** si el televisor no abre el archivo (contenedor o códec que no reconoce), el **motor del
  panel** lo convierte (video sin cambios, audio en AAC) desde donde iba antes de dar el error.
- **El progreso se guarda siempre** con su duración: con el motor del panel (que no la sabe) se usa la del servidor.
- **Botón DNS** (como Android e iOS): Automático, Cloudflare, Google, Quad9, AdGuard, NextDNS u OpenDNS.
  Si el DNS de la red no encuentra el servidor IPTV (bloqueo del proveedor de internet), la app lo resuelve
  con DNS sobre HTTPS y se conecta a esa IP: catálogo, inicio de sesión y reproductor (una vez por video).
  Solo para servidores http (https necesita el nombre para el certificado). `src/lib/securedns.ts`.
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
  distribuidor o del dueño); sin clave no hay carrusel.
- **Audio y subtítulos del panel**: `media_webos.php?do=status&token=` — si el dueño desactivó ffmpeg
  para el distribuidor de la línea, el panel responde `ffmpeg:false` y se queda el audio original.
- **Botones iguales a Roku, Windows y la web**: un solo componente en toda la app (inicio de sesión,
  distribuidor, avisos, diálogos, Cuenta y menú del reproductor). Principal = color del distribuidor
  (rojo sin distribuidor) con texto de contraste; secundario = blanco translúcido con borde fino; con
  el foco del control, borde blanco de 3 px y crece un poco con una animación corta.
- **Inicio estilo Netflix**: portada grande, Continuar viendo, Mi lista, Top 10,
  plataformas (Netflix, Disney+, HBO Max, Prime, Marvel, Navidad, Halloween…) y géneros
  (Acción, Suspenso, Aventura, Anime, Drama…), igual que la web.
- **Menú superior**: Inicio, Series, Películas, TV en vivo, Deportes, Mi lista, Buscar, Cuenta.
  *Atrás* vuelve a Inicio y, en Inicio, pregunta si quieres salir.
- **Ficha** con sinopsis, reparto, temporadas, episodios con su avance y "Más títulos como este".
- **Actores**: en la ficha, el reparto (fotos de TMDB) abre la página del actor con su filmografía, solo los títulos que el servidor tiene (título normalizado y año ±1, como la app de Windows y la web). Clave TMDB del panel o la incorporada.
- **Reproductor del televisor (`<video>` de webOS, por hardware)**: MP4, MKV, MOV, MPEG-TS y HLS sin límite de
  resolución ni de bitrate (4K / HDR si el televisor y el archivo lo tienen): continuar donde quedó, ◀▶ 10 s, OK
  pausa, ▼ o los botones rojo / verde para audio y subtítulos, idioma preferido automático y siguiente episodio solo.
- **Cualquier formato, en este orden:** el video directo con el reproductor del televisor → el otro protocolo
  (http ↔ https) → la IP del DNS elegido → **el motor del panel** (`api/media_webos.php`: video sin cambios y audio
  en AAC, en HLS que el televisor abre directo) cuando el televisor no abre el archivo (AVI, MKV o códecs que no
  reconoce) o no decodifica su audio (DTS, TrueHD…). Solo si todo eso falla sale el error.
- **El progreso se guarda siempre** (cada pocos segundos, al pausar, salir y terminar), también con el motor del
  panel: como ese HLS no sabe la duración total, se usa la del servidor (`serverDurationSec`), así Continuar
  viendo muestra el avance en todas las apps.
- **Audio y subtítulos como en Roku**: se lee la cabecera del MKV/MP4 para listar todas las pistas
  con su idioma (Español latino, Inglés…) y su códec. El cambio de audio se comprueba en el
  reproductor; si el equipo no lo toma o no decodifica ese audio (DTS, TrueHD…), lo prepara el
  **motor del panel** (`api/media_webos.php`: video sin cambios + ese audio en AAC, HLS que el
  televisor abre directo desde el segundo actual). Los subtítulos de texto del archivo se eligen en el
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
- **Aviso del panel al abrir la app** (`api/alerta.php?format=json`, página **Alertas** del panel): bienvenida con el texto general y la imagen, o aviso de vencimiento con el texto de 3, 2, 1 o 0 días. Una vez por arranque y otra vez tras iniciar sesión; botón **Entendido** enfocado, *Atrás* también lo cierra.
- **Número de distribuidor** (primera vez, sin pantalla de inicio antes: el logo de inicio es el del distribuidor elegido, o el de la app con *Omitir*): 6 dígitos con teclado en pantalla. Con número, la
  app usa el logo, el nombre y los colores de ese distribuidor (`login.php` acción
  `tenant_config`, app `webos`) y todas las llamadas al panel llevan `tenant` + `app` (DNS,
  demo, registro, progreso, EPG, deportes y `alerta.php?t=`). **Omitir** deja la app como
  siempre. No vuelve a preguntar: abre en el inicio de sesión o directo en Inicio. Al abrir, al
  volver a la app y cada 6 h se revisa el número: si venció, está suspendido o ya no vale se
  borra (con la sesión) y vuelve a pedirlo con el motivo; sin conexión sigue con lo guardado
  hasta 72 h. **Cuenta › Cambiar distribuidor** cierra sesión y pide otro número. Necesita la
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
  usa el idioma del televisor (`navigator.language`, que en webOS es el idioma del menú del televisor; las 2
  primeras letras; shim `web/shims/kepler.ts`); si no es uno de esos cuatro, español.
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

- Todo lo que va a `login.php` lleva `"platform": "webos"` (Clientes MAC › Dispositivo: «LG Smart TV (webOS)»),
  `"enc": 1` y `"ts"` (verificador antihack); con distribuidor `"tenant"` + `"app": "webos"`.
  `progress.php` lleva `platform` y `device`.
- **Código del equipo (MAC)**: `AA:BB:CC:DD:EE:FF` armado con el **LGUDID** del televisor
  (`luna://com.webos.service.sm/deviceid/getIDs`, SHA-256): es el mismo aunque se desinstale y se vuelva a
  instalar la app, así el registro del panel no se pierde (`src/lib/platform.ts`). Se pide antes de mostrar la
  app (`web/index.tsx`); sin respuesta en 3 s queda un código al azar guardado en el equipo.
- **Permisos de webOS** (`requiredACG` en `webos/appinfo.json`): `deviceinfo.query` (LGUDID) y
  `systemconfig.query` (modelo y versión). Sin ellos los webOS nuevos niegan esas llamadas.
- **Pantalla falsa** (`src/components/FakeScreen.tsx`): calculadora (funciona de verdad), carrusel, imagen,
  **video** (en bucle, sin sonido) y **web**.
- **Errores al panel** (`api/report.php`, cifrado) con el modelo del televisor (`modelName`) y la versión de webOS.

## Cómo está hecha

| Pieza de Vega | En webOS (`web/`) |
| --- | --- |
| `react-native` | `react-native-web` + `BackHandler` con el botón Atrás del control LG (keyCode 461; `disableBackHistoryAPI` en `appinfo.json`) y `hasTVPreferredFocus` |
| `@amazon-devices/react-native-w3cmedia` (`VideoPlayer`) | `web/shims/w3cmedia.tsx`: el `<video>` de webOS (reproductor por hardware del televisor, pistas de audio con `audioTracks`, HLS directo) |
| `@amazon-devices/react-native-kepler` | `useTVEventHandler` con las teclas del control LG (flechas, OK, ▶ ❚❚ ■ ⏪ ⏩, CH+ / CH− = 33 / 34, INFO, rojo / verde = menú de audio y subtítulos) |
| Foco del control (nativo en Vega) | `web/spatial.ts`: las flechas van al botón más cercano en esa dirección; el puntero del Magic Remote también hace clic |
| AsyncStorage | `localStorage` del televisor (se borra al desinstalar la app) |
| HLS del motor del panel por MSE | el `<video>` de webOS lo abre directo (`src/player/hls.ts`, modo `nativeHls`) |
| Televisores viejos | `web/polyfills.ts`: `globalThis`, `padStart`, `Promise.finally`, `Object.entries` y un `AbortController` que sí corta las peticiones (webOS 4.x, Chromium 53) |

`tools/build-webos.js` compila todo con esbuild en `dist/` (`app.js` para Chromium 53 = webOS 4.0, televisores LG
2018 en adelante) y copia `webos/index.html`, `appinfo.json`, iconos y la pantalla de carga. `ares-package dist`
(CLI oficial de LG, `@webos-tools/cli`) arma el `.ipk`.

El build también copia `app.js` e `img/` a `webos/` (sin subir a git): el simulador de LG abierto en `webos/`
quedaba en negro porque ahí no estaba `app.js`. Si algo falla al arrancar, `index.html` muestra el error en
pantalla en lugar de dejarla negra. No hay pantalla de carga fija (`splashBackground`): la primera pantalla
es el número de distribuidor y el logo de inicio es el del distribuidor (solo el icono y el nombre son fijos).

## Instalarla en tu televisor LG

LG instala apps propias con la app **Developer Mode** (gratis con una cuenta de LG):

1. En el televisor abre **LG Content Store**, instala **Developer Mode** y entra con tu cuenta de LG
   (créala en [webostv.developer.lge.com](https://webostv.developer.lge.com)). Activa **Dev Mode Status** y
   **Key Server**; el televisor se reinicia. La sesión dura 50 h y se renueva con *Extend* (o sola si el
   televisor tiene internet).
2. En tu PC: `npm i -g @webos-tools/cli` y agrega el televisor con `ares-setup-device` (IP del televisor, usuario
   `prisoner`); trae la llave con `ares-novacom --device <nombre> --getkey` (la frase que muestra Developer Mode).
3. Instala: `ares-install --device <nombre> MPXPlayer.ipk` y ábrela desde el menú de apps (o
   `ares-launch --device <nombre> com.mpxplayer.app`).

## Compilar y probar en tu PC

```sh
npm ci
npm run typecheck && npm test
npm run build            # dist/ (con config/panel.key incluye Autodemo, DNS y registro del equipo)
npx @webos-tools/cli ares-package -o out dist   # o: npm run package (con la CLI instalada)
```

`dist/index.html` se abre en Chrome para probar (flechas = cruceta, Enter = OK, Esc = Atrás; en el navegador el
HLS del panel va por MSE).

## Límites conocidos

- Probada en Chromium (con el panel real y un bus de servicios de webOS simulado): distribuidor, inicio de sesión,
  código del equipo con el LGUDID y el control remoto. **No se ha probado todavía en un televisor LG real.**
- Televisores LG de 2018 o más nuevos (webOS 4.0+).
- El tipo «Player» y «Obligar» de la pantalla falsa no aplican (igual que en Roku, Tizen y la web player).
- TV en vivo: si un canal falla se prueba `.m3u8`, `.ts` y la dirección corta sin `/live/`
  (`LIVE_FORMATS` en `src/api/xtream.ts`).
