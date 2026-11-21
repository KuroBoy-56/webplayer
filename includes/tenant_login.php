<?php
/**
 * Inicio de sesión y distribuidor (2.8.1): la dirección decide. tudominio/login es la web del dueño y
 * tudominio/login?d=NNNNNN la del distribuidor NNNNNN, ya con su logo, nombre y colores. Ya no hay pantalla «Número de
 * distribuidor» ni «Cambiar distribuidor». Un dominio propio (Worker) sigue fijo en su número (includes/edge.php).
 */
if (defined('WP_TENANT_LOGIN_LOADED')) {
    return;
}
define('WP_TENANT_LOGIN_LOADED', true);
require_once __DIR__ . '/tenant.php';

/**
 * login?d=NNNNNN con una sesión abierta de otro distribuidor (o del dueño): esa sesión se cierra y se muestra el inicio
 * de sesión del distribuidor del enlace. Con el mismo, login.php sigue a Inicio como siempre.
 */
function wp_tenant_link_get()
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' || !isset($_GET['d'])) return;
    if (function_exists('wp_edge_dist') && wp_edge_dist() !== null) return; // dominio propio: siempre el suyo
    $code = (string)$_GET['d'];
    if (!preg_match('/^\d{6}$/', $code)) return;
    $s = wp_session_read_close();
    if (!empty($s['username']) && (string)($s['dist'] ?? '') !== $code) wp_tenant_logout();
}

/**
 * Estado para dibujar login.php:
 * ['step' => 'login'|'blocked', 'error' => mensaje, 'cfg' => config|null, 'code' => número|'', 'choice' => 'skip'|número]
 * 'blocked': el enlace es de un número que no existe, vencido, suspendido o sin la web player (el panel la apagó):
 * solo el aviso, sin el formulario.
 */
function wp_tenant_login_view()
{
    $v = ['step' => 'login', 'error' => '', 'cfg' => null, 'code' => '', 'choice' => wp_dist_choice()];
    $err = preg_replace('/[^a-z_]/', '', (string)($_GET['dist_err'] ?? ''));
    $cfgErr = null;
    if ($v['choice'] !== 'skip') {
        $v['code'] = $v['choice'];
        $st = wp_tenant_status($v['choice']);
        if ($st['state'] === 'ok') {
            $v['cfg'] = $st['cfg'];
        } elseif ($st['state'] === 'error' && wp_tenant_is_hard($st['error'])) {
            $err = $st['error'];
            $cfgErr = $st['cfg'] ?? null;
        } else {
            // panel sin respuesta, demasiados intentos: el aviso, y el formulario sigue
            $v['error'] = wp_tenant_message($st['error']);
        }
    }
    if ($err !== '' && $err !== 'changed') {
        $v['error'] = wp_tenant_message($err, $cfgErr);
        if (wp_tenant_is_hard($err)) $v['step'] = 'blocked';
    }
    return $v;
}
