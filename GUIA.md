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

## Distribuidor: la dirección decide (2.8.1)

Ya no hay pantalla «Número de distribuidor». `wp_dist_choice()` (`includes/tenant.php`):

- **Dominio propio** de un distribuidor (Worker, `'edge_keys'` en `panel_secret.php`): siempre su número.
- **`dist_pick`** en el POST: el número de la dirección de la página de inicio de sesión, en cada paso (`servers`, `client` y el del hosting).
- **`?d=NNNNNN`**: el enlace del distribuidor (`tudominio/login?d=NNNNNN`, también `tudominio/?d=` por `index.php`). El panel lo muestra en su perfil mientras tenga la web player encendida (`tenant_webplayer_url()`).
- **`login` sin `?d=`**: la web del dueño (lo que antes era «Omitir»).
- Lo demás (una página sin sesión): el último distribuidor con el que se entró en este navegador (cookie `wp_dist`, la guardan `wp_login_finish()` y el guardián).

`wp_login_url()` arma el inicio de sesión con el `?d=` de la sesión (o el recordado): lo usan `session.php`, `route.php`, `logout.php`, el guardián de la línea, el de navegadores bloqueados y `NF.login` en `assets/nf/app.js` (un 401). Un número que no existe, vencido, suspendido o sin la web player (el panel contesta `app_not_linked`) deja la página en `data-step="blocked"`: solo el aviso, sin formulario. Con una sesión de otro distribuidor abierta, `wp_tenant_link_get()` la cierra al abrir el enlace.

## Velocidad: caché del catálogo y del navegador (2.8.0)

- **Hosting** (`includes/catalog_fast.php`): `wp_cat_derive()` guarda lo que se calcula del catálogo (filas `wp_filter_cached()`, ids `wp_catalog_ids()`, «Similares» `wp_catalog_similar()`, géneros) atado a la fecha del catálogo y sus categorías en la caché. Si el catálogo venció, sirve lo guardado y pide renovarlo sin esperar (`wp_cat_touch()`): por el hosting después de contestar (`wp_xt_refresh_later()`, con `fastcgi_finish_request` / `litespeed_finish_request`) o por el navegador en el modo navegador. Un hosting sin esas funciones sigue como antes. El perfil infantil siempre calcula (su filtro cambia a medida que llega TMDB). Para ordenar: `wp_sort_items()` (mismo orden que usort, estable).
- **Navegador** (`assets/nf/app.js`): `NF.getJSON(url, maxAge)` / `NF.api(params, maxAge)` guardan en `localStorage` (`nfr|<NF.ck>|…`) las filas (30 min), el destacado (20 min) y la primera página de Explorar (10 min). `NF.ck` (`wp_client_cache_key()`) cambia con la sesión, el perfil, el idioma, el distribuidor y la versión. El login borra todo `nfr|`.
- **Páginas** (`wp_page_cache_headers()`): Inicio, Películas, Series, Explorar, fichas y actores salen con `Cache-Control: private, max-age=60` (cada enlace es un token nuevo, así que nunca se ve una vieja al entrar). «Cargando…» del modo navegador es `no-store`. Los enlaces al reproductor y a la salida llevan `data-noprefetch` (lo agrega `wp_route_rewrite()`). `logout.php` manda `Clear-Site-Data: "cache"`.
- Prueba: secciones «Número de distribuidor en tu dominio» y «Más rápida» de `tools/profiles_web_test.php` del panel.

## Modo navegador (el navegador le pide al servidor IPTV, nunca el hosting)

`includes/xt_client.php`, `xtfill.php` y `assets/nf/xtfill.js`. Se elige al iniciar sesión:

- `login.php` (`step=servers`) le da al navegador las direcciones en orden. Con la web en https, solo las https.
- El navegador hace `fetch` directo a `player_api.php` (CORS) y manda lo que contestó (`step=client`). La sesión queda con `xt_client = 1`.
- Si no pudo leer ninguno, el formulario sigue como siempre: lo prueba el hosting. `xt_skip` le dice qué servidores ya dijeron que no y `xt_why` va en el reporte.
- `xtcors|<servidor>`: el hosting lo comprueba una sola vez con un pedido válido. Con ese dato, una respuesta que el navegador no puede leer es «usuario o contraseña incorrectos» y no se prueba por el hosting.

Con `xt_client`:

