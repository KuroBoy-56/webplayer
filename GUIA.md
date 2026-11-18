# Guía para terminar: Web player

1. **Subir:** descomprime `webplayer.zip` en la carpeta de tu web player en el hosting.
2. **Llave:** copia `includes/panel_secret.sample.php` como `includes/panel_secret.php` y pega la misma llave del panel (`master_key_hex`, 64 caracteres). Este archivo vive solo en el hosting.
3. **Permisos:** la carpeta `includes/cache/` debe poder escribirse (755).
4. **Limpieza:** si siguen en el hosting, borra `bin/` (ffmpeg ya no se usa en el hosting), `instalar_ffmpeg.php`, `setup.php`, `test.php`, `database.php`, `epgjob.php`, `includes/admin/`, `includes/dns/` y `includes/notifications/`. **No borres** `media.php`, `proxy.php` ni `route.php`.
5. **HTTPS:** ver la sección de abajo. Con la VPS / VDS del motor en https puedes encender SSL y Forzar HTTPS; sin ella, deja Forzar HTTPS apagado (el video http se abre en `play.php` por http).
6. **Prueba:** entra con un usuario de prueba desde un PC, un iPhone y un Android. Si algo no carga, abre el diagnóstico desde el aviso de error del reproductor.
7. **Si falla la TV en vivo:** si no carga en Chrome pero sí en VLC, pide a tu proveedor IPTV que permita CORS en su servidor.

Después del login la barra del navegador nunca muestra el nombre de una página: cada enlace es `w-<token>`, distinto y aleatorio cada vez (cifrado con la llave propia del hosting, válido 7 días y solo para la sesión que lo abrió). Una página abierta por su nombre se cambia sola a un token.

## Web en HTTPS (SSL de Hostinger) sin cargar el hosting
El navegador bloquea un video `http` dentro de una página `https`. Con SSL, el video http del servidor IPTV pasa tal cual por la **VPS / VDS de la línea** (la misma del motor de conversión): **servidor IPTV → VPS / VDS → navegador**. Nunca pasa por Hostinger ni por Cloudflare. Un distribuidor con su VDS propia usa solo su VDS; los demás, la máquina del dueño (Guía EPG del panel).

1. La VPS / VDS con **https** (certbot) y los archivos nuevos del motor (`api/media_worker.php`, `includes/media_engine.php`, `includes/media_convert.php`, `includes/media_relay.php`). Ver `tools/vps/README.md` del panel.
2. En hPanel activa **SSL** y, si quieres, **Forzar HTTPS**.
3. Orden del video con la web en https: https directo del servidor IPTV (si lo tiene) → VPS / VDS de la línea → `play.php` por http (solo con Forzar HTTPS apagado) → el hosting solo como último recurso.

El relay de Cloudflare de versiones anteriores ya no se usa: puedes borrar el Worker de Cloudflare e `includes/https_relay.php` del hosting.

**Distribuidor que no usa tus recursos:** en el panel, Distribuidores › Editar › «Solo sus recursos». Su web y sus apps solo usan su VDS propia; sin ella, el video va directo del servidor IPTV y nunca pasa por tu VPS ni por este hosting.

**Cloudflare solo para los dominios:** la web, el panel y los dominios de tus distribuidores pueden estar en Cloudflare (nube naranja para esconder la IP de Hostinger y proteger el dominio principal, o gris si prefieres el SSL de Hostinger). El registro de la **VPS / VDS va con nube gris** (solo DNS): así el video nunca pasa por Cloudflare.

**Dominio propio con un Worker (opcional):** el cliente entra por un dominio nuevo (el tuyo o el de cada distribuidor, sin límite) y el dominio original de la web responde **403 Forbidden**. El Worker (`cloudflare/edge-worker.js`) abre la web por dentro con un secreto; la web (`includes/edge.php`) solo atiende con ese secreto y toma el dominio y la IP real del cliente. Cada secreto puede llevar el número de un distribuidor: en su dominio la web queda fija en él. Se configura con `'edge_keys'` (y `'edge_block'` para probar) en `includes/panel_secret.php`; sin eso la web funciona exactamente igual. Paso a paso con dibujos: **`docs/GUIA-WORKER.html`** (ábrelo en tu PC; en el hosting `docs/` y `cloudflare/` están bloqueados).

## Perfiles (para quien siga el código)

Contrato con el panel, reglas, estado de cada app y cómo seguir: **`docs/PERFILES.md` del panel** (repo `panelweb`).
Esta web es la implementación de referencia para las demás apps.

- **Solo con los perfiles encendidos** por el dueño (panel › Perfiles). Apagados, en una DEMO o con una sola conexión
  en la línea, la web queda exactamente como antes.
