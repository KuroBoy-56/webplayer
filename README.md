# MPX Player para Hisense Smart TV (VIDAA OS)

**Es la misma app de Vega OS, Tizen OS y webOS** (`src/`, React Native) corriendo en el navegador del televisor
Hisense con [react-native-web](https://necolas.github.io/react-native-web/). Salió de la rama `webOS` (1.4.6): mismo
panel, mismo diseño Netflix y mismas funciones (inicio de sesión con el panel, Verificar activación, Autodemo, perfiles,
control parental, TV en vivo con guía, películas, series, Continuar viendo, Mi lista, Deportes, distribuidores). Solo
cambian las piezas propias del equipo y la forma de publicarla. Un cambio en `src/` de `webOS` / `tizenOS` / `vega-os`
se trae aquí con un `git merge`.

## Cómo es una app de VIDAA

- (1.1.4) **Géneros de Películas con su fondo:** con el foco en un género cuyo destacado todavía no tiene imagen horizontal se queda el último fondo (y su carátula a la derecha) hasta que llega la de TMDB; antes se estiraba su carátula de fondo y en Películas se veía borrosa.
- (1.1.3) **La tarjeta del partido abre el menú de canales y un buscador de canales más preciso:** en Inicio, al presionar una tarjeta de «En vivo ahora» se abre el **mismo menú que en Deportes** (el canal automático, los canales que lo transmiten, los de la guía, el de los equipos, buscar canales por equipo y escribir otro nombre; `src/components/LiveMenu.tsx`); antes abría solo la primera coincidencia. La **píldora roja del minuto** queda en una línea y nunca se sale. **Buscador de canales** (`src/data/sports.ts`, ideas de los emparejadores de IPTV como Stream-Mapparr): «+» es «plus» («ESPN+» ya no da «ESPN»; «Movistar+ LaLiga» encuentra «Movistar LaLiga»), números en palabra como cifra, más etiquetas que no cuentan (HDR, FD, 2160p, 1080i, Full HD, East/West, ENG, RAW) y, como último recurso, el parecido de Levenshtein entre las palabras ordenadas («TyC Sport» = «TyC Sports») solo con los mismos números y más estricto con los nombres cortos. Pruebas: `tools/channels.test.js`.
- (1.1.2) **Deporte favorito, géneros con dibujo y plataformas sin parpadeo:** **Cuenta › Deporte favorito** (solo con perfiles): «Todos los deportes» o una de las disciplinas que da el panel; «En vivo ahora» de Inicio solo con esa (por línea y perfil). **Agregar equipo** con todas las disciplinas, ordenadas. En **Películas** y **Series** las tarjetas de **Géneros** llevan un dibujo de líneas del género (`assets/image/genre_*.png`), el nombre abajo a la izquierda y el **póster del título más destacado** del género (Top de la semana de TMDB o el mejor calificado), que va de fondo con el foco. Con perfiles y partidos en vivo del panel, **las tarjetas de plataformas ya no aparecen al entrar para irse después** (hasta que el panel contesta vale lo de la última vez). Eventos de Deportes un poco translúcidos. Explorar guarda las fichas ya armadas (la lupa abre al momento). `src/version.ts` vuelve a decir la versión real .
- (1.1.1) **Peleas y carreras siempre con su póster:** combate, boxeo, lucha (WWE), motor, golf, ciclismo y atletismo van siempre como evento en «En vivo ahora» (la disciplina, el nombre y su póster, sin marcador), también cuando TheSportsDB pone a los dos boxeadores como local y visitante.
- (1.1.0) **Carga al elegir el perfil, Explorar con Categorías, «En vivo ahora» después del Top 10 y eventos sin equipos:** al elegir el perfil el avatar queda al centro con el circulito **al menos 5 s** (si el catálogo todavía carga, hasta que termine, como mucho 15 s) mientras se preparan «En vivo ahora» (apenas hay canales) y Explorar; al entrar, Inicio y la lupa salen al momento. **Explorar:** el orden de cada combinación queda en memoria hasta que cambie el catálogo; «Agregados recientemente» pasa a ser **«Categorías»**, que despliega las carpetas del servidor IPTV (con «Todo», las de películas y las de series) y la cuadrícula muestra esa carpeta, como el selector de Películas / Series del web player (sin géneros ni plataformas mientras hay una elegida). **Inicio:** «En vivo ahora» va **después del Top 10**; las plataformas, si se habilitan en Cuenta, vuelven a su lugar de siempre (antes del Top 10). **Eventos sin equipos** (peleas, boxeo, WWE, carreras): la tarjeta muestra la disciplina y el nombre del evento, con su póster en pequeño si lo tiene, sin escudos ni marcador; con el foco el póster va en grande de fondo (sin póster, el estadio solo, sin «VS»).
- (1.0.9) **Explorar, Equipos favoritos, campanita y mejor canal para cada partido:** con perfiles la lupa abre **Explorar**, igual que `browse.php` del web player en horizontal (título y subtítulo sobre el degradado, Todo / Películas / Series, Agregados recientemente / A - Z / Mejor valorados, «Filtrar por título…», total, chips de géneros y de plataformas y la grilla); al abrirla el foco entra en «Filtrar por título…», de vuelta de una ficha queda en la carátula que se abrió y Atrás lo devuelve a la lupa de la barra. **Cuenta › Equipos favoritos** (solo con perfiles, no infantil): la lista (OK quita uno) y «+ Agregar equipo» (deporte → liga o selecciones → equipo, de `api/sports_fixtures.php` y la tabla), guardados en la nube con `api/alerts.php` `set_teams`; avisa que las notificaciones solo las da la app del celular (Android o iOS). **Campanita** en la barra junto a la lupa: al entrar, si hoy juega un equipo favorito o un partido marcado, baja un mensajito 7 s («¡En vivo! Real Madrid 1-0 Barcelona», «Hoy 20:00: …», «Final: …»), punto rojo mientras haya avisos y con OK la lista de hoy (se vuelve a mirar cada 10 min). Deportes: «ESPN» encuentra «ESPN 1» y, sin canal de transmisión, el partido usa los canales que **suelen transmitir** a su local o su liga (`tvh` del panel, «suele transmitirlo»), nunca en «En vivo ahora».
- (1.0.8) **Fondo al enfocar un partido:** con el foco en un partido de «En vivo ahora» la portada muestra la imagen del evento (TheSportsDB) y, si no la hay, el estadio sin personas con los dos escudos grandes y «VS» (antes la cancha dibujada): nunca queda en negro ni con el último póster de una película.
- (1.0.7) **Marcador siempre en una línea:** en la lista de Deportes y en «En vivo ahora» el marcador («2 - 1», «102 - 98») queda siempre entero entre los dos equipos, nunca un número encima del otro; si no cabe, se acortan los nombres de los equipos.
- (1.0.6) **20 partidos, Finalizados y recordatorio con tiempo (solo con perfiles):** «En vivo ahora» trae hasta **20** partidos, primero los que se juegan y después los **próximos** de las 24 h siguientes con su hora (`api/sports_live.php?next=1`), y al final la tarjeta **Ir a Deportes** (estadio con el color de la app; abre Deportes). Un partido que termina sale de la fila. En Deportes, junto a Hoy / Mañana, la pestaña **Finalizados** con los eventos de hoy ya terminados (el último primero; se vacía a las 00:00 de la zona del panel) y **Hoy** queda con los que se juegan y los que no empiezan. «Recordarme este partido» solo se activa si faltan **más de 5 minutos** (si no, lo explica; el panel también responde 409 `too_late`).
- (1.0.5) **Deportes con perfiles (todo solo con los perfiles activos):** fila **«En vivo ahora»** en Inicio (en el lugar de las plataformas) con los partidos que se juegan y los que empiezan en 5 minutos o menos (`api/sports_live.php?soon=1`), y con equipos favoritos (los que se eligen en el celular o la computadora) todos los de hoy de esos equipos; cada tarjeta con la cancha del deporte, escudos, marcador, minuto y el canal exacto del cliente (OK lo abre). Con el foco en un partido la portada muestra su imagen o la cancha con los dos escudos lado a lado (sin nada de eso, el último fondo). **Recordatorio en la nube:** en Deportes, al elegir un partido, «🔔 Recordarme este partido» (también para los de otro día) lo guarda en el panel (`api/alerts.php`, por línea y perfil) y avisa que hay que tener la app de la marca (la del distribuidor o la del dueño) en el celular, que es la que notifica. **Cuenta › Habilitar tarjetas de plataformas** (si el distribuidor las tiene): vuelven debajo de «En vivo ahora». **Fondo de Deportes:** estadio de noche en 4K sin personas (`assets/image/sports_bg.jpg`) bajo el color de la app. Código: `src/data/liveTv.ts`, `src/components/LiveTile.tsx`.
- (1.0.4) **Elegir perfil:** al elegir un perfil su avatar va al centro de la pantalla con el nombre y el circulito girando, y recién entonces se arma lo de ese perfil (en el infantil, el filtro del catálogo, lo que más tarda): la pantalla ya no queda trabada un par de segundos (`src/components/ProfileEnter.tsx`, `src/screens/Profiles.tsx`).

VIDAA OS (Linux de Hisense) no instala paquetes como LG (`.ipk`) o Samsung (`.wgt`): sus apps son **páginas web que el
televisor abre desde una dirección**, en su propio navegador y a pantalla completa. Por eso esta app se publica como
una carpeta de archivos (`index.html`, `app.js`, imágenes) en un servidor web, y el televisor la abre desde ahí.

Lo propio de VIDAA (todo en `web/` y `src/lib/`):

| Pieza | Archivo | Qué hace |
|---|---|---|
| Datos del televisor | `src/lib/platform.ts` | `Hisense_GetDeviceID` (id fijo del equipo, de ahí sale la MAC del panel), `Hisense_GetModelName`, `Hisense_GetOSVersion` |
| Control remoto | `web/remote.ts` | Flechas, OK, Atrás (8, 461 o 10009 según el modelo), canal +/- (427/428), rojo y verde = audio y subtítulos |
| Salir | `web/back.ts` | `Hisense_Exit()` (en VIDAA `window.close()` no siempre hace nada) |
| Reproductor | `web/shims/w3cmedia.tsx` | El `<video>` del televisor abre todo primero (HLS, MP4, MKV); el motor de audio del panel (`api/media_vidaa.php`) para lo que no decodifica |
| Datos del servidor IPTV | `src/lib/http.ts` | Ver «CORS» abajo |
| Pantalla | `src/theme.ts` | La interfaz se escala sola: algunos VIDAA dan una página de 1280x720 y otros de 1920x1080 |

Fuera de un televisor (un navegador de computadora) la app funciona igual para probar, con los lectores de video de la
app como en el simulador de LG.

### CORS: por qué la app va dentro del panel

Al ser una página, el navegador del televisor no deja leer las respuestas de otros servidores que no lo permiten
(CORS). Por eso:

- **El panel**: la app se sube a la carpeta `vidaa/` del mismo panel (junto a `api/`) y le pide al panel en la misma
  dirección que la página. Así `login.php`, `progress.php`, perfiles, guía, deportes, etc. funcionan sin cambiar nada.
- **El servidor IPTV** (`player_api.php`: cuenta, categorías, listas, guía corta): la app lo pide primero directo y, si
  el navegador no lo deja, por **`api/xtream_relay.php`** del panel. El relevo solo pasa `player_api.php` de servidores
  que están en **Servidores DNS** del panel (nunca otra dirección) y **nunca video ni audio**.
- **El video** lo abre el `<video>` del televisor directo desde el servidor IPTV (el navegador no le pide CORS al
  video). No pasa por el panel ni por ningún hosting.

## Descarga

Pestaña **Releases › vidaa-latest** de este repositorio: `MPXPlayer-VIDAA.zip`. GitHub Actions la compila sola en cada
cambio de la rama `vidaaOS` (workflow `App VIDAA (Hisense)`), con la llave del panel del secreto `PANEL_KEY` (la misma
de webOS, Tizen, Vega OS e iOS; ver `config/README.md`).

## Publicarla (una vez por versión)

1. Descomprime `MPXPlayer-VIDAA.zip` en una carpeta **`vidaa/` dentro del panel**, al lado de `api/`
   (por ejemplo `public_html/vidaa/` si el panel está en `public_html/`). Quedan `vidaa/index.html`, `vidaa/app.js`,
   `vidaa/img/`, `vidaa/instalar.html`, los iconos y `vidaa/.htaccess` (hace que el televisor tome la versión nueva
   apenas se sube).
2. En el panel deben estar `api/xtream_relay.php` y `api/media_vidaa.php` (vienen con el panel).
3. Prueba en una computadora: `http://TU-PANEL/vidaa/` debe mostrar el inicio de sesión de MPX Player.
4. Distribuidores: VIDAA es una app más del panel. Un distribuidor que ya existía la recibe **apagada**; el dueño la
   enciende en **Distribuidores** (y su motor de audio, si corresponde). Sin ella el distribuidor recibe
   «Error: código no vinculado a esta app».

**Usa `http://`** para abrir la app en el televisor (no `https://`): casi todos los servidores IPTV dan el video por
`http`, y una página `https` no puede abrir video `http`. Si el hosting obliga a `https`, usa un subdominio sin esa
regla para la carpeta `vidaa/`.

## Instalarla en el televisor

VIDAA no tiene una tienda abierta: la **VIDAA Store** oficial solo recibe apps de socios de Hisense (portal de
desarrolladores con acceso). Mientras tanto, hay tres formas:

1. **Navegador (todos los modelos):** abre el navegador del televisor, entra a `http://TU-PANEL/vidaa/` y guárdala en
   favoritos. Se abre desde ahí.
2. **Como app en el inicio (modelos que lo permiten):** el televisor solo deja instalar una app desde páginas de su
   confianza. La comunidad lo hace cambiando el DNS del televisor para que una de esas páginas responda desde una
   computadora de la casa, con una página que llama a `Hisense_installApp(...)`. `instalar.html` es esa página: cópiala
   en esa computadora y pon `APP_URL = 'http://TU-PANEL/vidaa/'` al principio de su script (los iconos se toman de
   ahí), o ábrela directo desde el panel (`http://TU-PANEL/vidaa/instalar.html`) en los modelos que permiten instalar
   desde cualquier página. Pasos y herramientas de la comunidad: [vidaa-appstore](https://github.com/trialuser/vidaa-appstore),
   [hisense_vidaa](https://github.com/ztomer/hisense_vidaa). Depende del modelo y del firmware de VIDAA.
3. **VIDAA Store oficial:** pedir el alta como socio a Hisense (VIDAA Partner) y subir la dirección de la app.

## Limitaciones conocidas

- **No se probó en un televisor Hisense real**: se probó en Chromium contra un panel de prueba con las funciones
  `Hisense_*` simuladas (inicio de sesión, activación, catálogo por el relevo, Atrás, Salir, 1920x1080 y 1280x720).
  Qué formatos abre el `<video>` de cada modelo (MKV, audio AC-3 / E-AC-3, DTS) depende del televisor; lo que no
  abre lo prepara el motor del panel si el dueño lo tiene encendido.
- **La llave del panel queda en `app.js`**, que cualquiera puede descargar desde `http://TU-PANEL/vidaa/app.js` (en
  las otras apps también va dentro del paquete, pero aquí es una dirección pública).
- **Servidores IPTV que bloquean la IP del hosting**: si el servidor no da permiso CORS y además bloquea al hosting del
  panel, el relevo no llega y la app no puede leer sus listas (el video no tiene ese problema).
- El relevo pasa por el hosting del panel solo los datos de `player_api.php` (las listas de un proveedor grande pueden
  pesar varios MB cada vez que se abre la app); nunca el video.
- `Hisense_GetDeviceID` no existe en el navegador común de algunos modelos: ahí la app usa un número al azar guardado,
  como las demás apps cuando el equipo no da su id (el panel lo reconoce igual mientras no se borren los datos).

## Desarrollo

```bash
npm ci
npm run typecheck      # TypeScript
npm test               # pruebas (incluye tools/relay.test.js: panel en la misma dirección y relevo de player_api.php)
npm run build          # dist/ (la carpeta que se sube a vidaa/ del panel)
node tools/test-player.cjs && node tools/test-interface.cjs && node tools/test-deviceid.cjs
```

Para probar en la computadora sirve cualquier servidor web sobre `dist/` (por ejemplo
`python3 -m http.server -d dist 8080`); el panel y el relevo funcionan cuando la carpeta está dentro del panel.

El historial de cambios de la base (1.3.x y 1.4.x) está en el README de la rama `webOS`.
