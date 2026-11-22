# MPX Player para Samsung Smart TV (Tizen OS)

**Es la misma app de Vega OS** (`src/`, React Native) corriendo en el navegador del televisor Samsung con
[react-native-web](https://necolas.github.io/react-native-web/). Solo cambian las piezas propias de cada
equipo, que viven en `web/`: el reproductor (AVPlay), el control remoto, el botón Atrás y el
almacenamiento. Mismo panel, mismo diseño Netflix y mismas funciones que la web, Android, Android TV,
Windows, Roku y Vega OS. Un cambio en `src/` de la rama `vega-os` se trae aquí con un `git merge`.

**Descarga:** pestaña **Releases › tizen-latest** de este repositorio (`MPXPlayer.wgt`). GitHub Actions la
compila sola en cada cambio de la rama `tizenOS` (workflow `App Tizen OS (Samsung)`), con la llave del panel
del secreto `PANEL_KEY` (la misma de Vega OS e iOS).

## Novedades de la 1.3.0 (lo mismo que webOS 1.4.0)

- (1.3.9) **Actualizar catálogo (como Roku):** Cuenta › «Actualizar catálogo» (antes «Recargar catálogo») vuelve a bajar películas, series y canales del servidor IPTV sin vaciar lo que se ve: cada lista se cambia al llegar y, si el servidor no contesta una, se conserva la anterior; avisa «Actualizando el catálogo…» y al terminar «Catálogo actualizado» (`reloadCatalog()` en `src/state.ts`). Antes la pantalla quedaba vacía cargando todo de nuevo.
- (1.3.8) **Perfil infantil con la lista de títulos para niños (reglas v3 del panel):** las reglas traen `kids_titles` (unos 700 títulos: Shrek, Toy Story, Paw Patrol, Bob Esponja, Pokémon…): un título así cuenta como de una categoría de niños aunque esté en «Estrenos», sin ganar nunca a las listas de bloqueo ni al «no» de TMDB. Se mira solo sin género o con género de niños, familia o animación (o en una categoría de Disney o familia) y se guarda por nombre (`kidsTitle()` en `src/lib/kids.ts`). La copia de fábrica `src/lib/kidsrules.ts` es la v3 del panel, generada desde `includes/kids_rules.php`.
- (1.3.7) **Logo de la marca en los canales sin logo:** un canal en vivo sin logo, o cuyo logo no carga, muestra el logo de la marca en la lista de canales, la vista previa y el reproductor: el de la app sin distribuidor, el del distribuidor con su número y ninguno si el distribuidor no tiene logo, como la web player y Android (`ChannelLogo` en `src/components/ui.tsx`).
- (1.3.6) **Cerrar sesión no vuelve a entrar solo y botón «Verificar activación» (como Roku):** después de cerrar sesión
  (Cuenta, «Salir» de «¿Quién está viendo?» o el tema de prueba) el inicio de sesión no le pregunta al panel ni entra
  solo; la entrada automática solo pasa al abrir la app. **Verificar activación** pregunta al panel (`check_mac`) si el
  equipo tiene una línea y, si la tiene, entra; si no, avisa que el equipo aún no está activado. Al entrar escribiendo
  usuario y contraseña la app manda `replace: 1` en `submit_url` y el panel deja la MAC solo con el usuario nuevo
  (`signedOutByHand` / `logoutByHand` en `src/state.ts`, `src/screens/Login.tsx`, `panelSubmit` en `src/api/panel.ts`).
  Probado en Chromium contra un panel de prueba (abrir, sin activar, activar, cerrar sesión, otro usuario, volver a abrir).
- (1.3.5) **Avatares redondeados:** el avatar del perfil de la barra, los de «¿Quién está viendo?» y los del editor llevan el
  radio también en la imagen (`borderRadius` en el `Image`): en Vega la caja redondeada con `overflow: hidden` no
  siempre recortaba la imagen de adentro y el avatar se veía cuadrado. El oscurecido de «Administrar perfiles» y la
  etiqueta «Niños» siguen la misma curva.
- (1.3.4) **Foco del menú de arriba que se iba a las filas:** después de bajar por las filas y volver al menú con Atrás,
  izquierda desde «Inicio» bajaba a una carátula (las filas de arriba quedan detrás de la barra, a la misma altura y más
  cerca que el avatar) y para llegar al avatar (Cambiar perfil, Administrar perfiles, Cuenta) había que subir toda la
  página. Ahora izquierda desde «Inicio» va siempre al avatar y derecha desde el avatar a «Inicio» (`Focusable` con
  `nextLeft` / `nextRight`: en Vega el `nextFocusLeft/Right` del foco del sistema, en webOS y Tizen `data-next-*` que lee
  `web/spatial.ts`). En los extremos del menú (sin avatar a la izquierda; la lupa o el usuario a la derecha) el foco se
  queda en el menú en vez de bajar a una carátula escondida.
- (1.3.3) **Fondo de «¿Quién está viendo?» como Netflix en el televisor:** la imagen vuelve a ocupar toda la pantalla
  (en una caja arriba a la derecha quedaba chica y con demasiado color liso). El color del tema entra con un degradado
  suave desde el borde izquierdo (más oscuro en el borde; detrás de los perfiles la imagen se sigue viendo, más oscura)
  hasta el 65 % del ancho, y abajo y arriba solo un sombreado leve. El título y los nombres de los perfiles llevan una
  sombra para leerse siempre. En Vega los degradados usan imágenes blancas con la misma curva suave que la web
  (`assets/image/shade_*.png`, teñidas con el color del tema). Sigue cada 10 s.
- (1.3.2) **Fondo de «¿Quién está viendo?» más chico, con degradado y cada 10 s:** la imagen ya no cubre toda la
  pantalla: va en una caja de 1320×742 (16:9) arriba a la derecha y el color del tema entra suave por su borde izquierdo
  (donde están los perfiles), por abajo y un poco por arriba; la versión y el nombre del destacado quedan sobre el color
  liso. En Vega los degradados no se veían: `Shade` dibujaba la imagen del paquete con la medida de su archivo (4 px de
  alto o de ancho) cuando el estilo no traía alto y ancho; ahora va dentro de una caja con el tamaño pedido (eso también
  arregla el degradado de la barra de arriba en Vega). Cada destacado se ve **10 s** (antes 5).
- (1.3.1) **Fondo de «¿Quién está viendo?» sin bordes rectos y con los destacados de la semana:** la imagen cubre toda la
  pantalla (antes medía 1600×900 pegada arriba a la derecha y en el televisor se veían sus bordes izquierdo e inferior como
  líneas rectas) y el color del tema entra suave desde la izquierda, abajo y arriba (`Shade`). Van pasando **15 a 20
  títulos** del trending semanal de TMDB (películas y series con fondo, sin repetir; la página 2 solo si en la 1 no
  llegan a 15), **5 s cada uno**, con un fundido de 0,7 s que empieza cuando la imagen nueva ya cargó, y después del
  último vuelve el primero (`src/components/BackdropSlides.tsx`, `weekHighlights` en `src/api/tmdb.ts`). El nombre y la
  calificación de abajo a la derecha son los del fondo que se ve. Prueba: `npm test (tools/highlights.test.js)`.
- **Perfiles como Netflix** (con los perfiles encendidos en el panel y una línea de 2 o más conexiones; contrato en
  `docs/PERFILES.md` del panel). Al entrar, **«¿Quién está viendo?»**: perfiles en columna a la izquierda (los 5 entran),
  el título arriba al centro, «Salir» arriba a la izquierda, el logo arriba a la derecha, «Administrar perfiles» debajo
  de los perfiles, de fondo lo más destacado de la semana de TMDB con solo su nombre y su calificación, y la versión
  abajo a la izquierda. El foco empieza en el último perfil usado en el televisor. Todo con el control: el PIN con un
  teclado numérico de la app y el nombre con `KeyboardModal` (nunca un campo del sistema).
  - **PIN de 4 números** (se comprueba en el panel y nunca se guarda en el televisor) y «¿Olvidaste el PIN?» con la
    contraseña de la línea. **Administrar:** nombre, avatar (la lista del panel), bloquear / cambiar / quitar el PIN y
    eliminar (nunca el principal; se recupera 7 días con el mismo nombre exacto). «Agregar perfil» solo si la línea
    admite más.
  - **Cada perfil con lo suyo:** `profile` en cada llamada a `progress.php` (`cloud()` en `src/api/panel.ts`);
    Continuar viendo y Mi lista se leen otra vez al cambiar. Si el perfil ya no existe (eliminado en otro equipo) el
    panel contesta 410 y la app vuelve a «¿Quién está viendo?».
  - **Perfil infantil** (solo al crear): solo contenido para niños y de Disney en Inicio, Películas, Series, búsqueda,
    Top 10 y actores; TV en vivo solo con las categorías de niños (si no hay, desaparece) y sin Deportes. Lo que no pasa
    el filtro no se abre aunque llegue por otro camino. Las listas las manda el panel (`kidsRules`, con una copia de
    fábrica en `src/lib/kidsrules.ts`) y lo dudoso se ve solo con el visto bueno de TMDB (`api/kids_rate.php`, en
    segundo plano: `src/data/kidsrate.ts`). El catálogo guardado es siempre el completo; el filtro es una vista aparte
    (`catalog.kidsOn`), así el principal nunca ve el catálogo recortado.
  - **Barra con perfiles:** el avatar del perfil a la izquierda («Cambiar perfil», «Administrar perfiles», «Cuenta»), el
    menú al centro y el logo a la derecha. Con los perfiles apagados, una conexión o una DEMO, la app es la de siempre.
- **Barra de arriba sin franja negra** (solo con los perfiles encendidos por el dueño en el panel): en Inicio, Series y
  Películas el menú va encima del destacado solo con un degradado suave detrás de las letras (como Android TV) y **se
  esconde al bajar** a las filas (sube y se desvanece); vuelve al subir o con Atrás.
- **Todo lo nuevo solo con los perfiles encendidos:** apagados (o una línea DEMO), la app, la barra (con su franja) y
  el inicio de sesión son los de siempre. Si la última vez estaban apagados, después de iniciar sesión la app entra a
  Inicio enseguida (sin esperar al panel) y lo que conteste el panel vale para el próximo inicio: si el dueño los
  enciende, se ven desde la próxima vez que se abra la app, nunca con un salto en pleno uso (`pf_on|<línea>`).
- **Inicio de sesión de a una DNS** (regla de `docs/LOGIN-SERVIDORES.md` del panel, para que XUI no bloquee la IP):
  primero la DNS con la que ese usuario entró la última vez en el televisor, después de a una y parando en la primera
  que acepta, una vez por servidor, https solo si en http no contestó nadie, y pasados 20 s lo que falta a la vez. Si
  no contesta ninguna, se avisa al panel (Errores de las apps). Antes probaba todas las DNS, en http y https, a la vez.
- Pruebas: `tools/profiles.test.js` (filtro infantil con los ejemplos del panel e inicio de sesión de a una DNS) y la
  app compilada en Chromium contra un panel de prueba (pantalla, agregar con el teclado de la app, perfil infantil,
  `profile` en `progress.php`, PIN equivocado y correcto, Mi lista por perfil, perfil eliminado en otro equipo,
  perfiles apagados). Probado en Chromium con la versión de webOS (el mismo código); falta verlo en un televisor Samsung.

## Novedades de la 1.2.8

- **La lupa de las plataformas abre el teclado de la app** («Ver todo» de Netflix, Disney+, etc.), como Buscar e Iniciar sesión. Era el último lugar con el campo de texto del televisor Samsung: el teclado del sistema se quedaba con las flechas y, al volver a la lupa con el control, podía abrirse solo (el mismo error que se vio en Android TV). Ahora: OK en la lupa abre el teclado de la app, las carátulas se filtran mientras se escribe y, al cerrarlo con Listo o con Atrás, el foco baja a la primera; lo escrito queda junto a la lupa (✕ lo borra). `Grid.tsx` (`KeyboardModal`, `focusFirst`). Probado en Chromium con la pantalla real y el control simulado: ningún campo del sistema en todo el recorrido. Falta verlo en un televisor Samsung.

## Novedades de la 1.2.7

- **TV en vivo como Roku y Vega OS: la pantalla grande hereda la miniatura y al salir vuelve a ella, sin cortes.** OK en un canal lo pone en la miniatura; OK otra vez lo abre en pantalla grande con **el mismo reproductor** (AVPlay no se detiene ni se vuelve a abrir: solo cambia el rectángulo donde se ve, también si la miniatura todavía conectaba). Al salir con Atrás, ese mismo reproductor vuelve a la miniatura del canal que sonaba (también si se cambió con ▲▼ o con la lista de la carpeta ◀ dentro de la pantalla grande) y el foco queda en ese canal. Antes la miniatura se cerraba al abrir la pantalla grande y el canal se volvía a conectar dos veces (al entrar y al salir).
- Cómo: `src/player/preview-session.ts` (`handPreview` / `offerPreview` / `takePreview` al agrandar, `offerReturn` / `takeReturn` / `dropReturn` al volver, `markLiveOrigin` / `takeLiveOrigin`), `LivePreview.tsx` (entrega y recibe el reproductor), `Player.tsx` (lo hereda, `setHooks`, y al cerrarse lo devuelve; Atrás ya no lo pausa), `Live.tsx` (lo mismo que webOS 1.3.18). En `web/shims/w3cmedia.tsx`: AVPlay tiene un dueño (el último `VideoPlayer` que lo abrió); uno viejo que se cierra después no lo detiene, no lo pausa ni vuelve a tapar la pantalla transparente del dueño; `clearSurfaceHandle` solo actúa en su propia superficie y la capa de subtítulos pasa a la superficie nueva. En el navegador (`<video>`), `park()` deja el video en la página mientras cambia de superficie, como en webOS.
- Arreglo de la miniatura: ahora avisa al reproductor que ya suena (`onPlaying`); antes, a los 12 s, el respaldo del lector de la app reabría un canal que el televisor ya estaba mostrando.
- Probado: las pantallas reales (TV en vivo + reproductor) en Chromium contra un servidor IPTV de prueba (un solo reproductor en todo el recorrido, sin pausas ni recargas), `tools/preview.test.js` y `tools/avplay-handoff.test.js` (AVPlay simulado: el traspaso no llama a `stop` / `close` / `open`). Falta verlo en un televisor Samsung.

## Novedades de la 1.2.6

- **Número del equipo que no cambia al reinstalar**: el número («MAC») que queda registrado en el panel sale del **DUID** de Samsung (`webapis.productinfo.getDuid()`, el «Unique ID» de Soporte › Acerca del televisor; permiso `productinfo` en `config.xml`), que no lo guarda la app: es el mismo aunque se desinstale y se vuelva a instalar. Cambios de esta versión (`src/lib/deviceid.ts`):
  - Si el televisor no daba su identificador en la primera apertura, la app creaba un número al azar y **lo dejaba para siempre** (cambiaba al reinstalar y el cliente creía que le habían borrado la cuenta). Ahora ese número queda marcado y, en cuanto el televisor da el suyo (y todavía no se inició sesión), se cambia por el fijo. De respaldo, la app manda al panel una segunda clave (el Tizen ID del sistema, `tvAltKey`) por si el DUID no está disponible.
  - **Con el panel** (`api/login.php` acción `device_id`, `includes/device_alias.php`): el identificador del televisor es su «clave fija». La app ya instalada la deja anotada junto al número que usa (también si es uno al azar de una versión anterior) y una instalación nueva pregunta con esa clave y recibe el número con el que el televisor ya estaba registrado: entra con su línea sin escribir usuario y contraseña. Una consulta por clave, distribuidor y número (como mucho 4 s antes del primer `check_mac`); con un panel sin la función todo sigue como antes.
  - El número ya guardado nunca se cambia por otro: el panel lo tiene registrado. Prueba: `node --test tools/test-deviceid.cjs`.

## Novedades de la 1.2.5

- **Índice compartido (más rápido):** en películas y capítulos MP4 con el índice (moov) al final, el lector de la app (cambio de audio y subtítulos, `mp4mse.ts`) y la lectura de los idiomas (`probe.ts`) usan el índice que otro equipo (Vega, Roku, Android, la web) dejó en la VPS / VDS de la línea (`api/vidx.php` del panel, `sharedindex.ts`): al servidor IPTV no se le piden los 3-10 MB del final del archivo. Si no lo tiene, el que lee la app se le deja para los demás. Un índice de otro archivo (otro tamaño) se descarta. El reproductor del televisor lee el archivo él mismo (eso no cambia); sin VPS / VDS todo sigue igual.

## Novedades de la 1.2.4

- **Plataformas**: el logo de cada plataforma se ve con las esquinas redondas y el borde de selección queda encima del logo (antes el logo, de tamaño fijo, tapaba el borde y se veía cuadrado; `Tiles.tsx`).

## Novedades de la 1.2.3

- **Control parental como Roku** (Cuenta): «Canales y categorías para adultos» (Ocultos / Visibles; mostrarlos pide el PIN), «Bloquear categorías» (con el PIN, una lista por Películas, Series y TV en vivo: OK bloquea o desbloquea; las bloqueadas se ocultan y piden el PIN, `CategoryLock.tsx`, `blocked_cats`) y «Contenido protegido en esta sesión» (Bloqueado / Desbloqueado: con el PIN se ve todo hasta cerrar la app). Mostrar adultos ya no desbloquea todo de paso. El PIN es el del panel (0000 de fábrica), también con distribuidor.

## Novedades de la 1.2.2

- **Control parental:** el diálogo del PIN de control parental (Cuenta › «Ocultar contenido para adultos» y categorías bloqueadas de TV en vivo) se cierra después de la tecla OK / Aceptar, no dentro de ella. En Roku cerrarlo dentro de la tecla del teclado numérico sacaba de la app con el PIN correcto; aquí es preventivo (`PinDialog.tsx`). El PIN sigue siendo el del panel (0000 de fábrica), también con distribuidor.

## Novedades de la 1.2.1

Con número de distribuidor la app sacaba al cliente a los ~10 minutos y pedía otra vez usuario y contraseña (el panel no
devolvía la línea de un cliente que su distribuidor había quitado de Clientes aunque volviera a iniciar sesión; arreglado
en el panel, que hay que actualizar). En la app: la sesión abierta solo se cierra cuando el panel **deja de dar** una
línea que antes dio para este televisor, o lo bloquea (`lineLost`, `src/api/panel.ts`), y el rechazo del número de
distribuidor se confirma con una segunda consulta antes de borrar el número y la sesión (`runCheck`, `src/state.ts`).
El identificador del televisor (DUID de Samsung) es el mismo siempre, también al reinstalar la app.

## Novedades de la 1.2.0 (webOS 1.3.1 a 1.3.7, Vega OS 1.0.56 a 1.0.60 y los arreglos de interfaz de Vega hasta la 2.0.11)

- **Todo lo de webOS hasta la 1.3.7** (merge de la rama `webOS`): TV en vivo como Vega y Roku (OK miniatura y punto
  rojo, OK otra vez pantalla grande, el foco vuelve al canal que sonaba), canales con audio MP2 / MP3 / AC-3, imagen
  trabada que salta al cuadro clave siguiente, Deportes igual a Roku (filtro de canales por los canales que pasan el
  partido, por las reglas del panel y por los equipos; Tablas, Selecciones y Equipos; el foco vuelve al evento al
  cerrar el canal), descripción de la portada que sube sola, ficha que vuelve arriba, MKV con extensión .mp4.
- **AVPlay sigue siendo el reproductor** (`web/shims/w3cmedia.tsx`): abre MP4, MKV, TS y HLS por hardware, con los
  idiomas y subtítulos del archivo (`tvSelectTrack`). Ahora anuncia `nativeLive`: los canales también los abre el
  televisor; los caminos del lector de canales de LG no se usan en Samsung (`noMse`).
- **Último recurso, en este orden**: el televisor (AVPlay) → el servidor convierte solo el audio → el video copiado
  como HLS → el video convertido. Con la conversión del servidor apagada (`features.ffmpeg` / motor sin permiso): «Audio
  no compatible con este equipo», «Subtítulo no compatible…» o «Contenido no compatible con este equipo» (sin pedir
  encender el servidor); el detalle completo va en el reporte al panel.
- **Buscar como Vega**: el recuadro abre el teclado de la app (texto centrado), los resultados se arman mientras se
  escribe (primero los títulos que empiezan por lo buscado), al cerrar el teclado (Listo o Atrás) el foco baja a la
  primera carátula y al volver de una ficha o de un canal el foco vuelve a la carátula elegida (`ItemGrid`,
  `src/screens/Grid.tsx`; también en «Ver todo»).
- **El foco vuelve a donde estaba** al cerrar una pantalla (`web/spatial.ts` recuerda lo último con foco), en
  Inicio, Películas, Series, TV en vivo, Deportes, Buscar y «Ver todo». La portada de Inicio, Películas y Series queda
  fija: solo se mueven las filas de abajo.
- **Carátulas**: se recuerda qué dirección cargó cada imagen (`src/lib/imagememory.ts`), la ficha sin fondo lo busca
  en TMDB por el título, y Continuar viendo / Mi lista no redibujan todas las filas mientras suena un video.

## Novedades de la 1.1.0 (traídas de Vega OS 1.0.25 a 1.0.55 por la rama `webOS`, más lo propio de Samsung)

**Reproducción: el servidor es el último recurso.** Todo lo abre primero **AVPlay** (el reproductor por hardware del
televisor: MP4, MKV, AVI, MOV, TS y HLS; Dolby y DTS los decodifica la tele). Para cambiar de idioma o de subtítulo,
en este orden y solo si el paso anterior no puede:

1. **Las pistas de AVPlay** (`audioTracks` / `textTracks` del adaptador, con `setSelectTrack`): el cambio se comprueba
   a los 1,5 s.
2. **`tvSelectTrack`** (`web/shims/w3cmedia.tsx`): la pista *n* del archivo (el orden de la cabecera que lee la app) se
   busca en `getTotalTrackInfo()` y se elige con `setSelectTrack('AUDIO' | 'TEXT', índice de AVPlay)`; los subtítulos
   se encienden con `setSilentSubtitle(false)` y se apagan con `tvSubtitleOff`. AVPlay también dibuja los de imagen (PGS).
3. **El servidor** (VPS / VDS, `media_tizen.php`); si está apagado o sin permiso: «Audio no compatible con este
   equipo: es necesario encender el servidor.» (y lo mismo para subtítulos y video), con el reporte al panel.

A diferencia de LG, aquí no hay paso del lector propio de la app (`mp4mse.ts` / `mkvmse.ts`): AVPlay no recibe un
MediaSource, así que el adaptador anuncia `noMse` y `playback.ts` lo salta (`readerCan()`).

Cómo se decide (sin `if` de plataforma en `src/`): el adaptador de AVPlay anuncia `nativeFiles`, `nativeHls` y `noMse`;
`src/player/playback.ts` con `nativeFiles` no usa los lectores de Vega para abrir (`tvNative()`), deja los canales a
AVPlay (no `livehls.ts`) y sigue la cadena de arriba (`tvAudio`, `tvSub`). En Vega esos campos no existen y todo sigue
igual que allá. Pruebas: `npm run test:player` (casos «Samsung:») y `tools/avplay.test.js` (el adaptador con un AVPlay
simulado: la pista 2 del archivo es el índice correcto de AVPlay).

**Más de Vega (1.0.25 a 1.0.55):**
- **Controles del reproductor**: sin botones de adelantar, atrasar ni pausa en pantalla (◀ ▶ y OK del control siguen
  funcionando); en series solo capítulo anterior |◀ y siguiente ▶| (▲ los elige). Sin el botón «Audio» de arriba:
  ▼ o TOOLS abren idiomas y subtítulos.
- **Top 10 de la semana** (`api/top10.php`: lo más popular de la semana en TMDB cruzado con el catálogo; lo que falte,
  de lo mejor calificado, distinto cada semana).
- **Lista negra del panel**: un televisor bloqueado ve «Este equipo está bloqueado…», no entra ni vincula cuenta y la
  sesión abierta se cierra.
- **Interruptor de la conversión de audio del distribuidor** (`features.ffmpeg`): apagado, solo el audio que reproduce
  la tele.
- **Deportes nuevo**: agenda con canales del cliente, Tablas, Equipos y Selecciones (`SportsTables.tsx`,
  `SportsTeams.tsx`); carátulas por la caché del panel (`img.php` / `imgc`), vista previa del canal en TV en vivo,
  Cuenta nueva, teclado de la app, idiomas de cada video recordados por el panel (`tracks.php`).
- Avisos claros cuando hace falta el servidor; filas de Inicio sin animación; el foco crece al instante y el círculo de
  carga gira con CSS (`src/components/ui.tsx`, `Platform.OS === 'web'`); reportes de error con la versión real
  (`src/version.ts`).
- Lo que es solo de Vega queda fuera: **Shaka** (`tools/build-tizen.js` pone `web/shims/shaka.ts`: AVPlay abre HLS /
  DASH solo), el lector de canales (`livehls.ts`), los lectores MP4 / MKV y el pedido adelantado del video
  (`prefetch.ts`: en la tele sería una conexión de más).
- **Tema de prueba del dueño** (estilo IBO Player, con Omitir, cuando el panel lo ofrece): ya estaba desde la 1.0.2; el
  panel lo da para `tizen` (`includes/review_theme.php`).
- Se queda lo de Samsung: `APP_ID` `tizen`, `media_tizen.php`, id del televisor (DUID, `src/lib/platform.ts`), teclas
  registradas con `tizen.tvinputdevice`, Atrás 10009, `tizen/config.xml` y la firma `.wgt`.

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
- **Último recurso para un video que no abre (1.0.3, como webOS / Vega / Roku):** si la copia del panel (video sin
  cambios) tampoco abre, se pide por http cuando el certificado de la VPS / VDS falló y después con el video convertido
  a H.264 (`&v=1`, solo en la VPS / VDS con el interruptor del dueño o del distribuidor); si tampoco, el error.
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
  resolución ni de bitrate (4K si el televisor y el archivo lo tienen): continuar donde quedó, ◀▶ del control 10 s, OK pausa,
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
| `@amazon-devices/react-native-w3cmedia` (`VideoPlayer`) | `web/shims/w3cmedia.tsx`: el mismo `VideoPlayer` sobre **AVPlay** (`webapis.avplay`): anuncia `nativeFiles` / `nativeHls` / `noMse`, pistas de audio y subtítulos del archivo (`getTotalTrackInfo` / `setSelectTrack`, también `tvSelectTrack` / `tvSubtitleOff`), subtítulos dibujados encima, `suspend`/`restore` al pasar a segundo plano y la página transparente sobre el video. En un navegador usa `<video>` |
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
npm run typecheck && npm test && npm run test:player && npm run test:interface
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
