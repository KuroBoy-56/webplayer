<?php
/**
 * Errores de la web player -> panel («Errores de las apps», solo el dueño).
 * - Del servidor: errores fatales de PHP (al terminar la petición).
 * - Del navegador: report.php (solo con sesión iniciada), p. ej. un video que no se pudo reproducir.
 * Se envían cifrados como login.php (api/report.php). El mismo mensaje sale como mucho
 * una vez por minuto. La contraseña de la línea nunca va en un reporte.
 */

/** IP del visitante para las estadísticas del panel (Cloudflare delante: su cabecera). */
function wp_client_ip()
{
    $cf = trim((string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
    if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP)) return $cf;
    return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}

function wp_panel_report($kind, $message, $detail = '', $screen = '')
{
    $message = trim(mb_substr((string)$message, 0, 400));
    if ($message === '' || !wp_panel_ready()) return false;
    $kinds = ['crash', 'error', 'playback', 'network', 'panel', 'warning'];
    $kind = in_array($kind, $kinds, true) ? $kind : 'error';
    $dedupe = 'rep|' . md5($kind . '|' . $message);
    if (wp_cache_get($dedupe, 60)) return false;
    wp_cache_set($dedupe, 1);
    $user = (string)($_SESSION['username'] ?? '');
    $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    $body = [
        'app' => WP_APP_ID,
        'version' => 'web',
        'kind' => $kind,
        'message' => $message,
        'detail' => mb_substr((string)$detail, 0, 8000),
        'screen' => mb_substr((string)$screen, 0, 120),
        'device' => $user !== '' ? 'WEB ' . $user : 'WEB',
        'model' => mb_substr($ua, 0, 120),
        'os' => wp_ua_os($ua),
        'user' => mb_substr($user, 0, 80),
        'server' => mb_substr((string)($_SESSION['server'] ?? ''), 0, 200),
        'ip' => wp_client_ip(),
    ] + wp_panel_tenant_fields();
    $data = wp_panel_encrypt(json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    if ($data === null) return false;
    wp_panel_request('report.php', http_build_query(['data' => $data]), [], 4, $code);
    return $code === 200;
}

function wp_ua_os($ua)
{
    foreach (['Windows' => 'Windows', 'Android' => 'Android', 'iPhone' => 'iOS', 'iPad' => 'iOS', 'Mac OS X' => 'macOS', 'CrOS' => 'ChromeOS', 'Linux' => 'Linux'] as $k => $v) {
        if (stripos($ua, $k) !== false) return $v;
    }
    return '';
}

/** Errores fatales de PHP: solo se observan, la página falla igual que antes. */
function wp_report_fatal()
{
    $e = error_get_last();
    if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) return;
    $file = str_replace(WP_ROOT, '', (string)$e['file']);
    try {
        wp_panel_report('crash', 'PHP: ' . $e['message'], $file . ':' . $e['line'], (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH));
    } catch (Throwable $t) {
    }
}
register_shutdown_function('wp_report_fatal');
