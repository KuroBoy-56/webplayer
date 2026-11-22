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
3. Orden del video con la web en https: https directo del servidor IPTV (si lo tiene) → VPS / VDS de la línea → `play.php` por http (solo con Forzar HTTPS apagado). **Desde la 2.9.1 el video nunca pasa por el hosting** (`proxy.php` contesta 403 siempre): sin VPS / VDS y con Forzar HTTPS, el reproductor ofrece «Solucionar» (motor de la VPS / VDS) o VLC. El respaldo de películas y episodios y la lectura de idiomas (`tracks.php`) también van por la VPS / VDS de la línea.

El relay de Cloudflare de versiones anteriores ya no se usa: puedes borrar el Worker de Cloudflare e `includes/https_relay.php` del hosting.

**Distribuidor que no usa tus recursos:** en el panel, Distribuidores › Editar › «Solo sus recursos». Su web y sus apps solo usan su VDS propia; sin ella, el video va directo del servidor IPTV y nunca pasa por tu VPS ni por este hosting.

**Cloudflare solo para los dominios:** la web, el panel y los dominios de tus distribuidores pueden estar en Cloudflare (nube naranja para esconder la IP de Hostinger y proteger el dominio principal, o gris si prefieres el SSL de Hostinger). El registro de la **VPS / VDS va con nube gris** (solo DNS): así el video nunca pasa por Cloudflare.

**Dominio propio con un Worker (opcional):** el cliente entra por un dominio nuevo (el tuyo o el de cada distribuidor, sin límite) y el dominio original de la web responde **403 Forbidden**. El Worker (`cloudflare/edge-worker.js`) abre la web por dentro con un secreto; la web (`includes/edge.php`) solo atiende con ese secreto y toma el dominio y la IP real del cliente. Cada secreto puede llevar el número de un distribuidor: en su dominio la web queda fija en él. Se configura con `'edge_keys'` (y `'edge_block'` para probar) en `includes/panel_secret.php`; sin eso la web funciona exactamente igual. Paso a paso con dibujos: **`docs/GUIA-WORKER.html`** (ábrelo en tu PC; en el hosting `docs/` y `cloudflare/` están bloqueados).

## Puente para servidores sin SSL (2.9.0)

`includes/xt_relay.php` + `cloudflare/edge-worker.js`. Solo con la web abierta por un Worker nuevo (manda `X-MPX-Relay: 1`; `wp_edge_boot()` guarda su secreto en `$GLOBALS['wp_edge_key']`) y en https:

- `wp_xt_relay_base($url)` → `xtr/<firma>.<vence>/http/<servidor:puerto>`. La firma es un HMAC-SHA256 con el secreto del Worker de `xtr|esquema|servidor:puerto|vence` (base64url, 22 caracteres); vence en 2-3 días y es igual todo el día. Solo servidores con nombre y sin carpeta.
- `wp_xt_login_cands()` agrega el puente después del https directo. En `step=client`, `wp_xt_relay_target()` da la dirección real y `wp_xt_relay_check()` comprueba la línea desde el hosting por el puente (`https://<este dominio>/xtr/…`): nunca se confía en lo que manda el navegador. La sesión queda con la dirección real del servidor.
- `wp_xt_need()` le da al navegador `wp_xt_browser_url(xt_url(…))`: lo que trae `xtfill.js` también va por el puente.
- El Worker solo acepta `GET /xtr/<firma>.<vence>/<http|https>/<servidor:puerto>/player_api.php` con firma válida y vigente (403 si no, 404 otra ruta) y no guarda nada.
- Prueba: `tools/web_relay_test.php` del panel (la web en https detrás del Worker de verdad, en Node, con un servidor IPTV que el hosting no encuentra).

## Carátulas, token del panel y catálogo por partes (2.9.1)

