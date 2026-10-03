<?php
/* Actualiza la guía de respaldo en segundo plano (la lanza includes/epg.php). */
require_once __DIR__ . '/includes/epg.php';
$sess = wp_session_read_close();
if (empty($sess['username'])) { http_response_code(403); exit; }
ignore_user_abort(true);
@set_time_limit(0);
header('Content-Type: text/plain');
header('Content-Length: 2');
echo 'ok';
@flush();
wp_epg_build();
