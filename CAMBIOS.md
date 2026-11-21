# WebPlayer: resumen de cambios

Desde la actualización del 4 de octubre **todo se administra desde el panel** (ver la última sección). Las secciones de abajo describen la historia de cambios. Donde mencionan el administrador, `setup.php`, `dns.json`, `admin.json`, `progress.json`, `userdata.sqlite`, el proxy de video (`proxy.php`), la conversión con ffmpeg (`media.php`, `bin/`) o el botón DNS, eso ya no existe: el video va directo del servidor IPTV al navegador.

**Requisitos:** PHP 7.1 o superior con las extensiones `curl` y `openssl` (ffmpeg ya no se usa en el hosting: la conversión la hace el motor del panel en la VPS / VDS). La carpeta `includes/cache/` debe tener permisos de escritura. Hace falta `includes/panel_secret.php` (ver abajo).

## Vista previa de TV en vivo más chica: más lugar para la guía — versión 2.9.6 (21 de noviembre, novena parte)
- En la computadora la vista previa de TV en vivo ocupaba hasta el 62 % del alto de la pantalla y la guía de programas quedaba con 4 o 5 programas a la vista.
- Ahora es un poco más chica, siempre en 16:9 y centrada (46 % del alto: en 1920×1080, 883×497 en lugar de 1241×670), y la guía muestra casi el doble (en 1920×1080 de unos 5 a 9 programas). En el celular no cambia.
- Archivo: `tvguide.php`.

## Imagen del destacado y logo de los canales del distribuidor — versión 2.9.5 (21 de noviembre, octava parte)
- **El problema del destacado:** en Inicio, Películas y Series, cuando el fondo de un destacado no cargaba, la web cambiaba el título y la sinopsis pero dejaba la imagen del anterior: se veía siempre la misma película mientras el texto cambiaba.
- **Ahora:** cada destacado muestra solo su propia imagen: su fondo (el del panel en Full HD o el original) y, si no carga, su carátula. Si no carga ninguna, ese título sale del carrusel y pasa el siguiente; nunca se ve la imagen de otro título.
- **Logo de los canales en vivo:** un canal sin logo, o cuyo logo no carga, muestra el logo del distribuidor con su número. El logo del dueño solo aparece con la web del dueño. Un distribuidor sin logo no ve ninguno, como en las apps de TV.
- Archivos: `assets/nf/app.js`, `header.php`, `img.php`, `tvguide.php`, `includes/core.php`, `includes/tenant_brand.php`.

## Carrusel de destacados como en la TV — versión 2.9.4 (21 de noviembre, séptima parte)
- **El problema:** la web esperaba a tener todos los destacados listos (16 en Inicio: la ficha de cada uno del servidor y, sin fondo, la búsqueda en TMDB) antes de mostrar el primero. Con el servidor del distribuidor (por el Worker) eso tardaba tanto que en Inicio el pedido se cortaba y quedaba la imagen fija; en Películas y Series tardaba mucho, y lo que llegaba se guardaba 20 minutos aunque fuera uno solo (sin carrusel).
- **Ahora, como en la TV (Roku, Vega, Android TV):** el destacado sale al momento con los que ya tienen su fondo y los demás se piden de a dos y se suman al carrusel a medida que llegan. En Inicio, si las series todavía no llegaron, empieza con las películas y suma las series después. Cambia solo cada 10 s, como en la TV.
- El collage «Bienvenido» (cuando no hay ningún destacado con fondo) ya no queda de fondo en las demás páginas mientras cargan las suyas.
- Archivos: `api.php`, `homex.php`, `includes/hero.php` (nuevo), `includes/ondemand.php`, `includes/core.php`, `header.php`, `assets/nf/app.js`.

## Carrusel de destacados del distribuidor sin clave de TMDB — versión 2.9.3 (21 de noviembre, sexta parte)
- **El problema:** el carrusel necesita un fondo horizontal por título. Si el servidor IPTV no lo trae, la web lo busca en TMDB, pero con un distribuidor solo usaba la clave de TMDB del distribuidor: sin clave propia no había fondos y el carrusel no salía (en Inicio la imagen fija «Bienvenido»; en Películas y Series nada). Las apps de TV en ese caso usan otra clave, por eso ahí sí se veía.
- **Ahora:** un distribuidor sin clave propia usa TMDB por el panel (`api/tmdb.php`, con tu clave y su caché de 24 h), como Roku, Vega y Android: fondos del carrusel, fichas, carátulas que faltan, capítulos y actores. Con «Solo sus recursos» no se usa nada tuyo. Con su propia clave, la suya, como antes.
- **El carrusel ya no espera dos veces:** si una ficha no llegó del servidor, sale con las demás (y el fondo de TMDB) en lugar de volver a esperar y quedar vacío.
- **Capítulos:** si las imágenes de TMDB no cargan, el último respaldo es la carátula del servidor.
- Archivos: `api.php`, `seriesvideo.php`, `includes/core.php`, `includes/episodes.php`, `includes/actor.php`.

## Carrusel de destacados, vista previa de capítulos, idiomas y subtítulos — versión 2.9.2 (21 de noviembre, quinta parte)
- **Carrusel de destacados como en la TV:** si el servidor no daba la ficha de un solo título (error o respuesta rota), la web se «rendía» y pasaba la sesión al hosting; con un servidor que bloquea al hosting (el del distribuidor) el destacado quedaba con una sola imagen fija y las fichas podían fallar. Ahora una ficha que falla queda vacía 10 minutos y lo demás sigue; la sesión solo pasa al hosting si el navegador no pudo leer **nada** del servidor. Además, sin fondo en el servidor se usa el de TMDB (como Roku, Vega y Android TV), primero lo ya guardado y hasta 4 s de búsqueda.
- **Vista previa de los capítulos:** la imagen de cada capítulo del servidor (por el Worker si hace falta) → la foto del capítulo en TMDB → el fondo de la serie → su carátula. Si el servidor solo trae «Episodio 2» o «Serie - S01E02», o no trae sinopsis, se usan las de TMDB. Las demás temporadas se completan al elegirlas.
- **Idiomas y subtítulos bien detectados:** en el modo navegador (siempre con el servidor del distribuidor) el hosting no leía la cabecera del archivo y, si ninguna TV lo había leído antes, la web no sabía los audios ni los subtítulos (un audio Dolby sonaba mudo y los subtítulos internos no aparecían). Ahora se lee por la VPS / VDS de la línea, como las apps de TV (el servidor IPTV nunca ve al hosting), y queda en el panel para todas las apps.
- **Audio no compatible → conversión por la VPS / VDS:** si ya se sabe que el audio es Dolby / DTS (o el video no lo abre el navegador), arranca directo con la conversión del motor del panel: la VDS del distribuidor si eligió la suya, si no la VPS del dueño, todo aislado. Si las pistas llegan con el video ya empezado, pasa a la conversión al momento.
- **Con la conversión apagada (dueño o distribuidor):** el video se reproduce normal, directo; lo que el navegador no puede reproducir solo muestra el aviso (por ejemplo «audio Dolby… ábrelo en Safari, Edge o VLC»), sin errores ni esperas, y los menús muestran solo lo que el navegador puede usar.
- Archivos: `api.php`, `seriesvideo.php`, `video_player.php`, `play.php`, `xtfill.php`, `includes/core.php`, `includes/episodes.php` (nuevo), `includes/file_tracks.php`, `includes/xt_client.php`, `assets/nf/player.js`, `assets/nf/xtfill.js`.

## El video nunca pasa por el hosting, carátulas del distribuidor y catálogo por partes — versión 2.9.1 (21 de noviembre, cuarta parte)
- **El video nunca toca el hosting:** va directo del servidor IPTV al navegador o por la VPS / VDS de la línea, según el panel (la VDS propia del distribuidor si la eligió; con «Solo sus recursos», solo su VDS; si no, la VPS del dueño). Antes, sin VPS / VDS, el hosting quedaba como último recurso y de respaldo en películas y episodios: ya no. El respaldo y la lectura de los idiomas también van por la VPS / VDS. `proxy.php` contesta 403 siempre. El hosting solo sirve las páginas.
- **Carátulas y destacados del distribuidor:** su servidor IPTV rechaza la IP del hosting y del panel y su https tiene un certificado casero, así que las carátulas guardadas en ese servidor no cargaban por ningún camino. Ahora van por el **Worker de Cloudflare** (solo imágenes, guardadas una semana). **Hay que volver a pegar el código del Worker** (`docs/GUIA-WORKER.html`, paso 3).
- **Token del panel para esas líneas:** el panel no podía comprobar la línea con ese servidor y no daba el token: sin carátulas del panel, TMDB, Continuar viendo, Mi lista ni la VPS / VDS. Ahora la web firma la línea que ya comprobó (con la llave maestra) y el panel la acepta solo cuando no puede preguntarle al servidor; si el servidor dice que no, sigue siendo no. **Hay que subir el archivo del panel** `includes/client_auth.php`.
- **Catálogo por partes:** Inicio, Películas, Series, Explorar y las fichas se muestran al momento, sin la pantalla «Cargando…»; el catálogo completo llega por detrás y las filas se llenan solas. Las filas de cada categoría y su «Ver todo» llegan solos, sin esperar el catálogo completo. Un catálogo grande puede tardar hasta 3 minutos en llegar sin que la web se rinda.
- **Contenido bajo la barra de arriba:** en Películas y Series sin destacados, el título, «Categorías» y los géneros quedaban debajo de la barra (dueño y distribuidor, PC, tablet y celular). Ahora bajan. En el destacado, un título largo en una pantalla baja (laptop) ya no sube hasta la barra: máximo 2 líneas y la sinopsis más corta si falta alto.
- **Carátulas de TMDB guardadas por servidor:** el dueño y un distribuidor en el mismo navegador ya no se mezclan las carátulas (el mismo número es otro título en otro servidor).
- Archivos: `includes/core.php`, `includes/tenant.php`, `includes/file_tracks.php`, `includes/handoff.php`, `includes/panel.php`, `includes/panel_img.php`, `includes/xt_relay.php`, `includes/xt_client.php`, `includes/catalog_fast.php`, `includes/ondemand.php`, `includes/tenant_guard.php`, `api.php`, `login.php`, `homex.php`, `browse.php`, `Movie_description.php`, `seriesvideo.php`, `video_player.php`, `tvguide.php`, `play.php`, `perfiles.php`, `diag.php`, `header.php`, `assets/nf/app.css`, `assets/nf/app.js`, `assets/nf/xtfill.js`, `cloudflare/edge-worker.js`, `docs/GUIA-WORKER.html`.

## Puente para servidores IPTV sin SSL (web en https) — versión 2.9.0 (21 de noviembre, tercera parte)
- **El problema:** con la web en https el navegador no deja pedir nada a un servidor IPTV que solo tiene http (o un certificado casero o vencido). Entonces todo iba por el hosting, y muchos servidores rechazan al hosting: «El servidor de video no está dejando entrar a la web».
- **Ahora:** si la web se abre por un dominio con el **Worker de Cloudflare** (el nuevo código de `cloudflare/edge-worker.js`), el navegador le pide a la misma web `xtr/…/player_api.php` y el Worker se lo pide al servidor IPTV. Entran el inicio de sesión, el catálogo, las fichas, la cuenta y la guía. El servidor ve la IP de Cloudflare, nunca la del hosting.
- **Seguro:** solo `player_api.php` y solo `GET`, nunca video ni otro archivo. Solo pasan los servidores que la web firmó con el secreto de ese Worker, y la firma vence en pocos días. Al entrar por el puente el hosting comprueba la línea también por el puente: una respuesta inventada desde el navegador no entra.
- **Orden al entrar:** primero el https del servidor directo desde el navegador (si tiene uno válido), después el puente y, al final, el hosting como antes. Sin el Worker nuevo, o con la web abierta por el hosting, todo sigue igual.
- **Límites:** un servidor configurado con una IP (sin nombre) no puede ir por el puente (Cloudflare no deja). Con un puerto propio (`:8080`), el Worker tiene que tener la fecha de compatibilidad 2024-09-02 o más nueva. El video de un servidor http sigue por la VPS / VDS del motor, como antes.
- **Hay que volver a pegar el código del Worker** en Cloudflare (`docs/GUIA-WORKER.html`, paso 3) en cada dominio con Worker.
- Archivos: `includes/xt_relay.php` (nuevo), `includes/edge.php`, `includes/core.php`, `includes/xt_client.php`, `login.php`, `cloudflare/edge-worker.js`, `docs/GUIA-WORKER.html`.

## La dirección decide el distribuidor (sin pantalla «Número de distribuidor») — versión 2.8.1 (21 de noviembre, segunda parte)
- **Tu dominio es tu web:** `tudominio/login` ya no pide el número ni muestra «Omitir» ni «Cambiar distribuidor» (tampoco en Mi cuenta). Es la web de siempre del dueño.
- **El enlace del distribuidor ya trae todo:** `tudominio/login?d=NÚMERO` (o `tudominio/?d=NÚMERO`) abre su web con su logo, nombre y colores, sin escribir nada. El panel lo muestra en el perfil del distribuidor mientras tenga la web player encendida.
- **Web player apagada, número que no existe, vencido o suspendido:** su enlace muestra solo el aviso («Este número de distribuidor no está habilitado…»), sin el formulario. Las sesiones abiertas se cierran en la próxima revisión (como mucho 10 minutos).
- **Siempre vuelve a la web de su distribuidor:** «Cerrar sesión», una sesión vencida, una línea vencida o bloqueada y un enlace viejo llevan a `login?d=NÚMERO` del distribuidor con el que se entró (este navegador lo recuerda), nunca a la web del dueño. Con una sesión de otro abierta, el enlace de un distribuidor la cierra y muestra su inicio de sesión.
- **Dominio propio de un distribuidor:** igual que antes (su secreto en `panel_secret.php`); ahí la web queda siempre en su número.
- Archivos: `includes/tenant.php`, `includes/tenant_login.php`, `includes/tenant_guard.php`, `includes/line_guard.php`, `includes/web_device.php`, `includes/lang/en.php`, `includes/lang/pt.php`, `includes/lang/fr.php`, `login.php`, `logout.php`, `route.php`, `session.php`, `myaccount.php`, `header.php`, `assets/nf/app.js`, `includes/core.php` (versión).