- **Carátulas por el puente:** `wp_xt_relay_img($url)` (`includes/xt_relay.php`) da `/xtr/<firma>.<vence semanal>/http/<servidor:puerto>/<ruta>.jpg` para una imagen http (o https del mismo servidor de la línea cuando la línea va por http). `wp_img()` la usa antes que `img.php` del hosting y `wp_poster_sources()` la pone después de la copia del panel (`imgc`) y antes de `img.php` del panel. El Worker solo la entrega si es una imagen (.jpg .png .webp .gif .bmp, tipo `image/*`, hasta 10 MB) y Cloudflare la guarda una semana.
- **Token del panel aunque el panel no llegue al servidor IPTV:** muchos servidores bloquean la IP del hosting y del panel. `wp_panel_auth_body()` (`includes/panel.php`) firma la línea ya comprobada por la web (`wv`, `wts`, `wca`: HMAC con una llave sacada de la llave maestra). El panel (`client_web_vouch()` en `includes/client_auth.php`) la acepta solo si no pudo preguntarle al servidor, si la firma tiene menos de 10 minutos, viene de la web (`platform=web`) y el servidor está en las DNS del distribuidor; si el servidor contesta «no», sigue siendo no. Con el token llegan las carátulas del panel, la clave de TMDB, Continuar viendo, Mi lista, perfiles y la VPS / VDS del video.
- **Catálogo por partes:** Inicio, Películas, Series, Explorar y las fichas definen `WP_XT_SOFT`: en el modo navegador salen al momento sin la pantalla «Cargando…» y el catálogo completo se trae por detrás (`wp_xt_soft()` en `includes/xt_client.php`, salvo en un perfil infantil). Cada fila (`api.php?action=row`) espera lo suyo; una fila de una categoría y su «Ver todo» llegan solos con `get_vod_streams&category_id=` (`wp_cat_list_quick()`) mientras llega el catálogo completo. `wp_cat_derive()` no guarda cálculos hechos sin catálogo. El navegador espera el catálogo completo hasta 3 minutos (`xtfill.js`).
- Pruebas: `tools/web_relay_test.php` del panel (carátulas por el Worker, firma de la línea, catálogo por partes con un servidor lento).

## «Continuar viendo» como Roku y Vega (2.9.12)

- `wp_panel_userdata()` pide `progress.php?v=2&play=1`; `wp_user_progress()` trae `play` (`wp_play_clean()`: `{a, ai}`). `wp_play_hint($slug, $id, $seriesId)` (`includes/panel.php`) da el idioma para el video que se abre: el de la película, o el de la serie (`a` para todos sus capítulos, `ai` solo para el mismo). Va al reproductor como `cfg.play`, con `cfg.tkey` (`movie_<id>` / `series_<id>`), también en `play.php` (dato `play` del enlace).
- `assets/nf/player.js`: `titleWant()` (lo de este navegador en `localStorage` `nfp_tlang`, 180 días, 400 títulos; si no, `cfg.play`), `titlePick(list)` (por `lang2`, desempata con `ai`) dentro de `pickAudio()`, `prefAudioIndex()` y `applyAudioPref()`; `rememberTitleAudio()` al elegir en el menú (la primera pista o «Automático» = predeterminado: se borra y en esa sesión se manda `{a: ""}`); `playHint()` lo que va con el avance. Cada pista de `audioList()` trae `ai`.
- `video_player.php` / `play.php` mandan `play_a` / `play_ai` con el avance; `wp_progress_play()` (`includes/progress_save.php`) los pasa al panel como `play`. Contrato: `docs/AVANCE-COMPARTIDO.md` del panel.
- `playMp4()`: con un solo audio sigue con `NFMp4` si el moov llegó del índice compartido (`m.shared`) o si hay `resume`; si no, el reproductor del navegador como antes.
- Pruebas del panel: `tools/web_play_hint_test.mjs` (elección de pista, lo que se manda, decisión del lector MP4) y `tools/web_relay_test.php` (el idioma va y vuelve por el panel de prueba).

## Logos de canales sin depender del hosting (2.9.11)

- `wp_logo_sources($url)` (`includes/core.php`), en orden: el original (logo https o web en http), `wp_xt_relay_img()` (Worker; no para servidores con IP), `img.php?…&fb=2` del hosting, `wp_panel_logo_url()` (`img.php?w=200&token=` del panel: lo baja el panel, solo imágenes de 80 px o más) y, con la web en https y el logo http, la misma dirección por https. La marca (`CH_FB`) la pone la página al final.
- `img.php`: `&fb=2` contesta 404 (`Cache-Control: private, max-age=600`; marca de falla 6 h) en lugar de redirigir a la marca, para que la página pruebe el siguiente camino; `&fb=1` sigue igual para los enlaces viejos. Si no puede guardar en `includes/cache/img`, entrega la imagen desde la memoria (antes salía vacía).
- `wp_secret()`: si no puede guardar `includes/cache/.key.php`, usa una clave fija sacada de `master_key_hex` (antes una al azar en cada página: `img.php` respondía 403 a todo).
- `tvguide.php`: `chLogoNext()` da 6 s a cada dirección que no es la primera; los logos van con `referrerpolicy="no-referrer"`.
- Pruebas del panel: `tools/web_img_logo_test.php` (caché sin permiso, clave sin guardar, 404 con `&fb=2`, orden de los caminos; con la 2.9.10 fallan 4) y `tools/web_relay_test.php` (un logo que no existe en ningún lado termina en la marca en ~4 s).

## Logos de canales por el navegador y tarjetas de Deportes (2.9.10)