- `xt_get_raw()` / `xt_multi()` nunca le piden al servidor IPTV. Usan lo guardado; si está vencido, lo usan igual y anotan una renovación en segundo plano (`wp_xt_need(…, false)`); si falta, lo piden al navegador (`wp_xt_need(…, true)`).
- `wp_route_rewrite()` llama a `wp_xt_output()`. Si falta algo, la página sale como «Cargando…» (`wp_xt_loader()`); el navegador lo trae, lo sube a `xtfill.php?id=` y vuelve a cargar. En JSON sale `{"xtneed": […]}`: `xtfill.js` envuelve `fetch`, lo trae y repite el pedido.
- Mientras una página espera, `wp_cache_set()` no guarda nada de lo que calcula (solo `xtneed|` / `xtbg|`).
- `xtfill.php` solo acepta lo que pidió esa misma sesión y lo guarda con `xt_cache_key()`, que lleva una huella de la contraseña.
- `wp_line_guard()` usa los datos de la cuenta que trajo el navegador, y `wp_file_tracks()` no lee archivos del servidor IPTV.
- Si el navegador no puede, `xtfill.php?fail=1` pasa la sesión al hosting (`wp_xt_disable()`, con aviso al panel una vez al día por servidor).

Regla para el código nuevo: todo pedido al servidor IPTV va por `xt_get()` / `xt_multi()`, nunca con `wp_http_get()`
directo, para que funcione el modo navegador. Prueba: sección «Modo navegador» de `tools/profiles_web_test.php` del
panel. Ahí el servidor IPTV de prueba anota quién le pide cada cosa.

## Inicio de sesión: en qué orden se prueban las DNS

`login.php` + `includes/login_probe.php`. Todos los usuarios de la web salen con la IP del hosting y cada DNS donde el
usuario no existe le cuenta a XUI un intento fallido: XUI termina bloqueando la IP (protección contra flood). Por eso:
la última DNS del usuario sola; después de a una (`wp_login_order()`, los servidores más usados por distribuidor) hasta
la primera que acepta; https solo si en http nadie contestó. Si todas rechazan la conexión, `wp_login_diagnose()`
averigua si es el hosting (puerto de salida), XUI (IP bloqueada) o el servidor, y va en el reporte al panel. La regla
para todas las apps y cómo leer el reporte: `docs/LOGIN-SERVIDORES.md` del panel.

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
  - `wp_prof_highlights()`: lo más destacado de la semana, 15 a 20 títulos con fondo (`api/tmdb.php?path=trending/all/week`
    del panel, página 1 y la 2 si no llegan a 15, con la clave del distribuidor o la del dueño con Omitir, 6 h en caché
    por idioma); `wp_prof_bg()` arma las direcciones de cada uno (Full HD y el original 4K por `srcset`). `profiles.js`
    (`slides()`) pasa de uno a otro cada 10 s con un fundido entre dos capas `.pf-bg` (la nueva aparece recién cuando
    cargó) y, después del último, vuelve al primero; el nombre de abajo a la derecha cambia con la imagen. En horizontal
    las capas y `.pf-shade` van a pantalla completa, como Netflix en el televisor: el color del tema entra con un
    degradado suave desde el borde izquierdo hasta el 66 % del ancho y abajo y arriba solo un sombreado leve; en vertical,
    arriba de lado a lado (22 % del alto).
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
  (`#pfKids` en `profiles.js`, campo `kids`). **Con TMDB (2.6.2):** `wp_kids_item_level()` deja cada título seguro /
  dudoso / fuera; `wp_kids_rate_schedule()` pide al panel (`api/kids_rate.php`) los que no tienen veredicto, después de
  contestar la página (cada 15 s como mucho por distribuidor; sin PHP-FPM / LiteSpeed solo 150 por vez para no demorar);
  `wp_kids_rate_map()` guarda `ok` / `no` / `?` por distribuidor (`kids|rate`) y `kids|raterev` hace que el catálogo
  infantil (`kidscat2|…`) se vuelva a armar. Lo dudoso se ve solo con `ok`; lo que dice `no` nunca. Al abrir `perfiles.php` se borra `nf_hero_bg` de `sessionStorage` (el fondo
  que `app.js` deja mientras carga el destacado) para que un perfil nunca vea el banner de otro; en el inicio infantil el
  «Bienvenido» sin destacados no usa el collage `assets/images/overlay.webp`.
- **Con número de distribuidor**, `perfiles.php` usa su logo y nombre (`wp_brand_logo`, `wp_brand_name`), sus variables
  (`wp_tenant_css`) y `wp_prof_theme_css()` (`includes/profiles.php`): `--pf-bg`, `--pf-bg-rgb`, `--pf-card`,
  `--pf-focus`, `--pf-on` para el fondo, las sombras, los diálogos, el foco y el interruptor; sin paleta (Omitir) no se
  define nada y `profiles.css` usa el negro y blanco de siempre. «Eliminar perfil» es rojo fijo. En vertical
  `profiles.js` (`fitTop`) pone `--pf-logo-w` con el ancho del logo para correr «Administrar perfiles» y, si no entra el
  texto, lo deja solo con el lápiz (`.pf-icon-only`, con `aria-label`).
- **Prueba:** desde el repo del panel, `WP_DIR=/ruta/a/esta/web php tools/profiles_web_test.php` (Chromium contra una
  copia del panel con datos inventados; el servidor IPTV de prueba trae un catálogo pequeño para el perfil infantil).