## Más rápida y con caché, y el número de distribuidor en tu dominio — versión 2.8.0 (21 de noviembre)
- **Inicio, Películas, Series y Explorar mucho más livianos para el hosting:** cada fila de Inicio (unas 20), cada página de Explorar y cada ficha leían el catálogo entero de la línea (40.000 títulos ≈ 10 MB), lo filtraban y lo ordenaban: 150-350 ms y unos 100 MB de memoria por pedido. Ahora cada resultado (una fila, una página de Explorar, los «Similares» de una ficha, los géneros que hay, los títulos que siguen en el servidor) queda guardado aparte mientras el catálogo no cambie: una fila se contesta en milisegundos con 1 MB. El orden (recientes, A-Z, calificación) es el mismo pero hasta 8 veces más rápido.
- **El catálogo vencido ya no congela una página:** cada 30 minutos una página esperaba que el hosting bajara el catálogo completo del servidor IPTV. Ahora se usa el de antes y el nuevo se baja después de contestar (sin hacer esperar a nadie); en el modo navegador lo trae el navegador por detrás y el catálogo ligero queda listo al subirlo.
- **Lo ya cargado no se vuelve a cargar:** las filas de Inicio, el destacado y la primera página de cada filtro de Explorar quedan guardados en el navegador (atados a la sesión, el perfil y el idioma). Al recargar o al volver salen al instante; si tienen más de 5 minutos se piden otra vez por detrás para la próxima. Al cerrar sesión se borran. Las carátulas que se buscaron en TMDB (y las que TMDB no tiene, por 2 días) también quedan guardadas: al recargar Inicio se hacen 5 pedidos en lugar de 59.
- **«Atrás» al instante y la precarga que sí sirve:** las páginas para mirar (Inicio, Películas, Series, Explorar, fichas, actores) se guardan 60 s en el navegador. Antes la sesión mandaba «no guardar» a todas: la precarga al pasar el mouse pedía cada página dos veces y «Atrás» la volvía a armar. El reproductor, la salida y los pagos nunca se precargan. Si se vio algo, «Atrás» vuelve a pedir la página (Continuar viendo al día); pasado un minuto, comprueba que la sesión siga abierta.
- **El número de distribuidor en tu dominio, sin dominio propio:** el número va en cada paso del inicio de sesión, no solo en la cookie. Con un navegador que no la guardaba, el login directo desde el navegador se saltaba y quedaba en manos del hosting (y un servidor IPTV que bloquea la IP del hosting no dejaba entrar). Además cada distribuidor tiene su enlace: **`tudominio/login?d=NÚMERO`** (o `tudominio/?d=NÚMERO`) abre la web ya con su número, logo y colores, sin escribir nada. El panel lo muestra en Distribuidores y en «Mi cuenta» del distribuidor (con la dirección de la web player puesta en Guía EPG).
- Archivos: `includes/catalog_fast.php` (nuevo), `includes/core.php`, `api.php`, `homex.php`, `Movie_description.php`, `seriesvideo.php`, `xtfill.php`, `session.php`, `includes/route_token.php`, `logout.php`, `header.php`, `assets/nf/app.js`, `video_player.php`, `login.php`, `includes/tenant_login.php`, `index.php`, `includes/ondemand.php`.

## El destacado de Inicio, Películas y Series vuelve a verse — versión 2.7.5 (19 de noviembre, cuarta parte)
- **Destacado vacío en el modo navegador (2.7.0):** el destacado elegía títulos al azar en cada pedido. Cuando el navegador traía sus fichas del servidor IPTV y la página repetía el pedido, salían otros títulos, volvía a pedir otras fichas y el destacado nunca aparecía (Inicio mostraba «Bienvenido» y en Películas / Series quedaba oculto). Ahora los títulos elegidos se guardan 20 minutos y, si alguno ya tiene su ficha, el destacado sale enseguida y el resto se trae por detrás.
- **Series y Explorar › Series mostraban películas o todo el catálogo:** la palabra «series» del script de la página se cambiaba por un enlace con token (como si fuera la página series.php) y api.php no sabía qué tipo se pedía. Ahora solo se cambian direcciones (con .php o ?…), nunca una palabra suelta.
- Archivos: `api.php`, `includes/core.php`, `includes/route_token.php`, `includes/core.php` (versión).

## Fondo de «¿Quién está viendo?» como Netflix en el televisor — versión 2.7.4 (19 de noviembre, tercera parte)
- En horizontal la imagen vuelve a ocupar **toda la pantalla** (en la caja arriba a la derecha quedaba chica y con demasiado color liso). El color del tema entra con un **degradado suave desde el borde izquierdo** hasta un poco más de la mitad (más oscuro en el borde; detrás de los perfiles la imagen se sigue viendo, más oscura) y **abajo y arriba solo un sombreado leve**. Los nombres de los perfiles llevan una sombra para leerse siempre. En vertical (celular) sigue igual. Cada destacado se sigue viendo 10 s.
- Archivos: `perfiles.php`, `assets/nf/profiles.css`, `includes/core.php` (versión).

## Fondo de «¿Quién está viendo?» más chico, con degradado y cada 10 s — versión 2.7.3 (19 de noviembre, segunda parte)
- En horizontal la imagen ya no cubre toda la pantalla: va en una caja 16:9 **arriba a la derecha** (69 % del ancho) y el color del tema (el del distribuidor con su número) entra suave por su **borde izquierdo**, donde están los perfiles, **por abajo** y un poco por arriba. Los perfiles, la versión y el nombre del destacado se leen sobre el color liso. En vertical (celular) sigue arriba, de lado a lado.
- Cada destacado se ve **10 segundos** (antes 5).
- Archivos: `perfiles.php`, `assets/nf/profiles.css`, `assets/nf/profiles.js`, `includes/core.php` (versión).

## Fondo de «¿Quién está viendo?» con lo más destacado de la semana — versión 2.7.2 (19 de noviembre)
- El fondo de la pantalla de perfiles ya no es un solo título: pasa por **15 a 20 títulos** de lo más destacado de la semana en TMDB (películas y series), **5 segundos cada uno**, con un fundido suave; después del último vuelve al primero. El nombre, la calificación, el año y el tipo de abajo a la derecha cambian con la imagen.
- Cada imagen aparece recién cuando terminó de cargar (nunca un hueco negro) y la siguiente se pide antes. Si una no carga se salta. Siempre a pantalla completa debajo de los degradados del color del tema.
- Archivos: `perfiles.php`, `includes/profiles.php`, `assets/nf/profiles.js`, `assets/nf/profiles.css`, `includes/core.php` (versión).

## El avatar del perfil solo en Inicio, Películas y Series — versión 2.7.1 (18 de noviembre, octava parte)
- Con perfiles, el avatar de arriba a la izquierda (con «Cambiar perfil») sale solo en **Inicio, Películas y Series** (también en las listas por categoría). En las fichas, TV en vivo, Deportes, Explorar y Mi cuenta queda solo el logo arriba a la derecha. En el celular el perfil sigue en «Mi cuenta» de la barra de abajo.
- Archivos: `header.php`, `includes/core.php` (versión).

## Modo navegador: cada usuario le pide al servidor IPTV con su propia IP — versión 2.7.0 (18 de noviembre, séptima parte)
- **Antes:** el hosting le pedía al servidor IPTV el inicio de sesión, el catálogo, las fichas, los canales y la cuenta de **todos** los usuarios, siempre con la misma IP. XUI la bloqueaba por exceso de pedidos o por intentos fallidos (protección contra flood), y nadie podía entrar por la web.
- **Ahora:**
  - **Inicio de sesión:** el navegador prueba el usuario directo en el servidor IPTV con la IP del cliente, de a una DNS (la última primero).
  - **Catálogo, fichas, canales y cuenta:** si la web necesita algo del servidor IPTV, el navegador lo trae y se lo pasa a la web, que lo guarda como siempre. Lo que falta sale con un «Cargando…» corto; lo vencido se muestra y el navegador lo renueva por detrás. El hosting no le pide nada al servidor IPTV.
- **Necesita** que el servidor IPTV dé permiso al navegador (CORS; XUI lo da con un usuario válido) y, con la web en https, que el servidor tenga https válido.
- **Si no se puede**, la web sigue por el hosting como antes y avisa al panel (Errores de las apps): «el navegador no pudo…».
- **Contraseña equivocada:** en un servidor que ya dio permiso, el navegador se da cuenta solo y el hosting no hace ningún intento fallido.
- Seguridad: la caché de cada línea va separada por una huella de la contraseña, así nadie puede dejar datos falsos en la de otro. La primera vez que un navegador entra por un servidor, el hosting comprueba el permiso con un solo pedido válido.
- Sin cambios en el video, que ya iba directo del servidor IPTV al navegador: el hosting sigue solo como último recurso. El modo navegador tampoco deja al hosting leer el comienzo de los videos para buscar idiomas.
- Archivos: `includes/xt_client.php`, `xtfill.php`, `assets/nf/xtfill.js` (nuevos), `login.php`, `includes/core.php`, `includes/route_token.php`, `includes/line_guard.php`, `includes/file_tracks.php`. El panel no cambia.

## Inicio de sesión con número de distribuidor: sin bloqueos de XUI — versión 2.6.3 (18 de noviembre, sexta parte)
- **Caso:** con el distribuidor 228729 (LATAM +) salía «El servidor de video no está dejando entrar a la web…». Eso pasa cuando todas las DNS rechazan la conexión del hosting. La causa más común es que XUI bloqueó la IP del hosting por intentos fallidos: con número de distribuidor la web probaba a la vez todas sus DNS (y las del dueño si no está aislado), y cada una donde el usuario no existe le contaba un intento fallido a la IP del hosting, la misma para todos.
- **Ahora:** primero la DNS con la que ese usuario entró la última vez (sola). Si no, las demás **de a una**, empezando por el servidor donde más usuarios de ese distribuidor entraron, hasta la primera que acepta. Un servidor que no contesta no cuenta; pasados 20 s, el resto va a la vez.
- **Si igual rechazan todas**, la web averigua la causa en unos segundos (si el hosting no deja salir por ese puerto, si XUI bloqueó la IP del hosting o si el servidor no deja conectar en ningún puerto) y la manda al panel (**Errores de las apps**), con qué hacer.
- Si es el hosting, el cliente ve: «La web no puede conectarse con el servidor de video por ahora (no es tu conexión). Ya le avisamos al administrador; mientras tanto puedes usar nuestras apps.».
- Guía completa (y la regla para las demás apps): `docs/LOGIN-SERVIDORES.md` del panel.
- Archivos: `login.php`, `includes/login_probe.php` (nuevo), `includes/core.php` (versión), `includes/lang/en.php`, `pt.php`, `fr.php`. El panel no cambia.

## Perfil infantil con la clasificación de TMDB — versión 2.6.2 (18 de noviembre, quinta parte)
- **Arreglo:** en el perfil infantil aparecían telenovelas y dramas como «Mírame así, el camino de Noa», porque TMDB les pone el género «Familia».
- Ahora cada título queda **seguro**, **dudoso** o **fuera**:
  - **Seguro:** está en una categoría de niños o su género es infantil, o animación con familia. Se ve, salvo que TMDB diga que no es para niños.
  - **Dudoso:** «Familia» sola, una categoría de Disney o de familia, o un género como Telenovela. Se ve solo cuando TMDB confirma que es para niños: clasificación hasta 7 años (G, PG, TV-Y, TV-G, TV-PG, AA, A…).
- La web le pide al panel la clasificación (`api/kids_rate.php`) después de mostrar la página, sin hacerla esperar, y la guarda por distribuidor. Lo dudoso aparece a medida que llegan las respuestas.
- Sin clave de TMDB del distribuidor, o si el panel no contesta, se ve solo lo seguro.
- Las reglas de fábrica pasan a la versión 2 del panel.
- Archivos: `includes/kids.php`, `includes/core.php` (versión). **Panel:** `api/kids_rate.php`, `includes/kids_rate.php`, `includes/kids_rules.php` (subir primero).

## Perfiles con número de distribuidor — versión 2.6.1 (18 de noviembre, cuarta parte)
- Revisado todo con un distribuidor (número, logo, nombre y colores propios): inicio de sesión, «¿Quién está viendo?», la barra, el perfil infantil y un cambio de marca hecho en el panel (llega a la web en su revisión de cada 10 minutos, también a la pantalla de perfiles y a la marca guardada en el navegador). Los avatares que se ofrecen son los del distribuidor.
- **«¿Quién está viendo?» con los colores del distribuidor:** fondo, sombras sobre el destacado, cuadros de los diálogos, foco y el interruptor «Perfil infantil» toman su paleta (antes la pantalla quedaba negra). Con Omitir sigue igual (negro y blanco).
- «Eliminar perfil» queda siempre en rojo (con el acento del distribuidor podía verse verde o azul, como un botón de aceptar).
- **Celular vertical con un logo ancho:** «Administrar perfiles» se corre según el ancho del logo y, si el texto no entra, queda solo el lápiz (antes un logo ancho lo tapaba).
- **Perfil infantil:** al cambiar de perfil ya no queda de fondo el último destacado que vio otro perfil, y si el inicio no tiene destacados no se muestra el collage de «Bienvenido» (tiene carátulas para adultos). Ese «Bienvenido» ya no usa el logo de MPX con un distribuidor (en el celular se recortaba su logo).
- Archivos: `perfiles.php`, `includes/profiles.php`, `includes/core.php` (versión), `assets/nf/profiles.css`, `assets/nf/profiles.js`, `homex.php`. El panel no cambia.

## Perfil infantil y perfiles más grandes — versión 2.6.0 (18 de noviembre, tercera parte)
- **Al agregar un perfil, el interruptor «Perfil infantil»** (solo al crearlo; después no se cambia: para quitarlo se elimina y se crea otro). El perfil lleva la etiqueta **«Niños»** en la pantalla de perfiles y en la barra.
- **Con un perfil infantil se ve solo contenido para niños y de Disney** en todas partes: Inicio, Películas, Series, Explorar, búsqueda, Top 10, plataformas y actores. Entra lo de las categorías de niños, animación, familia y Disney, y lo que el servidor marca como «Familia» o «Infantil»; nunca lo que esté en una categoría de adultos, terror, anime, Marvel, Star Wars o Star (aunque también esté en una de niños), ni la animación para adultos o el anime para adolescentes (Padre de familia, Rick y Morty, Los Simpson, Deadpool, Loki…).
- **TV en vivo** solo con las categorías de niños de la lista (Infantiles, Kids, Disney, Cartoon Network…); si la lista no tiene ninguna, TV en vivo desaparece del menú. **Deportes** no aparece.
- Una ficha, el reproductor o un enlace a algo que no es para niños (por ejemplo desde otro equipo) vuelve al inicio.
- Guarda lo suyo aparte como cualquier perfil (Continuar viendo y Mi lista).
- Las reglas del filtro las manda el panel (las mismas para todas las apps; una filtración se arregla en el panel sin tocar la web). La web trae una copia por si el panel no contesta.
- **Perfiles más grandes** en «¿Quién está viendo?» (más que en 2.5.1): avatares de unos 140 px en 1080p y hasta 170 en pantallas grandes, y nombres más grandes; en el celular vertical hasta 150 px y en horizontal hasta 96. Los 5 siguen entrando sin desplazarse. Se mantienen los arreglos de 2.5.1 a 2.5.4 («Administrar perfiles» al toque, avatares sin encimarse en Safari, el mouse solo agranda el perfil).
- La versión que se ve abajo a la izquierda pasa a **2.6.0**.
- Archivos: `includes/kids.php` (nuevo), `includes/core.php`, `includes/profiles.php`, `header.php`, `api.php`, `perfiles.php`, `Movie_description.php`, `seriesvideo.php`, `video_player.php`, `tvguide.php`, `sportsschedule.php`, `assets/nf/profiles.css`, `assets/nf/profiles.js`, `assets/nf/app.css`, `includes/lang/en.php`, `pt.php`, `fr.php` (y `login.php`, `play.php`, `includes/tenant_guard.php`: solo la versión del CSS). **Panel:** subir primero `includes/kids_rules.php`, `includes/profiles.php` y `api/profiles.php`.

## Pantalla de perfiles: título centrado y versión de la web (18 de noviembre, segunda parte)
- En horizontal «¿Quién está viendo?» va arriba, en el centro (entre «Salir» y el logo).
- Del destacado de la semana quedan solo el nombre y la calificación (sin la leyenda «Lo más destacado de la semana»).
- Abajo a la izquierda, la versión de la web: **«Versión 2.5.0»** (`WP_VERSION` en `includes/core.php`), chica y sin tapar «Administrar perfiles».
- Al entrar desde el menú ya no se ve un instante la página de antes (como el «Top 10 de hoy» del inicio): la pantalla aparece sin transición.
- Archivos: `perfiles.php`, `assets/nf/profiles.css`, `includes/core.php`, `includes/lang/en.php`, `pt.php`, `fr.php`.