- `wp_logo_sources($url)` (`includes/core.php`): direcciones del logo de un canal en orden: el original (solo si es https o la web va en http), `wp_xt_relay_img()` (Worker, logo http con la web en https) y `wp_logo()` (`img.php` del hosting, `&fb=1`: si falla redirige a `wp_channel_fallback()`). Sin logo: `[wp_channel_fallback()]`.
- `tvguide.php`: `ajax=channels` da `i` (primera dirección), `j` (las demás) y `p` (el original, para el póster de Mis favoritos). `chLogoNext()` / `chLogoOk()` / `chLogoSet()` prueban las direcciones en orden (una imagen de menos de 4 px cuenta como fallida) y terminan en `CH_FB`. `ajax=channel` de un canal elegido en la lista no trae logo (`logos: []`, lo pone la página); con `?id=` trae `logos`. La búsqueda (`api.php?action=search`, `live`) usa `i` + `f` de `NF.card`.
- `sportsschedule.php`: `.sp-card` con `grid-template-columns: minmax(0, 1fr)` y `min-width: 0` en sus hijos (antes un texto de una línea ensanchaba la columna y empujaba `.sp-pill` y `.sp-tv` fuera de la tarjeta); `.sp-teams` con `minmax(0, 1fr)`; `.sp-single` hasta 3 líneas.
- Pruebas del panel: `tools/web_relay_test.php` (logos en un servidor que el hosting no alcanza: se ven por el Worker; el logo grande es el mismo de la lista) y `tools/web_sports_card_test.mjs` (tarjetas con textos largos a 1366, 900, 600 y 360 px; con la 2.9.9 fallan 24).

## Fondo de TMDB en los destacados y TV en vivo inmediata (2.9.9)

- `wp_hero_art()` (`includes/hero.php`): primero el fondo de TMDB (`wp_tmdb_details()`, `w1280`) y, solo si TMDB no tiene, `backdrop_path` de la ficha del servidor. Sin red (`$net = false`) y TMDB sin buscar todavía, el título queda pendiente (`[ '', $info, false ]`) y lo resuelve `api.php?action=heroart`. Sin TMDB (`wp_tmdb_on()` falso), como antes: el del servidor.
- `tvguide.php`: `ajax=channel` ya no trae la guía; `ajax=epg&id=` la da aparte. `openChannel()` marca el canal (`markActive()`, sin volver a dibujar la lista), pone nombre y logo de `state.channels`, corta el reproductor y muestra `.tv-wait`; `state.seq` descarta respuestas de un canal elegido antes. La página manda `n` (nombre) y `tv_channel_row()` lo usa; el logo lo pone la página (2.9.10). Sin ellos (enlace `?id=`), `tv_channel_map()` (`id => [nombre, logo]` guardado aparte mientras no cambie la caché de `get_live_streams`). Los favoritos en vivo llegan una vez en `state.favs` (`'fav' => null` en `ajax=channel`).
- Pruebas del panel: `tools/web_hero_art_test.php` (TMDB antes que el servidor, el servidor si TMDB no tiene, pendiente si TMDB no se buscó) y `tools/web_relay_test.php` (con la guía del servidor tardando 3 s y el canal 1 s: el canal se marca a los ~40 ms, el reproductor sale al segundo y la guía después; con la 2.9.8, nada al hacer clic y todo junto a los ~5 s).

## Pósters de TMDB, orden de las claves y flechas de Plataformas (2.9.8)

- `wp_tmdb_key_list()` (`includes/core.php`): claves en orden: `tmdb_key` de `includes/panel_secret.php` (o `WP_TMDB_KEY`; nunca para un distribuidor con «Solo sus recursos») y la del panel (`panel|tmdbkey`). `wp_tmdb_key()` es la primera y `wp_tmdb_keys()` (`includes/actor.php`) la lista. Una clave que TMDB rechaza (401, `status_code` 7) queda marcada un día con `wp_tmdb_key_bad()` y se usa la siguiente.
- `NF.posters()` (`assets/nf/app.js`) corre en todas las tarjetas (antes solo en las que no tenían la caché del panel): la carátula del servidor sale al momento y el póster de TMDB (`api.php?action=posters`, `w500`) la reemplaza cuando carga. La memoria del navegador (`nfp|…`) sube los `w342` de antes a `w500`.
- `wp_platform_tiles()` (`includes/ui.php`) arma `.nf-plats-row` con `.nf-arrow` a los lados; `setupRow()` también la maneja (desplaza `.nf-platforms`).
- Prueba del panel: `tools/web_tmdb_panel_test.php` (orden de las claves, clave rechazada, distribuidor y «Solo sus recursos»).

## Imagen del destacado y logo de canal por marca (2.9.5)

