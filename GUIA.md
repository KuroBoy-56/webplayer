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

**Cloudflare solo para los dominios:** la web, el panel y los dominios de tus distribuidores pueden estar en Cloudflare (nube naranja para esconder la IP de Hostinger y proteger el dominio principal, o gris si prefieres el SSL de Hostinger). El registro de la **VPS / VDS va con nube gris** (solo DNS): así el video nunca pasa por Cloudflare.

**Dominio propio con un Worker (opcional):** el cliente entra por un dominio nuevo (el tuyo o el de cada distribuidor, sin límite) y el dominio original de la web responde **403 Forbidden**. El Worker (`cloudflare/edge-worker.js`) abre la web por dentro con un secreto; la web (`includes/edge.php`) solo atiende con ese secreto y toma el dominio y la IP real del cliente. Cada secreto puede llevar el número de un distribuidor: en su dominio la web queda fija en él. Se configura con `'edge_keys'` (y `'edge_block'` para probar) en `includes/panel_secret.php`; sin eso la web funciona exactamente igual. Paso a paso con dibujos: **`docs/GUIA-WORKER.html`** (ábrelo en tu PC; en el hosting `docs/` y `cloudflare/` están bloqueados).
