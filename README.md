# LatMpx TV+ para Fire TV con Vega OS

App de la webplayer para los Fire TV nuevos con **Vega OS** (Fire TV Stick 4K Select y
siguientes). Está hecha en React Native para Vega y usa el mismo panel y el mismo diseño
Netflix que la web, Android, Android TV, Windows y Roku.

**Descarga:** pestaña **Releases › vega-latest** de este repositorio (archivos `.vpkg`).
GitHub Actions la compila sola en cada cambio de la rama `vega-os`.

## Qué trae

- **Inicio de sesión** solo con usuario y contraseña: se prueba a la vez en todos los DNS
  del panel y entra en el que coincida. Si el panel tiene una cuenta asignada a este equipo
  aparece un botón para entrar con ella. Fondo con carteles de estreno (TMDB del panel).
- **Autodemo con código de revendedor**: si en *Contraseña* hay un código de 6 letras y números
  (con al menos una letra, p. ej. `RV7K2M`), *Autodemo* lo envía en mayúsculas (`reseller` dentro de
  `auto_demo`) y la demo queda a nombre de ese revendedor en el panel. Solo números o cualquier otra
  cosa no se envía. Código que no existe: se muestra el aviso del panel y la demo sigue disponible.
- **Botones iguales a Roku, Windows y la web**: un solo componente en toda la app (inicio de sesión,
  distribuidor, avisos, diálogos, Cuenta y menú del reproductor). Principal = color del distribuidor
  (rojo sin distribuidor) con texto de contraste; secundario = blanco translúcido con borde fino; con
  el foco del control, borde blanco de 3 px y crece un poco con una animación corta.
- **Inicio estilo Netflix**: portada grande, Continuar viendo, Mi lista, Top 10,
  plataformas (Netflix, Disney+, HBO Max, Prime, Marvel, Navidad, Halloween…) y géneros
  (Acción, Suspenso, Aventura, Anime, Drama…), igual que la web.
- **Menú superior**: Inicio, Series, Películas, TV en vivo, Deportes, Mi lista, Buscar, Cuenta.
  *Atrás* vuelve a Inicio y, en Inicio, pregunta si quieres salir.
- **Ficha** con sinopsis, reparto, temporadas, episodios con su avance y "Más títulos como este".
- **Actores**: en la ficha, el reparto (fotos de TMDB) abre la página del actor con su filmografía, solo los títulos que el servidor tiene (título normalizado y año ±1, como la app de Windows y la web). Clave TMDB del panel o la incorporada.
- **Reproductor nativo de Vega** (MP4, MKV, AVI, MOV, MPEG-TS) sin límite de resolución ni de
  bitrate (4K si el equipo y el archivo lo tienen): continuar donde quedó, ◀▶ 10 s, OK pausa,
  ▼ o MENÚ para audio y subtítulos, idioma preferido automático y siguiente episodio solo.
- **Audio y subtítulos como en Roku**: se lee la cabecera del MKV/MP4 para listar todas las pistas
  con su idioma (Español latino, Inglés…) y su códec. El cambio de audio se comprueba en el
  reproductor; si el equipo no lo toma o no decodifica ese audio (DTS, TrueHD…), lo prepara el
  **motor del panel** (`api/media_vega.php`: video sin cambios + ese audio en AAC, HLS por Media
  Source Extensions desde el segundo actual). Los subtítulos de texto del archivo se eligen en el
  reproductor o, si el equipo no los muestra, el panel los convierte a WebVTT y se dibujan encima del
  video. *Desactivados* los quita. El panel necesita ffmpeg (Guía EPG).
- **TV en vivo**: categorías, canales, guía EPG (proveedor y, si no hay, la del panel),
  favoritos, cambio de canal con ▲▼ dentro del reproductor.
- **Deportes**: partidos de hoy y mañana con el canal encontrado automáticamente
  (mismas reglas `match` de `api/sports.php`).
- **Progreso y Mi lista sincronizados** con `api/progress.php`: lo que ves en la TV sigue en la web y el móvil, aunque cada app haya entrado por otra DNS del mismo servicio (el panel los une). Se vuelven a leer al regresar a la app.
- **Aviso del panel al abrir la app** (`api/alerta.php?format=json`, página **Alertas** del panel): bienvenida con el texto general y la imagen, o aviso de vencimiento con el texto de 3, 2, 1 o 0 días. Una vez por arranque y otra vez tras iniciar sesión; botón **Entendido** enfocado, *Atrás* también lo cierra.
- **Número de distribuidor** (primera vez): 6 dígitos con teclado en pantalla. Con número, la
  app usa el logo, el nombre y los colores de ese distribuidor (`login.php` acción
  `tenant_config`, app `vega`) y todas las llamadas al panel llevan `tenant` + `app` (DNS,
  demo, registro, progreso, EPG, deportes y `alerta.php?t=`). **Omitir** deja la app como
  siempre. No vuelve a preguntar: abre en el inicio de sesión o directo en Inicio. Al abrir, al
  volver a la app y cada 6 h se revisa el número: si venció, está suspendido o ya no vale se
  borra (con la sesión) y vuelve a pedirlo con el motivo; sin conexión sigue con lo guardado
  hasta 72 h. **Cuenta › Cambiar distribuidor** cierra sesión y pide otro número. Necesita la
  llave del panel (sin llave, *Continuar* avisa y *Omitir* sigue funcionando).
  Con distribuidor, todo sigue su marca: pantalla de inicio (su fondo con su logo al centro; sin logo,
  su nombre), menú superior, inicio de sesión, Cuenta, avisos, reproductor, anillos de foco y barras
  de progreso. Con *Omitir* todo queda como siempre.
