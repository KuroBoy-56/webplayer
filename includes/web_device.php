<?php
/**
 * El navegador en el panel (Clientes › Web player) y la lista negra. Un navegador no deja leer la MAC del equipo: la
 * web le da su propio identificador («WEB-» + 16 caracteres, cookie de 5 años) y el panel guarda también su IP real.
 * Se manda cifrado, del hosting al panel (api/login.php, acción web_device), al iniciar sesión y, mientras se usa la
 * web, como mucho cada 10 minutos. Si su distribuidor (o el dueño con Omitir) bloqueó ese navegador o esa IP, el
 * panel contesta 403 device_blocked: no entra y la sesión abierta se cierra. Si el panel no contesta, no se corta nada.
 */
if (defined('WP_WEB_DEVICE_LOADED')) {
    return;
}
define('WP_WEB_DEVICE_LOADED', true);

const WP_WEB_DEVICE_TTL = 600;

/** identificador de este navegador (se crea la primera vez) */
function wp_web_device_id()
{
    static $id = null;
    if ($id !== null) return $id;
    $c = strtoupper((string)($_COOKIE['wp_dev'] ?? ''));
    if (!preg_match('/^WEB-[0-9A-F]{16}$/', $c)) {
        $c = 'WEB-' . strtoupper(bin2hex(random_bytes(8)));
        if (!headers_sent()) wp_setcookie('wp_dev', $c, time() + 5 * 365 * 86400);
        $_COOKIE['wp_dev'] = $c;
    }
    return $id = $c;
}

/** null = puede seguir (o el panel no contestó); si no, el aviso del panel (navegador o IP bloqueados) */
function wp_web_device_check($user, $server, $dist)
{
    if (!wp_panel_ready()) return null;
    $fields = [
        'platform' => WP_APP_ID,
        'device' => wp_web_device_id(),
        'ip' => wp_client_ip(),
        // la IP de la conexión: sin Cloudflare delante, la cabecera de IP la podría inventar el navegador
        'peer' => (string)($_SERVER['REMOTE_ADDR'] ?? ''),
        'user' => (string)$user,
        'dns' => (string)$server,
        'ua' => mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
    ] + wp_panel_tenant_fields((string)$dist);
    $body = wp_panel_login('web_device', $fields, 6, $code);
    if ($code !== 403) return null;
    $j = json_decode((string)$body, true);
    if (!is_array($j) || ($j['code'] ?? '') !== 'device_blocked') return null;
    return trim((string)($j['error'] ?? '')) ?: t('Este equipo está bloqueado. Contacta a tu proveedor.');
}

/** en cada página con sesión (session.php): bloqueado => se cierra la sesión y vuelve al login con el aviso */
function wp_web_device_guard(array $sess)
{
    $user = (string)($sess['username'] ?? '');
    if ($user === '') return;
    $dist = (string)($sess['dist'] ?? '');
    $ck = 'webdev|' . hash('sha256', wp_web_device_id() . "\n" . $user . "\n" . wp_client_ip() . "\n" . $dist);
    if (wp_cache_get($ck, WP_WEB_DEVICE_TTL) === 'ok') return;
    if (wp_web_device_check($user, (string)($sess['server'] ?? ''), $dist) === null) {
        wp_cache_set($ck, 'ok');
        return;
    }
    wp_tenant_logout();
    if (wp_tenant_is_ajax()) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'auth', 'line' => 'blocked']);
    } else {
        header('Location: ./login?line_err=blocked');
    }
    exit;
}
