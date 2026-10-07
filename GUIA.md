# Guía para terminar: Web player

1. **Subir:** descomprime `webplayer.zip` en la carpeta de tu web player en el hosting.
2. **Llave:** copia `includes/panel_secret.sample.php` como `includes/panel_secret.php` y pega la misma llave del panel (`master_key_hex`, 64 caracteres). Este archivo vive solo en el hosting.
3. **Permisos:** la carpeta `includes/cache/` debe poder escribirse (755).
4. **Limpieza:** si siguen en el hosting, borra `bin/`, `proxy.php`, `media.php`, `setup.php`, `test.php`, `database.php`, `epgjob.php`, `includes/admin/`, `includes/dns/` y `includes/notifications/`.
5. **HTTPS:** deja la web en **http** (sin SSL). En hPanel → **Seguridad → SSL** deja **Forzar HTTPS** apagado. Así el navegador reproduce el video directo del servidor IPTV sin bloquearlo y sin pasar por tu hosting. No actives HSTS.
6. **Prueba:** entra con un usuario de prueba desde un PC, un iPhone y un Android. Abre `diag.php` si algo no carga.
7. **Si falla la TV en vivo:** si no carga en Chrome pero sí en VLC, pide a tu proveedor IPTV que permita CORS en su servidor.

## Video por HTTPS (opcional, sin pasar por tu hosting)
Si quieres la web en **https** y tu servidor IPTV solo entrega bien por http:
1. Crea una cuenta gratis en [Cloudflare](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker**. Ponle un nombre (por ejemplo `relay`) y **Deploy**.
2. **Edit code**: borra lo que trae, pega el contenido de `cloudflare/relay-worker.js` y **Deploy**.
3. (Recomendado) En **Settings → Variables** agrega `ALLOWED_HOSTS` con los hosts de tus DNS separados por coma (por ejemplo `latammx.net`) y `ALLOWED_ORIGINS` con tu web (`https://tuweb.com`).
4. En el hosting copia `includes/https_relay.sample.php` como `includes/https_relay.php` y cambia la dirección por la de tu Worker (`https://relay.TU-CUENTA.workers.dev`).
5. Activa SSL en hPanel. La web probará primero el https del servidor IPTV y, si no sirve, usará tu relay. El video nunca pasa por Hostinger.

El plan gratis de Cloudflare permite 100.000 peticiones al día (una película completa usa unas 500 a 1.000). Si se queda corto, el plan de 5 USD al mes da 10 millones.
