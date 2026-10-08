<?php
/**
 * Pantalla "Número de distribuidor" del login (acciones POST dist / dist_skip) y el estado
 * con el que se dibuja login.php.
 */
if (defined('WP_TENANT_LOGIN_LOADED')) {
    return;
}
define('WP_TENANT_LOGIN_LOADED', true);
require_once __DIR__ . '/tenant.php';

/** Atiende POST action=dist|dist_skip (JSON) y termina; si no es una de esas, no hace nada. */
function wp_tenant_login_post()
{
    $act = (string)($_POST['action'] ?? '');
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($act !== 'dist' && $act !== 'dist_skip')) return;
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ($act === 'dist_skip') {
        wp_tenant_switch('skip');
        echo json_encode(['success' => true, 'brand' => null]);
        exit;
    }
    $code = preg_replace('/\D/', '', (string)($_POST['code'] ?? ''));
    if (strlen($code) !== 6) {
        echo json_encode(['success' => false, 'message' => 'Escribe los 6 dígitos de tu número de distribuidor.']);
        exit;
    }
    if (!wp_panel_ready()) {
        echo json_encode(['success' => false, 'message' => wp_tenant_message('no_key')]);
        exit;
    }
    if (wp_rate_limited('dist', 8, 900)) {
        echo json_encode(['success' => false, 'message' => wp_tenant_message('too_many_attempts')]);
        exit;
    }
    $st = wp_tenant_status($code, true);
    if ($st['state'] !== 'ok') {
        echo json_encode(['success' => false, 'message' => wp_tenant_message($st['error'], $st['cfg'] ?? null)], JSON_UNESCAPED_UNICODE);
        exit;
    }
    wp_rate_reset('dist');
    wp_tenant_switch($code);
    echo json_encode(['success' => true, 'brand' => wp_brand_local($st['cfg'])], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** Guarda la elección; si había una sesión de otro distribuidor, se cierra. */
function wp_tenant_switch($choice)
{
    $old = wp_dist_choice();
    wp_dist_set($choice);
    if ($old !== $choice) {
        $s = wp_session_read_close();
        if (!empty($s['username'])) wp_tenant_logout();
    }
}

/**
 * Estado para dibujar login.php:
 * ['step' => 'dist'|'login', 'error' => mensaje, 'cfg' => config|null, 'code' => número|'']
 */
function wp_tenant_login_view()
{
    $v = ['step' => 'login', 'error' => '', 'cfg' => null, 'code' => '', 'choice' => wp_dist_choice()];
    $err = preg_replace('/[^a-z_]/', '', (string)($_GET['dist_err'] ?? ''));
    $cfgErr = null;
    // número que el guardián acaba de cortar: su fecha de vencimiento para el mensaje
    $dc = (string)($_GET['d'] ?? '');
    if ($err !== '' && preg_match('/^\d{6}$/', $dc)) {
        $c = wp_cache_get('tenant|cfg|' . $dc, 30 * 86400, $old);
        $c = is_array($c) ? $c : $old;
        $cfgErr = is_array($c) && is_array($c['cfg'] ?? null) ? $c['cfg'] : null;
    }
    if ($v['choice'] !== '' && $v['choice'] !== 'skip') {
        $st = wp_tenant_status($v['choice']);
        if ($st['state'] === 'ok') {
            $v['cfg'] = $st['cfg'];
            $v['code'] = $v['choice'];
        } elseif ($st['state'] === 'error' && wp_tenant_is_hard($st['error'])) {
            wp_dist_set('');
            $v['choice'] = '';
            $err = $st['error'];
            $cfgErr = $st['cfg'] ?? null;
        } else {
            $v['code'] = $v['choice'];
            $v['error'] = wp_tenant_message($st['error']);
        }
    }
    if ($err === 'changed') {
        $v['error'] = 'Se cambió el distribuidor en este navegador. Inicia sesión de nuevo.';
    } elseif ($err !== '') {
        $v['error'] = wp_tenant_message($err, $cfgErr);
    }
    if ($v['choice'] === '' || isset($_GET['dist'])) $v['step'] = 'dist';
    return $v;
}
