# Reproductor, teclado y fluidez para Vega OS

Fecha: 2 de noviembre de 2026. Basada en el proyecto 1.0.45 suministrado.

## Funcionamiento

| Contenido | Primera opción local | Respaldo |
| --- | --- | --- |
| Canales en vivo (.m3u8) | Lector propio `livehls.ts` (cada segmento se convierte a MP4 de corrido: sin los micro-huecos del lector MPEG-TS de Vega) | Shaka si el equipo no tiene MSE para el lector propio; pasos de recuperación existentes |
| HLS y DASH de películas y series (.m3u8 / .mpd) | Shaka 4.16.13 adaptado por Amazon, sobre MSE de Vega | Lector anterior y pasos de recuperación existentes |
| MP4 compatibles con el lector existente | MSE local con elección de pista y reutilización del índice | Modo URI y recuperación existentes |
| MKV y otros archivos | Pistas expuestas por W3C Media de Vega | Motor del panel si no existe una ruta local compatible |

El botón «Audio · [idioma activo]» abre las pistas disponibles. Al seleccionar
una, el menú se cierra y se muestra la confirmación. En películas y episodios,
▲ permite enfocar el botón; ▼ y MENÚ conservan el acceso al menú completo de
audio/subtítulos. En vivo se conservan ▲▼ para cambiar canal y MENÚ para las
pistas. Atrás cierra el selector.

Shaka conserva la fuente, la posición y la selección adaptativa de calidad al
cambiar audio. En MP4, el lector MSE puede volver a llenar el búfer desde la
posición actual con el audio elegido: puede haber una pausa breve. No se
garantiza un cambio instantáneo para todos los contenedores o servidores IPTV.

Solo se aplica automáticamente el idioma que el usuario eligió antes para ese
título (Continuar viendo) y únicamente si existe una pista local compatible; un
título nuevo empieza con su audio predeterminado, como Roku. Las antiguas rutas guardadas hacia el panel no fuerzan la
reproducción remota antes de probar localmente. El servidor IPTV de origen
sigue suministrando el contenido; lo que se evita cuando es posible es usar el
motor adicional del panel para detectar/convertir/cambiar audio.

## Fluidez

- Apertura sin la espera anterior de hasta dos segundos por datos del panel.
- Actualizaciones del progreso una vez por segundo mientras se ve; se evitan
  al ocultarse la barra, excepto cuando se aproxima el siguiente episodio.
- Shaka se evalúa al abrir el primer manifiesto; compilación release sin su UI web.
- Shaka en vivo: margen de arranque/reanudación de 1 segundo, objetivo de 12
  segundos por delante y 6 por detrás. Películas/series conservan 2/18/10.
  El objetivo por delante no es una espera obligatoria antes de mostrar imagen.
  La calidad sigue siendo adaptativa, sin imponer un límite de resolución.
- Las comprobaciones de selecciones antiguas se cancelan al cambiar de pista.
- La liberación de Shaka termina antes de adjuntar otra fuente o cerrar Vega.
- El lector MSE cancela descargas pendientes y libera su URL de objetos al cerrarse.
- El lector HLS de respaldo también cancela listas, segmentos y llaves al cerrar,
  y libera su URL MSE: un canal abandonado deja de competir por la conexión.
- Vista previa y pantalla completa coordinan su cierre asíncrono. El reproductor
  principal espera que la vista previa termine de liberar Shaka y Vega.
- Al recorrer canales con las flechas, la etiqueta cambia inmediatamente y la
  conexión se inicia cuando la selección permanece 120 ms. Un barrido rápido
  abre el último canal elegido. La primera apertura no tiene esta demora.
- Los temporizadores y respuestas de un intento anterior no recargan un canal
  abandonado. La guía espera 350 ms en el reproductor y usa una caché en memoria
  de hasta 64 canales durante 60 segundos, separada por cuenta; las consultas
  simultáneas de vista previa/reproductor comparten una petición.
- Filas y tarjetas mantienen sus propiedades entre cambios de foco; no se
  redibujan todas al cambiar el destacado o el reloj. Se limita la ventana de
  canales/categorías y se suspenden la vista previa, guía y rotación del destacado
  mientras la pantalla principal está cubierta.

## Teclado corregido

