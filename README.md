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
- **Inicio estilo Netflix**: portada grande, Continuar viendo, Mi lista, Top 10,
  plataformas (Netflix, Disney+, HBO Max, Prime, Marvel, Navidad, Halloween…) y géneros
  (Acción, Suspenso, Aventura, Anime, Drama…), igual que la web.
- **Menú superior**: Inicio, Series, Películas, TV en vivo, Deportes, Mi lista, Buscar, Cuenta.
  *Atrás* vuelve a Inicio y, en Inicio, pregunta si quieres salir.
- **Ficha** con sinopsis, reparto, temporadas, episodios con su avance y "Más títulos como este".
- **Reproductor nativo de Vega** (MP4, MKV, AVI, MOV, MPEG-TS): continuar donde quedó,
  ◀▶ 10 s, OK pausa, ▼ o MENÚ para audio y subtítulos, idioma preferido automático y
  siguiente episodio solo.
- **TV en vivo**: categorías, canales, guía EPG (proveedor y, si no hay, la del panel),
  favoritos, cambio de canal con ▲▼ dentro del reproductor.
- **Deportes**: partidos de hoy y mañana con el canal encontrado automáticamente
  (mismas reglas `match` de `api/sports.php`).
- **Progreso y Mi lista sincronizados** con `api/progress.php`: lo que ves en la TV sigue en la web y el móvil.
- **Control parental**: oculta adultos; se desbloquea con el PIN del panel (0000 por defecto).

## Subir a la Amazon Appstore

1. Descarga los `.vpkg` de **Releases › vega-latest** (`latmpxvega_armv7.vpkg` y `latmpxvega_aarch64.vpkg`; el `x86_64` es solo para el simulador).
2. En la [Amazon Developer Console](https://developer.amazon.com/apps-and-games/console/apps/list.html)
   crea una app nueva para **Fire TV (Vega OS)**.
3. En *Archivos de la app* sube los `.vpkg`. El identificador del paquete es
   `com.latmpx.player.vega` (en `manifest.toml`).
4. Completa ficha, capturas, icono (`assets/image/app_icon.png`, 512×512) y clasificación, y envía a revisión.
   La firma la pone Amazon al publicar.

Para cambiar el número de versión que ve la tienda, edita `version` en `manifest.toml` y en `package.json`.

## Probar en un Fire TV con Vega OS

Con el [SDK de Vega](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html) en tu PC y el
Fire TV en modo desarrollador en la misma red:

```sh
vega device connect <IP-del-Fire-TV>
vega device install-app --packagePath latmpxvega_armv7.vpkg   # o latmpxvega_aarch64.vpkg
vega device launch-app --appName com.latmpx.player.vega.main
```

## Compilar en tu PC

```sh
npm ci
npm run typecheck
npm run build:release     # necesita el SDK de Vega instalado
```

## Límites conocidos

- La TV en vivo usa MPEG-TS (`.ts`), que el reproductor de Vega abre directo. HLS (`.m3u8`)
  necesitaría integrar Shaka Player; no hace falta mientras el proveedor sirva `.ts`.
- Autodemo y registrar el equipo usan `login.php` con la llave maestra, que no va en el
  repositorio; esta versión no los trae.
- La app no se ha probado en un Fire TV real todavía: se compiló y se revisó el código,
  pero el contenedor de desarrollo no llega al panel ni tiene un equipo Vega.
