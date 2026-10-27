# Pendiente en Vega: lo que se corrigió en Roku

Vega 1.0.7 tiene todo lo de Roku hasta el build 66 (rama `main` del repo `roku`): carátulas y plataformas, Continuar
viendo por pasos (nunca desde el principio solo), la consulta al servidor cuando un video no abre (403 / 404 /
extensión / cuenta), el panel por http o con el video convertido como último recurso, los idiomas leídos con el video
ya abierto y reintentados hasta tenerlos, el menú de audio con «Audio predeterminado» arriba y todos los idiomas por el
panel, y el borrado de caché (`cache_clear_at`, `poll: 1`, espera a salir del reproductor). Ver el README.

Vega 1.0.8 agrega: plataformas del tamaño correcto, ícono centrado para el mosaico 16:9 del Fire TV, menú de arriba
como Roku (lupa y perfil a la derecha, hora; sin «Cuenta» ni «Salir»), perfil con la línea a la izquierda y los ajustes
a la derecha, Atrás como Roku (sube al menú; en el menú pregunta si salir), menú de audio sin trabarse y sin cerrar la
app con Atrás, canales en vivo también por HLS (lector propio por MSE) y errores de canales con el motivo exacto.

## Falta en Vega

- Nada por ahora. Lo nuevo que se corrija en Roku se anota aquí.

## Cómo lo hace Roku (igual en todas las apps)

- **Idiomas de audio y subtítulos** (`source/Probe.brs` de Roku, `src/api/media.ts` aquí): se piden al panel
  (`api/tracks.php`, lo que ya leyó cualquier equipo del distribuidor); al abrir el video se espera como mucho 2 s. En
  el equipo solo se recuerdan mientras la app está abierta (Roku: `tmp:`; Vega: memoria), **nunca guardados en el
  equipo**: lo que dura lo guarda el panel por distribuidor (de 1 mes a nunca el dueño en Monitor VPS / VDS; un
  distribuidor hasta 3 meses). Si nadie los sabe se leen de la cabecera del archivo con el video abierto, se reintenta
  hasta tenerlos y se le dejan al panel (POST) para los demás equipos. Vega 1.0.18/1.0.19 además los pide apenas se
  abre la ficha (y el episodio enfocado, y el siguiente mientras suena el actual) para que el video empiece con el
  idioma elegido.
- **Carátulas y fondos**: copia del panel (`api/imgc/<sha1>.jpg?v=2`) → `api/img.php` (con el título busca en TMDB si
  el servidor IPTV no tiene) → la original; fondos de TMDB en Full HD por `img.php?w=1920`; con `"img": false` de
  `progress.php ?v=2` todo va directo (`src/lib/images.ts`).
- **La conversión del panel no se comparte** entre líneas ni equipos (cada una dura lo que dice Monitor VPS, para no
  saturar la VPS); no tocar.
- **Canales en vivo con lector propio** (Vega 1.0.18, `src/player/livehls.ts`): 2 segmentos por adelantado, vigilante
  cada 300 ms que salta huecos, pausa con margen en vez de detenerse y seguir, segmento perdido se salta a la tercera.
  Si LG o Samsung terminan usando el lector propio, va igual.

## Siguiente: LG (webOS) y después Samsung (Tizen)

Las ramas `webOS` y `tizenOS` usan el mismo código de `src/` que Vega (React Native para la web: `web/`, `webos/`,
`tizen/`), pero se quedaron en lo del 24/10 (les faltan 27 cambios de `vega-os`). Plan: unir `vega-os` en cada rama
(merge, sin reescribir historia) y resolver lo propio de cada tele:

- [ ] **Reproducción** (`src/player/playback.ts`, `src/screens/Player.tsx`, `src/player/streamcheck.ts`): Continuar
      viendo por pasos (nunca desde el principio solo), consulta al servidor cuando un video no abre (403 / 404 /
      extensión / cuenta / línea en uso), el panel por http o con el video convertido, idiomas leídos con el video ya
      abierto y reintentados, menú de audio con «Audio predeterminado» arriba y todos los idiomas por el panel.
- [ ] **TV en vivo**: en webOS el `<video>` abre `.m3u8` solo (LG empieza por `.m3u8`); el lector propio
      (`src/player/livehls.ts`) es solo para Vega (`PalmSystem` lo deja fuera). En Tizen revisar si `<video>` abre
      `.m3u8` (AVPlay/HTML5); si no, usar el lector por MSE. Reporte detallado del canal (`failLive`).
- [ ] **XUI «Debug Mode»** (200 con página HTML): leer el código (`xuiError`) y no insistir; pocos intentos seguidos.
- [ ] **Portada que sigue al foco** con el fondo buscado (`src/data/heroart.ts`) y plataformas con fondo liso.
- [ ] **Errores al panel** con la versión real (`src/api/report.ts` usa `APP_VERSION`), el motivo y cada intento.
- [ ] **Interfaz**: menú de arriba con lupa y perfil, perfil en dos columnas, Atrás → menú → «¿Salir?» (en webOS el
      Atrás llega por `web/back.ts`; en Tizen la tecla 10009), plataformas e ícono de la app de cada tienda.
- [ ] **Borrado de caché** (`cache_clear_at`, `poll: 1`, espera a salir del reproductor).
- [ ] **Idiomas como Roku** (ver arriba): pedidos desde la ficha, solo en memoria, 2 s al abrir.
- [ ] **Canales**: lo nuevo del lector de Vega 1.0.18 si esa tele lo usa.
- [ ] Subir la versión de cada rama, compilar en GitHub (`.ipk` / `.wgt`) y probar en la tele.

Después: Android, Android TV, iOS, Windows y Mac (ya reproducen bien; solo revisar que tengan lo mismo).

## Después de copiar

- Subir la versión (`manifest.toml`, `package.json`, `package-lock.json`, `src/version.ts`).
- `npx tsc -p tsconfig.json --noEmit` y `npm run bundle:check`.
- Subir a `vega-os` y esperar la compilación de GitHub (Releases › vega-latest).