- **Control parental**: oculta adultos; se desbloquea con el PIN del panel (0000 por defecto).

## Panel: dispositivo, pantalla falsa y errores

- `login.php` lleva `"platform": "vega"` (Clientes MAC › Dispositivo) y `progress.php` lleva `platform` y `device` (mapa y estadísticas del Dashboard).
- **Pantalla falsa** (`src/components/FakeScreen.tsx`): si `check_mac` manda `fake_screen.show` y el equipo es nuevo, en lugar del inicio de sesión sale la calculadora (funciona de verdad), el carrusel o la imagen; «video» y «web» se muestran como la calculadora (Vega OS no tiene navegador). El código del panel + «=» abre el inicio de sesión; cada 30 s se revisa si registraron el equipo. Abajo, pequeño, el ID del equipo.
- **Errores al panel** (`src/api/report.ts` → `api/report.php`, cifrado): errores de JavaScript no atrapados y fallos de reproducción, con equipo, línea y servidor. El dueño los ve en «Errores de las apps».
- **Autodemo:** ya no se bloquea en el equipo; el panel decide (si el dueño borró el registro, se puede pedir otra demo).

## Subir a la Amazon Appstore

1. Descarga los `.vpkg` de **Releases › vega-latest** (`latmpxvega_armv7.vpkg` y `latmpxvega_aarch64.vpkg`; el `x86_64` es solo para el simulador).
2. En la [Amazon Developer Console](https://developer.amazon.com/apps-and-games/console/apps/list.html)
   crea una app nueva para **Fire TV (Vega OS)**.
3. En *Archivos de la app* sube los `.vpkg`. El identificador del paquete es
   `com.latmpx.player.vega` (en `manifest.toml`).
4. Completa ficha, capturas, icono (`assets/image/app_icon.png`, 512×512) y clasificación, y envía a revisión.
   La firma la pone Amazon al publicar.

Para cambiar el número de versión que ve la tienda, edita `version` en `manifest.toml` y en `package.json`.

## Probar sin Fire TV: simulador de Vega en Linux

Amazon trae un **Vega Virtual Device** (simulador de Fire TV) que corre en **Ubuntu 22.04 de 64 bits**
(Intel/AMD). Sirve también un Ubuntu "portable" en USB con persistencia, siempre que el PC tenga la
virtualización activada en la BIOS (Intel VT-x / AMD-V; con KVM va mucho más fluido).

1. Instala el SDK con el simulador (sin cuenta):
   ```sh
   sudo apt install -y curl lz4 jq
   curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash
   source ~/vega/env        # o abre una terminal nueva
   ```
2. Descarga `latmpxvega_x86_64.vpkg` de **Releases › vega-latest** (el x86_64 es el del simulador).
3. Arranca el simulador y abre la app:
   ```sh
   vega virtual-device start --timeout 120
   vega run-app latmpxvega_x86_64.vpkg com.latmpx.player.vega.main -d VirtualDevice
   ```
   Con el teclado: flechas = cruceta, Enter = OK, Esc/Retroceso = Atrás.
   Si la imagen falla, prueba `vega virtual-device start --no-gl-accel`.
4. Para cerrarlo: `vega virtual-device stop`.

## Probar en un Fire TV con Vega OS

Con el SDK en el PC y el Fire TV en la misma red:

```sh
vega devmode login
vega devmode enable-device --code <código de 6 dígitos que muestra la TV>
vega device list
vega device install-app --packagePath latmpxvega_armv7.vpkg
vega device launch-app --appName com.latmpx.player.vega
```

## Compilar en tu PC

```sh
npm ci
npm run typecheck
npm run build:release     # necesita el SDK de Vega instalado
```

Con `config/panel.key` en tu PC (ver [config/README.md](config/README.md)) la compilación local
incluye Autodemo y registro del equipo. Los `.vpkg` quedan en `build/`.

## Límites conocidos

- La TV en vivo usa MPEG-TS (`.ts`), que el reproductor de Vega abre directo. HLS (`.m3u8`) del
  proveedor necesitaría integrar Shaka Player; no hace falta mientras el proveedor sirva `.ts`. El
  HLS del motor del panel (audio cambiado) se reproduce con un lector propio por MSE (`src/player/hls.ts`).
- Autodemo, registrar el equipo y la activación por código MAC usan `login.php` con la llave
  maestra, que no va en el código: se agrega al compilar (ver [config/README.md](config/README.md)).
  Sin llave esos botones no aparecen. `check_mac` y `auto_demo` piden la respuesta cifrada
  (`"enc": 1`): el usuario y la contraseña de la línea llegan con AES-GCM, nunca en claro (con un
  panel antiguo se sigue aceptando el JSON normal).
- La app no se ha probado en un Fire TV real todavía: se compiló y se revisó el código,
  pero el contenedor de desarrollo no llega al panel ni tiene un equipo Vega.
