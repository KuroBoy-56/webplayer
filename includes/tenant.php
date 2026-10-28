<?php
/**
 * Número de distribuidor (multi-distribuidor del panel).
 *
 * - La elección se guarda en la cookie de larga duración "wp_dist": "skip" (Omitir) o el número
 *   de 6 dígitos. Sin cookie se muestra la pantalla "Número de distribuidor" en el login.
 * - "Omitir": todo funciona exactamente como antes (no se manda nada nuevo al panel).
 * - Con número: login.php del panel (fetch_dns), progress.php (auth), alerta.php llevan
 *   "tenant" + "app" = "web"; la marca (nombre, logo, colores) sale de la acción tenant_config.
 * - Guardián: la configuración del distribuidor se revisa como mucho cada 10 minutos (caché
 *   compartida por número en el hosting); si el panel dice vencido, suspendido, no válido o
 *   app no vinculada, se cierra la sesión y se vuelve a pedir el número con el mensaje.
 */
if (defined('WP_TENANT_LOADED')) {
    return;
}
define('WP_TENANT_LOADED', true);

define('WP_APP_ID', 'web');
define('WP_DIST_COOKIE', 'wp_dist');
define('WP_TENANT_TTL', 600);            // revisión del distribuidor (guardián) cada 10 min
define('WP_TENANT_OFFLINE_MAX', 259200); // sin panel: se sigue con la copia hasta 72 h
define('WP_TENANT_FAILS', 8);            // números no válidos desde el hosting en 15 min (el panel espera con 10)
define('WP_TENANT_FAILS_DAY', 25);       // ... y en 24 h (el panel bloquea la IP con 30)

/** Mensajes por código de error del panel (en el idioma de la app). */
function wp_tenant_messages()
{
    return [
        'tenant_invalid' => t('Número de distribuidor no válido'),
        'tenant_expired' => t('El servicio de este distribuidor venció. Contacta a tu distribuidor.'),
        'tenant_suspended' => t('Este distribuidor está suspendido. Contacta a tu distribuidor.'),
        'app_not_linked' => t('Este número de distribuidor no está habilitado para esta aplicación.'),
        'too_many_attempts' => t('Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.'),
        'app_required' => t('Error interno: falta indicar la aplicación (app_required). Avisa a soporte.'),
        'no_key' => t('Esta versión de la app no tiene la llave del panel'),
        'offline' => t('No se pudo conectar con el panel del distribuidor. Revisa tu conexión e inténtalo de nuevo.'),
    ];
}

function wp_tenant_message($code, array $cfg = null)
{
    // the distributor's expiry is private: the message never carries its date
    $m = wp_tenant_messages();
    return $m[$code] ?? $m['tenant_invalid'];
}

/** Errores que borran el número guardado y vuelven a pedirlo. */
function wp_tenant_is_hard($code)
{
    return in_array($code, ['tenant_invalid', 'tenant_expired', 'tenant_suspended', 'app_not_linked'], true);
}

/* ------------------------------------------------------------------ */
/* Elección guardada (cookie)                                           */
/* ------------------------------------------------------------------ */

/** '' (sin elegir), 'skip' u 'NNNNNN'. */
function wp_dist_choice()
{
    // dominio propio de un distribuidor (Worker con su secreto): siempre su número, sin la pantalla del distribuidor
    if (function_exists('wp_edge_dist') && wp_edge_dist() !== null) return wp_edge_dist();
    $ok = function ($v) { return $v === 'skip' || preg_match('/^\d{6}$/', $v); };
    $v = isset($_COOKIE[WP_DIST_COOKIE]) && is_string($_COOKIE[WP_DIST_COOKIE]) ? trim($_COOKIE[WP_DIST_COOKIE]) : '';
    if ($ok($v)) return $v;
    // la pantalla del distribuidor manda también la elección (dist_pick): sirve aunque el navegador o el
    // hosting no hayan guardado la cookie (antes se volvía a la pantalla del distribuidor una y otra vez)
    $p = $_POST['dist_pick'] ?? ($_GET['dist_pick'] ?? '');
    $p = is_string($p) ? trim($p) : '';
    if (!$ok($p)) return '';
    wp_dist_set($p);
    return $p;
}

