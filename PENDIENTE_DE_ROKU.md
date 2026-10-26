# Pendiente en Vega: lo que se corrigió en Roku

Vega queda en pausa hasta que Roku funcione bien. Esta lista dice qué se cambió en Roku (rama `main` del repo
`roku`) y qué falta copiar a Vega. Al terminar cada punto, márcalo y súbelo a `vega-os`.

## Ya está en Vega

- [x] Carátulas de TMDB solo del mismo título (lo hace el panel, `api/img.php`).
- [x] Nombre exacto de la copia pública del panel (`canonKey` en `src/lib/images.ts`) y una carátula por título con
      el id de TMDB del servidor (`Item.tm`, `&t=`).
- [x] Plataformas sin títulos repetidos.
- [ ] **Continuar viendo por pasos (Roku build 56)**: lo que tiene Vega hoy (`resumeFallback`: desde el principio y
      saltar) es lo que en Roku quedaba en bucle («Cargando…», «Reconectando…»): en algunos videos o líneas el servidor
      no deja saltar. Cambiar a: 1) directo en el segundo guardado; 2) si no suena (error o 15 s), 4 s después el motor
      del panel lo prepara desde ese segundo (`toRemux` con el audio del idioma preferido, `hlsLink(..., t)`), si el
      distribuidor lo permite; 3) si tampoco, desde el principio con el aviso «No se pudo continuar donde quedó: el
      video empieza desde el principio.» Nunca volver a intentar el salto. (Roku: `resumeNextStage`, `onResumeWait`,
      `resumeFromStart`, `resumeAudio` en `components/views/PlayerView.brs`.)
- [x] La lectura de idiomas se corta a los 6 s (`stopProbe`).
- [x] Barra de arriba del reproductor: un solo título y se va sola (Roku la tenía pegada; Vega ya estaba bien).

## Falta en Vega (Roku build 54)

Problema en Roku: en líneas de una sola conexión, Continuar viendo y Plataformas se quedaban cargando y había que
reiniciar el contenido; al reiniciar sí sonaba porque los idiomas ya estaban guardados y no se volvía a tocar el
servidor IPTV. El servidor seguía contando la lectura de idiomas cuando se abría el video.

- [ ] **Lectura de idiomas con `Connection: close`** (`src/lib/probe.ts`, `fetchRange`): que la conexión no quede
      abierta al terminar. (Roku: `source/Probe.brs`, `prbFetch`.)
- [ ] **Saber si la lectura tocó el servidor IPTV**: `Probe` con `requests` (0 si salió del panel `tracks.php` o
      de lo ya leído). (Roku: `r.requests`.)
- [ ] **Abrir el video tras una pausa corta** (`load` en `src/player/playback.ts`): 1,5 s después si la lectura tocó el
      servidor; 2 s después si se cortó a los 6 s; al instante si los idiomas salieron del panel. (Roku:
      `openAfter` en `components/views/PlayerView.brs`, `onProbeEarly` en `PlayerTracks.brs`.)
- [ ] **Vigilante de arranque para todo video, no solo Continuar viendo**: si no empieza a sonar en 20 s (15 s en
      Continuar viendo, 45 s con el audio del panel) se trata como error y se prueba otra forma. Hoy Vega solo
      tiene los 15 s de `resumeTimer`. (Roku: `startDog`.)
- [ ] **Cada reintento 2 s después de cerrar el anterior** (`onError` en `src/screens/Player.tsx`): el cambio de
      http/https hoy espera 500 ms. Antes de reabrir, parar el video. (Roku: `onError` → `openAfter(2, …)`.)
- [ ] **El mismo archivo por http o https no se vuelve a leer** (la lectura de idiomas va por la dirección sin
      el protocolo). (Roku: `noScheme` en `startVod`.)
- [ ] **Idiomas al empezar a sonar**: la lectura empieza al pulsar Reproducir y los idiomas quedan en el menú
      apenas suena; si hay 2 o más, el aviso «N idiomas de audio…» sale una vez. Revisar que en Vega pase siempre
      (con los idiomas del panel, de la cabecera o del propio reproductor).

## Falta en Vega (Roku build 59)

- [ ] **Video que el reproductor no abre directo → el panel (VPS / VDS)** tras dos intentos directos, con el aviso
      «Preparando el video en el panel…»; si el panel no puede, siguen los intentos de siempre. Vega ya tiene
      `formatFallback`, pero solo cuando el archivo no es MKV/MP4 conocido: revisar que también cubra los videos de
      Plataformas que no abren. (Roku: `m.panelTried`, `panelAllowed`, `panelUnavailable` en `PlayerView.brs`.)
