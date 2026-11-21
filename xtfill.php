<?php
/**
 * Modo navegador (includes/xt_client.php): el navegador le trajo al servidor IPTV lo que la web necesitaba (con la IP
 * del usuario) y lo deja aquí. Solo se acepta lo que esta misma sesión pidió (wp_xt_need: 'xtneed|<sesión>|<id>'), y
 * se guarda en la misma caché que usaría el hosting (xt_cache_key). Cada usuario solo puede llenar lo suyo.
 *
 *   POST xtfill.php?id=<id>   cuerpo: la respuesta de player_api.php (texto, o gzip con la cabecera X-Gz: 1)
 *   POST xtfill.php?id=<id>&empty=1   el servidor no dio la ficha de un título (error o respuesta rota): queda vacía
 *                                     por 10 minutos (la página sigue sin ella) y después se vuelve a pedir
 *   POST xtfill.php?fail=1    el navegador no pudo leer el servidor IPTV: la sesión sigue por el hosting
 */
include __DIR__ . '/session.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !wp_xt_client()) {
    echo json_encode(['ok' => false]);
    exit;
}
if (!empty($_GET['fail'])) {
    wp_xt_disable((string)file_get_contents('php://input', false, null, 0, 2000));
    echo json_encode(['ok' => true, 'off' => true]);
    exit;
}
$id = preg_replace('/[^a-f0-9]/', '', (string)($_GET['id'] ?? ''));
$sid = wp_xt_sid();
$meta = ($id !== '' && $sid !== '') ? wp_cache_get('xtneed|' . $sid . '|' . $id, 3600) : null;
if (!is_array($meta) || empty($meta['ck'])) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'need']);
    exit;
}
// una ficha que el servidor no dio (2.9.2): vacía por un rato, nunca un catálogo
if (!empty($_GET['empty'])) {
    $ok = in_array($meta['a'] ?? '', ['get_vod_info', 'get_series_info', 'get_short_epg', 'get_simple_data_table'], true);
    if ($ok && wp_cache_get($meta['ck'], 86400 * 30) === null) {
        wp_cache_set($meta['ck'], []);
        // vale 10 minutos para quien la lee con 24 h; para los que la leen con menos, ya está vencida (se usa y se renueva)
        @touch(wp_cache_dir('data') . '/' . md5($meta['ck']) . '.json', time() - 86400 + 600);
    }
    echo json_encode(['ok' => $ok]);
    exit;
}
@ini_set('memory_limit', '512M');
$raw = (string)file_get_contents('php://input');
if (!empty($_SERVER['HTTP_X_GZ'])) {
    $raw = @gzdecode($raw);
    if (!is_string($raw)) {
        echo json_encode(['ok' => false, 'error' => 'gzip']);
        exit;
    }
}
$json = json_decode($raw, true);
if (!is_array($json)) {
    echo json_encode(['ok' => false, 'error' => 'json']);
    exit;
}
wp_cache_set($meta['ck'], $json);
// películas o series: el catálogo ligero queda listo ya, con lo nuevo (la próxima página no lo arma)
if (in_array($meta['a'] ?? '', ['get_vod_streams', 'get_series'], true) && $meta['ck'] === xt_cache_key($meta['a'], [])) {
    $type = $meta['a'] === 'get_series' ? 'series' : 'movie';
    $slim = wp_catalog_slim($type, $json);
    if ($slim) wp_cache_set('slim2|' . $type . '|' . xt_cache_key('', []), $slim);
}
// ya no hace falta renovarlo en segundo plano
$bg = wp_cache_get('xtbg|' . $sid, 1800);
if (is_array($bg) && isset($bg[$id])) {
    unset($bg[$id]);
    wp_cache_set('xtbg|' . $sid, $bg);
}
echo json_encode(['ok' => true]);
