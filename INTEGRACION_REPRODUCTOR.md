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
