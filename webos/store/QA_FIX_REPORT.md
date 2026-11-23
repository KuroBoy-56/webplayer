# QA_FIX_REPORT — MPX Player (com.mpxplayer.app) 1.4.10

## Defecto de LG

| Campo | Valor |
|---|---|
| App | MPX Player, `com.mpxplayer.app`, LG webOS TV |
| Versión evaluada | 1.3.11 |
| QA Round | 3 (pretest, «Test Device: -») |
| Issue ID | QA2026111927245 · P2 · Open · QA Rejected |
| Defecto | «Appicon background color and tile color do not match.» |

## Causa

1. En el `.ipk` 1.3.11 los iconos **ya coincidían** con el mosaico: `iconColor` era `#000000` y el fondo de
   `icon.png` (80x80) y `largeIcon.png` (130x130) era `#000000` exacto, opaco, sin un solo píxel de otro tono en el
   borde. Se comprobó sobre el `appinfo.json` y los iconos del commit de la 1.3.11 (`80cc8df`): son los mismos de la
   1.3.9.
2. La documentación de LG (App Resources) dice que esos dos iconos «are used only for app testing» y que en LG Apps se
   usa **el icono de 400x400 que se sube aparte en LG Seller Lounge**, achicado solo. El rechazo fue en el *pretest*
   (sin televisor de prueba), que revisa los datos registrados: ese icono de 400x400 frente al color del mosaico
   (`iconColor` del `appinfo.json`).
3. El repositorio **no tenía** un icono de 400x400 con este diseño ni con este fondo. El único icono grande era
   `assets/image/app_icon.png` (512x512, fondo `#141414` con textura y logo con degradado), que dentro de un mosaico
   `#000000` deja un cuadro gris visible. No se puede ver desde aquí qué archivo se subió en Seller Lounge; la causa
   más probable es un icono de 400x400 con fondo distinto de `#000000`.

## Corrección

- Un solo generador para los tres iconos: `tools/lg-icons/make-lg-icons.py` (Pillow). Toma el logo
  (`assets/image/logo.png`) con colores planos (rojo `#E5011E`, amarillo `#FECD03`, azul `#006AE1`), el nombre
  «MPX Player» en Inter Bold blanco (`tools/lg-icons/Inter-Bold.ttf`, OFL) y **el fondo exacto de `iconColor`** del
  `appinfo.json`. Dibuja a 4x y reduce promediando (sin LANCZOS): el fondo queda exacto y sin halos.
- La composición es la de la 1.3.9 (logo arriba al centro, nombre debajo, márgenes de ~15 %): no hay rediseño.
- Salida: PNG RGB opacos, sin canal alfa ni chunks de color (`gAMA`, `iCCP`, `sRGB`, `cHRM`).
- `tools/lg-icons.test.js` (en `npm test`) falla si algún icono no mide lo que debe o si un solo píxel del 10 % exterior
  no es `iconColor`. Se comprobó que falla con `iconColor` `#141414`.
- El workflow publica `appIcon-400.png` en **Releases › webos-latest**, junto al `.ipk`.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `webos/icon.png` | Regenerado (80x80, mismo diseño, fondo `#000000`) |
| `webos/largeIcon.png` | Regenerado (130x130, mismo diseño, fondo `#000000`) |
| `webos/store/appIcon-400.png` | **Nuevo**: icono de Seller Lounge 400x400, fondo `#000000` |
| `webos/appinfo.json` | Solo `version`: 1.4.9 → 1.4.10 (`iconColor` sigue `#000000`) |
| `package.json`, `package-lock.json`, `src/version.ts` | Versión 1.4.10 |
| `tools/lg-icons/make-lg-icons.py`, `Inter-Bold.ttf`, `LICENSE-Inter.txt` | **Nuevos**: generador y su letra |
| `tools/lg-icons.test.js` | **Nuevo**: iconos contra `iconColor` |
| `.github/workflows/webos.yml` | Publica `appIcon-400.png` en la release |
| `README.md` | Novedades de la 1.4.10 e instrucciones del icono |

No se tocó nada del reproductor, la interfaz, la navegación, el control remoto, los servicios de webOS, el arranque, el
id ni el nombre de la app.

## Colores