El relleno lateral del botón general dejaba solo 28 px para letras de 32 px:
W, M, @ y borrar podían recortarse. Las teclas ahora usan relleno compacto,
texto sin compresión y un panel con ancho estable, centrado y escalado a la
pantalla. Se incorpora ñ/Ñ y el borrado elimina un carácter Unicode completo.

Las teclas de caracteres están memorizadas: escribir cambia el campo, no las
41 teclas. Se conservan mayúsculas, símbolos, espacio, borrar, mostrar/ocultar
contraseña, Listo y Atrás sin aplicar cambios.

Los ajustes reducen trabajo y esperas innecesarios. La mejora real de tiempos,
memoria y fluidez todavía debe medirse en el equipo Vega de destino.

## Alcance de los cambios

Se mantienen los cambios anteriores de Shaka/MSE y el botón de audio. Esta
revisión añade el ajuste del teclado y de los botones compactos; optimiza
Live, LivePreview, Browse, Main y Tiles; añade una suscripción selectiva al
estado, la coordinación de cierre de vistas previas y la caché breve de guía.
Los lectores mantienen la prioridad local y el motor del panel como respaldo.

Se incluyen tools/test-player.cjs y tools/test-interface.cjs. Los datos del
catálogo, credenciales, cuentas, marcas, navegación, manifest y configuración
privada del flujo de compilación conservan su comportamiento existente.

