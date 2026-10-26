# Pendiente en Vega: lo que se corrigió en Roku

Vega queda en pausa hasta que Roku funcione bien. Esta lista dice qué se cambió en Roku (rama `main` del repo
`roku`) y qué falta copiar a Vega. Al terminar cada punto, márcalo y súbelo a `vega-os`.

## Ya está en Vega

- [x] Carátulas de TMDB solo del mismo título (lo hace el panel, `api/img.php`).
- [x] Nombre exacto de la copia pública del panel (`canonKey` en `src/lib/images.ts`) y una carátula por título con
      el id de TMDB del servidor (`Item.tm`, `&t=`).
- [x] Plataformas sin títulos repetidos.
- [x] Continuar viendo: si no arranca en el segundo guardado, se abre desde el principio y salta ahí
      (`resumeFallback` en `src/player/playback.ts`).
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
