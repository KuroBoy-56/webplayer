# MPX Player para Hisense Smart TV (VIDAA OS)

**Es la misma app de Vega OS, Tizen OS y webOS** (`src/`, React Native) corriendo en el navegador del televisor
Hisense con [react-native-web](https://necolas.github.io/react-native-web/). Salió de la rama `webOS` (1.4.6): mismo
panel, mismo diseño Netflix y mismas funciones (inicio de sesión con el panel, Verificar activación, Autodemo, perfiles,
control parental, TV en vivo con guía, películas, series, Continuar viendo, Mi lista, Deportes, distribuidores). Solo
cambian las piezas propias del equipo y la forma de publicarla. Un cambio en `src/` de `webOS` / `tizenOS` / `vega-os`
se trae aquí con un `git merge`.

## Cómo es una app de VIDAA

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
