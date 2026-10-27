# Guía para terminar: Web player

1. **Subir:** descomprime `webplayer.zip` en la carpeta de tu web player en el hosting.
2. **Llave:** copia `includes/panel_secret.sample.php` como `includes/panel_secret.php` y pega la misma llave del panel (`master_key_hex`, 64 caracteres). Este archivo vive solo en el hosting.
3. **Permisos:** la carpeta `includes/cache/` debe poder escribirse (755).
4. **Limpieza:** si siguen en el hosting, borra `bin/` (ffmpeg ya no se usa en el hosting), `instalar_ffmpeg.php`, `setup.php`, `test.php`, `database.php`, `epgjob.php`, `includes/admin/`, `includes/dns/` y `includes/notifications/`. **No borres** `media.php`, `proxy.php` ni `route.php`.
5. **HTTPS:** ver la sección de abajo. Sin relay de Cloudflare, deja **Forzar HTTPS** apagado (el video http se abre en `play.php` por http). Con el relay puedes encender SSL y Forzar HTTPS.
6. **Prueba:** entra con un usuario de prueba desde un PC, un iPhone y un Android. Si algo no carga, abre el diagnóstico desde el aviso de error del reproductor.
7. **Si falla la TV en vivo:** si no carga en Chrome pero sí en VLC, pide a tu proveedor IPTV que permita CORS en su servidor.

Después del login la barra del navegador nunca muestra el nombre de una página: cada enlace es `w-<token>`, distinto y aleatorio cada vez (cifrado con la llave propia del hosting, válido 7 días y solo para la sesión que lo abrió). Una página abierta por su nombre se cambia sola a un token.

## Web en HTTPS (SSL de Hostinger) sin cargar el hosting
El navegador bloquea un video `http` dentro de una página `https`. Por eso, con SSL, el video http del servidor IPTV va por un **relay https de Cloudflare** (Worker): servidor IPTV → Cloudflare → navegador, nunca por Hostinger. La conversión de audio y video no cambia (motor del panel en la VPS / VDS, que también necesita https).

1. Crea una cuenta gratis en [Cloudflare](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker**. Ponle un nombre (por ejemplo `relay`) y **Deploy**.
2. **Edit code**: borra lo que trae, pega el contenido de `cloudflare/relay-worker.js` y **Deploy**.
3. En **Settings → Variables** agrega `ALLOWED_HOSTS` con los hosts de tus DNS separados por coma (por ejemplo `latammx.net,1.2.3.4`) y `ALLOWED_ORIGINS` con **todas** las direcciones de tu web y las de tus distribuidores (`https://tuweb.com,https://web.distribuidor.com`).
4. (Opcional) Dirección propia para el relay: **Settings → Domains & Routes → Add → Custom Domain**, por ejemplo `video.tudominio.com` (el dominio tiene que estar en Cloudflare; Cloudflare crea solo ese registro, con la nube naranja). Si no, usa la de `workers.dev`.
5. En el hosting copia `includes/https_relay.sample.php` como `includes/https_relay.php` con la dirección del Worker.
6. En hPanel activa **SSL** y, si quieres, **Forzar HTTPS**. Orden del video: https directo del servidor IPTV (si lo tiene) → relay de Cloudflare. Solo si no hay relay: `play.php` por http (con Forzar HTTPS apagado) y, como último recurso, el hosting.

**Dominios de la web con nube gris:** la web (y los dominios de tus distribuidores) pueden estar en Cloudflare con **nube gris** (solo DNS) apuntando a Hostinger: así el SSL lo da Hostinger (agrega cada dominio en hPanel y activa su SSL). Lo que **no** se puede es poner el Worker en un registro con nube gris: un Worker solo funciona con tráfico que pasa por Cloudflare (nube naranja). Por eso el relay va en su propio subdominio (paso 4) o en `workers.dev`, y la web se queda gris.

**Límites de Cloudflare:** el plan gratis permite 100.000 peticiones al día. Una película en MP4 usa pocas; la TV en vivo en HLS pide la lista y un segmento cada pocos segundos (un solo televidente todo el día puede pasar de 40.000). En PC y Android la TV en vivo va primero en `.ts` (una sola petición por canal); en iPhone va en HLS. Si se queda corto, el plan Workers Paid (5 USD al mes) incluye 10 millones al mes. Cloudflare restringe el uso de su red para servir mayormente video: con mucho tráfico revisa sus condiciones (o usa la web en http).
