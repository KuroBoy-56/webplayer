<?php
/**
 * «Pantalla falsa» del panel para visitantes nuevos de la web player (sin sesión).
 *
 * - El panel decide si se muestra (Pantalla Falsa: app "Web" marcada, solo equipos nuevos).
 *   Se pide del lado del servidor (api/login.php acción fake_screen, cifrada) y se guarda 1 minuto.
 * - El código de desbloqueo nunca llega al navegador: se comprueba aquí (20 intentos cada
 *   10 minutos por IP) y en caché solo queda su HMAC.
 * - Con el código correcto el navegador recibe la cookie wp_fk (1 año, firmada con la llave del
 *   panel y atada al código: si el dueño cambia el código, la pantalla vuelve a salir).
 */

define('WP_FAKE_COOKIE', 'wp_fk');

function wp_fake_mac($code)
{
    $key = wp_panel_key();
    return $key === null ? '' : hash_hmac('sha256', 'wp-fake|' . $code, $key);
}

/** Respuesta del panel -> pantalla limpia (solo URLs http/https). */
function wp_fake_clean($f)
{
    $types = ['calculator', 'carrusel', 'image', 'video', 'web'];
    $http = function ($u) { return is_string($u) && preg_match('#^https?://#i', $u) ? $u : ''; };
    if (!is_array($f) || ($f['show'] ?? false) !== true) return ['show' => false];
    $type = in_array($f['type'] ?? '', $types, true) ? $f['type'] : 'calculator';
    $url = $http($f['url'] ?? '');
    $images = array_values(array_filter(array_map($http, is_array($f['images'] ?? null) ? $f['images'] : [])));
    if (($type === 'carrusel' && !$images) || (in_array($type, ['image', 'video', 'web'], true) && $url === '')) {
        $type = 'calculator';
    }
    $code = preg_replace('/\D/', '', (string)($f['unlock'] ?? ''));
    return [
        'show' => true,
        'type' => $type,
        'url' => $url,
        'images' => array_slice($images, 0, 30),
        'interval' => max(1, min(120, (int)($f['interval'] ?? 5))),
        'lock' => $code === '' ? '' : wp_fake_mac($code),
    ];
}

/** Pantalla falsa para este visitante, o null (apagada, panel sin respuesta, sin llave). */
function wp_fake_screen_cfg()
{
    if (!wp_panel_ready()) return null;
    $key = 'fake|' . wp_panel_tenant();
    $cached = wp_cache_get($key, 60, $stale);
    if (!is_array($cached)) {
        $body = wp_panel_login('fake_screen', ['platform' => WP_APP_ID] + wp_panel_tenant_fields(), 5, $code);
        $plain = ($body !== null && $code === 200) ? wp_panel_decrypt($body) : null;
        $j = $plain !== null ? json_decode($plain, true) : null;
        if (is_array($j) && array_key_exists('fake_screen', $j)) {
            $cached = wp_fake_clean($j['fake_screen']);
            wp_cache_set($key, $cached);
        } else {
            // panel caído o panel viejo: la última copia buena
            $cached = is_array($stale) ? $stale : ['show' => false];
        }
    }
    return !empty($cached['show']) ? $cached : null;
}

/** El navegador ya puso el código correcto (y sigue siendo el código actual). */
function wp_fake_unlocked(array $fake)
{
    if ($fake['lock'] === '') return false;
    $c = (string)($_COOKIE[WP_FAKE_COOKIE] ?? '');
    return $c !== '' && hash_equals(hash_hmac('sha256', 'ok', $fake['lock']), $c);
}

/** POST fake_unlock=<código>: {"ok": true|false}. */
function wp_fake_unlock_post()
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !isset($_POST['fake_unlock'])) return;
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $fake = wp_fake_screen_cfg();
    if ($fake === null) exit(json_encode(['ok' => true]));
    if (wp_rate_limited('fake', 20, 600)) {
        http_response_code(429);
        exit(json_encode(['ok' => false]));
    }
    $code = preg_replace('/\D/', '', (string)$_POST['fake_unlock']);
    $ok = $fake['lock'] !== '' && $code !== '' && hash_equals($fake['lock'], wp_fake_mac($code));
    if ($ok) {
        wp_rate_reset('fake');
        wp_setcookie(WP_FAKE_COOKIE, hash_hmac('sha256', 'ok', $fake['lock']), time() + 365 * 86400);
    }
    exit(json_encode(['ok' => $ok]));
}

/** Muestra la pantalla falsa (página completa) y termina. */
function wp_fake_screen_render(array $fake)
{
    $nonce = base64_encode(random_bytes(12));
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'self'; img-src * data:; media-src *; frame-src https: http:; style-src 'unsafe-inline'; script-src 'nonce-$nonce'; connect-src 'self'; base-uri 'none'; form-action 'self'");
    $type = $fake['type'];
    include WP_ROOT . '/includes/fake_screen_view.php';
    exit;
}