## Perfiles como Netflix (18 de noviembre)
- **Solo cuando el dueño los enciende en el panel** (panel › Perfiles). Apagados, en una DEMO o con una sola conexión en la línea, la web queda exactamente como antes (logo a la izquierda, sin pantalla de perfiles, todo se guarda como siempre).
- **«¿Quién está viendo?»** (`perfiles.php`): al iniciar sesión, antes de cualquier página, se elige el perfil. Horizontal: los perfiles en columna a la izquierda (los 5 caben, también en 720p), «Salir» arriba a la izquierda, el logo arriba a la derecha y de fondo lo más destacado de la semana en TMDB en alta calidad (Full HD; el original 4K en pantallas grandes) con su nombre, calificación y año abajo a la derecha, sin tapar nada. Vertical (celular): el destacado arriba, dos perfiles por fila y el último centrado, y «Administrar perfiles» arriba junto al logo para que todo entre sin desplazarse. Celular horizontal: los perfiles en fila.
- **Elegir:** sin PIN se entra directo; con PIN se piden los 4 números (5 intentos y espera de 5 minutos, lo cuenta el panel). «¿Olvidaste el PIN?» lo quita con la contraseña de la línea. Al elegir se vuelve a la página que se había pedido.
- **Administrar perfiles:** el lápiz de cada perfil abre editar (nombre, avatar de los del panel o del distribuidor, bloquear con PIN, cambiar o quitar el PIN) y «Eliminar perfil» (nunca en el principal; se recupera 7 días creándolo con el mismo nombre exacto). «Agregar perfil» aparece solo si la línea admite más (tantos como conexiones, máximo 5).
- **Continuar viendo y Mi lista (también los canales favoritos) son de cada perfil:** cada llamada a `api/progress.php` lleva el perfil elegido (`profile`), también desde el reproductor http (`play.php`). Si el perfil se elimina en otro equipo, la página siguiente vuelve a «¿Quién está viendo?».
- **Barra superior con perfiles:** el avatar del perfil a la izquierda (su menú tiene «Cambiar perfil» y «Administrar perfiles»), el menú en el centro y el logo a la derecha. En el celular el avatar también va en «Mi cuenta» de la barra de abajo, y «Mi cuenta» muestra el perfil con sus botones.
- Si el panel no contesta, la pantalla lo dice y «Entrar» sigue con el perfil principal (nunca se queda dando vueltas).
- Archivos: `perfiles.php`, `includes/profiles.php`, `assets/nf/profiles.css`, `assets/nf/profiles.js` (nuevos), `session.php`, `header.php`, `login.php`, `myaccount.php`, `play.php`, `includes/core.php`, `includes/panel.php`, `includes/handoff.php`, `includes/line_guard.php`, `includes/route_token.php`, `includes/lang/en.php`, `pt.php`, `fr.php`, `assets/nf/app.css` (y `video_player.php` / `includes/tenant_guard.php`: solo la versión del CSS). **Panel:** subir primero la parte de Perfiles del panel (`api/profiles.php` y lo demás del 18 de noviembre).

## TV en vivo en el teléfono: más espacio para los canales, sin saltos (17 de noviembre)
- Como una app: en el teléfono la página no se desplaza. Arriba quedan fijos el reproductor (siempre 16:9) y el canal; abajo, una sola zona que se desplaza con el dedo: la guía de programas (el programa de ahora y los 2 siguientes) y, debajo, la carpeta y los canales.
- Al subir por los canales la guía se va hacia arriba con el propio desplazamiento del teléfono (nada cambia de alto, así no hay saltos ni parpadeos), la carpeta queda fija arriba de la lista y bajo el nombre del canal aparece, en una línea y con un fundido, lo que se transmite ahora. Al volver al principio la guía baja otra vez. Se puede deslizar desde cualquier parte debajo del reproductor (también sobre la guía).
- La zona queda fija entre la barra de arriba y la de abajo, así calza con cualquier barra de Safari (antes la página podía correrse hacia arriba, el reproductor se estiraba con una franja negra y la guía quedaba encima de la lista).
- Cambiar de carpeta con la guía fuera de la vista: la carpeta sigue arriba y la lista nueva empieza en su primer canal, sin saltos mientras carga. Elegir un canal deja la lista donde estaba, aunque la guía del canal nuevo tenga otro alto. La pantalla completa propia del iPhone ocupa toda la pantalla, por encima de las barras. En la computadora (900 px o más) no cambia nada.
- Archivo: `tvguide.php`.

## Deportes igual que Android TV, Roku, Vega OS, webOS y Tizen (17 de noviembre)
- **Pestañas** Hoy / Mañana y, si el panel las ofrece, Tablas / Selecciones / Equipos (antes Hoy y Mañana eran botones dentro de «Agenda»). Hoy incluye los que siguen en vivo; el orden es en vivo → próximos → terminados, con las disciplinas en chips y una tarjeta por fila en el teléfono. Ya no hay buscador de la agenda, fila «En vivo ahora» ni grupos por liga (como las apps).
- **Cada tarjeta muestra el canal** que se abre (en verde si es de la lista del cliente; «Sin canal», «Por confirmar» en Equipos / Selecciones, o «Buscando…» mientras se buscan) y «En TV: …» (hasta 4). Con «Solo los canales del servidor IPTV» en el panel (`chan: "iptv"`) solo se nombran los que el cliente tiene.
- **El canal de cada partido**, con la misma lógica de Android TV (`includes/sports_match.php`): el que lo transmite si el cliente lo tiene (por su nombre sin calidad ni país: «ESPN 2» da «MX: ESPN 2 HD», nunca «ESPN» ni «ESPN 3»; «M+» = Movistar; al final por las palabras pegadas), el de la **guía del panel** (`api/sports_epg.php`, hasta 600 canales deportivos) o el de los equipos / nombre del evento (reglas `match` y alias del panel). Se buscan una vez, en segundo plano, al abrir Deportes (`sportsschedule.php?ajax=match`, 10 min en el hosting por línea); los partidos de Equipos / Selecciones buscan el suyo al mostrarse.
- **Al tocar la tarjeta** sale el menú de las apps: «Ver el evento (canal automático)», cada canal que lo transmite (en verde los del cliente), los de la guía y por equipos, «Buscar canales: «equipo»» y «Buscar canal, equipo o evento…» (`?ajax=search`, hasta 12, deportes / eventos primero). Un evento aplazado, terminado o que aún no es hoy avisa en lugar de abrir. Un canal que el cliente no tiene abre el de los equipos («No tienes X; te mostramos Y») o la primera carpeta de eventos.
- Archivos: `sportsschedule.php`, `assets/nf/sports.js`, `includes/sports_match.php` (nuevo), `includes/lang/en.php`, `pt.php`, `fr.php`. El panel no cambia (usa `api/sports.php` y `api/sports_epg.php` como las apps).

## Distribuidor aislado: su video nunca pasa por este hosting (17 de noviembre)
- En el panel, Distribuidores › Editar › **«Solo sus recursos»**. El panel lo manda en `tenant_config` (`features.hosting_video = false`) y la web deja de entregar el video de ese distribuidor por este hosting: ni la fuente de respaldo de `proxy.php` (varios audios en http) ni el último recurso con la web en https. `proxy.php` además le responde 403 (enlaces viejos guardados incluidos).
- Su video va directo del servidor IPTV, o por su VDS propia si la tiene (el panel ya no le da el puente por la VPS del dueño). Con la web en https y un servidor IPTV solo http, sin VDS propia, se abre `play.php` por http; con «Forzar HTTPS», el reproductor muestra el error con «Abrir en VLC».
- El dueño (Omitir), los demás distribuidores y una copia de la configuración guardada antes de esta versión siguen exactamente igual.
- Archivos: `includes/core.php` (`wp_play_sources`), `includes/tenant.php` (`wp_hosting_video_ok`), `proxy.php`. **Panel:** `panel_usuarios.php`, `includes/tenant_schema.php`, `includes/tenant_admin.php`, `includes/media_remote.php`, `includes/tenant_api.php`, `api/vidx.php` (subir el panel primero).

## Cada navegador queda en el panel con su IP y se puede bloquear (13 de noviembre, noche)
- **Registro:** un navegador no deja leer la MAC del equipo, así que la web le da a cada navegador su propio identificador (`WEB-` + 16 caracteres, cookie `wp_dev` de 5 años) y manda también su IP real. Lo manda cifrado al panel (acción `web_device` de `login.php`) al iniciar sesión y, mientras se usa la web, como mucho cada 10 minutos (`includes/web_device.php`, desde `session.php`). Con Cloudflare (o el Worker) delante la IP es la del visitante; además va la IP de la conexión, para que una cabecera inventada no esquive un bloqueo.
- **En el panel:** Clientes › «Web player: navegadores registrados» (navegador, IP, usuario, último acceso). El dueño ve todos; un distribuidor los suyos si tiene la web player; sus revendedores, los de sus clientes. **Bloquear navegador** o **Bloquear IP** los pasa a la lista negra de ese ID.
- **Bloqueado:** el inicio de sesión dice «Este equipo está bloqueado. Contacta a tu proveedor.» y una sesión abierta se cierra (vuelve al login con ese aviso). Si el panel no contesta no se corta nada; con un panel sin actualizar la web sigue como antes.
- Archivos: `includes/web_device.php` (nuevo), `login.php`, `session.php`, `includes/line_guard.php`, `includes/lang/en.php`, `pt.php`, `fr.php`. **Panel:** `api/login.php`, `includes/web_devices.php`, Clientes y la lista negra (subir el panel primero).

## TMDB del distribuidor o del dueño, «no compatible» sin conversión inútil e índice compartido (13 de noviembre)
- **TMDB (carátulas, fondos, sinopsis, elenco, tráileres y actores):** la clave es siempre la guardada en el panel (Ajustes del dueño, o la del distribuidor con su número), que el panel ya manda con el token: ahora se guarda desde el inicio de sesión (antes solo llegaba con Continuar viendo y las primeras páginas podían quedar sin TMDB). La clave escrita en `includes/panel_secret.php` queda solo de respaldo para el dueño cuando el panel no tiene ninguna (antes ganaba a la del panel). Un distribuidor sin clave no ve datos de TMDB, tampoco los que otro dejó en la caché del hosting.
- **Conversión de video apagada:** cuando el navegador no puede con el video (HEVC sin soporte, MPEG-4, MKV que no abre…) la web le pregunta antes al panel si la conversión de video está encendida (`?do=status`, campo `video`). Apagada: dice de una vez «Este contenido no es compatible con tu navegador… Ábrelo en VLC o en nuestras apps» en vez de mostrar «Convirtiendo…» y terminar en error. Encendida: la conversión empieza como antes. Si ya se está viendo y se elige un idioma que pide convertir el video, sigue como va y lo avisa. La conversión de audio no cambia.
- **Índice compartido (más rápido):** en películas y capítulos MP4 con el índice (moov) al final, el lector MP4 de la web pide al panel (`api/vidx.php`) el índice que otro equipo (Roku, Vega, Android u otro navegador) dejó en la VPS / VDS de la línea: llega de ahí y al servidor IPTV no se le piden los 3-10 MB del final del archivo (15-35 s en servidores lentos). Si la VPS / VDS no lo tiene, el navegador le deja el que lee. El navegador habla directo con el panel y la VPS / VDS (el hosting no lo toca); sin VPS / VDS todo sigue igual.
- Archivos: `includes/core.php`, `includes/panel.php`, `includes/actor.php`, `includes/media_admin.php`, `video_player.php`, `play.php`, `assets/nf/player.js`, `assets/nf/mp4mse.js`, `includes/lang/en.php`, `pt.php`, `fr.php`. **Panel:** `api/media.php` (campo `video` de `do=status`) y `api/vidx.php` (permiso para el navegador y `app=web`); sin el panel actualizado la web sigue como antes.

## «No pudimos conectar con los servidores» otra vez: menos intentos desde la IP del hosting (11 de noviembre)
- **La causa sigue sin ser el SSL:** el login lo hace el hosting (PHP), no el navegador. Ese mensaje sale cuando **ningún** servidor IPTV le contesta al hosting; el 7 de noviembre el reporte del panel mostró `curl 7 Failed to connect … after 12 ms` en todas las DNS: XUI bloqueó la IP del hosting (protección contra flood). Todos los usuarios de la web salen con esa misma IP.
- **Por qué se bloqueaba tan fácil:** cada inicio de sesión preguntaba a la vez a **todas** las DNS, en http y en https. Varias DNS suelen ser el mismo XUI (otro nombre, la misma IP y puerto), así que un solo login contaba como varios intentos fallidos para XUI.
- **Ahora:** una sola pregunta por servidor real (IP + puerto, `wp_login_endpoint`); primero, sola, la DNS con la que ese usuario entró la última vez (se recuerda 120 días en el hosting); https solo si en http nadie contestó. Un usuario que vuelve a entrar hace **un** pedido al servidor IPTV.
- Si el servidor IPTV rechaza la conexión del hosting en todas las DNS, el mensaje lo dice («El servidor de video no está dejando entrar a la web en este momento (no es tu conexión)…») y el reporte del panel trae la IP del hosting para desbloquearla en XUI.
- **Qué hacer en XUI (una vez):** IPs bloqueadas → quitar la IP del hosting; Seguridad / protección contra flood → agregarla a las IP excluidas. Sin eso, con muchos usuarios en la web, XUI puede volver a bloquearla.
- Archivos: `login.php`, `includes/core.php`, `includes/lang/en.php`, `pt.php`, `fr.php`. El panel no cambia.

## Web con SSL: «No pudimos conectar» y los idiomas que no aparecen (7 de noviembre, tarde)
- **La causa no es el SSL:** el reporte decía `curl 7 Failed to connect to latmpxtv.click:80 after 12 ms` en **todas** las DNS: el servidor IPTV rechazó al instante la conexión **del hosting** (no del navegador). Es lo que hace XUI cuando bloquea una IP (protección contra flood, intentos fallidos de login o demasiadas conexiones). Todos los usuarios de la web entran con la IP del hosting, así que unos pocos intentos fallidos o la lectura de pistas bastan para que la bloquee, y sin conexión del hosting al servidor tampoco se pueden leer los idiomas (por eso no aparecían y el motor de conversión nunca arrancaba: solo se usa cuando se sabe que hay varios audios).
- **Qué hacer en XUI:** buscar la IP del hosting (el panel ahora la muestra en el reporte: «IP del hosting de la web») en **IPs bloqueadas** y quitarla, y agregarla a las IP excluidas de la protección contra flood / fuerza bruta.
- El reporte del login ahora lo dice («el servidor IPTV rechaza la conexión del hosting») con la IP de cada servidor. Y cuando el hosting no puede leer las pistas de un video (conexión rechazada, página de XUI en vez del video…) llega un reporte **«Idiomas de la web player: el hosting no pudo leer el archivo (…)»** (uno cada 30 min por motivo).
- `https://servidor:80` (el panel en https cambiaba http por https sin quitar el puerto) ya no se prueba: va `http://servidor:80` y `https://servidor`.
- Archivos: `login.php`, `includes/audio_probe.php`, `includes/file_tracks.php`. Panel: `api/login.php`, `api/report.php`.