- `NF.hero()` (`assets/nf/app.js`): `art(it, cb)` prueba solo las imágenes de ese título (`background_image`, `background_fb`, `poster`, `poster_fb`; 12 s). Si ninguna carga, el título sale del carrusel y pasa el siguiente; si no carga ninguno, queda sin fondo. Un cambio pedido después anula al anterior (`seq`).
- `wp_channel_fallback()` (`includes/tenant_brand.php`): imagen de un canal sin logo. Con Omitir es `WP_LOGO`; con distribuidor, su logo; sin logo, `WP_NOIMG`. La usan `wp_logo()`, la redirección de `img.php?…&fb=1` (con `Cache-Control: private`, porque depende del distribuidor) y el `onerror` de `tvguide.php` (`CH_FB`).
- Pruebas del panel: `tools/web_relay_test.php` (la imagen cambia con el título) y `tools/profiles_web_test.php` (canal sin logo con y sin distribuidor).

## Destacados progresivos (2.9.4)

- `includes/hero.php`: `wp_hero_pool()` (candidatos, 20 min; en Inicio, con un solo catálogo listo, una lista parcial de 90 s con ese), `wp_hero_art()` (fondo de TMDB y, si no tiene, el del servidor —2.9.9—; sin red: solo lo guardado), `wp_hero_list()` (`api.php?action=hero` → `{items, pending}` al momento, sin esperar nada) y `wp_hero_one()` (`api.php?action=heroart&type=&t=&id=`: uno, con su ficha del servidor —en el modo navegador por xtneed— y TMDB).
- `assets/nf/app.js`: `NF.heroLoad(root, type, {empty})` arranca con `items`, pide `pending` de a dos y los suma con el controlador de `NF.hero()` (`add`, cambio cada 10 s); `empty()` cuando no hay ninguno con fondo (Inicio: collage «Bienvenido»; Películas / Series: sin banner).
- Prueba: `tools/web_relay_test.php` (Inicio con un servidor lento: el primer destacado en ~1,5 s y el carrusel se va llenando; cambio a los 10 s).

## TMDB de un distribuidor sin clave (2.9.3)

- `wp_tmdb_url($path, $query)` (`includes/core.php`): directo con la clave de la línea (`wp_tmdb_key()`) o, si no hay, por el panel (`api/tmdb.php?path=…`, clave del dueño) cuando `wp_tmdb_via_panel()`: no para un distribuidor con «Solo sus recursos» (`features.hosting_video === false` de tenant_config). `wp_tmdb_on()` reemplaza los `if (!wp_tmdb_key())`. Todas las llamadas a TMDB (búsqueda, fichas, carátulas, temporadas, actores) pasan por ahí.
- Destacado: la espera por las fichas del servidor (`xt_multi` bloqueante) se hace una vez por sesión cada 2 min (`heroask|`).
- Pruebas (panel): `tools/web_tmdb_panel_test.php` (reglas), `tools/web_relay_test.php` (carrusel con TMDB por el panel).

## Carrusel, capítulos e idiomas (2.9.2)

- **Modo navegador sin rendirse por una ficha:** `xtfill.js` solo pasa la sesión al hosting (`xtfill.php?fail=1`) si el navegador no pudo leer nada del servidor (sin red o sin CORS en todos los pedidos). Una ficha (`get_vod_info`, `get_series_info`, `get_short_epg`, `get_simple_data_table`) con error HTTP o respuesta rota se marca vacía (`xtfill.php?id=…&empty=1`: vale 10 min para quien la lee con 24 h, para los demás ya vencida, así se vuelve a pedir).
- **Destacado:** `api.php?action=hero` usa el fondo del servidor y, si no hay, el de TMDB (`wp_tmdb_details(…, $cacheOnly)`: primero lo guardado, después búsquedas hasta 4 s).
- **Capítulos:** `includes/episodes.php` (`wp_tmdb_season`, `wp_eps_fill`) arma `img` + `fb` (servidor → foto de TMDB → fondo → carátula) y completa nombre y sinopsis; `api.php?action=eps&id=&s=` hace lo mismo para otra temporada.
- **Idiomas y subtítulos:** `wp_file_tracks()` lee la cabecera por la VPS / VDS de la línea (`wp_vps_relay`) también en el modo navegador; `video_player.php` y `play.php` siempre le dan al reproductor `tracks` cuando los audios no se saben. `player.js`: un audio que el navegador no reproduce, ya conocido o recién llegado, va a la conversión (`startTc`); sin motor (`do=status` → `ffmpeg: false` o 503) el video sigue directo con el aviso.
- Pruebas (panel): `tools/web_relay_test.php` (carrusel con fichas que fallan, capítulos), `tools/web_tracks_test.php` (MKV con 2 audios AC3 y 2 subtítulos por la VPS), `tools/web_player_audio_test.php` (reproductor con la conversión encendida y apagada).

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
