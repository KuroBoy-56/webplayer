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

## 2.0.18 — puente con caché de la VPS / VDS

| Pieza | Qué hace |
| --- | --- |
| `src/player/bridge.ts` | `setBridge(url, enlace)` (lo llama `sharedindex.linksFor` con el `vod` que firma `vidx.php`; '' = sin máquina), `viaBridge(url)` (a dónde pedir los tramos), `bridgeNone(url)` (se sabe que es directo), `bridgeFailed(url)` (el puente no entregó: directo el resto de la sesión) |
| `rangeget.ts` | pide a `viaBridge(url)` si hay puente (plazo para contestar 28 s: la máquina espera al servidor IPTV); otro código que 206 o sin respuesta → `bridgeFailed` y el mismo pedido sigue directo. `RangeState.bridge` cuenta los pedidos por el puente |
| `prefetch.ts` | el pedido adelantado de Player también va al puente |
| `Mp4Mse.doPrepare`, `MkvMse.start` / `indexOnly` | `await bridgeAsk(url)` antes del primer pedido |
| `Player.tsx` | sin pedido adelantado mientras no se sepa si hay puente |
| `Playback.nativeVodPlanned` | con puente, el lector (no el nativo) |

Panel: `includes/vod_bridge.php` en la VPS / VDS (una conexión al servidor IPTV por video, pedidos de la app desde el
disco, el que baja va hasta 150 MB por delante de lo que se lee, 30 GB de disco de fábrica, se borra a los 30 min sin
pedidos). Prueba: `php tools/vod_bridge_test.php` del panel.

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