## Verificación realizada

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run test:player
npm run test:interface
npm run bundle:check
```

TypeScript y el bundle para la plataforma kepler pasan. Pasan 19 pruebas:
11 de prioridad, selección e identidad de pistas y liberación; 8 de guía,
cierre de vistas previas, cancelación y configuración del búfer. Son pruebas
aisladas de lógica con servicios simulados; no sustituyen la decodificación
nativa de Vega.

También se comprobó la interfaz original renderizada con React Native Web,
usando Shaka real y MSE de Chromium con un HLS sintético VP9/Opus y dos audios.
La selección Español → Inglés mantuvo la misma fuente MSE, el tiempo avanzó
de forma continua y no se llamó al motor de conversión simulado. Un analizador
de audio confirmó el cambio de tono de 441,4 Hz a 877,5 Hz (señales de prueba
nominales de 440 Hz y 880 Hz): se verificó el audio, además de la etiqueta. Las capturas
están marcadas como prueba web. La superficie y los servicios de cuenta de ese
banco son sustitutos de prueba, sin credenciales reales. No es una ejecución
de Vega ni una comprobación de H.264/AAC en el equipo final.

La revisión del teclado se comprobó con los componentes reales en React Native
Web a 1920×1080 y 1280×720, con números, mayúsculas/ñ, símbolos, borrado,
contraseña oculta/visible y confirmación. Se reprodujeron los recortes de W,
M, @ y borrar de la versión anterior y se comprobó que ahora caben. En ese
banco, una pulsación pasó de redibujar 49 botones a 9. La actualización de un
padre y el cambio de foco dejaron de redibujar las filas ya montadas del
catálogo. Estas cifras describen el banco web, no los FPS o tiempos del equipo
Vega. Las capturas siguen identificadas como prueba web.

No se ha generado ni instalado un .vpkg: falta el SDK/dispositivo Vega en este
entorno. Usar el flujo de compilación existente con su configuración privada.
Las claves de panel no están incluidas en esta entrega.

## 2.1.4 — Continuar viendo sin pantalla negra

En 2.1.3, Continuar viendo sin el índice leído abría con el reproductor de Amazon: empezaba en 0 sin sonido y, apenas
tenía datos, saltaba al segundo guardado sin mostrar nada. Si en 9 s no avanzaba, el lector de la app se abría en ese
mismo reproductor, y con Vega OS 2.0 un reproductor que ya abrió un video en modo directo no muestra después lo que
entrega el lector (pantalla negra, el tiempo quieto, OK sin efecto; lo mismo que «el equipo no aceptó el MP4 del lector»
en los canales, que por eso cambian de forma con un reproductor nuevo). Al final pasaba a la conversión del panel.
- `Playback.nativeVodPlanned`: con `at > 5` (Continuar viendo) MP4 / MKV abren con el lector, como hasta 2.0.17; el de
  Amazon queda de respaldo si el lector no puede. Una película nueva sigue abriendo con el de Amazon.
- `Playback.nativeGaveUp`: si el de Amazon llegó a abrir el archivo (no el rechazo de http al instante de Vega OS
  anterior a 2.0), el lector va en un reproductor nuevo: hook `vodFresh` → `Player` sube `session` y crea otro
  `VideoPlayer` (espera a que se libere el anterior) desde ese segundo. El archivo queda en `nativeLost` el resto de la
  sesión: no vuelve al de Amazon.
- Prueba en el simulador (`npm run test:vod`, caso «2.1.4»): 13,9 s hasta la imagen (2.1.3: 26,7 s, y en el equipo,
  negro).

## 2.1.3 — canales con Vega OS 2.0, sesión que no se pierde y películas con el índice ya leído

**Canales en vivo: el lector de la app primero (`playback-live.ts`).** Con Vega OS anterior a 2.0 el reproductor de
Amazon rechazaba al instante el `.ts` en modo directo y todo iba al lector de la app (miniatura rápida, cambio de canal
fluido). Con Vega OS 2.0 lo acepta, pero con muchos servidores no empieza (avisos `nativo: no empezó · modo=nativo
(.ts directo) t=0.0`): cada canal esperaba 10-18 s dos veces antes del lector y la pantalla grande se quedaba en
«cargando». Ahora `nativeLivePlanned` solo es verdadero para un canal que el lector no pudo mostrar en ninguna de sus
formas (MP4 propio, MPEG-TS, sin el audio MP2 / AC-3, congelado 6 veces): entonces una vez el nativo con un reproductor
nuevo (`liveNext` → `'fresh'`); si tampoco empieza, no queda otra forma. Las listas HLS se piden por adelantado para
todos los canales (miniatura y pantalla grande).

**Sesión (`App.tsx`, `Login.tsx`, `api/panel.ts`).** La sesión vive en memoria: si el sistema cierra la app, al volver
entra sola solo si el panel da la línea del equipo.
- Una respuesta «sin línea» suelta del chequeo de cada 10 min ya no saca al cliente: se pregunta otra vez a los 2 min
  y se cierra si sigue sin darla (`sessionVerdict`); el equipo bloqueado sale al momento. Igual con distribuidor.
- Al abrir la app, si `check_mac` no tuvo respuesta (red recién despierta, panel lento) se pregunta dos veces más
  (2 y 4 s) antes de mostrar usuario y contraseña.
- Usuario y contraseña escritos que el panel no pudo registrar (503: no llegó al servidor IPTV) se registran otra vez
  con el chequeo de cada 10 min (`registerLater` / `registerPending`): el próximo inicio entra solo.

**Películas y series (`playback.ts`, `warm.ts`).** Con el índice ya leído (la ficha lo lee mientras se mira, o el título
ya se abrió) el lector abre también desde el principio: pide de una vez el video, una sola espera del servidor IPTV. El
reproductor de Amazon pide cabecera, índice y video (aviso `modo=nativo total=12.6s`). La ficha lee el índice en las
líneas de más de una conexión (en las de una sola no la ocupa: abre el reproductor de Amazon como en 2.1.2).

## 2.1.2 — canales en vivo de la 2.0.17 y dos ajustes de películas

**Canales en vivo, como en la 2.0.17.** La pantalla grande de los canales es `src/screens/PlayerLive.tsx` (el
`Player.tsx` de la 2.0.17 tal cual) con su reproductor `src/player/playback-live.ts` y `src/player/nativemode-live.ts`
(los de la 2.0.17). La miniatura (`LivePreview.tsx`) y el paso miniatura → pantalla grande (`preview-session.ts`) usan
ese mismo reproductor; `livehls.ts` es el de la 2.0.17. `App.tsx` abre `PlayerLive` para `kind: 'live'` y `Player`
(películas y series) para lo demás. Lo único agregado: `PlayerLive` detiene los índices de Continuar viendo en
segundo plano (`idxWarmHold`). Las pruebas de la 2.0.17 corren contra esta copia: `npm run test:player-live`.

**Películas y series (`playback.ts` del archivo enviado), dos ajustes:**
- Índice compartido (el que dejó otro equipo, p. ej. Roku): se espera hasta 8 s, no 0,6 s (`Mp4Mse.doPrepare`); con
  0,6 s casi nunca llegaba y se leía el índice del servidor IPTV (15-30 s).
- Error 4 al instante con http en un equipo que no dice su versión (solo `keplerOSVariant`) = Vega OS antes de 2.0
  (`Playback.httpCheck`): desde ahí no se prueba el modo directo con http y la ficha vuelve a preparar el video.
- Simulador del reproductor completo: `tools/vod-sim/playback-harness.cjs` (en `npm run test:vod`).

## 2.1.2 — reproducción de películas y series

| Situación | Ruta |
| --- | --- |
| Archivo nuevo por URL, como MP4 o MKV | Motor W3C Media de Vega. El inicio y el cambio de pistas usan el mismo reproductor. |
| Manifiesto HLS o DASH | Shaka sobre Media Source Extensions de Vega. |
| Continuar viendo con un índice local | El lector MP4/MKV pide directamente el tramo guardado. |
| Continuar viendo por URL | Vega salta al segundo guardado y la app espera a que avance el reloj antes de registrar progreso nuevo. |
| Vega no abre el archivo o no expone una pista | Lector local MP4/MKV. El menú ofrece «Buscar más pistas en el archivo» si aún falta el catálogo. |
| Ninguna ruta local compatible | Conversión en la VPS del panel, desde el segundo de reproducción. |

Los fallos de un título se limitan a su apertura. El cambio de episodio y el
regreso a la app crean un reproductor nuevo después de liberar el anterior.
El cambio de audio o subtítulos mediante pistas nativas conserva la fuente y
la posición. Los formatos y códecs que admite Vega dependen de la versión y
de la salida del equipo. Consulta [W3C Media API de Amazon](https://developer.amazon.com/docs/vega/2.0/media-player).

Para compilar con el SDK de Amazon, usa `npm ci`, `npm run typecheck` y
`npm run build:release`. También puedes usar el flujo «App Vega OS (Fire TV)»
que ya incluye el proyecto. En un Fire TV, abre un MP4 y un MKV con dos
audios y subtítulos, cambia las pistas con el control y retoma ambos desde
«Continuar viendo». Repite con un episodio guardado desde otro equipo.

## 2.1.1 — servidor de 6-8 s por pedido: arrancar antes, no reiniciar, idiomas completos, navegación sin trabas

| Pieza | Qué hace |
| --- | --- |
| `Mp4Mse.startPlay`, `MkvMse.startPlay` | colchón de arranque chico: `min(4, eta + 1,5)` s bajados, como mucho 5 s de espera (2.1.0: hasta 10 s y 12 s) |
| `MP4_HEAD` | 3 MB (lo que pide Player por adelantado desde el principio en líneas de un pedido) |
| `ReadAhead.singleSize` (primera ventana) | `bps × (espera + segunda / ritmo) + firstNeed`, entre 1,5 y 4 MB |
| `ReadAhead.fixed` / `paused` | ventanas de tamaño fijo (índice en segundo plano: 2 MB; el resto del índice: un pedido) y la descarga del video detenida mientras se lee el resto del índice |
| `Mp4Mse.moovGate(rest)` | de a un pedido: con `ahead ≥ min(40, espera + rest / ritmo + 10)` s, el resto del índice en un pedido |
| `Playback.audioItems` | índice a medias y el panel con más pistas: el menú con las del panel (mismo orden del archivo) |
| `Player.waitStart` | lector con el índice leído y el servidor entregando: espera hasta 2 min antes de la vuelta siguiente |
| `openNativeVod`, `nativeStarting`, `nativeSlow` | 30 s + 20 s para el reproductor de Amazon; tardar no lo apaga en el equipo |
| `src/lib/keyidle.ts` (`noteKey` en `App.tsx`) | última tecla del control: `idxwarm.ts`, la lectura del índice en segundo plano y la miniatura de canales (`LiveHls.deliver`, solo `keep`) esperan a que no se navegue |
| `Playback.vodMode` | `reproductor_amazon=` en los avisos; al fallar, `mp4Why` lleva el `diag()` del lector |

## 2.1.0 — películas y series sin la VPS: menos pedidos, sin cortes, idioma y subtítulos locales

Todo el tráfico del video va del servidor IPTV al Fire TV (el puente de la VPS de 2.0.18 se quitó por su costo). La VPS
sigue solo para lo que ya hacía: convertir audio como último recurso y el índice compartido (`sharedindex.ts`).

| Pieza | Qué hace |
| --- | --- |
| `rangeget.ts` | plazo para que el servidor empiece a contestar: 30 s (antes 12 s: con el índice al final de un archivo grande se cortaba y volvía a empezar para siempre, «sin índice en 120 s»). En líneas de un pedido aprende cuánto tarda el servidor en soltar la conexión (`linger`, 403 / 429 / 503 justo después de otro pedido) y el siguiente espera eso. Mide la espera (solo de los 206) y el ritmo por conexión (`hostStats`) |
| `readahead.ts` | `singleSize`: ventanas del tamaño justo para que la espera pese poco (4-16 MB; la primera, lo que se ve mientras llega la segunda). `doneUntil` / `peek`: lo ya bajado sin esperar nada. `eta`: cuándo llega la ventana en camino. `keepBehind`: ~40 s ya leídos se guardan (cambio de idioma) |
| `Mp4Mse.fitIn` | el tramo se corta donde termina lo bajado (video y audio), si alcanza para 1 s |
| `Mp4Mse.startPlay`, `MkvMse.startPlay` | de a un pedido: el video arranca cuando lo bajado alcanza hasta que llegue la ventana siguiente (como mucho 10 s de colchón, 12 s de espera) |
| `Mp4Mse.moovFrom` | de a un pedido: el índice entero de una vez si lo que falta baja en menos que una espera; si no, el 60 % |
| `Mp4Mse.switchAudio` | otro audio AAC de la misma configuración: misma MediaSource, desde el segundo actual, de lo ya bajado |
| `mp4subs.ts`, `Mp4Mse.subCues` | subtítulos tx3g / text / wvtt sacados de lo ya bajado (de 10 s antes a 90 s después del segundo actual); `slimMoov` guarda sus pistas enteras |
| `idxwarm.ts`, `preloadIndex`, `Mp4Mse.fullIndex` | índices de los primeros 4 de Continuar viendo en segundo plano (Inicio), de a uno, guardados en el equipo (`indexstore.ts`, ahora 12 títulos). `idxWarmHold`: Player, la ficha y la miniatura de canal lo detienen |
| `Playback.mp4Failed` / `readerGaveUp` | sin el modo directo cuando no puede abrir (http y el nativo nunca abrió en el equipo): Player sigue al instante |
| `Playback.nativeVodPlanned` / `openNativeVod(at)` | con el nativo ya probado en el equipo (Vega OS 2.0), también Continuar viendo |
| `Player.tsx` (AppState) | a segundo plano: avance guardado, `Playback.destroy`, `freeMp4Memory`; al volver, `load` en el mismo segundo |

Simulador: `tools/vod-sim/` (MP4 con el índice al final, servidor XUI con espera, ritmo, una conexión, `linger` y
final del archivo lento) y `npm run test:vod` (4-5 min, tiempo real).

## 2.0.17 — el índice compartido en la VPS / VDS

`sharedindex.ts`: `linksFor()` pide al panel (`vidx.php`, 2,5 s) los dos enlaces firmados de la máquina (`head` y
`url`, válidos 6 h; se piden otra vez pasada 1 h). `{ok: false}` = sin máquina para esta línea: ni se pregunta ni se
sube nada. Con enlaces: «¿lo tiene?» (`head`), el índice (`url`, GET) y la subida por partes (`url`, POST con JSON), todo
directo con la VPS / VDS (`media_worker.php?do=vidx`, `includes/vidx_store.php` del panel).

## 2.0.16 — índice compartido por el panel e idiomas con el reproductor nativo

| Pieza | Qué hace |
| --- | --- |
| `src/player/sharedindex.ts` | `sharedIndex(url, 'm')`: pregunta al panel (`vidx.php?head=1`, 2,5 s) y, si lo tiene, baja el índice (25 s). `shareIndex()`: sube el índice entero por partes de 1,5 MB, solo si el panel dijo que no lo tenía. `sharedStale()`: lo del panel no era de este archivo (otro tamaño) |
| `Mp4Mse.doPrepare` | índice: memoria → equipo → **panel** → servidor IPTV. Del panel cuenta como guardado (`packed`, tamaño comprobado con la primera respuesta) y se guarda también en el equipo. `takeHead()` usa el principio que Player pidió por adelantado (desde el principio) o lo corta (Continuar viendo) para que no ocupe la conexión |
| `Mp4Mse.keepIndex` | además del índice adelgazado en el equipo, el entero al panel (`shareIndex`) |
| `api/media.ts` `shareTracks` | los idiomas que leyó el lector propio a `tracks.php` (si el panel no los tenía) |
| `Playback.load` | pide los idiomas al panel sin esperar (`knownTracks`) y los pone en el menú cuando llegan |
| `Playback.langCheck` | con el nativo en una línea de una conexión (`isSingle`) no lee la cabecera del servidor IPTV |
| `Playback.select` | con el nativo: `nativeSwitch` si el reproductor informa la pista; si no, `toReaderAudio` |
| `Playback.nativeVodPlanned` | no usa el nativo si el lector ya tiene el índice (`mp4Ready`) y el audio predeterminado es AAC; `openNativeVod` corta lo que preparaba la ficha (`dropWarm`, `dropMkvWarm`) |

Panel: `api/vidx.php` + `includes/vidx_store.php` (misma clave y permisos que `tracks.php`, gzip, se borra con los
días de los idiomas y pasados 2 GB lo menos usado). Pruebas: `tools/media_test.php` (panel), `test-player.cjs` y
`test-interface.cjs` (app).

## 2.0.15 — canales que abren igual en pantalla grande, índice por partes y foco al volver

### Canales en vivo: un fallo suelto no es «este canal no abre así»

Al cambiar de canal rápido en pantalla grande (▲▼ o la lista de la izquierda) el reproductor anterior todavía puede
estar soltando el decodificador (Amazon: «The first Fire TV based on Vega OS supports only one secure video decoder
instance… you must deinitialize the first videoPlayer instance before initializing the second one», Media Player
Requirements) o el servidor sigue contando la conexión del canal anterior. Antes ese fallo pasajero:

- dejaba el canal sin el reproductor nativo toda la sesión (`nativeFailed`) y, con dos, 2 días (`nativeLiveBad`);
- un MP4 propio rechazado apagaba el MP4 para **todos** los canales de la sesión (`disableMp4`);
- el canal terminaba en el lector con MPEG-TS, que en Vega no muestra algunos canales (HBO: `modo=ts … buf=[] t=0.0`),
  esperaba 40 s y probaba el otro protocolo (inútil: el servidor sí entregaba) → «No se pudo reproducir».

Ahora (`Playback.liveNext()`, devuelve `'here' | 'fresh' | ''`):

| Qué pasó | Qué sigue |
| --- | --- |
| El nativo falla antes de verse, 1.ª vez en la sesión | `'fresh'`: Player / la miniatura lo abren otra vez con un **reproductor nuevo** (como la miniatura), 600 ms |
| El nativo falla otra vez | lector de la app en el mismo reproductor; el canal queda marcado 2 días (`markNativeLiveBad(url, true)`) |
| El lector entrega y el equipo no muestra nada (`LiveHls.noShow`: ≥3 segmentos y el reloj quieto 7 s) | el nativo con reproductor nuevo si se puede; si no, el otro modo del lector (MP4 ↔ MPEG-TS) |
| Imagen congelada en el lector | el nativo con reproductor nuevo (el nativo no toma otra dirección en un reproductor ya usado) |
| MP4 propio rechazado | **solo ese canal** en MPEG-TS (`mp4BadLive`); con 3 canales distintos, el equipo entero |
| El servidor contestó 200 y entregó | no se prueba el otro protocolo ni el DNS: una vez más con reproductor nuevo y después el aviso |

El vigilante del nativo espera 18 s (no 10) si el equipo ya recibe el canal (`readyState` / `buffered`).

### Películas y series: el índice por partes

| Pieza | Qué hace |
| --- | --- |
| `Mp4Mse.moovFrom()` | lee el índice (moov) en orden con su propia descarga adelantada (`mra`) y devuelve lo leído apenas están **enteras la pista del video y la del audio que va a sonar** (`enough()`: elegido a mano, idioma guardado del título o el primer audio activado). El resto sigue por detrás (`moovGate`: con varias conexiones cuando hay 12 s de video por delante; con una sola, cuando el video no tiene ventanas pendientes y lleva 40 s por delante) y al terminar `moovDone()` lo deja como índice completo (memoria, equipo, menú de idiomas) |
| `PARTIAL` | índice a medio leer: si se sale o se elige otro idioma antes de tenerlo entero, el lector siguiente del mismo archivo sigue desde ahí |
| Final del archivo | con varias conexiones, a la vez que el principio se pide `Range: bytes=-3145728` (`rangeget.ts`, `off < 0`): si el índice cabe en esos 3 MB todo llega en una espera del servidor; si no, ya se tiene su final y falta solo el principio. Va con su propio `RangeState`: un servidor que no lo admite no afecta al resto |
| Principio + video | desde el principio, el primer pedido es de 1,5 MB (`MP4_HEAD`): cabecera y principio del video juntos (`ReadAhead.seed`). Player pide por adelantado exactamente eso (no dos pedidos) |
| Tope de pedidos | `rangeget.ts` (`slot` / `free`): todos los pedidos de los lectores (índice, video, final del archivo) comparten un tope = `max_connections` de la cuenta (`setLineMax`; sin saberlo, 4). En un servidor que rechazó pedidos a la vez (`markSingle`, 4 minutos; antes toda la sesión) o con una línea de 1 conexión, el tope es 1: todo en orden, sin que una parte le pise la conexión a otra |
| Líneas de 1 conexión | el primer pedido trae cabecera + principio del video (1,5 MB); el índice de una vez (~40 %, `lazy`); su resto solo cuando el video no tiene ventanas pendientes y lleva 40 s por delante. Sin pedido del final del archivo (también con 2 o 3 conexiones) |
| Plazo final | si el lector pasa al modo directo de Vega (`mp4Fallback`), 30 s para sonar (`vodFinal`) y después los pasos de siempre hasta el aviso (antes no quedaba ningún plazo: carga sin fin) |

En el aviso «tardó en empezar»: `indice=<leído>/<total>MB en Xs empezo_con=<MB con que arrancó> indice_del_final=entero|final`.

Medido con el simulador (servidor que tarda 6,4 s en contestar cada pedido; capítulo de 45 min con el índice al final;
A = nuevo desde el principio, B = Continuar viendo con el índice guardado, C = Continuar algo visto en otro equipo):

| Caso | 2.0.14 | 2.0.15 |
| --- | --- | --- |
| 2 idiomas (índice 2,9 MB), 2 MB/s por conexión | A 14,2 s · B 6,6 s · C 19,9 s | A 8,9 s · B 6,6 s · C 14,6 s |
| 6 idiomas (índice 6,6 MB), 2 MB/s por conexión | A 14,9 s · B 6,6 s · C 20,6 s | A 14,9 s · B 6,6 s · C 19,8 s |
| 6 idiomas (índice 6,6 MB), 260 KB/s por conexión | A 23,1 s · B 7,5 s · C 29,6 s | A 23,4 s · B 7,5 s · C 24,1 s |
| 6 idiomas, línea que admite 1 conexión | no abría («índice: pedido 403») | A 33,7 s · C 34,6 s |

Con un índice grande y conexiones libres, un título nuevo tarda lo mismo: son dos esperas del servidor (cabecera e
índice) que la app no puede evitar. En la línea de 1 conexión del simulador, B (47,9 s) cuenta como si fuera el
primer video de la sesión (el simulador olvida que la línea es «de a uno»); en la app eso se recuerda 4 minutos y, con
`max_connections` 1, desde el principio.

### Foco al volver de la ficha

Las filas de Inicio, Películas y Series (`Browse`) recuerdan la tarjeta enfocada (fila y título); al volver a la
pantalla la fila se monta, se pone arriba y la tarjeta se vuelve a montar con `preferred` 1 s (`RowView focusKey /
focusRev / focusPref`), como ya hacía `ItemGrid` (Buscar, Ver todo, Actor). Si el foco estaba en la portada, vuelve a
Reproducir.

## 2.0.14 — lectura adelantada, índice en el equipo e idioma compartido

Para llevar esto a las otras apps con lector propio (webOS, Tizen, web player) o entender un aviso.

### Piezas

| Archivo | Qué hace |
| --- | --- |
| `src/player/readahead.ts` | `ReadAhead`: baja el archivo por ventanas seguidas, hasta 3 pedidos a la vez, delante de la reproducción. `read(off, len)` entrega bytes de las ventanas ya bajadas o en camino; `seek()` corta y empieza en otro byte; `goSingle()` pasa a un pedido a la vez (línea de 1 conexión); `limit` acota lo que se baja mientras solo se prepara desde la ficha |
| `src/player/indexstore.ts` | Índices en AsyncStorage con prefijo `latmpxidx:` (fuera de lo que `storage.ts` carga al iniciar). Lista `idx_list_1`: 8 títulos, 32 MB de texto. Clave = dirección sin http/https. Lectura con tope de 2,5 s |
| `src/player/mp4mse.ts` | `prepare()` (índice: memoria → equipo → servidor) y `start()` (MSE). `Mp4Mse.open()` entrega la instancia ya preparada por la ficha. `slimMoov()` guarda el índice sin las tablas de los otros idiomas; si se elige uno que falta, se lee el índice entero |
| `src/player/mkvmse.ts` | Igual para MKV: `packMkv` / `unpackMkv` (cabecera, pistas, Cues), `preloadMkv`, lectura con `ReadAhead` |
| `src/player/warm.ts` | `warmVideo(url, at, hint)` desde la ficha (1,2 s), `vodKnown(url)`, `warmStop()` |
| `src/player/preview-session.ts` | `offerPreview` / `takePreview` (miniatura → pantalla grande) y `offerReturn` / `takeReturn` / `dropReturn` (pantalla grande → miniatura) |
| `src/player/nativemode.ts` | `nativeLiveBad` / `markNativeLiveBad` / `nativeLiveGood`: canal que el nativo no abre |
| `src/state.ts`, `src/player/playback.ts` | `play` del avance: `playHintFor`, `seedTitleLang`, `titlePlayHint`, `titleLangOf` |

### Reglas que no hay que romper

- **Un solo decodificador** (Amazon): un reproductor nuevo solo se inicia cuando el anterior terminó de cerrarse
  (`playerClosing` / `waitForLivePreview`). El reproductor que cambia de superficie (miniatura ↔ pantalla grande) no
  se cierra: `clearSurfaceHandle` en la que deja y `setSurfaceHandle` en la que toma.
- **Línea de una conexión**: nunca dar por hecho que admite pedidos a la vez. `ReadAhead` lo detecta por el pedido
  rechazado, cortado o incompleto con otro en curso (`rs.errs`) y sigue de a uno.
- **Lo guardado es un atajo, no una fuente**: tamaño del archivo distinto → `STALE_INDEX` → se descarta y se abre de
  nuevo leyendo del servidor. Texto guardado a medias (largo distinto) → no se usa.
- **El idioma se comparte, la forma no**: `play.a` dice en qué idioma se ve el título; cada equipo decide cómo
  (pista local, o conversión solo donde no hay otra).

### En los avisos

`modo=lector mp4 [...]` trae ahora `indice_guardado=true|false`, `adelanto=<ventanas>v <MB>MB <KB/s>KB/s_por_conexion`
y `de_a_uno` si la línea no admitió pedidos a la vez.

## Comprobación pendiente en el dispositivo

Probar las fuentes propias de HLS, DASH, MP4 y MKV: audio único, dos idiomas,
pistas del mismo idioma, pistas sin etiqueta, pausa/reanudación, retorno a la
posición guardada, cambio rápido de canal y salida/entrada al reproductor.
Probar también una pista no compatible para confirmar el respaldo del panel
y una línea sin permiso del motor para confirmar que el audio local sigue
funcionando. La disponibilidad de idiomas depende de las pistas que realmente
exponga la fuente y de los códecs admitidos por el equipo y su salida de audio.
Comprobar el foco del teclado con el control remoto, sus símbolos y las fuentes
del dispositivo; medir apertura en frío, vista previa → pantalla completa,
ráfagas de cambio de canal y estabilidad con la red IPTV real, incluyendo
canales HD/4K y fuentes lentas. No se promete un tiempo fijo de apertura:
también depende del proveedor, la duración de los segmentos y la conexión.