## Inicio de sesión con servidores XUI en «Debug Mode» (7 de noviembre)
- **Corregido: «No pudimos conectar con los servidores» con un usuario o contraseña mal escritos.** Los servidores XUI en «Debug Mode» no contestan `{"user_info":{"auth":0}}` sino una página HTML con el motivo («XUI.ONE INVALID_CREDENTIALS…»); la web no la leía y lo contaba como «ningún servidor contestó». Ahora lee el motivo (`wp_xui_error`, como las apps): usuario o contraseña incorrectos, cuenta vencida, cuenta deshabilitada, u otro motivo del servidor («El servidor rechazó el inicio de sesión (…)»). Igual con Omitir y con número de distribuidor (el mismo inicio de sesión con las DNS de cada uno).
- Si ningún servidor contesta, o XUI da un motivo raro (IP del sitio bloqueada, demasiados intentos…), la web lo manda a **Errores de las apps** del panel con lo que pasó en cada DNS (error de conexión, código HTTP o motivo de XUI).
- Archivos: `login.php`, `includes/core.php` (`wp_xui_error`, `wp_http_multi` con el motivo de cada fallo) e `includes/lang/en.php`, `pt.php`, `fr.php`.

## Verificador antihack del panel en los pedidos a login.php (28 de octubre, noche)
- Los tres pedidos que la web hace a `login.php` del panel (lista de DNS, número de distribuidor y pantalla falsa) llevan `"ts"` (la hora) dentro del JSON cifrado, como las apps. Si el reloj del hosting está corrido, el panel responde con su hora y se reintenta una vez con la diferencia (se recuerda un día). Así la web sigue funcionando cuando el panel exija `ts` (`login_require_ts`). Nada cambia para el cliente. Archivos: `includes/panel.php` (`wp_panel_login`), `includes/tenant.php`, `includes/fake_screen.php`.

## Sin la carpeta bin/ (28 de octubre)
- Se quitaron `bin/` (ffmpeg y ffprobe) e `instalar_ffmpeg.php`: el hosting ya no convierte ni analiza nada (lo hace el motor del panel en la VPS / VDS). Puedes borrarlos del hosting. `estado.php` ya no muestra «ffmpeg: NO instalado». La regla de `.htaccess` que bloquea `bin/` se queda por si quedó algo.

## Dominio propio con un Worker de Cloudflare (28 de octubre)
- **Opcional:** el cliente entra por un dominio nuevo y el dominio original da **403 Forbidden**. El Worker (`cloudflare/edge-worker.js`) manda un secreto; la web (`includes/edge.php`, cargado por `includes/core.php`) solo atiende con él y usa el dominio que ve el cliente y su IP real (login, cookies, redirecciones y el freno de intentos funcionan igual). Varios dominios, uno por distribuidor, cada uno con su secreto y, si quieres, fijo en su número (sin «Número de distribuidor» ni «Cambiar distribuidor»). Se activa con `'edge_keys'` en `includes/panel_secret.php` (`'edge_block' => false` para probar sin cerrar el original); sin eso nada cambia. El panel sigue llegando a `media_admin.php` (firmado). Guía: `docs/GUIA-WORKER.html`. Archivos: `includes/edge.php` (nuevo), `includes/core.php`, `includes/tenant.php`, `includes/tenant_login.php`, `includes/tenant_guard.php`, `login.php`, `media.php`, `oops.php`, `.htaccess`, `includes/panel_secret.sample.php`, `cloudflare/edge-worker.js` y `docs/GUIA-WORKER.html` (nuevos).

## Aviso de bienvenida con varias imágenes (28 de octubre)
- Con varias imágenes en **Alertas** del panel, el aviso las muestra todas en el mismo lugar y cambian cada 3 segundos (con un fundido; todas cargan de inicio). El encabezado no cambia; con una sola imagen o con el video, igual que antes. Archivos: `api.php`, `assets/nf/alert.js` (`v=5`), `assets/nf/app.css` (`v=11`), `header.php`, `login.php`, `play.php`, `video_player.php`, `includes/tenant_guard.php`.

## Aviso de bienvenida con video corto (27 de octubre, noche)
- El aviso del panel (Alertas) muestra la imagen por enlace y, si el panel tiene uno, un **video corto** (sin sonido, en bucle, con la imagen de portada; si el video no carga, queda la imagen). Archivos: `api.php`, `assets/nf/alert.js` (`v=4`), `header.php`.

## SSL sin cargar el hosting y direcciones con tokens (27 de octubre, tarde)

**SSL (Hostinger)**
- **Corregido:** con la web en https, todo video de un servidor IPTV http pasaba por `proxy.php` (el hosting reenviaba cada película y cada canal). Ahora el orden es: https directo del servidor IPTV → **la VPS / VDS de la línea** (`api/media_web.php?do=link` del panel firma el enlace; servidor IPTV → VPS / VDS → navegador, con permiso CORS: también sirve para elegir el idioma en el navegador; la VDS propia del distribuidor si la eligió, si no la del dueño) → `play.php` por http (solo con "Forzar HTTPS" apagado) → el hosting solo como último recurso. **El video nunca pasa por Cloudflare**: se quitó el relay de Cloudflare (`cloudflare/relay-worker.js`, `includes/https_relay.sample.php`); Cloudflare queda solo para los dominios.
- Con la VPS / VDS en https se puede activar **SSL y Forzar HTTPS** en hPanel. Probado: película por rangos y canal en vivo HLS por una VPS local; el navegador solo habló con la web y la VPS.
- `play.php` vuelve a http bien aunque la dirección sea un token, y el reproductor retoma el segundo con `?t=` en cualquier dirección.
- Ver GUIA.md: SSL con la VPS / VDS y Cloudflare solo para los dominios.

**Direcciones con tokens (como el panel)**
- Después del login la barra nunca muestra el nombre de una página `.php`: cada enlace es `w-<token>`, **distinto y aleatorio cada vez** (AES-256-GCM con un IV al azar y la llave propia del hosting), con la página, sus parámetros, la hora y la línea de la sesión. Un token alterado, de otra sesión o de más de 7 días lleva al inicio.
- Una página abierta por su nombre (enlace viejo, favorito, `homex`) se cambia sola a un token nuevo. Las redirecciones (`Location`), los enlaces, los formularios y la configuración del reproductor salen con token. Las llamadas internas (`api.php`, `img.php`, `report.php`, `tracks.php`…) no aparecen en la barra y siguen igual (como la API del panel).
- Filtros de Explorar y canal de TV en vivo: la barra conserva el token y agrega los filtros (`?_r=1&…`).
- Archivos: `route.php` (nuevo), `includes/route_token.php` (nuevo), `.htaccess` (regla `w-<token>`), `session.php`, `index.php`, `home.php`, `login.php`, `play.php`, `browse.php`, `tvguide.php`, `sportsschedule.php`, `video_player.php`, `includes/core.php`, `includes/handoff.php`, `assets/nf/player.js` (`v=33`), `GUIA.md`.
- Probado: cada enlace un token distinto; token alterado → inicio; token de otra sesión no sirve; una página abierta por nombre → token; `Location: homex.php` → token; los fetch de JavaScript y las direcciones que arma el JavaScript no se tocan; `&` de la configuración JSON respetado.

## Conversión por el motor del panel, carátulas del panel, Deportes nuevo, idiomas compartidos y TV en vivo estable (27 de octubre)

**Conversión de audio, subtítulos y video: ya no usa el hosting**
- La web ya no ejecuta ffmpeg ni ffprobe en el hosting: `media.php` quedó apagado (responde "motor no disponible") y `tracks.php` ya no usa ffprobe. La conversión la hace el **motor del panel** (`api/media_web.php`), igual que las apps, y **solo en una VPS / VDS**:
  - distribuidor con **su propia VDS** elegida en Distribuidores → convierte **solo en su VDS** (si no responde, el video sigue directo; nunca usa la VPS del dueño);
  - distribuidor en «Por defecto» u Omitir → la máquina del dueño (Guía EPG: VPS o VDS). Con Guía EPG en «Hosting», la web no convierte.
  - El permiso sigue siendo el del dueño (Distribuidores › motores › Web player) y el interruptor «Web player» de Guía EPG.
- **Más rápido y fluido:** el panel entrega HLS en fMP4 (hls.js en Chrome/Edge/Firefox/Android, HLS nativo en iPhone/Safari) y responde con el primer segmento (antes esperaba dos). Si el contenido tiene audio Dolby/DTS y los idiomas ya se saben, la conversión arranca **sin abrir antes el video directo** (en la prueba: ~1,7 s desde el punto guardado, con el idioma del navegador). Adelantar o retroceder **dentro de lo ya convertido es instantáneo** (no vuelve a convertir).
- **Audio siempre sincronizado:** al empezar en un punto que no es fotograma clave, audio y video arrancan juntos en el fotograma clave (`-noaccurate_seek`) y el motor anota el segundo exacto (`#EXT-X-MPX-START`), así el reloj, la barra y los subtítulos cuadran. (Antes el navegador dejaba el audio hasta ~2 s adelantado.)
- **Subtítulos del archivo** desde el motor del panel: se muestran mientras el panel todavía los está leyendo y se completan solos.
- **Solucionar** pregunta al motor del panel (no al hosting) y, si el formato no abre en el navegador, pide también el video convertido (`v=1`, solo VPS / VDS).
- Para que funcione hay que actualizar el panel y **copiar 3 archivos a la VPS y a cada VDS** (ver abajo). Mientras tanto la web sigue con el video directo, como si el motor estuviera apagado. Con la web en https, la VPS / VDS también necesita https.

**Idiomas compartidos con el panel (como Roku)**
- Orden: lo que el hosting ya sabe (30 días) → lo que el panel recuerda de ese video (`api/tracks.php`, ≤ 2 s, sin tocar el servidor IPTV) → la cabecera del archivo (unos KB por rangos, sin ffmpeg). Lo leído **se le deja al panel** para los demás equipos (mismo formato que Roku, Vega y LG).
- La ficha de la película (o el episodio que se va a ver) **pide los idiomas apenas se abre** (solo al panel): al pulsar Reproducir ya se saben.
- Lectura de cabecera más liviana: pocos pedidos grandes (MKV en 1 pedido, MP4 con el índice al final en 2).
- Menú de audio y subtítulos solo con el idioma ("Español latino", "Inglés"; si se repite, "Inglés 2"), como las apps.

**Carátulas y fondos por la caché del panel (como Roku, Vega, Android, Windows e iPhone)**
- Carátula: copia pública del panel (`api/imgc/<sha1>.jpg`) → `api/img.php` (la achica y, si el servidor no tiene, busca el póster en TMDB por título) → la original → TMDB por el hosting solo si todo falla. Mismos nombres que las apps: una sola copia por título para todos.
- Fondos de TMDB en Full HD hechos por el panel (`img.php?w=1920`) en la cartelera y las fichas; si no cargan, el de siempre.
- Si el dueño apaga la caché (`"img": false` de `progress.php ?v=2`) todo va directo, como antes.
- "Mi lista" guarda la carátula del servidor (la misma que usan las apps para la caché del panel).

**Deportes: Tablas, Selecciones y Equipos**
- Pestañas **Agenda / Tablas / Selecciones / Equipos** cuando el panel las ofrece (`tables.on`, `fixtures.on`, `fixtures.nat` de `api/sports.php`).
- **Tablas:** región (Copas, Selecciones, Europa, América, Resto del mundo), división (1.ª, 2.ª… y Liga femenina) y liga; tabla con PJ, G, E, P, GF, GC, DG, PTS, últimos resultados y zonas (clasificación, otra copa o ascenso, repechaje, descenso). Al tocar un equipo: su ficha (fundación, estadio, liga, títulos, descripción) con «Entendido» y «Más detalles». En celular: PJ, DG y PTS.
- **Selecciones:** partidos de selecciones por empezar o en vivo, por competición y «Selección femenina».
- **Equipos:** buscador por equipo (también en español: «Alemania» = «Germany») o por país, próximos 21 días, con los últimos 5 buscados. El botón de TV en vivo funciona igual que en la agenda.
- El hosting guarda **una sola copia por distribuidor e idioma** para todos (tablas hasta 7 días, partidos 12 h o hasta que el panel anuncie otra versión). Si el panel todavía está armando, se vuelve a preguntar solo.

**TV en vivo estable**
- Si el canal se corta mientras se mira (token XUI que vence, servidor que cierra o deja de mandar 15 s), se **reconecta solo y sin aviso** desde el enlace original (con token nuevo), con espera creciente.
- hls.js y mpegts.js con un margen de seguridad y puesta al día acelerando un poco (sin saltos que cortan el audio).

**Borrado de caché remoto:** no aplica a la web (el panel nunca le manda órdenes; la web no guarda datos en el equipo).

**Archivos de la web:** `media.php`, `tracks.php`, `video_player.php`, `play.php`, `tvguide.php`, `sportsschedule.php`, `Movie_description.php`, `seriesvideo.php`, `homex.php`, `api.php`, `header.php` (`app.js?v=8`), `includes/core.php`, `includes/panel.php`, `includes/panel_img.php` (nuevo), `includes/sports_panel.php` (nuevo), `includes/file_tracks.php` (nuevo), `includes/audio_probe.php`, `includes/media_core.php`, `includes/media_admin.php`, `includes/ui.php`, `includes/lang/{en,pt,fr}.php`, `assets/nf/player.js` (`v=32`), `assets/nf/app.js`, `assets/nf/sports.js` y `assets/nf/sports.css` (nuevos). Se pueden borrar del hosting `bin/` (ffmpeg) e `instalar_ffmpeg.php`.

**Archivos del panel:** `api/media_web.php` (nuevo), `api/media.php`, `api/media_worker.php`, `includes/media_engine.php`, `includes/media_convert.php`, `epg_manager.php`, `tools/vps/README.md`. **En la VPS y en cada VDS** (carpeta del motor, `/var/www/motor`): `api/media_worker.php`, `includes/media_engine.php`, `includes/media_convert.php`.

**Pruebas:** reproductor con el motor del panel nuevo (ffmpeg 6.1) y un "servidor IPTV" local: MKV con audio AC3 + AAC, desde el segundo 30 → arranca en ~1,7 s con el audio en inglés convertido, reloj exacto (fotograma clave 28), retroceso dentro de lo convertido sin reconvertir. Canal en vivo con token que vence a los 20 s → se reconecta solo y sigue. Lectura de idiomas de MKV y MP4 (índice al final). Carátulas con los mismos nombres que las apps. Deportes: pestañas, divisiones, ficha, selecciones, búsqueda en español y vista de celular.

## Login: fondo de pósters solo con clave TMDB (18 de octubre)
- **Fondo de pósters:** se ve solo si el panel lo entrega (`api/tmdb.php` con `t` = distribuidor, o sin él con Omitir). Con `tmdb_key_not_set` o un error del panel el fondo queda negro: ya no se muestran pósters viejos guardados (se quitó la copia de respaldo de 6 h) y la caché es de 10 min por distribuidor e idioma, así quitar o poner la clave en el panel se nota pronto. El carrusel sigue infinito y ahora vuelve al inicio sin el pequeño salto (filas completas).
- **«Cambiar distribuidor»** sigue siempre visible debajo de la caja de inicio de sesión (con número o con Omitir) y lleva a la pantalla «Número de distribuidor»; ahora con borde de foco para teclado.
- **No aplica a la web:** el botón Autodemo (el panel responde `demo: false` para la app web y la web no lo tiene) y el selector DNS (se quitó de la web, ver `includes/doh.php`).
- Archivos: `login.php`.

