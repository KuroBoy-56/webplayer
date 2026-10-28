<?php
/**
 * Dominio propio con un Worker de Cloudflare (opcional; ver GUIA-WORKER.html y cloudflare/edge-worker.js).
 *
 * El Worker del dominio nuevo abre esta web por dentro y manda un secreto (cabecera X-MPX-Edge). Con
 * 'edge_keys' en includes/panel_secret.php:
 *  - una visita con un secreto válido usa el dominio que vio el cliente (X-Forwarded-Host), su IP real
 *    (X-MPX-Client-IP) y https; así las redirecciones, las cookies y el freno de intentos funcionan igual;
 *  - una visita sin el secreto (el dominio original, directo) recibe 403 Forbidden ('edge_block' => false
 *    lo deja pasar: sirve para probar el Worker antes de cerrar el dominio original);
 *  - cada secreto puede llevar un número de distribuidor: en ese dominio la web queda fija en ese
 *    distribuidor (sin la pantalla «Número de distribuidor»). '' = como siempre (el cliente lo escribe).
 * Sin 'edge_keys' no cambia nada: la web funciona exactamente como antes.
 */
if (defined('WP_EDGE_LOADED')) {
    return;
}
define('WP_EDGE_LOADED', true);

/** ['keys' => [secreto => '' | 'NNNNNN'], 'block' => bool] desde includes/panel_secret.php */
function wp_edge_cfg()
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $cfg = ['keys' => [], 'block' => true];
    $file = __DIR__ . '/panel_secret.php';
    $s = is_file($file) ? include $file : null;
    if (!is_array($s)) return $cfg;
    $raw = $s['edge_keys'] ?? ($s['edge_key'] ?? []);
    if (is_string($raw)) $raw = [$raw => ''];
    foreach (is_array($raw) ? $raw : [] as $k => $dist) {
        // secretos de al menos 32 letras y números (los cortos o con espacios se ignoran)
        if (is_string($k) && preg_match('/^[A-Za-z0-9_-]{32,128}$/', $k)) {
            $cfg['keys'][$k] = preg_match('/^\d{6}$/', (string)$dist) ? (string)$dist : '';
        }
    }
    if (array_key_exists('edge_block', $s)) $cfg['block'] = (bool)$s['edge_block'];
    return $cfg;
}

/** Número de distribuidor fijo de este dominio: null (no hay), o 'NNNNNN'. */
function wp_edge_dist()
{
    return $GLOBALS['wp_edge_dist'] ?? null;
}

/** ¿La visita llegó por el Worker (con un secreto válido)? */
function wp_edge_active()
{
    return !empty($GLOBALS['wp_edge_on']);
}

function wp_edge_boot()
{
    if (PHP_SAPI === 'cli') return;
    $cfg = wp_edge_cfg();
    if (!$cfg['keys']) return;
    $got = (string)($_SERVER['HTTP_X_MPX_EDGE'] ?? '');
    $dist = null;
    foreach ($cfg['keys'] as $k => $d) {
        if ($got !== '' && hash_equals($k, $got)) {
            $dist = $d;
            break;
        }
    }
    if ($dist === null) {
        // el panel llama a media_admin.php directo (va firmado con la llave maestra)
        $self = basename((string)($_SERVER['SCRIPT_NAME'] ?? ''));
        if (!$cfg['block'] || $self === 'media_admin.php') return;
        if (!headers_sent()) {
            http_response_code(403);
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-store');
        }
        echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>403 Forbidden</title></head>'
            . '<body style="background:#000;color:#ccc;font-family:sans-serif;text-align:center;padding-top:15vh">'
            . '<h1 style="color:#fff">403 Forbidden</h1></body></html>';
        exit;
    }
    $GLOBALS['wp_edge_on'] = true;
    if ($dist !== '') $GLOBALS['wp_edge_dist'] = $dist;
    unset($_SERVER['HTTP_X_MPX_EDGE']);
    // el dominio que ve el cliente (las páginas, redirecciones y cookies lo usan)
    $host = strtolower((string)($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ''));
    if (preg_match('/^[a-z0-9.-]{1,253}(:\d{1,5})?$/', $host)) {
        $_SERVER['HTTP_HOST'] = $host;
        $_SERVER['SERVER_NAME'] = preg_replace('/:\d+$/', '', $host);
    }
    // la IP real del cliente (el freno de intentos de login va por IP)
    $ip = trim((string)($_SERVER['HTTP_X_MPX_CLIENT_IP'] ?? ''));
    if ($ip !== '' && filter_var($ip, FILTER_VALIDATE_IP)) $_SERVER['REMOTE_ADDR'] = $ip;
    if (strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
        $_SERVER['HTTPS'] = 'on';
        $_SERVER['SERVER_PORT'] = 443;
    }
}

wp_edge_boot();
