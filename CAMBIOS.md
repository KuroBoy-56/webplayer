# WebPlayer: resumen de cambios

Se conserva la misma estructura de archivos y los mismos datos guardados: `includes/dns/dns.json`, `admin.json`, `progress.json`, `api/history.json`, `api/live_favorites.json` y los favoritos en `userdata.sqlite`. Solo hay que subir el contenido del zip encima de la versión anterior.

**Requisitos:** PHP 7.1 o superior con las extensiones `curl` y `sqlite3`. La carpeta `includes/cache/` debe tener permisos de escritura.

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