## Distribuidor: motor sin permiso, marca en el banner, plataformas y Mi cuenta (18 de octubre)
- **Motor de audio y subtítulos sin permiso (`features.ffmpeg` del panel):** sin permiso, con el motor apagado o sin ffmpeg, la página del video no ofrece el motor (`wp_media_off_text()` en `includes/media_admin.php`) y `media.php` responde 503 con `{"ffmpeg":false,"error":"Sin permisos"}` (mismo formato que el motor del panel; `?do=status` responde `{"ffmpeg":true}`). El reproductor no pasa por el motor de forma automática (formato no soportado → error normal o VLC) y `tracks.php` ya no usa ffprobe. Si el motor responde 503 a mitad del video, el reproductor muestra el texto **una vez**, deja de pedirle cosas en esa página y el video sigue directo, sin recargar ni spinner. Antes de soltar el video directo por una conversión que nada confirmó, se pregunta una sola vez (`do=status`). Con varios audios que el navegador no separa, el menú muestra *Otros idiomas*: al elegirlo solo aparece el aviso.
- **Subtítulos:** al volver de una conversión al video directo los subtítulos se re-ubican (antes quedaban corridos por el desfase de la conversión). "Automático (Nativo)" volvía a abrir el video con una dirección inválida; ahora vuelve al directo en el mismo punto.
- **Banner:** la "N" de los destacados es la inicial de la marca del distribuidor (`wp_brand_initial()`; con Omitir o sin nombre, la "M" de MPX Player) en su color de acento. Si una imagen del banner no carga, queda la anterior; al entrar a Inicio, Películas o Series se muestra el último banner visto mientras llegan los nuevos (nunca negro).
- **Foco con el color del distribuidor:** con paleta, el borde/realce de foco (tarjetas, plataformas, géneros, botones, campos) usa el acento, aclarado si hace falta para que se vea sobre el fondo oscuro (`wp_focus_color()`). Sin paleta, como siempre.
- **`features.platforms` = false:** `wp_platforms()` queda vacío: no hay tiles, filas "Lo mejor de…", chips ni páginas de plataforma; quedan géneros, categorías y "nuevas".
- **Mi cuenta:** "Canales en vivo", "Películas" y "Series" con la cantidad del servidor (`api.php?action=counts`, se carga aparte con "…").
- **Fluidez:** la rejilla de Explorar descarta la respuesta de un filtro anterior (antes, al cambiar rápido de género, podía mostrar resultados viejos y quedarse sin cargar más) y calcula el scroll una vez por cuadro; `wp_available_platforms()` se calcula una vez por página.
- Archivos: `media.php`, `video_player.php`, `tracks.php`, `api.php`, `browse.php`, `myaccount.php`, `header.php` (`app.js?v=7`), `play.php` y `tvguide.php` (`player.js?v=31`), `includes/media_admin.php`, `includes/tenant.php`, `includes/tenant_brand.php`, `includes/ui.php`, `includes/core.php`, `includes/lang/{en,pt,fr}.php`, `assets/nf/player.js`, `assets/nf/app.js`.

## Idiomas de la app: español, inglés, portugués y francés (14 de octubre)
- **Automático:** sin elección, la web usa el idioma principal del navegador (Accept-Language). Si no es español, inglés, portugués o francés, queda en español.
- **Elegir idioma:** menú del perfil y **Mi cuenta** → *Idioma de la app* (Automático / Español / English / Português / Français); también arriba a la derecha en el login y el número de distribuidor. Se guarda en la cookie `wp_lang` (5 años) y la página se recarga en el idioma elegido.
- **Qué se traduce:** todas las páginas (login, distribuidor, inicio, explorar, fichas, reproductor, TV en vivo, deportes, actor, Mi cuenta, Ajustes), los textos del reproductor y de los menús de audio/subtítulos, los avisos y los mensajes que la web genera (errores de inicio de sesión, distribuidor, DEMO). Fechas y horas en el idioma elegido.
- **Qué no se traduce:** títulos y nombres del servidor IPTV y de TMDB, categorías, textos del panel (alertas, pantalla falsa), marcas y la etiqueta "DEMO". Las palabras que reconocen plataformas y géneros en las categorías del servidor siguen en español; solo cambia el nombre que se muestra. `diag.php` y `estado.php` (diagnóstico técnico) siguen en español.
- **Panel:** cada llamada al panel lleva el idioma (`?lang=`, `Accept-Language` y `lang` dentro del JSON y de los datos cifrados), así el panel responde sus mensajes traducidos; los códigos de error se manejan igual. La agenda de deportes se guarda en caché por idioma.
- **TMDB:** la búsqueda de títulos sigue en es-MX (para encontrar el mismo contenido); la ficha (descripción, tráiler), la biografía del actor y el fondo del login llegan en el idioma elegido (es-MX, en-US, pt-BR, fr-FR), con caché por idioma.
- **Sinopsis en el idioma de la app:** en inglés, portugués o francés la ficha de película o serie y el destacado del inicio muestran la sinopsis de TMDB en ese idioma (la búsqueda sigue en es-MX); si TMDB no la tiene en ese idioma, no hay clave o no encuentra el título, se muestra la del servidor. En español no cambia nada (la del servidor y, si no trae, la de TMDB). Los episodios siguen con la del servidor. Archivos: `includes/core.php` (`wp_tmdb_plot`, caché `tmdbd4` por idioma), `Movie_description.php`, `seriesvideo.php`, `api.php`.
- **Para traducir un texto nuevo:** en PHP `t('Texto en español')`, en los JS de `assets/nf` `tr('Texto en español')`, y se agrega la traducción en `includes/lang/en.php`, `pt.php` y `fr.php` (la clave es el texto en español). Ver `includes/i18n.php`.
- Archivos: `includes/i18n.php` y `includes/lang/` (nuevos), `includes/core.php`, `includes/panel.php`, `includes/tenant.php`, `includes/tenant_login.php`, `includes/tenant_guard.php`, `includes/line_guard.php`, `includes/ui.php`, `includes/ondemand.php`, `includes/actor.php`, `includes/media_core.php`, `header.php`, `login.php`, `homex.php`, `browse.php`, `Movie_description.php`, `seriesvideo.php`, `video_player.php`, `play.php`, `tvguide.php`, `sportsschedule.php`, `actor.php`, `myaccount.php`, `settings.php`, `api.php`, `playlist.php`, `save_favorite.php` y `assets/nf/app.js?v=6`, `alert.js?v=3`, `player.js?v=30`, `mp4mse.js?v=2`, `app.css?v=10`.

## Conversión con ffmpeg: audio sincronizado y sin carga infinita (13 de octubre)
- **Audio desfasado — causa:** al cambiar de idioma o adelantar, la conversión copia el video, que solo puede empezar en un fotograma clave (k, hasta 10 s antes del punto pedido t), pero el audio se recortaba exacto en t (`-ss t`). El audio quedaba (t − k) segundos corrido respecto al video: un hueco al inicio que el navegador no respeta igual en todos lados. Además, los huecos o solapes de tiempo del audio original (archivos IPTV mal cortados) hacían que el audio se fuera atrasando o adelantando a lo largo de la película.
- **Ahora:** con el video copiado la conversión arranca en el fotograma clave con video y audio juntos (`-ss k+0,5 -noaccurate_seek`; k es el mismo segundo que lee el reproductor con `do=kf`, así el tiempo y los subtítulos cuadran) y el audio pasa por `aresample=async=1` (rellena huecos con silencio y recorta solapes). Con el video convertido (modos compatible y seguro) el corte sigue exacto en t para los dos. Igual en el MP4 en flujo (`do=tc`) y en el HLS del iPhone (`do=hls`).
- **Carga infinita — causas:** (1) el arreglo del 12 de octubre cambió `assets/nf/player.js` sin subir su versión (`?v=28`) y el `.htaccess` guarda los `.js` 7 días en el navegador: muchos seguían con el reproductor viejo, sin vigilante. (2) El temporizador de arranque se apagaba con `loadedmetadata` (bastan los primeros cuadros) y el vigilante no actuaba mientras el video no hubiera avanzado nunca: si después no llegaba más, "Cargando" quedaba para siempre. (3) `media.php` mandaba la cabecera del MP4 apenas arrancaba ffmpeg, así la respuesta ya era un 200 y se esperaba 45 s más sin video; cada intento fallido encadenaba otros modos (hasta minutos). (4) HLS: una conversión colgada seguía "viva" mientras el iPhone pidiera la lista (el vigilante solo miraba los pedidos), un pid muerto podía parecer vivo si otro programa lo reusaba y una lista terminada sin segmentos se reusaba. (5) Subtítulos: si el hosting mataba el trabajo, el archivo `.job` decía "espera" durante 25 minutos.
- **Ahora:** la cabecera se guarda hasta el primer fragmento de video y audio; si ffmpeg no lo entrega en **25 s** (o muere) se detiene y `media.php` responde error 502. El reproductor deja de esperar y vuelve al **video original con su audio** desde el mismo punto (aviso "La conversión no respondió"); un error rápido (formato que ffmpeg no puede copiar) sigue probando los modos compatible y seguro. Respaldo en el navegador: sin ningún dato en 40 s también vuelve al original. Si la preparación (ffprobe) tarda más de 20 s ya no se abre ffmpeg, para no ocupar otra conexión de la cuenta IPTV.
- **HLS (iPhone):** el vigilante del hosting detiene ffmpeg si no hay primer segmento en 25 s o si la lista deja de avanzar 60 s sin terminar; una conversión terminada sin segmentos o con un pid muerto (o reusado por otro programa) se vuelve a lanzar; la lista y los segmentos se escriben completos (`temp_file`).
- **Subtítulos:** el trabajo en segundo plano guarda el pid de ffmpeg; si el hosting lo mató, se vuelve a lanzar en vez de responder "espera" 25 minutos. ffmpeg también se reconecta ahí.
- Probado con ffmpeg 6.1 y un archivo de prueba con destello y pitido cada segundo (GOP de 10 s, audio AC3): antes, al empezar en el segundo 25 el audio arrancaba 5 s después del video; ahora destellos y pitidos coinciden. Servidor IPTV que no responde: error a los ~15 s y el reproductor vuelve al original (antes ~50 s y luego más intentos con otros modos).
- Archivos: `media.php`, `includes/media_admin.php` (`wp_media_pid_alive`), `assets/nf/player.js` (`tcWatch`, `tcGiveUp`) y `video_player.php`, `play.php`, `tvguide.php` (`player.js?v=29`, para que el navegador cargue el reproductor nuevo).

## Conversión que no se queda "Convirtiendo" para siempre (12 de octubre)
- **Antes:** si la conversión con ffmpeg ya había entregado algo de video y después el servidor IPTV o el hosting se trababa, el `<video>` no emitía ni `error` ni `ended`: el aviso "Convirtiendo" se quedaba infinito y nunca entregaba el video con los audios seleccionables. El único rescate solo actuaba cuando no cargaban ni los primeros datos.
- **Ahora:** un vigilante (`tcWatch`) revisa cada 5 s que la conversión siga avanzando (el tiempo o lo que se va almacenando). Si ya arrancó y deja de avanzar 25 s, la da por colgada y la rescata de forma acotada: reintenta desde el mismo punto (hasta 3 veces), luego el modo seguro (480p) y, si aún así no, pasa al video http directo / VLC o al aviso de error. Nunca gira sin fin. Una conversión lenta pero que sigue entregando no se corta. Elegir otro idioma pasa por el mismo vigilante.
- Archivos: `assets/nf/player.js` (`tcWatch`, `recoverTc`).

## Sin demo automática (12 de octubre)
- La web player **no tiene demo automática**: no hay botón ni se pide una demo al panel. El panel tampoco la ofrece a la web (`tenant_config` responde `features.demo: false` para `app: web` y `auto_demo` con `platform: web` se rechaza). Una línea DEMO creada en el panel o en una app sigue entrando con su usuario y contraseña, en modo DEMO (ver abajo).
- Archivos: `includes/tenant.php` (ya no lee `features.demo`).

## Modo DEMO (12 de octubre)
- **Cómo se sabe.** El panel marca las líneas DEMO con `"demo": true` en la respuesta de `api/progress.php` (acción `auth`, que la web pide al iniciar sesión, y también en `GET ?v=2`). La web lo guarda en la sesión del servidor (`is_demo`); un inicio de sesión normal lo quita. No se guardan credenciales en ningún sitio nuevo. Con un panel anterior (sin el campo) todo sigue como antes.
- **Sin usuario ni contraseña a la vista.** Con una DEMO el menú de la cuenta dice **Cuenta DEMO** (avatar "D"), **Mi cuenta** muestra *Usuario: DEMO* con la etiqueta **Cuenta DEMO**, el aviso del panel (Alertas) cambia el usuario/contraseña por "DEMO" y el diagnóstico los oculta. Tampoco hay **Descargar contenido** ni **Abrir en VLC** / lista `.m3u` (`playlist.php` responde "No disponible en la DEMO"), porque esos enlaces llevan el usuario y la contraseña. El login no cambia.
- **Sin Continuar viendo ni Mi lista.** No se llama a `save`, `delete`, `fav_add` ni `fav_remove` del panel (ni desde el reproductor ni desde `save_favorite.php` / `save_progress.php` / `play.php`), las filas **Continuar viendo** y **Mi lista** no aparecen y el botón **Mi lista** (y la estrella de los canales) muestra "No disponible en la DEMO".
- Con la web en **http** el video de una DEMO sigue yendo directo del servidor IPTV (`/movie/usuario/contraseña/…`), igual que con cualquier línea: para que no se vea en el navegador, usa la web con SSL.
- Archivos: `includes/panel.php` (`wp_is_demo`, `wp_panel_set_demo`, `wp_demo_mask`), `login.php`, `header.php`, `myaccount.php`, `assets/nf/app.js`, `video_player.php`, `play.php`, `includes/handoff.php`, `tvguide.php`, `save_favorite.php`, `includes/progress_save.php`, `playlist.php`, `api.php`, `diag.php`.

## Deportes con canales y revisión de la línea (11 de octubre)
- **Canales que transmiten.** El panel ahora manda, para muchos eventos, los canales donde se ven (`tv`). La tarjeta los muestra ("📺 ESPN 2 · Fox Sports +3") y el botón pasa a **Ver canales**, que abre un menú: **Ver el evento** (prueba esos canales en orden y, si el cliente no tiene ninguno, busca por los equipos), cada canal con su país, y **Buscar por equipos**.
- **Canal correcto.** "ESPN 2" busca en la lista del cliente el canal que se llama igual sin calidad ni país ("MX: ESPN 2 HD", "ESPN2"); nunca da "ESPN" ni "ESPN 3". Si no lo tiene, avisa ("No tienes ESPN 2") y busca el partido por los equipos o el nombre del evento en la carpeta de eventos. Mismas reglas que Android, Android TV, Roku, Vega OS y Windows.
- Sin canales del panel todo sigue como antes (botón **TV en vivo**).
- **La línea se revisa sola.** Como mucho cada 15 minutos, las páginas con sesión preguntan al servidor IPTV si el usuario sigue activo. Contraseña cambiada, cuenta vencida, suspendida o borrada: se cierra la sesión y el login dice el motivo. Si el servidor no responde no se corta nada. La web nunca guarda la contraseña en el navegador (solo en la sesión del servidor). Archivo: `includes/line_guard.php`.