/** Número elegido en este navegador ('' con Omitir o sin elegir). */
function wp_dist_cookie_code()
{
    $c = wp_dist_choice();
    return $c === 'skip' ? '' : $c;
}

/**
 * Guarda la elección (1 año). Sin "secure" a propósito: no es un secreto y así la misma cookie
 * sirve en http y en https (una cookie secure no se puede reemplazar desde http).
 */
function wp_dist_set($value)
{
    $value = (string)$value;
    $exp = $value === '' ? time() - 3600 : time() + 365 * 86400;
    if (!headers_sent()) {
        if (PHP_VERSION_ID >= 70300) {
            setcookie(WP_DIST_COOKIE, $value, ['expires' => $exp, 'path' => '/', 'secure' => false, 'httponly' => true, 'samesite' => 'Lax']);
        } else {
            setcookie(WP_DIST_COOKIE, $value, $exp, '/; samesite=Lax', '', false, true);
        }
    }
    if ($value === '') unset($_COOKIE[WP_DIST_COOKIE]);
    else $_COOKIE[WP_DIST_COOKIE] = $value;
}

/* ------------------------------------------------------------------ */
/* Número activo en esta petición                                       */
/* ------------------------------------------------------------------ */

/** Fija el número de esta petición (la sesión manda sobre la cookie). */
function wp_panel_set_tenant($code)
{
    $GLOBALS['wp_tenant_code'] = preg_match('/^\d{6}$/', (string)$code) ? (string)$code : '';
}

/** Número con el que se habla con el panel ('' = Omitir: todo como antes). */
function wp_panel_tenant()
{
    if (!array_key_exists('wp_tenant_code', $GLOBALS)) {
        wp_panel_set_tenant(wp_dist_cookie_code());
    }
    return (string)$GLOBALS['wp_tenant_code'];
}

/** Campos que se agregan a cada petición al panel ([] con Omitir). */
function wp_panel_tenant_fields($code = null)
{
    $code = $code === null ? wp_panel_tenant() : (string)$code;
    return $code === '' ? [] : ['tenant' => $code, 'app' => WP_APP_ID];
}

/** Agrega ?t=&app= (o &t=&app=) a una ruta del panel cuando hay número. */
function wp_panel_tenant_query($path, $code = null)
{
    $f = wp_panel_tenant_fields($code);
    if (!$f) return $path;
    return $path . (strpos($path, '?') === false ? '?' : '&') . http_build_query(['t' => $f['tenant'], 'app' => $f['app']]);
}

/** Clave de caché por número: la de siempre con Omitir, "clave|NNNNNN" con número. */
function wp_panel_ck($key, $code = null)
{
    $code = $code === null ? wp_panel_tenant() : (string)$code;
    return $code === '' ? $key : $key . '|' . $code;
}

/* ------------------------------------------------------------------ */
/* tenant_config (con caché compartida por número)                      */
/* ------------------------------------------------------------------ */

/** Cuerpo cifrado de la acción tenant_config. */
function wp_panel_tenant_payload($code)
{
    return ['code' => (string)$code, 'tenant' => (string)$code, 'app' => WP_APP_ID, 'device' => 'web', 't' => time()];
}

/**
 * Interpreta la respuesta del panel. Devuelve
 * ['ok' => true, 'cfg' => [...]] | ['ok' => false, 'error' => código] | null (sin respuesta / 5xx).
 */
function wp_panel_tenant_parse($body, $code)
{
    if ($body === null || $code === 0 || $code >= 500) return null;
    $j = json_decode((string)$body, true);
    if (is_array($j) && isset($j['code']) && is_string($j['code'])) {
        return ['ok' => false, 'error' => $j['code']];
    }
    if ($code !== 200) return null;
    $plain = wp_panel_decrypt($body);
    $j = $plain !== null ? json_decode($plain, true) : null;
    if (!is_array($j) || ($j['status'] ?? '') !== 'ok' || !is_array($j['tenant'] ?? null)) return null;
    return ['ok' => true, 'cfg' => wp_tenant_normalize($j)];
}

