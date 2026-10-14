<?php
/**
 * Revisión de la línea en las páginas con sesión (session.php): como mucho cada 15 minutos se
 * pregunta al servidor IPTV si el usuario sigue activo. Contraseña cambiada, cuenta vencida,
 * suspendida o borrada => se cierra la sesión y se vuelve al login con el motivo.
 * Si el servidor no responde no se corta nada (se vuelve a probar en la próxima página).
 */
if (defined('WP_LINE_GUARD_LOADED')) {
    return;
}
define('WP_LINE_GUARD_LOADED', true);

const WP_LINE_CHECK_TTL = 900;

/** '' = sigue activa, 'auth' / 'expired' / 'disabled' = ya no vale, null = no se pudo saber. */
function wp_line_state($body)
{
    $j = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($j)) return null;
    $ui = $j['user_info'] ?? null;
    if (!is_array($ui) || !isset($ui['auth'])) return (is_array($ui) || array_key_exists('user_info', $j)) ? 'auth' : null;
    if ((int)$ui['auth'] !== 1) return 'auth';
    $st = strtolower((string)($ui['status'] ?? ''));
    if ($st === 'expired') return 'expired';
    if ($st !== '' && $st !== 'active') return 'disabled';
    $exp = (int)($ui['exp_date'] ?? 0);
    if ($exp > 0 && $exp < time()) return 'expired';
    return '';
}

function wp_line_message($code)
{
    $m = [
        'auth' => t('Tu usuario o contraseña ya no son válidos. Vuelve a iniciar sesión.'),
        'expired' => t('Tu cuenta está vencida. Renueva tu suscripción para seguir viendo.'),
        'disabled' => t('Tu cuenta está deshabilitada. Contacta a soporte.'),
    ];
    return $m[$code] ?? '';
}

function wp_line_guard(array $sess)
{
    $server = rtrim((string)($sess['server'] ?? ''), '/');
    $user = (string)($sess['username'] ?? '');
    $pass = (string)($sess['password'] ?? '');
    if ($server === '' || $user === '') return;
    // la clave de la caché es una huella (nunca el usuario ni la contraseña en el nombre del archivo)
    $ck = 'line|' . hash('sha256', $server . "\n" . $user . "\n" . $pass);
    if (wp_cache_get($ck, WP_LINE_CHECK_TTL) === 'ok') return;
    $body = wp_http_get($server . '/player_api.php?username=' . urlencode($user) . '&password=' . urlencode($pass), 8);
    $state = wp_line_state($body);
    if ($state === null) return;
    if ($state === '') {
        wp_cache_set($ck, 'ok');
        return;
    }
    wp_tenant_logout();
    if (wp_tenant_is_ajax()) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'auth', 'line' => $state]);
    } else {
        header('Location: ./login?line_err=' . rawurlencode($state));
    }
    exit;
}