## Pantalla falsa, errores y estadísticas del panel (10 de octubre)
- **Pantalla falsa.** Si en el panel (Pantalla Falsa) está marcada la app **Web**, quien abre la web sin sesión ve la pantalla configurada (calculadora, carrusel, imagen, video o una página web dentro de un marco aislado) en vez del login. El código del panel seguido de **=** (o Enter; en imagen/video/web, mantener pulsado 3 s para escribirlo) abre el login. El código se comprueba en el servidor (nunca va en la página ni en la caché; 20 intentos cada 10 minutos) y el navegador queda desbloqueado un año con una cookie firmada; si el dueño cambia el código, la pantalla vuelve a salir. Quien ya tiene sesión no la ve. Archivos: `includes/fake_screen.php`, `includes/fake_screen_view.php`.
- **Errores al panel.** Los errores fatales de PHP y los videos que no se pudieron reproducir llegan cifrados a **Errores de las apps** del panel (solo el dueño), con usuario, navegador y hora; la contraseña nunca. El navegador los manda por `report.php` (solo con sesión iniciada, 30 cada 10 minutos). Archivo: `includes/error_report.php`.
- **Estadísticas.** El progreso y el inicio de sesión mandan `platform: web` y la IP del visitante, así la web cuenta en el mapa y en "clientes más activos" del Dashboard.
- Necesita el panel actualizado (acción `fake_screen` de `api/login.php`). Con un panel anterior todo sigue como antes.

## Conversión de audio que no terminaba (10 de octubre)
- **Antes:** al elegir otro idioma (o con audio Dolby/DTS) el video quedaba "Convirtiendo" para siempre cuando el servidor IPTV dejaba de mandar datos: ffmpeg esperaba sin límite, `media.php` esperaba a ffmpeg sin límite y el reproductor nunca recibía el video. El ffmpeg colgado seguía vivo en el hosting aunque se cerrara el video.
- **Ahora:** ffmpeg corta una lectura sin datos a los 15 s y se reconecta en el mismo punto (`-rw_timeout` + `-reconnect`), así la conversión sigue aunque el servidor se trabe. `media.php` lee sin bloquearse: si ffmpeg no entrega nada en 40 s (o se queda 45 s sin datos a mitad del video) lo detiene y responde un error, y el reproductor pasa al modo compatible o vuelve al video directo. No quedan procesos colgados.
- El fotograma clave de inicio se calcula antes de abrir la conversión (una sola conexión al servidor IPTV a la vez); el reproductor lo lee de la caché cuando ya llegan datos (`do=kf&c=1`).
- Probado con un servidor de prueba que se traba cada 20 MB (antes: colgado para siempre; ahora: la película completa), uno que nunca responde (antes: colgado; ahora: error a los ~70 s y vuelve al video directo) y uno que acepta una sola conexión.

## Seguridad (10 de octubre)
- **Clave de TMDB fuera del código.** Ya no está escrita en `includes/core.php`. Se lee de `'tmdb_key'` en `includes/panel_secret.php` (no se sube a GitHub) y, si falta, se usa la clave TMDB que manda el panel. **Cambia la clave vieja en tu cuenta de TMDB**: quedó en el historial de GitHub y en los `webplayer.zip` anteriores.
- **Estado (`estado.php`) solo muestra lo tuyo.** "Últimos guardados de progreso" lista solo los guardados del usuario que tiene la sesión abierta (cada entrada lleva una huella del usuario, no su nombre). La lista de procesos del hosting y el botón para detener todas las conversiones salieron de esta página: se manejan desde el panel (Guía EPG › motor multimedia).
- Con la web player en **http** (sin SSL) el navegador sigue leyendo el video directo del servidor IPTV con la dirección `/movie/usuario/contraseña/…`, igual que cualquier app Xtream: así el video no pasa por el hosting. Con **https** el video va por el enlace firmado y no se ve. Para que no se vea, usa la web con SSL.

## 1. Login con varias DNS
- El formulario muestra solo usuario, contraseña e Ingresar. Ya no aparece el selector de DNS.
- Al ingresar se consultan **todas las DNS en paralelo** y se entra con la primera que acepta los datos (en las pruebas tardó 0,16 s con 3 servidores).
- Mensajes claros para cada caso: contraseña incorrecta, cuenta vencida, cuenta bloqueada o ningún servidor disponible.
- Límite de 15 intentos cada 5 minutos para frenar ataques de fuerza bruta.
- El acceso de administrador ahora queda guardado en la sesión del servidor.

## 2. HTTPS
- Se detecta HTTPS también detrás de un proxy o Cloudflare (`X-Forwarded-Proto`).
- Si la página está en HTTPS y el servidor IPTV es HTTP, el video pasa por `proxy.php` y los pósters por `img.php`, así el navegador no bloquea contenido mixto. Las URLs van firmadas, por lo que nadie puede usar el proxy para otras direcciones.
- Si la página está en HTTP, el video se reproduce directo desde el servidor, sin gastar ancho de banda del hosting.

## 3. Fluidez
- Las respuestas del servidor Xtream quedan en caché en disco, y si el servidor tarda se usa la copia anterior.
- La sesión ya no bloquea las peticiones simultáneas.
- Las filas se cargan a medida que se hace scroll, y las páginas se precargan al pasar el mouse por encima.
- Las transiciones entre páginas son suaves.
- Se quitó la redirección `?loaded=1`, que obligaba a cargar cada página dos veces.

## 4. Reproductor
- Nuevo reproductor estilo Netflix con estos controles: reanudar, ±10 s, audio, subtítulos, velocidad, PiP, pantalla completa, siguiente episodio con cuenta regresiva, atajos de teclado y doble toque en el celular.
- Si un formato falla, prueba automáticamente el siguiente: MP4, luego la extensión original y por último HLS (m3u8). Para TS en vivo usa hls.js y mpegts.js. Las librerías están incluidas en el zip y no dependen de un CDN.
- Se mantienen las opciones Descargar, Abrir en VLC y el modo VLC de Ajustes.
- **Límite honesto:** el navegador no puede decodificar algunos códecs por sí mismo, como HEVC/H.265 en algunos equipos, audio AC3/DTS o AVI antiguos. Si el servidor no entrega una versión MP4 o HLS de ese contenido, la única opción es VLC.

## 5. Filtros inteligentes
- Desde homex, cada plataforma (Netflix, Disney+, Max, Prime Video, Marvel, Apple TV+, Paramount+, DC, Navidad y Halloween) abre todo su contenido de películas y series.
- Dentro de cada plataforma se puede filtrar por género: acción, suspenso, aventura, anime, drama, comedia, terror, ciencia ficción, fantasía, romance, crimen, animación, infantil, documental, bélica, doramas, novelas y otros.
- Para encontrar coincidencias se combinan el nombre de la categoría, el género que informa el servidor y el cruce por título entre categorías. También se puede ordenar por recientes, A‑Z o calificación.

## 6. Diseño Netflix
- Se aplicaron los colores, la tipografía y el estilo de Netflix: hero rotativo, Top 10, filas con desplazamiento, "Continuar viendo", "Mi lista" y páginas de detalle con elenco y tráiler.
- En el celular en vertical se ve como la app de Netflix: póster central, botones de categoría arriba y barra de pestañas abajo.

## 7. Seguridad
- **Corregido:** cualquier persona podía entrar al panel de administración con la cookie `admin=true`. Ahora se valida en la sesión del servidor.
- **Corregido:** había inyección SQL en las páginas de administración y XSS en los mensajes.
- **Corregido:** `proxy.php` era un proxy abierto y `portal.php` exponía las DNS. Además, la contraseña del usuario se guardaba en una cookie. Ya no.
- `.htaccess` bloquea el acceso directo a los archivos `.json`, `.sqlite`, `.log` y otros archivos de datos, a `includes/` y a `api/`. También agrega cabeceras de seguridad y compresión.
- En el navegador se bloquean el clic derecho, F12, Ctrl+U y Ctrl+S.
- **Hay que saberlo:** el HTML, el CSS y el JavaScript siempre llegan al navegador, así que nadie puede ocultarlos al 100%. Los bloqueos solo frenan a usuarios comunes. El código PHP y los datos nunca son visibles desde afuera.
- **Opcional:** en `includes/core.php`, `define('WP_FORCE_PROXY', true)` hace que todo el video pase por el proxy para ocultar las DNS, pero consume ancho de banda del hosting.
- **Pendiente:** la contraseña del administrador sigue guardada en texto plano dentro de `admin.json`. El archivo está protegido por `.htaccess`, pero conviene usar una contraseña única.
- Si el hosting usa **nginx** en lugar de Apache, `.htaccess` no tiene efecto. En ese caso hay que agregar esta regla:
  ```
  location ~* \.(json|sqlite|db|log|lock|txt)$ { deny all; }
  location ~ ^/(includes|api)/ { deny all; }
  ```

## Pruebas realizadas
Se probó en Chromium, en PC y en celular, con un servidor Xtream simulado y en los modos HTTP y HTTPS. Pasaron estas pruebas: el login con varias DNS, todas las páginas sin errores PHP, el filtro Netflix + Acción, la reproducción de películas (MKV redirigido a MP4 y AVI con respaldo), episodios con salto al siguiente, TV en vivo con HLS, y el guardado del progreso y los favoritos. No se pudo probar con tu servidor IPTV real.

## Configuración inicial (nuevo)
- En una instalación desde cero, sin `includes/admin/admin.json`, el login te lleva a `setup.php`. Ahí creas el usuario y la contraseña del administrador, y opcionalmente la primera DNS.
- Para administrar las DNS, inicia sesión en el login normal con ese usuario y contraseña. Entrarás directo al panel de DNS (`includes/dns/edit_dns.php`).
- Cuando el administrador ya existe, `setup.php` queda bloqueado y redirige al login.

## Actualización 3 de octubre (reproducción, TMDB, deportes)

**Reproducción con HTTPS (sin volver a HTTP)**
- En iPhone y Safari el video ahora arranca en silencio cuando el navegador bloquea el sonido automático, igual que Netflix, y aparece el botón **Activar sonido**. Antes el reproductor esperaba y probaba otro formato hasta mostrar un error.
- Los enlaces del proxy son firmados y caducan a las 12 horas, y ya no dependen de la cookie de sesión. El reproductor del iPhone a veces pide el video sin enviarla.
- El proxy corrige el tipo de archivo cuando tu servidor IPTV responde `application/octet-stream`, porque Safari no reproduce en ese caso. También responde a peticiones HEAD.
- Si tu servidor IPTV tiene puerto HTTPS (`https_port` en su información), el video va directo del servidor al navegador sin pasar por el hosting. Si ese puerto no responde, en 9 segundos pasa al proxy.
- En iPhone y Safari se usa el HLS nativo. Los canales en vivo con HTTPS usan el flujo `.ts` continuo, que es más estable por el proxy que pedir cada segmento. El búfer es más amplio para evitar cortes.
- Nuevo botón **Diagnóstico** en la pantalla de error del reproductor (`diag.php`). Muestra cómo responde tu servidor IPTV a cada formato: código, tipo, si permite saltos en el video y tiempo de respuesta.

**Contenido**
- "Continuar viendo" y "Mi lista" solo muestran títulos que existen en el servidor IPTV con el que entraste.
- Se agregó tu clave de TMDB en `includes/core.php` (`WP_TMDB_KEY`). Las tarjetas cambian a carátulas de TMDB en alta calidad, con 30 días de caché. El detalle usa la carátula, el fondo, el elenco y el tráiler de TMDB, buscando por `tmdb_id` cuando el servidor lo envía.
- Los filtros de género se quitaron del inicio en PC (en el celular siguen) y la línea "Géneros" se quitó del detalle.

**Plataformas**
- Para usar logos propios, sube estas imágenes a la carpeta `img/`, en formato .webp de 275×183 px como las demás: `appletv.webp`, `paramount.webp` y `dc.webp`. Mientras no existan, se muestra el nombre de la plataforma.

**Deportes**
- La página es nueva: partidos de hoy y mañana en tu hora local, sección "En vivo ahora" con marcador, filtros por deporte, buscador y tarjetas por liga. En PC se ve en cuadrícula y en el celular en tarjetas compactas. Los datos vienen de TheSportsDB con 15 minutos de caché. Si no hay datos, se muestran las tablas de antes.

## Actualización 3 de octubre (pulido final)

**Reproducción**
- El diagnóstico mostró que tu servidor anuncia HTTPS en el puerto 443, pero desde una IP sin certificado válido. Ahora el reproductor solo usa la conexión HTTPS directa cuando el certificado es válido, y si no, va directo al proxy seguro sin esperar 9 segundos. Las películas de tu servidor no existen en formato m3u8, así que el diagnóstico lo muestra como "No disponible en este formato" y el reproductor lo descarta enseguida.
- **Audio e idiomas:** en el menú de audio aparecen todas las pistas del archivo (Español, Inglés...) y en el de subtítulos los subtítulos internos. Se recuerda el idioma que elijas.
- **Audio Dolby en 4K:** cuando el navegador no decodifica el audio (AC3, E-AC3, DTS), el servidor lo convierte al vuelo a AAC estéreo sin tocar el video, así el 4K se escucha en Chrome. Si el archivo no abre en el navegador (MKV, HEVC en equipos sin soporte), también se intenta la conversión antes de dar error.
- Esto necesita **ffmpeg** en el hosting. En `diag.php` aparece si está disponible. Si no lo está, sube los archivos `ffmpeg` y `ffprobe` estáticos para Linux a la carpeta `bin/` con permiso 755. Sin ffmpeg, el reproductor avisa que ese contenido se escucha en Safari, Edge o VLC.

**VLC**
- En el celular, "Abrir en VLC" abre la app directamente (Android e iPhone).
- En la PC se descarga una lista `.m3u` que abre VLC, y el botón de descarga lleva a la Microsoft Store en Windows o a videolan.org en Mac y Linux.

**Guía de TV (EPG)**
- Tu repositorio `KuroBoy-56/epg` es una copia de las herramientas de iptv-org, pero no tiene ningún archivo de guía. Por eso se integraron guías XMLTV públicas (epgshare01 y epg.pw) como respaldo automático.
- Los canales sin guía del servidor la toman de ahí, emparejados por id o por nombre. Se actualiza sola cada 12 horas en segundo plano.
- Puedes cambiar las fuentes en `includes/admin/epg_sources.json`, con una lista de URLs.

**Deportes**
- El botón **TV en vivo** de cada partido busca el canal que lo transmite, primero en las carpetas de eventos (EVENTOS, PPV, etc.), y abre el canal con más coincidencias.
- Si el partido no es de hoy, muestra "El evento no está en línea". Si ya terminó, avisa que el evento terminó.

**Otros**
- Top 10: el número 10 ya se ve completo.
- Logos de canales: pasan por el servidor con caché, así cargan también los de servidores que bloquean el enlace directo. Si el logo no existe, se muestra el logo del webplayer.

## Actualización 3 de octubre (audio 4K y diagnóstico)

- **Audio 4K:** antes de abrir el video, el reproductor revisa sus pistas. Si el audio es Dolby o DTS, arranca directo con la conversión, sin abrir antes una conexión directa. Muchas cuentas IPTV permiten una sola conexión, y esa conexión extra hacía que el servidor rechazara la conversión, que es la causa más probable de que no se escuchara.
- La conversión reintenta sola si el servidor IPTV la rechaza al principio. Si se corta a mitad de la película, se retoma donde iba.
- Ya no importa si la reproducción arrancó en silencio por el bloqueo de sonido automático: el reproductor sigue revisando si el audio realmente suena.
- **Diagnóstico:** nueva sección "Conversión de audio (ffmpeg)". Muestra si el hosting permite ejecutar programas, si los archivos de `bin/` tienen permiso y qué versión de ffmpeg arranca. El botón **Probar conversión con este contenido** convierte 15 segundos y mide la velocidad. También aparece el último error del reproductor. Se abre desde el menú ⋯ del reproductor: "¿Sin audio o no carga? Diagnóstico".
- **EPG:** en hostings con LiteSpeed (como Hostinger), la actualización de la guía de respaldo hacía esperar a la página del canal. Ahora corre aparte (`epgjob.php`).
- Los títulos de la guía del servidor se decodifican aunque vengan con saltos de línea.
- En el diagnóstico de un canal se ve si el servidor envía guía, si hay guía de respaldo y el resultado de cada fuente pública.
- **Top 10:** el ancho del 10 se mide con la fuente real del equipo, así el 0 nunca queda debajo de la carátula.