/** Deja solo los campos que usa la web, validados. */
function wp_tenant_normalize(array $j)
{
    $t = $j['tenant'];
    $pal = null;
    if (is_array($t['palette'] ?? null)) {
        $pal = [];
        foreach (['accent', 'bg', 'surface', 'text'] as $k) {
            $v = strtoupper((string)($t['palette'][$k] ?? ''));
            if (!preg_match('/^#[0-9A-F]{6}$/', $v)) { $pal = null; break; }
            $pal[$k] = $v;
        }
    }
    $logo = is_string($t['logo_url'] ?? null) && preg_match('~^https?://~i', $t['logo_url']) ? $t['logo_url'] : null;
    $name = is_string($t['name'] ?? null) ? trim($t['name']) : '';
    $f = is_array($j['features'] ?? null) ? $j['features'] : [];
    return [
        'code' => (string)($t['code'] ?? ''),
        'name' => $name !== '' ? mb_substr($name, 0, 60, 'UTF-8') : null,
        'logo_url' => $logo,
        'logo_rev' => (int)($t['logo_rev'] ?? 0),
        'palette' => $pal,
        'expires_at' => (int)($t['expires_at'] ?? 0),
        'expires_date' => is_string($t['expires_date'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $t['expires_date']) ? $t['expires_date'] : null,
        'rev' => (int)($t['rev'] ?? 0),
        'features' => [
            'alerts' => !array_key_exists('alerts', $f) || !empty($f['alerts']),
            'sports' => !array_key_exists('sports', $f) || !empty($f['sports']),
            // motor de audio y subtítulos (ffmpeg del hosting): el dueño se lo quita al distribuidor en el panel
            'ffmpeg' => !array_key_exists('ffmpeg', $f) || !empty($f['ffmpeg']),
            'platforms' => !array_key_exists('platforms', $f) || !empty($f['platforms']),
        ],
        'recheck_after' => max(600, (int)($j['recheck_after'] ?? 21600)),
    ];
}

/**
 * Números no válidos enviados desde este hosting. El panel cuenta por IP (la del hosting, no la
 * del cliente): 10 en 15 min => espera; 30 en 24 h => IP bloqueada para todos los distribuidores.
 * Aquí se corta antes (8 en 15 min, 25 en 24 h) sin preguntar al panel.
 */
function wp_tenant_fail_guard($record = false)
{
    $now = time();
    $d = wp_cache_get('tenant|fails', 86400);
    $d = array_values(array_filter(is_array($d) ? $d : [], function ($ts) use ($now) { return $ts > $now - 86400; }));
    if ($record) {
        $d[] = $now;
        wp_cache_set('tenant|fails', $d);
    }
    $recent = count(array_filter($d, function ($ts) use ($now) { return $ts > $now - 900; }));
    return $recent >= WP_TENANT_FAILS || count($d) >= WP_TENANT_FAILS_DAY;
}

/**
 * Estado del distribuidor:
 * ['state' => 'ok', 'cfg' => [...]] | ['state' => 'error', 'error' => código, 'cfg' => ?]
 * | ['state' => 'offline'] (sin panel y sin copia de menos de 72 h).
 * $force = true pregunta al panel aunque la caché sea reciente.
 */
function wp_tenant_status($code, $force = false)
{
    static $memo = [];
    $code = (string)$code;
    if (!preg_match('/^\d{6}$/', $code)) return ['state' => 'error', 'error' => 'tenant_invalid'];
    if (!$force && isset($memo[$code])) return $memo[$code];
    $ck = 'tenant|cfg|' . $code;
    $c = wp_cache_get($ck, WP_TENANT_TTL, $stale);
    if ($force || !is_array($c)) {
        $prev = is_array($c) ? $c : (is_array($stale) ? $stale : null);
        $known = is_array($prev) && !empty($prev['ok']);
        $res = null;
        if (!wp_panel_ready()) {
            $res = null;
        } elseif (!$known && wp_tenant_fail_guard()) {
            // ya hubo muchos números no válidos: no se pregunta (protege la IP del hosting)
            $res = ['ok' => false, 'error' => 'too_many_attempts', 'soft' => true];
        } else {
            $body = wp_panel_login('tenant_config', wp_panel_tenant_payload($code), 8, $http);
            $res = wp_panel_tenant_parse($body, isset($http) ? (int)$http : 0);
            if (is_array($res) && !$res['ok'] && $res['error'] === 'tenant_invalid') wp_tenant_fail_guard(true);
        }
        if (is_array($res) && $res['ok']) {
            $c = ['ok' => true, 'cfg' => $res['cfg'], 'last_ok' => time()];
            wp_cache_set($ck, $c);
        } elseif (is_array($res) && wp_tenant_is_hard($res['error'])) {
            $c = ['ok' => false, 'error' => $res['error'], 'cfg' => $known ? $prev['cfg'] : null];
            wp_cache_set($ck, $c);
        } elseif (is_array($res)) {
            // too_many_attempts / app_required: no se guarda, se avisa
            return $memo[$code] = ['state' => 'error', 'error' => $res['error'], 'cfg' => $known ? $prev['cfg'] : null];
        } elseif ($known && time() - (int)($prev['last_ok'] ?? 0) < WP_TENANT_OFFLINE_MAX) {
            $c = $prev; // panel caído: se sigue con la copia (se reintenta en la próxima revisión)
            if ($stale !== null || $force) wp_cache_set($ck, $c);
        } else {
            return $memo[$code] = ['state' => 'offline', 'error' => wp_panel_ready() ? 'offline' : 'no_key'];
        }
    }
    if (empty($c['ok'])) {
        return $memo[$code] = ['state' => 'error', 'error' => (string)($c['error'] ?? 'tenant_invalid'), 'cfg' => $c['cfg'] ?? null];
    }
    $cfg = $c['cfg'];
    // Vencimiento local (hora de Panamá ya va en expires_at, epoch UTC); 0 = sin vencimiento
    if ((int)$cfg['expires_at'] > 0 && time() > (int)$cfg['expires_at']) {
        return $memo[$code] = ['state' => 'error', 'error' => 'tenant_expired', 'cfg' => $cfg];
    }
    return $memo[$code] = ['state' => 'ok', 'cfg' => $cfg];
}

/** Marca un error del distribuidor que devolvió otra API (fetch_dns, progress…). */
function wp_tenant_mark_error($code, $error)
{
    if (!preg_match('/^\d{6}$/', (string)$code) || !wp_tenant_is_hard($error)) return;
    $ck = 'tenant|cfg|' . $code;
    $c = wp_cache_get($ck, 86400 * 30, $stale);
    $prev = is_array($c) ? $c : $stale;
    wp_cache_set($ck, ['ok' => false, 'error' => $error, 'cfg' => is_array($prev) ? ($prev['cfg'] ?? null) : null]);
}

/** Configuración del distribuidor activo (o null con Omitir / error). */
function wp_tenant_cfg()
{
    $code = wp_panel_tenant();
    if ($code === '') return null;
    $st = wp_tenant_status($code);
    return $st['state'] === 'ok' ? $st['cfg'] : null;
}

/** Funciones habilitadas (alerts, sports). Con Omitir: todo como hoy. La web player no tiene demo automática. */
function wp_tenant_feature($name)
{
    $cfg = wp_tenant_cfg();
    return $cfg === null || !empty($cfg['features'][$name]);
}

/** Cierra la sesión de PHP (al cambiar de distribuidor o cuando el panel lo corta). */
function wp_tenant_logout()
{
    wp_session_start();
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        if (ini_get('session.use_cookies') && !headers_sent()) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }
}

require_once __DIR__ . '/tenant_brand.php';
require_once __DIR__ . '/tenant_guard.php';
