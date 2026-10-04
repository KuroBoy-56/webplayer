# Guía para terminar: Web player

1. **Subir:** descomprime `webplayer.zip` en la carpeta de tu web player en el hosting.
2. **Llave:** copia `includes/panel_secret.sample.php` como `includes/panel_secret.php` y pega la misma llave del panel (`master_key_hex`, 64 caracteres). Este archivo vive solo en el hosting.
3. **Permisos:** la carpeta `includes/cache/` debe poder escribirse (755).
4. **Limpieza:** si siguen en el hosting, borra `bin/`, `proxy.php`, `media.php`, `setup.php`, `test.php`, `database.php`, `epgjob.php`, `includes/admin/`, `includes/dns/` y `includes/notifications/`.
5. **HTTPS:** en hPanel → **Seguridad → SSL**, apaga **Forzar HTTPS** (el SSL sigue activo). El `.htaccess` de la web ya manda todo a https, excepto el reproductor `play.php`. Si tu servidor IPTV da el video por http, la web abre `play.php` por http y el navegador lee el video directo del servidor IPTV. Así nada pasa por el hosting. No actives HSTS.
6. **Prueba:** entra con un usuario de prueba desde un PC, un iPhone y un Android. Abre `diag.php` si algo no carga.
7. **Si falla la TV en vivo:** si no carga en Chrome pero sí en VLC, pide a tu proveedor IPTV que permita CORS en su servidor.