## Actualización 3 de octubre (hosting sin proc_open)

- Si el hosting bloquea `proc_open` (como Hostinger), la conversión con ffmpeg prueba sola las otras formas que tiene PHP para ejecutar programas: `popen`, `exec` o `shell_exec`. Basta con que una esté permitida. Se probaron las cuatro: pistas, conversión de audio y subtítulos funcionan con cualquiera de ellas.
- El diagnóstico muestra cuáles de esas cuatro funciones permite tu hosting.

## Actualización 3 de octubre (entrega final del reproductor)

**Pistas de audio y subtítulos**
- El menú de audio y subtítulos muestra todas las pistas del archivo, aunque haya una sola, y siempre se puede elegir cualquiera.
- Antes, si la consulta de pistas tardaba más de unos segundos, el resultado se perdía y el menú decía "no hay pistas". Ahora se aplica igual cuando llega, y si el servidor la rechaza se reintenta.
- Mientras se consultan, el menú dice "Buscando pistas…".
- Los subtítulos se extraen en segundo plano para que el límite de tiempo del hosting no los corte. El reproductor avisa con "Preparando subtítulos…" y los activa solos cuando están listos. La primera vez tarda porque hay que leer el archivo completo; después quedan guardados.
- Los subtítulos de imagen (PGS de Blu-ray 4K) aparecen marcados como "(imagen)". El navegador no puede mostrarlos, solo VLC.

**Que todo reproduzca**
- El orden ahora es: formatos directos, luego conversión de audio, luego conversión completa del video a H.264 720p (para HEVC de 10 bits, XviD, MPEG-2 y similares en equipos que no los soportan). El mensaje de error solo aparece si todo eso falla.

**Diagnóstico**
- Botón **Volver a la reproducción** arriba y abajo de la página. El diagnóstico es solo una prueba: el reproductor usa la conversión solo cuando hace falta.

**TMDB (carátulas, elenco, descripción)**
- Los nombres del servidor IPTV se limpian antes de buscar: prefijos ("ES -", "|LAT|", "4K |"), calidad (4K, HDR, 1080p, HEVC...), idioma (LAT, DUAL, SUBT...) y año, que se usa para afinar.
- Se elige el resultado que más se parece por título, año y popularidad, en vez del primero de la lista. Si nada se parece, no se muestra una carátula equivocada.
- Si no aparece, se intenta sin año, con el título antes de ":" y como serie o película. Si el `tmdb_id` del servidor está mal, se busca por nombre.
- Los "no encontrado" se vuelven a intentar a los 2 días (antes quedaban 30). Si TMDB no respondió, no se guarda nada.
- Descripción en español de México, luego de España y luego en inglés. Elenco también para series.

## Actualización 3 de octubre (reproducir siempre en el navegador)

**Navegador primero, VLC como último recurso**
- Antes de mostrar un error, el reproductor prueba en orden: formato directo, conversión del audio, conversión completa a H.264 720p y un **modo seguro** a 480p con audio resincronizado, pensado para archivos dañados o con tiempos rotos.
- Todas las conversiones ignoran los paquetes dañados del archivo en vez de detenerse.
- Si todo eso falla, se busca una solución automáticamente ("Buscando una solución…"). Si la encuentra, muestra "Posible solución a la reproducción o el audio" con **▶ Volver a reproducir**, y si no lo tocas reproduce solo a los 4 segundos.
- Si vuelve a fallar, ese contenido ya no muestra la opción de solucionar. Quedan solo Reintentar, Abrir en VLC y Descargar.
- El botón Diagnóstico ya no aparece en el reproductor. En el menú ⋮ está "¿Sin audio o no carga? Solucionar", que hace lo mismo sin salir del video. `diag.php` sigue disponible por URL para el administrador.

**Idioma del audio**
- Si el contenido trae varios idiomas, se elige el del navegador (español si el navegador está en español). Si no está, se usa la pista predeterminada del archivo.
- Si eliges otro idioma a mano, se recuerda para los siguientes contenidos.
- Se reconocen spa, es, es-419, lat, "Español latino", "Castellano", etc.

**Pistas en Chrome**
- Chrome no muestra las pistas de los archivos por sí mismo, Safari sí. Ahora, si al abrir Audio y subtítulos todavía no se conocen las pistas, el reproductor las busca.
- Si el servidor IPTV rechaza la consulta porque el video ya ocupa la conexión, el reproductor suelta la conexión un segundo, lee las pistas y retoma en el mismo punto.

**Abrir en VLC**
- **iPhone / Android:** abre la app VLC directamente. Si no está instalada, aparece una ventana con los botones de App Store y Google Play; el de tu equipo va primero. En Android, si falta VLC, se abre la Play Store sola.
- **Computadora:** intenta abrir VLC. Si no responde, se descarga una lista de reproducción que se abre con VLC, junto con botones para descargar VLC (Microsoft Store en Windows o videolan.org).
- Funciona igual desde la guía de TV y en pantalla completa.

## Actualización 4 de octubre (todo desde el panel)

**Configuración (lo único que hay que hacer en el hosting)**
- Copia `includes/panel_secret.sample.php` como `includes/panel_secret.php` y pon la llave maestra del panel (`master_key_hex`, la misma de `includes/secrets.php` del panel).
- Ese archivo está en `.gitignore`: nunca se sube a GitHub ni va dentro de `webplayer.zip`. Si falta, el login muestra "configura includes/panel_secret.php".
- La dirección del panel va codificada dentro del código, no en texto plano.

**Sin sección de administración**
- Se quitaron `setup.php`, `test.php`, `includes/admin/`, `includes/dns/`, `includes/notifications/`, `includes/admin_guard.php`, `includes/portal.php`, `database.php`, `epgjob.php` y el acceso de administrador del login.
- Las notificaciones locales se quitaron (el reproductor no las mostraba). El aviso del panel (`api/alerta.php`) ahora sí se muestra: ver "Aviso de bienvenida y vencimiento" al final.
- Puedes borrar del hosting los archivos viejos: `includes/admin/`, `includes/dns/`, `includes/notifications/`, `progress.json`, `api/history.json`, `api/live_favorites.json`, `includes/userdata.sqlite`, `setup.php`, `test.php`, `database.php` y `epgjob.php`.

**DNS desde el panel**
- La lista de DNS se pide al panel (`api/login.php`, acción `fetch_dns`, cifrada con la llave maestra). Se guarda 10 minutos en caché; si el panel no responde se usa la última lista buena.
- El login sigue probando todas las DNS en paralelo y entra con la primera que acepta al usuario con cuenta activa. Si el panel entrega la DNS como `https://`, también se prueba la versión `http://`.

**Continuar viendo y Mi lista en el panel**
- Al iniciar sesión se pide un token al panel (`api/progress.php`, acción `auth`) y queda en la sesión. Si caduca se renueva solo.
- "Continuar viendo", "Mi lista" y los canales favoritos se leen y guardan en el panel, así se comparten con la app Android y la de Windows. Ya no se guarda nada de esto en el hosting.
- En el panel, cada serie tiene una sola entrada (con el último episodio visto). Al llegar al 95 % el título sale de "Continuar viendo".
- "Mi cuenta" muestra lo que estás viendo (el historial local de vistos ya no existe).

**Guía EPG**
- Primero se usa la guía del servidor IPTV (`get_short_epg`). Si un canal no tiene, se pide al panel (`api/epg.php`) con 15 minutos de caché. Ya no se descargan guías XMLTV en el hosting.

**Deportes**
- Los partidos vienen del panel (`api/sports.php`, 10 minutos de caché). La búsqueda del canal en vivo sigue igual, con las mismas reglas que publica el panel.

## Actualización 4 de octubre (video directo, sin pasar por el hosting)

**El video ya no pasa por el hosting**
- Todo el video (películas, series y TV en vivo) va directo del servidor IPTV al navegador. El hosting compartido solo hace llamadas pequeñas: la API del servidor IPTV (`player_api`) y el panel.
- Se quitaron `proxy.php` (proxy de video), `media.php` (conversión con ffmpeg a MP4/HLS, pistas y subtítulos) y la carpeta `bin/`. Ya no hace falta ffmpeg en el hosting. Si los subiste, puedes borrar `bin/ffmpeg` y `bin/ffprobe`.
- Si la web está en HTTPS, los enlaces de video se arman en HTTPS hacia el servidor IPTV (`https_port` de su información, o el 443), así el navegador no bloquea contenido mixto. Tu servidor tiene certificado válido en el 443.
- "Descargar" lleva directo al archivo del servidor IPTV.
- `diag.php` ya no prueba ffmpeg. Muestra cómo responde cada formato y si el video sale en HTTPS directo.
- Se quitó el botón DNS y la resolución por DNS sobre HTTPS.

**Reproductor en PC y celulares**
- El reproductor detecta qué sabe hacer el navegador y elige solo:
  - hls.js donde hay MSE (Chrome, Edge, Firefox, Samsung Internet, Android).
  - HLS nativo en iPhone/Safari.
  - mpegts.js para TV en vivo `.ts` (MSE o ManagedMediaSource del iPhone con iOS 17.1 o superior).
  - MP4 directo con saltos (Range) para películas y series.
- TV en vivo en iPhone/Safari: se usa primero el m3u8 del servidor.
- Se mantiene la elección de audio y subtítulos con las pistas que muestra el navegador (Safari y HLS).
- Si un formato no se puede reproducir en ese navegador (por ejemplo MKV o HEVC en iPhone, o audio Dolby en Chrome), el reproductor lo dice y ofrece abrirlo en VLC o en otra app como último recurso.
- **Límite:** sin conversión en el hosting, lo que el navegador no decodifica (audio AC3/DTS en Chrome, MKV/HEVC en iPhone) solo se puede ver en VLC.

## Reproducción directa con la web en HTTPS (4 de octubre)
- Un navegador no deja que una página https reproduzca video http, y hls.js/mpegts.js necesitan permiso CORS del servidor IPTV. Por eso, sin proxy, no reproducía nada.
- Ahora la web prueba desde el hosting (solo unos bytes, con caché de 6 horas) si el servidor IPTV entrega el video por https con certificado válido. Si no, abre el reproductor `play.php` por http: el navegador lee el video directo del servidor IPTV, como cuando la web estaba en http. El video nunca pasa por el hosting.
- `play.php` no usa la cookie de sesión: recibe un enlace cifrado (AES-256-GCM, llave propia del hosting) que caduca en 12 horas. "Continuar viendo" se sigue guardando en el panel.
- Si el reproductor https falla con todas las fuentes, cambia solo a `play.php` y continúa desde el mismo segundo.
- TV en vivo: si el canal necesita http, en la guía aparece el botón **Ver canal**, que lo abre en `play.php`.
- `.htaccess` manda toda la web a https excepto `play.php` y `assets/`. En Hostinger hay que apagar **Forzar HTTPS**.
- Safari (iPhone) y Chrome cambian solos `http://` por `https://` cuando la web tiene SSL, y eso volvía a bloquear el video. `play.php` ahora regresa a http una vez: el navegador detecta el ciclo y se queda en http.
- Se probó volver al proxy del hosting, pero se descartó para no saturar el hosting compartido.

- El `.htaccess` ya **no** fuerza https. La web funciona en http y el video va directo del servidor IPTV. (Antes, al quitar el SSL, el propio `.htaccess` seguía redirigiendo a https y la web no abría.)
- Arreglado el login que se recargaba sin dar acceso en http: la cookie de sesion ya no se marca "secure" cuando la web esta en http (se fija por ini_set, sin depender del php.ini del hosting). Antes, si el hosting forzaba secure=1, el navegador descartaba la cookie.
- Audio y subtitulos seleccionables en cualquier navegador: en VOD, los navegadores que no exponen las pistas de un MP4 directo (Chrome, Firefox, Android) reproducen por HLS (hls.js), que si las expone. En Safari/iPhone se usa el archivo directo que ya trae esa funcion. Si el servidor no ofrece HLS para una pelicula, se reproduce igual el archivo directo (sin cambio de pista, como un MP4 normal).

## Audio dual sin doble audio y video por HTTPS (7 de octubre)
- **Motor MP4 propio (`assets/nf/mp4mse.js` + `assets/vendor/mp4box.min.js`):** cuando una película o episodio MP4 trae más de un audio (o subtítulos de texto), el navegador lee el archivo directo del servidor IPTV por partes, separa las pistas y reproduce **una sola**. El reproductor del navegador es el que manda: en iPhone ya no suenan dos idiomas a la vez, y en Chrome, Edge y Firefox de PC y Android por fin se puede elegir el idioma de un MP4 (antes solo Safari).
  - Cambiar de idioma continúa desde el mismo segundo. Adelantar o retroceder pide solo esa parte del archivo.
  - Arranca con el idioma que elegiste la última vez, o el del navegador.
  - Los subtítulos de texto que vienen dentro del MP4 aparecen en el menú de subtítulos.
  - Guarda en memoria solo lo necesario (borra lo ya visto) para que 4K funcione también en celulares.
  - Si el contenido tiene un solo audio, si el servidor no permite leerlo por partes (CORS/rangos) o el navegador no tiene MediaSource (iPhone con iOS menor a 17.1), se usa el reproductor de siempre.
- **iPhone:** la pantalla completa nunca abre el reproductor de iOS: se usa la pantalla completa propia del web player (con su menú de audio y subtítulos). Si iOS intenta abrir el suyo con un gesto, se vuelve al del navegador.
- **Video por HTTPS sin pasar por el hosting:** si pones la web en https, el orden es: 1) https directo del servidor IPTV (puerto https del servidor), 2) **relay https propio en Cloudflare** (`cloudflare/relay-worker.js`, gratis), 3) `play.php` en http. Con el relay, el video va servidor IPTV → Cloudflare → navegador. Ver GUIA.md.
- Corregidos textos con acentos rotos en el reproductor ("Capítulo anterior", "T1:E1 · título").
- La pantalla "No se pudo reproducir" muestra en letra pequeña por qué falló cada intento, si la página está en http o https y un enlace a **Diagnóstico**. Sirve para encontrar la causa con una captura.
- Después del motor MP4 se esperan 1,5 s antes de probar el reproductor normal, porque algunos servidores IPTV siguen contando esa conexión un momento y rechazan la siguiente.
- Relay de Cloudflare: si el servidor IPTV redirige una película o episodio a otro servidor (balanceador), el Worker sigue esa redirección él mismo. Así `ALLOWED_HOSTS` ya no lo bloquea. Hay que volver a pegar `cloudflare/relay-worker.js` en el Worker.
- `play.php` (el reproductor por http): Safari en iPhone vuelve a forzar https cuando la web tiene SSL, y entonces el video http quedaba bloqueado (error "native 4"). Ahora, si `play.php` termina abierto en https, usa las mismas fuentes https que la página normal: https directo del servidor IPTV o el relay de Cloudflare. **Con la web en https hace falta `includes/https_relay.php`** para el contenido que el servidor solo entrega por http.
- Con `includes/https_relay.php` creado, el relay de Cloudflare **siempre** queda como respaldo de cada formato. Antes, si la prueba del hosting decía que el https directo del servidor IPTV funcionaba, el relay nunca se usaba aunque el celular no pudiera abrirlo (caso Reacher: "mp4: native 4"). El motor de audio usa el relay de entrada, porque es el que da el permiso para leer las pistas. En la línea de detalle del error, los intentos por el relay dicen "relay".
- **Diagnóstico** ahora prueba también el relay de Cloudflare: si el Worker responde, qué contesta para cada formato (por ejemplo "host", "origin" o "upstream"), a qué servidor terminó yendo y si da el permiso CORS. El enlace "Diagnóstico" aparece también en el error de `play.php`.