| | Antes | Después |
|---|---|---|
| `iconColor` (mosaico) | `#000000` | `#000000` (sin cambio) |
| Fondo `icon.png` / `largeIcon.png` | `#000000` | `#000000` |
| Fondo del icono de 400x400 | no existía en el repositorio (`app_icon.png`: `#141414`) | `#000000` |

## Recursos, antes y después

| Recurso | Antes | Después |
|---|---|---|
| `icon.png` | 80x80 RGB, 2318 B, borde 100 % `#000000` | 80x80 RGB, 2341 B, borde 100 % `#000000` |
| `largeIcon.png` | 130x130 RGB, 4035 B, borde 100 % `#000000` | 130x130 RGB, 4146 B, borde 100 % `#000000` |
| Icono de Seller Lounge | — | 400x400 RGB, 15 695 B, borde 100 % `#000000` |

Diferencia media entre los iconos viejos y los nuevos: unos 5 de 255 por canal, solo en los bordes suavizados del logo y
del texto (mismo diseño). Los píxeles casi negros que quedan están todos a menos de 2 px del logo o del texto
(suavizado), ninguno suelto en el fondo. La vista previa está en `preview.png` (entrega).

## Versión

LG evaluó la 1.3.11, pero la rama `webOS` ya iba en **1.4.9** (de la 1.3.12 a la 1.4.9 hubo otras correcciones, y la
1.3.12 ya existe como versión interna). La nueva es **1.4.10**: mayor que 1.3.11, como pide LG («you cannot upload the
same version again»), y con el formato `x.y.z` de la documentación.

## Validaciones

- `appinfo.json`: JSON válido; `id` `com.mpxplayer.app`; `version` `1.4.10`; `icon` `icon.png`; `largeIcon`
  `largeIcon.png`; `iconColor` `#000000`; rutas existentes.
- `npm run typecheck`: sin errores. `npm test`: 41 de 41 (incluye las 4 de `tools/lg-icons.test.js`).
- `npm run build` y `npm run build:hd`: `dist/` (1920x1080) y `dist-hd/` (1280x720) con `version` 1.4.10 y los iconos
  nuevos, idénticos byte a byte a los de `webos/`.
- `ares-package` (`@webos-tools/cli` 3.2.6, el del workflow) de los dos: `com.mpxplayer.app_1.4.10_all.ipk`. Por dentro
  (`control`: Package `com.mpxplayer.app`, Version `1.4.10`; `data`: `usr/palm/applications/com.mpxplayer.app/` con
  `app.js`, `appinfo.json`, `icon.png`, `index.html`, `largeIcon.png` e `img/` con 19 imágenes): el `appinfo.json` es
  el corregido, los iconos son los nuevos (no los viejos) y no entra nada de `webos/store/`.
- `dist/` abierto en Chromium a 1920x1080: la app arranca en la pantalla «Número de distribuidor», responde a las
  flechas y no da errores en la consola.

## Lo que no se pudo comprobar aquí

- **LG webOS TV 22 Simulator** y **webOS Cloud Test Lab**: no están en este entorno (el simulador es una app de
  escritorio de LG y el Test Lab pide la cuenta de Seller Lounge). No se vio el mosaico real del Launcher.
- **El icono que está hoy en Seller Lounge**: no hay acceso a la cuenta; por eso hay que reemplazarlo a mano.
- El `.ipk` para la tienda tiene que ser el del workflow (lleva la llave del panel del secreto `PANEL_KEY`); los
  empaquetados locales de esta revisión se hicieron sin la llave y solo sirvieron para inspeccionar el paquete.

## Pasos en LG Seller Lounge (a mano)

1. Application › Edit de MPX Player › información de la app: reemplazar el **App Icon** por `appIcon-400.png`.
2. Subir `MPXPlayer.ipk` (Full HD, Releases › webos-latest) y `MPXPlayer-HD.ipk` (HD, Releases › webos-hd-latest),
   versión 1.4.10.
3. En la nota para QA se puede indicar: «QA2026111927245: App Icon (400x400) replaced; its background is #000000, the
   same as iconColor in appinfo.json and the background of icon.png / largeIcon.png.»

No se puede asegurar que LG la apruebe: lo que se corrigió de forma comprobable es que los tres iconos y el color del
mosaico tienen exactamente el mismo fondo.