- [ ] **Duración con el video del panel**: usar la del avance guardado; si no se sabe, no mandarla. Con la del pedazo
      preparado el avance contaba como terminado y el título se borraba de Continuar viendo. (Roku: `knownDuration`,
      `saveProgress`.) En Vega revisar `duration()` en `src/player/playback.ts` y `save` en `src/screens/Player.tsx`.
- [ ] **«¿Salir del video?» no se congela**: un reintento no debe quitarle el foco al diálogo, y al cerrarse el
      reproductor se cierran sus diálogos. (Roku: `focusVideo`, `popView`.)

## Falta en Vega (Roku build 58): no leer el archivo antes de abrir el video

En Roku, leer la cabecera del archivo en el servidor IPTV antes de abrir el video (varias peticiones seguidas) hacía
que muchos servidores bloquearan la línea un rato: Continuar viendo y Plataformas (HBO) quedaban cargando sin fin y el
aviso de idiomas no salía. Vega hace lo mismo hoy (`load` en `src/player/playback.ts` espera a `fileTracks`). Esto
reemplaza los puntos de «Abrir el video tras una pausa corta» y «Connection: close» de arriba.

- [ ] **Antes de abrir, solo lo ya sabido sin tocar el servidor IPTV**: lo leído antes en el equipo o `tracks.php` del
      panel, como mucho 3 s; después se abre el video. (Roku: `nfKnownTracks` en `source/Probe.brs`, `tracksKnown`.)
- [ ] **Aviso de idiomas siempre**: apenas empieza a sonar, contar los audios (los del reproductor y los ya
      sabidos); con 2 o más, «N idiomas de audio en este video: ▼ para cambiar», una vez por video. (Roku:
      `onLangCheck`, `langNotice` en `components/views/PlayerTracks.brs`.)
- [ ] **Si nadie los sabe y el reproductor informa uno solo**: leer la cabecera 1 s después de empezar a sonar y
      dejársela al panel; si no sale, reintentar a los 5, 15 y 30 s. Nada de marcas que apaguen la lectura en un
      servidor (en Roku se activaban con una carga normal y los idiomas no salían nunca). (Roku build 60:
      `onLangCheck`, `lateProbeDone` en `components/views/PlayerTracks.brs`.)

## Falta en Vega (Roku build 55): borrado de caché del panel

Problema en Roku: el dueño mandó «Borrar caché y reiniciar» y al abrir la app no pasó nada. Si la app no tenía
número de orden guardado (reinstalada, datos borrados), la orden recién enviada se guardaba en silencio como «primera
vez» y no se aplicaba. Vega tiene la misma regla (`cacheDecision` en `src/lib/cacheclear.ts`).

- [ ] **Aplicar una orden reciente aunque no haya número guardado**: el panel ahora manda `cache_clear_at` (cuándo se
      envió) en `check_mac`. Sin número guardado: si la orden tiene menos de 3 días, borrar y reiniciar; si es más
      vieja, solo guardar. (Roku: `nfCacheClearAction(seen, got, at)` en `source/Utils.brs`; usar la hora corregida
      con el desfase del panel.)
- [ ] **Consulta de cada 10 min con `poll: 1`** (`recheck` en `src/App.tsx`): Vega ya vuelve a preguntar
      `check_mac` cada 10 min; agregar `poll: 1` para que el panel no lo cuente como otra apertura en el Dashboard.
      (Roku: `ccPoll` en `components/MainScene.brs`.)
- [ ] **Viendo un video, aplicar al salir del reproductor**, no en medio de la película. (Roku: `m.ccPending`.)
- [ ] Revisar que cada distribuidor reciba solo sus órdenes y Omitir solo las del dueño para Omitir o globales: lo
      decide el panel con el código de distribuidor (`tenant` + `app=vega`) que manda `check_mac` (probado en el panel,
      `tools/tenant_test/cases_cache.php`).

## Después de copiar

- Subir la versión (`manifest.toml`, `package.json`, `src/version.ts`).
- `npx tsc -p tsconfig.json --noEmit` y `npm run bundle:check`.
- Subir a `vega-os` y esperar la compilación de GitHub (Releases › vega-latest).