## El hosting vuelve a entregar el video http (7 de octubre)
- **Regla:** si la DNS del servidor IPTV es `http://`, el video pasa por el hosting (`proxy.php`). Si es `https://`, va directo del servidor IPTV al navegador y el hosting no participa. El día que el proveedor entregue https, el hosting queda libre solo, sin tocar nada.
- Como el video llega desde tu mismo dominio, el navegador puede leer las pistas: el motor MP4 elige y cambia el idioma en el propio celular o PC (sin doble audio en iPhone), **sin usar ffmpeg**. El hosting solo reenvía bytes.
- `media.php` (ffmpeg) vuelve para el contenido http: lista de pistas, audio Dolby/DTS convertido a AAC y formatos que el navegador no abre (MKV, etc.). Con https no se usa.
- El relay de Cloudflare ya no hace falta: puedes borrar `includes/https_relay.php`.
- Archivos nuevos: `proxy.php`, `media.php`, `includes/media_core.php`, `includes/doh.php`, `bin/`.
- `instalar_ffmpeg.php`: abre esta página con tu sesión iniciada y toca "Descargar e instalar ffmpeg". El hosting descarga ffmpeg y ffprobe (versión estática 6.0 para Linux) directo a `bin/` y comprueba que funcionan. No hay que subir nada desde el celular. Después se puede borrar.
- Corregido: la DNS del proveedor es https, pero el video redirige a otro servidor por **http** (p. ej. `http://88.99.28.189`). El reproductor lo mandaba directo y el iPhone lo bloqueaba ("Load failed" / "native 4"). Ahora el hosting comprueba una vez (caché de 6 h) a dónde termina el enlace: si termina en http, el video pasa por `proxy.php`; si termina en https, va directo.

## El hosting solo trabaja con contenido de varios audios (7 de octubre, tarde)
- **Nueva regla (página en http):** el video va directo del servidor IPTV al navegador por http. Solo si la película o el episodio trae **más de una pista de audio** se agrega la fuente por el hosting (`proxy.php`), para poder elegir el idioma. Si esa fuente falla, sigue lo directo.
- Las pistas se cuentan **sin ffmpeg**: el hosting lee solo la cabecera del archivo (unos KB, MP4 y MKV) y guarda el resultado 30 días (`includes/audio_probe.php`).
- ffmpeg (`media.php`, "Solucionar") solo se ofrece en contenido con varios audios. Con un solo audio ya no aparece "No se pudo convertir".
- Más rápido: el reproductor ya no intenta el motor MP4 con un http directo (fallaba sin CORS y retrasaba el inicio), y con el motor MP4 no espera a ffmpeg antes de arrancar.
- Página en **https**: el navegador bloquea video http, así que ese video sigue pasando por el hosting. Para que el hosting quede libre, la web debe abrirse en http.
- Corregido "getaddrinfo() thread failed to start": cuando el hosting llega a su límite de procesos, curl no puede crear el hilo con el que busca la IP. Ahora la IP se busca con `gethostbyname()` (sin hilos), queda en caché 30 minutos y se le entrega a curl.
- `diag.php` muestra cuántos audios tiene el contenido, por dónde va el video y la IP resuelta del servidor IPTV.
- Corregido: al quitar el SSL el login parpadeaba y no entraba. El navegador conservaba la cookie de sesión "secure" de cuando la web era https y una página http no puede reemplazarla. Ahora la cookie de sesión se llama distinto en http (`WPSESS`) y en https (`WPSESS_S`).

## Progreso, doble audio en iPhone y pantalla completa (7 de octubre)
- **Progreso:** si el panel deja de responder por https (por ejemplo, al quitar el SSL del dominio), la web ahora prueba https sin revisar el certificado y luego http, y recuerda la forma que funcionó. Si el panel está caído, se espera solo una vez por minuto, así las páginas no se ponen lentas.
- **Doble audio en iPhone:** aunque el hosting no alcance a leer las pistas, el reproductor detecta en el propio iPhone que el MP4 trae varios audios y se cambia en el mismo segundo al motor MP4 por el hosting (un solo audio y menú de idiomas). Si eso falla, vuelve a lo directo.
- **Pantalla completa en iPhone:** con un solo audio se usa la pantalla completa real de iOS. Con varios audios sigue la pantalla completa propia (la de iOS mezclaría los audios).
- **Más rápido:** la lectura de pistas en el hosting tiene un tope de 3 segundos.
- Nuevo `estado.php`: muestra si el hosting llega al panel (https, https sin certificado, http), cuántos títulos de progreso tienes, los procesos del hosting y un botón para detener las conversiones de ffmpeg.
- **Pantalla completa real en iPhone también con selección de idioma:** con el motor MP4 o la conversión el video lleva un solo audio, así que se usa la pantalla completa de iOS (sin barra del navegador). Si iOS no la abre, queda la propia.
- **Contenido con varios audios donde el motor MP4 falla (p. ej. audio Dolby):** si el iPhone detecta varios audios en el reproductor normal, se leen las pistas en el hosting y ffmpeg entrega un solo audio (el elegido). Con un solo audio el hosting sigue sin trabajar (`media.lazy`).
- **Progreso más confiable:** al abrir un contenido el video arranca en 0 un instante antes de saltar al punto guardado (y al cambiar al motor MP4 se pausa). Esos primeros segundos se guardaban y borraban el progreso real. Ahora no se guarda nada antes de los 10 segundos, ni un punto muy anterior al guardado durante los primeros 2 minutos. Si el panel no confirma el guardado, se reintenta. Igual en http, https y `play.php`: el progreso vive en el panel, no en la web.
- `estado.php` muestra los últimos 30 intentos de guardar progreso (hora, contenido, posición y si el panel lo aceptó o por qué no) y si ffmpeg está instalado y puede ejecutarse.
- **Progreso que se guardaba pero no se veía:** si un mismo contenido estaba guardado más de una vez en el panel (por ejemplo, con otro título desde otra app), la web podía reanudar con la copia vieja. Ahora gana siempre el guardado más reciente. Además, la lectura del progreso pide al panel una respuesta sin caché, y `estado.php` muestra lo que el panel tiene guardado (título, posición y fecha).
- **Reacher salía como "1 audio":** el hosting tenía solo 3 segundos para leer las pistas y, en archivos grandes con el índice al final, se quedaba a medias y contaba 1. Ahora un conteo incompleto se toma como "no se sabe" (no se guarda como 1). Además, la página ya no espera ese conteo: si no se sabe, el reproductor arranca directo y lo pide en segundo plano (`tracks.php`, hasta 10 s). Si resultan varios audios, cambia al modo de elegir idioma, o a ffmpeg si ese modo no puede.
- Modo diagnóstico del reproductor: agrega `&debug=1` al enlace de `video_player.php` y se ve en pantalla qué fuente se prueba, cuántos audios ve el navegador, qué decide el motor MP4 y si entra ffmpeg.
- **Reacher en iPhone (visto con `&debug=1`):** Safari decía que el MP4 tenía 0 audios, pero sonaban los dos; por eso nunca se cambiaba al modo de un idioma. Ahora, en iPhone/iPad/Mac, si no se sabe cuántos audios tiene un contenido, el hosting los cuenta antes de abrir el video (solo la primera vez, luego queda en caché). Un conteo fallido ya no se guarda como definitivo. El motor MP4 ya no se intenta con el enlace directo del servidor IPTV (sin CORS fallaba tras 20 s de espera). Si el motor MP4 no puede, pasa a ffmpeg con un solo audio.
- Reacher seguía en "contó audios: 0": la lectura rápida de la cabecera no lograba leer ese archivo. Ahora cada lectura vuelve a pedir el enlace original del servidor IPTV y, si aun así no alcanza, `tracks.php` (en segundo plano) y `diag.php` preguntan a ffprobe cuántos audios hay. Solo se pregunta: no se convierte nada.
- **Aviso de carga para el usuario:** arriba del video aparece una línea en verde con puntitos que explica qué está pasando, una a la vez (la nueva reemplaza a la anterior): "Cargando el contenido", "Error de reproducción en este navegador" → "Probando otra forma de reproducir", "Este contenido tiene varios idiomas" → "Preparando la selección de idioma", "Tu navegador no es compatible con este formato" → "Convirtiendo a un archivo compatible" y, si tarda más de 15 s, "Ya casi: la conversión puede tardar unos segundos, no cierres el video". Desaparece apenas el video empieza a reproducirse. Los detalles técnicos siguen solo en `&debug=1`.
- **Listo para un proveedor con HTTPS y CORS (sin tocar código):** el hosting prueba solo, una vez cada 6 horas por servidor, si el video del proveedor llega por https y trae el permiso CORS para tu web (incluido el que pide el navegador para leer por partes). Si lo trae, los contenidos con varios idiomas van directo del servidor IPTV al navegador, que separa los idiomas por su cuenta, y tu hosting no transmite nada. Si no lo trae (como hoy), todo sigue igual que ahora. Funciona con la página en http o en https: el día que el proveedor lo active, solo instalas el SSL. El hosting solo se usaría como último recurso si el navegador no puede con el formato (conversión con ffmpeg).

## Continuar viendo y Mi lista entre DNS, y página de actor (8 de octubre)
- **Corregido: la web no mostraba el progreso ni Mi lista guardados en otras apps.** El login entra por la DNS que responde primero, así que cada vez podía ser otra DNS, y el panel guardaba los datos por usuario + DNS. Ahora el panel guarda por usuario + **servicio**: todas las DNS del mismo servicio comparten "Continuar viendo" y "Mi lista" (el panel lo detecta solo o con el campo "Servicio / grupo" de la página DNS del panel). La web no necesita configuración nueva.
- "Continuar viendo" y la cuenta se ordenan por la hora exacta del último guardado (antes, por segundos, dos guardados del mismo segundo podían salir en otro orden).
- **Actores:** en la ficha de una película o serie, tocar a alguien del elenco abre `actor.php` con su foto, biografía y **solo los títulos que tu servidor tiene** (filmografía de TMDB emparejada por título normalizado y año ±1, igual que la app de Windows). Al tocar un título se abre su ficha. Usa la clave TMDB del panel y, si falta o no sirve, la incorporada.

## Aviso de bienvenida y vencimiento (8 de octubre)
- Al entrar, la web muestra el aviso que se configura en **Alertas** del panel (`admin_alertas.php`), igual que las apps: si a la cuenta le quedan 3, 2 o 1 días sale el texto de ese día, si quedan 0 o está vencida el de 0 días; si no, la bienvenida con el texto general y la imagen.
- Sale una vez por sesión del navegador: al abrir la web y cada vez que se inicia sesión, con el diseño de la web y un botón **Entendido** (también se cierra con Esc o Enter).
- `api.php?action=alerta` le pide el aviso al panel (`api/alerta.php?format=json`) desde el hosting; la contraseña nunca pasa por el navegador. La imagen pasa por `img.php` si la web está en https y el panel en http.
- Necesita el `api/alerta.php` nuevo del panel (con `format=json`). Archivos: `api.php`, `header.php`, `assets/nf/alert.js`, `assets/nf/app.css`.

## Número de distribuidor (8 de octubre)
- **Primera visita:** antes del login aparece la pantalla **Número de distribuidor** (6 dígitos) con **Continuar** y **Omitir**. La elección queda guardada en el navegador (cookie `wp_dist` de 1 año): las siguientes veces se va directo al login, o al inicio si la sesión sigue abierta.
- **Omitir:** todo funciona exactamente como antes (datos del dueño del panel, logo, nombre y colores de siempre).
- **Continuar:** la web valida el número con el panel (`api/login.php` acción `tenant_config`, cifrada con la llave maestra) y aplica la marca del distribuidor: nombre (título, pie y menú), logo (cabecera, login, aviso y reproductor; si falla, el logo incorporado) y colores (`:root` del tema, botón con texto blanco o negro según el contraste). El navegador guarda una copia de logo, nombre y colores (`localStorage`).
- Con número, las peticiones al panel llevan `tenant` + `app: "web"`: lista de DNS (`fetch_dns`), token de progreso/Mi lista/guía/deportes (`progress.php`) y el aviso (`alerta.php?t=…&app=web`). La lista de DNS, la última lista buena (`dns_last_NNNNNN.json`), la clave TMDB y la agenda deportiva se guardan por número: dos distribuidores nunca se mezclan. El token del panel también es uno por número.
- **Guardián:** cada página revisa el distribuidor con el panel como mucho cada 10 minutos (copia compartida en el hosting). Si está vencido, suspendido, no es válido o no tiene habilitada la web, se cierra la sesión, se borra el número y se vuelve a pedir con el mensaje en español. Si el panel no responde se sigue con la última copia hasta 72 h; después aparece una pantalla para reintentar.
- Si el distribuidor apagó Deportes o Alertas en el panel, la web oculta Deportes o no muestra el aviso.
- **Mi cuenta:** muestra "Distribuidor: nombre (número)", "Vence: DD/MM/AAAA (hora de Panamá)" y el botón **Cambiar distribuidor** (cierra la sesión y vuelve a la pantalla del número; también sirve para poner un número si antes se eligió Omitir). En el login hay el mismo enlace.
- **Protección de la IP del hosting:** el panel cuenta los números no válidos por IP, y para el panel todas las visitas de la web vienen de la IP del hosting (10 en 15 min = espera; 30 en 24 h = IP bloqueada). La web corta antes: máximo 8 intentos por visitante cada 15 min y deja de preguntar números desconocidos tras 8 no válidos en 15 min o 25 en 24 h (los números ya validados siguen funcionando).
- Archivos: `includes/tenant.php`, `includes/tenant_brand.php`, `includes/tenant_guard.php`, `includes/tenant_login.php` (nuevos), `includes/panel.php`, `includes/actor.php`, `includes/handoff.php`, `includes/ui.php`, `login.php`, `logout.php`, `session.php`, `header.php`, `config.php`, `api.php`, `myaccount.php`, `sportsschedule.php`, `video_player.php`, `play.php`, `assets/nf/alert.js`. Opcional: `panel_url` en `includes/panel_secret.php` para apuntar a otro panel (pruebas).

## Motor multimedia controlado desde el panel (10 de octubre de 2026)
- `media_admin.php` + `includes/media_admin.php`: el panel (**Guía EPG › Web player**) ve si el motor (`media.php`, ffmpeg) está activado, cuántas conversiones hay en curso y puede **Detener conversiones**, **Activar** o **Desactivar**.
- Las órdenes van firmadas con la llave maestra del panel (la misma de `includes/panel_secret.php`); una orden sin firma válida se rechaza.
- Desactivado: la página del video ya no ofrece el motor y `media.php` responde 503, así que se reproduce el video directo del servidor IPTV.
