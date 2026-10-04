<?php
/* El botón DNS se quitó de la web player (solo existe en Android, Windows y Roku).
 * Estas funciones quedan para el proxy y ffmpeg: siempre usan el DNS normal del hosting. */
function wp_dns_choice() { return 'auto'; }
function wp_doh_apply($ch, $url) {}
function wp_doh_ffmpeg($url) { return [$url, []]; }