- **`includes/profiles.php`** (lo carga `includes/core.php`):
  - Estado en la sesión, `$_SESSION['wp_prof']`: `on`, `max`, el perfil elegido (`id`, `name`, `avatar`), el
    principal (`main_name`, `main_avatar`), `at` (última pregunta al panel: como mucho cada 10 min, `WP_PROF_TTL`) y
    `down` (el panel no contestó: no se pide perfil). `acct` lo ata a la línea y al número de distribuidor.
  - `wp_prof_api()` llama a `api/profiles.php` con el token de la sesión (el navegador nunca lo ve).
  - `wp_prof_gate()`, desde `session.php`: si la línea elige perfil y todavía no lo eligió, una navegación a una de las
    páginas de `WP_PROF_GATED` va primero a `perfiles.php?next=<token de la página pedida>`. Las cargas en segundo plano
    no se redirigen.
  - `wp_prof_select()` comprueba el PIN en el panel (`pin_check`) antes de guardar el perfil en la sesión.
  - `wp_prof_id()` es el perfil que va como `profile` a `api/progress.php` (`includes/panel.php`: `wp_panel_userdata()` y
    `wp_panel_post()`); con 410 `wp_prof_gone()` lo olvida y la página siguiente vuelve a la pantalla de perfiles.
  - `wp_prof_highlight()`: lo más destacado de la semana (`api/tmdb.php?path=trending/all/week` del panel, con la clave
    del distribuidor o la del dueño con Omitir, 6 h en caché); el fondo va en Full HD y el original 4K por `srcset`.
- **`perfiles.php`** (en `WP_ROUTE_PAGES`, al final de la lista; nunca se cambia el orden porque el número va dentro
  de los tokens) y **`assets/nf/profiles.css` / `profiles.js`**: la pantalla, el PIN, administrar y agregar. En
  horizontal el título va arriba al centro, el destacado (solo nombre y calificación) abajo a la derecha y la versión de
  la web (`WP_VERSION`, `includes/core.php`) abajo a la izquierda. Al entrar se salta la transición entre páginas
  (`pagereveal` + `skipTransition()`; con `@view-transition { navigation: none }` Chrome deja un error en la consola). Las
  acciones van por `fetch` (POST) a la misma dirección y `wp_prof_post()` las pasa al panel. Token propio contra CSRF
  (`wp_prof_csrf()`).
- **Ojo:** `wp_route_rewrite()` convierte en token cualquier texto entre comillas igual al nombre de una página (por
  ejemplo `"profiles"` como clave de un JSON dentro de la página). Por eso la página es `perfiles.php`.
- `login.php` guarda las conexiones de la línea (`max_conn`, que el panel usa mientras no las sepa) y borra `wp_prof`:
  cada inicio de sesión vuelve a pedir el perfil. `includes/line_guard.php` mantiene `max_conn` al día.
- `includes/handoff.php` + `play.php`: el perfil viaja en el enlace cifrado del reproductor http (`pf`).
- `header.php`: con perfiles encendidos el avatar del perfil va a la izquierda (menú con «Cambiar perfil» y
  «Administrar perfiles»), el menú en el centro y el logo a la derecha; en el celular el avatar también va en «Mi
  cuenta» de la barra de abajo. `myaccount.php` muestra el perfil con sus botones.
- `assets/nf/profiles.css`: el tamaño de los avatares es `--av` (PC unos 140 px en 1080p y hasta 170 px en pantallas
  grandes; vertical hasta 150 px, tan grande como dejan el ancho y el alto, para que los 5 perfiles quepan sin
  desplazarse; celular horizontal hasta 96 px con los 5 en una fila). El mouse sobre un perfil solo lo agranda. En vertical «Administrar perfiles» va en la fila de
  la barra de arriba: la barra (`.pf-top`) no recibe toques, solo sus botones (si no, en el celular y la tableta el
  botón no respondía).
- Textos: `t('…')` en PHP y `tr('…')` en `assets/nf/*.js` (se buscan solos); las traducciones en
  `includes/lang/{en,pt,fr}.php`.
- **Perfil infantil** (`includes/kids.php`, lo carga `includes/core.php` después de `profiles.php`): con un perfil
  `kids` elegido (`wp_kids_on()`) se filtra **en el origen**, así cualquier página nueva que use estas funciones ya
  sale filtrada:
  - `wp_catalog()` → `wp_kids_catalog()` sobre `wp_catalog_raw()` (películas y series; 30 min en caché aparte,
    `kidscat|…`);
  - `wp_categories()` → `wp_kids_categories()` sobre `wp_categories_raw()` (solo las que tienen algo permitido; en
    vivo, solo las infantiles);
  - `xt_get('get_live_streams')` → `wp_kids_live_filter()` sobre `xt_get_raw()` (solo canales de categorías
    infantiles).
  Las cachés guardan siempre lo que manda el servidor IPTV, sin filtrar. **Una página nueva que lea el catálogo con
  `wp_catalog_raw()`, `wp_categories_raw()` o `xt_get_raw()` se salta el filtro**: usar las funciones de siempre.
  `wp_kids_guard($tipo, $id)` en `Movie_description.php`, `seriesvideo.php` y `video_player.php` manda al inicio lo
  que no pasa; `tvguide.php` (sin canales infantiles) y `sportsschedule.php` también; `header.php` esconde Deportes y
  TV en vivo (`$wp_show_sports`, `$wp_show_live`). El destacado de `api.php` lleva `|kids` en su clave.
  Las reglas llegan del panel en `kidsRules` (`wp_kids_rules_remember()`, 30 días) y `wp_kids_rules_local()` es la
  copia de fábrica: **cópiala de `includes/kids_rules.php` del panel cuando cambien las listas.** El algoritmo y cómo
  arreglar una filtración: «Perfil infantil» en `docs/PERFILES.md` del panel. El interruptor sale solo al crear
  (`#pfKids` en `profiles.js`, campo `kids`).
- **Prueba:** desde el repo del panel, `WP_DIR=/ruta/a/esta/web php tools/profiles_web_test.php` (Chromium contra una
  copia del panel con datos inventados; el servidor IPTV de prueba trae un catálogo pequeño para el perfil infantil).
