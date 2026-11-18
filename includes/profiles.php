<?php
/**
 * Perfiles (como Netflix), del panel: api/profiles.php (el contrato está en docs/PERFILES.md del panel).
 *
 * - El dueño los enciende en el panel (Perfiles). Apagados, con una sola conexión en la línea o en una DEMO la web
 *   sigue exactamente como antes: todo es del perfil principal y no hay pantalla de perfiles.
 * - Encendidos y con más de una conexión, cada inicio de sesión pasa por «¿Quién está viendo?» (perfiles.php) y el
 *   perfil elegido va como «profile» en cada llamada a api/progress.php: Continuar viendo y Mi lista son de cada
 *   perfil. «Cambiar perfil» (menú del perfil) vuelve a esa pantalla.
 * - En la sesión (wp_prof): si están encendidos, cuántos perfiles admite la línea, el perfil elegido (id, nombre,
 *   avatar) y cuándo se preguntó al panel: como mucho cada 10 minutos (como los otros guardianes), o al momento al
 *   abrir la pantalla de perfiles. Si el panel no contesta nada se bloquea: se sigue con lo que había.
 */
if (defined('WP_PROFILES_LOADED')) {
    return;
}
define('WP_PROFILES_LOADED', true);

const WP_PROF_TTL = 600;
// páginas que esperan a que se elija el perfil (las demás —salir, el reproductor http, avisos— se abren igual)
const WP_PROF_GATED = ['homex.php', 'home.php', 'browse.php', 'movies.php', 'series.php', 'moviesondemand.php', 'seriesondemand.php',
    'Movie_description.php', 'seriesvideo.php', 'video_player.php', 'tvguide.php', 'sportsschedule.php', 'actor.php', 'myaccount.php',
    'settings.php'];

/** De quién es lo guardado (otra línea u otro número de distribuidor en la misma sesión = se empieza de cero). */
function wp_prof_acct()
{
    $u = wp_user();
    return substr(md5(wp_panel_token_key() . '|' . $u['username'] . '|' . $u['server']), 0, 12);
}

function wp_prof_empty()
{
    return ['acct' => wp_prof_acct(), 'on' => false, 'max' => 1, 'at' => 0, 'id' => '', 'name' => '', 'avatar' => '',
        'main_name' => '', 'main_avatar' => '', 'down' => false];
}

/** Lo guardado en la sesión. */
function wp_prof_state()
{
    $s = $_SESSION['wp_prof'] ?? null;
    if (!is_array($s) || ($s['acct'] ?? '') !== wp_prof_acct()) return wp_prof_empty();
    return $s + wp_prof_empty();
}

function wp_prof_save(array $s)
{
    if (($_SESSION['wp_prof'] ?? null) === $s) return;
    wp_panel_session_set('wp_prof', $s);
}

/**
 * api/profiles.php del panel con el token de la sesión. GET sin $body, POST con $body. Devuelve el JSON también en un
 * error (trae «code» y «error» para mostrar) o null si el panel no contestó. $code = código HTTP.
 */
function wp_prof_api($body = null, &$code = null)
{
    $code = 0;
    if (!wp_panel_ready() || wp_is_demo()) return null;
    $token = wp_panel_token();
    for ($try = 0; $try < 2; $try++) {
        if ($token === '') {
            $u = wp_user();
            $token = wp_panel_auth($u['username'], $u['password'], $u['server']);
            if ($token === '') return null;
            wp_panel_store_token($token);
            wp_panel_set_demo(!empty($GLOBALS['wp_panel_auth_demo']));
        }
        $ep = 'profiles.php';
        if ($body === null) {
            // las conexiones de la línea que ya sabe la web (el panel las usa mientras no las sepa del servidor IPTV)
            $max = (int)($_SESSION['max_conn'] ?? 0);
            $ep .= '?_=' . str_replace('.', '', (string)microtime(true)) . ($max > 0 ? '&max=' . $max : '');
        }
        $res = wp_panel_request($ep, $body, ['Authorization: Bearer ' . $token], 8, $code);
        if ($code === 401 && $try === 0) {
            $token = '';
            continue;
        }
        $j = $res !== null ? json_decode($res, true) : null;
        if (!is_array($j)) return null;
        if (!empty($j['token']) && is_string($j['token']) && $j['token'] !== $token) wp_panel_store_token($j['token']);
        unset($j['token']);
        return $j;
    }
    return null;
}

/** Un perfil de la lista del panel por id (o null). */
function wp_prof_find(array $state, $id)
{
    foreach ((array)($state['profiles'] ?? []) as $p) {
        if (is_array($p) && (string)($p['id'] ?? '') === (string)$id) return $p;
    }
    return null;
}

/** Lo que dice el panel ($j, respuesta correcta de api/profiles.php) pasa a la sesión. */
function wp_prof_apply(array $s, array $j)
{
    $s['at'] = time();
    $s['down'] = false;
    $s['on'] = !empty($j['enabled']);
    $s['max'] = $s['on'] ? max(1, min(5, (int)($j['max'] ?? 1))) : 1;
    $main = wp_prof_find($j, 'main');
    $s['main_name'] = $main ? (string)$main['name'] : '';
    $s['main_avatar'] = $main ? (string)$main['avatar'] : '';
    if (!$s['on']) {
        $s['id'] = $s['name'] = $s['avatar'] = '';
        return $s;
    }
    if ($s['id'] !== '') {
        $p = wp_prof_find($j, $s['id']);
        if ($p === null) {
            // eliminado en otro equipo, o la línea bajó de conexiones: otra vez la pantalla de perfiles
            $s['id'] = $s['name'] = $s['avatar'] = '';
        } else {
            $s['name'] = (string)$p['name'];
            $s['avatar'] = (string)$p['avatar'];
        }
    }
    return $s;
}

/**
 * Estado de los perfiles: se pregunta al panel si pasaron 10 minutos (o con $force). Devuelve [estado de la sesión,
 * respuesta del panel o null].
 */
function wp_prof_refresh($force = false)
{
    $s = wp_prof_state();
    if (wp_is_demo()) return [wp_prof_empty(), null];
    if (!$force && time() - (int)$s['at'] < WP_PROF_TTL) return [$s, null];
    $j = wp_prof_api(null, $code);
    if (is_array($j) && !empty($j['success'])) {
        $s = wp_prof_apply($s, $j);
    } else {
        // sin respuesta: se vuelve a probar en un minuto, con lo que había (y sin pedir perfil mientras tanto: nunca
        // se queda dando vueltas entre la pantalla de perfiles y el inicio)
        $s['at'] = time() - WP_PROF_TTL + 60;
        $s['down'] = true;
        $j = null;
    }
    wp_prof_save($s);
    return [$s, $j];
}

/** ¿Esta línea elige perfil? (encendidos y más de una conexión) */
function wp_prof_needed(array $s)
{
    return !empty($s['on']) && (int)$s['max'] > 1;
}

/** El perfil que va en api/progress.php ('' = el principal, sin el campo). */
function wp_prof_id()
{
    if (wp_is_demo()) return '';
    $s = wp_prof_state();
    $id = !empty($s['on']) ? (string)$s['id'] : '';
    return $id === 'main' ? '' : $id;
}

/** El perfil elegido no existe más (api/progress.php contestó 410): se olvida y se vuelve a la pantalla de perfiles. */
function wp_prof_gone()
{
    $s = wp_prof_state();
    $s['id'] = $s['name'] = $s['avatar'] = '';
    $s['at'] = 0;
    wp_prof_save($s);
}

/** Lo que se ve en la barra superior: ['on', 'name', 'avatar', 'many'] (on false = barra de siempre). */
function wp_prof_view()
{
    $s = wp_prof_state();
    if (wp_is_demo() || empty($s['on'])) return ['on' => false, 'name' => '', 'avatar' => '', 'many' => false];
    $main = $s['id'] === '' || $s['id'] === 'main';
    return ['on' => true, 'name' => $main ? (string)$s['main_name'] : (string)$s['name'],
        'avatar' => $main ? (string)$s['main_avatar'] : (string)$s['avatar'], 'many' => wp_prof_needed($s)];
}

/**
 * session.php: si la línea elige perfil y todavía no lo eligió, la página espera en «¿Quién está viendo?» (solo al
 * navegar: las cargas en segundo plano siguen con el principal hasta que se elija).
 */
function wp_prof_gate()
{
    if (PHP_SAPI === 'cli' || defined('WP_HANDOFF') || wp_is_demo()) return;
    list($s) = wp_prof_refresh();
    $self = basename((string)($_SERVER['SCRIPT_NAME'] ?? ''));
    if (!in_array($self, WP_PROF_GATED, true) || !wp_prof_needed($s) || $s['id'] !== '' || !empty($s['down'])) return;
    if (!function_exists('wp_route_is_navigation') || !wp_route_is_navigation() || headers_sent()) return;
    // al elegir se vuelve a la página que se pidió (por su token), si no al inicio
    $next = defined('WP_ROUTED') ? basename((string)parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH)) : '';
    $to = wp_route_url('perfiles.php' . (wp_prof_next_ok($next) ? '?next=' . rawurlencode($next) : ''));
    header('Cache-Control: no-store');
    header('Location: ' . $to, true, 302);
    exit;
}

/** Solo una página de esta web por su token (nunca otra dirección). */
function wp_prof_next_ok($next)
{
    return is_string($next) && preg_match('/^w-[A-Za-z0-9_-]{30,2000}$/', $next);
}

/** Elige el perfil $id (con su PIN si está bloqueado). [true, estado] o [false, mensaje, código]. */
function wp_prof_select($id, $pin = '')
{
    list($s, $j) = wp_prof_refresh(true);
    if (!is_array($j)) return [false, t('No se pudo conectar con el servidor. Inténtalo de nuevo.'), 'net'];
    if (!$s['on']) return [true, $s];
    $p = wp_prof_find($j, $id);
    if ($p === null) return [false, t('Ese perfil ya no existe.'), 'not_found'];
    if (!empty($p['locked'])) {
        $r = wp_prof_api(['action' => 'pin_check', 'id' => (string)$id, 'pin' => (string)$pin], $code);
        if (!is_array($r)) return [false, t('No se pudo conectar con el servidor. Inténtalo de nuevo.'), 'net'];
        if (empty($r['success'])) return [false, (string)($r['error'] ?? t('El PIN no es correcto.')), (string)($r['code'] ?? 'pin_wrong')];
    }
    $s['id'] = (string)$p['id'];
    $s['name'] = (string)$p['name'];
    $s['avatar'] = (string)$p['avatar'];
    wp_prof_save($s);
    return [true, $s];
}

/**
 * Fondo de la pantalla de perfiles: lo más destacado de la semana en TMDB (trending de películas y series, el primero
 * con fondo), por api/tmdb.php del panel con la clave del distribuidor (o la del dueño con Omitir), como el fondo del
 * login. ['title', 'rating', 'year', 'kind', 'backdrop' (original)] o null sin clave. Caché de 6 horas por
 * distribuidor e idioma.
 */
function wp_prof_highlight()
{
    $base = wp_panel_base();
    if ($base === '') return null;
    $ck = wp_panel_ck('prof|highlight|' . wp_lang());
    $c = wp_cache_get($ck, 21600);
    if (is_array($c)) return $c['h'] ?? null;
    $body = wp_http_get($base . wp_panel_tenant_query('tmdb.php?path=trending/all/week&language=' . wp_tmdb_lang()), 6);
    $data = $body ? json_decode($body, true) : null;
    $h = null;
    foreach ((array)($data['results'] ?? []) as $r) {
        if (!is_array($r) || empty($r['backdrop_path']) || !in_array($r['media_type'] ?? '', ['movie', 'tv'], true)) continue;
        $title = (string)($r['title'] ?? ($r['name'] ?? ''));
        if ($title === '') continue;
        $date = (string)($r['release_date'] ?? ($r['first_air_date'] ?? ''));
        $h = ['title' => $title, 'rating' => round((float)($r['vote_average'] ?? 0), 1), 'year' => substr($date, 0, 4),
            'kind' => $r['media_type'] === 'tv' ? 'tv' : 'movie',
            'backdrop' => 'https://image.tmdb.org/t/p/original' . (string)$r['backdrop_path']];
        break;
    }
    // sin respuesta del panel no se guarda (se vuelve a probar en la próxima visita)
    if (is_array($data)) wp_cache_set($ck, ['h' => $h, 'at' => time()]);
    return $h;
}

/* ---------- pantalla de perfiles (perfiles.php): acciones por fetch ---------- */

/** Token de los formularios de la pantalla de perfiles (de esta sesión). */
function wp_prof_csrf()
{
    return substr(hash_hmac('sha256', session_id() . '|' . wp_prof_acct(), wp_secret()), 0, 32);
}

/** Dirección para mostrar una imagen del panel (http en una web https pasa por img.php). */
function wp_prof_img($url)
{
    return wp_img((string)$url, '');
}

/** La respuesta del panel para el navegador: con las direcciones de las imágenes para mostrar. */
function wp_prof_public(array $j, array $s)
{
    $out = ['max' => (int)($j['max'] ?? 1), 'canCreate' => !empty($j['canCreate']), 'current' => (string)$s['id'], 'profiles' => [], 'avatars' => []];
    foreach ((array)($j['profiles'] ?? []) as $p) {
        if (!is_array($p)) continue;
        $out['profiles'][] = ['id' => (string)($p['id'] ?? ''), 'name' => (string)($p['name'] ?? ''), 'avatar' => (string)($p['avatar'] ?? ''),
            'img' => wp_prof_img($p['avatar'] ?? ''), 'locked' => !empty($p['locked']), 'main' => !empty($p['main'])];
    }
    foreach ((array)($j['avatars'] ?? []) as $a) {
        if (is_string($a) && $a !== '') $out['avatars'][] = ['u' => $a, 's' => wp_prof_img($a)];
    }
    return $out;
}

/** Una acción de la pantalla de perfiles (POST). Devuelve lo que se manda al navegador. */
function wp_prof_post(array $in)
{
    if (!hash_equals(wp_prof_csrf(), (string)($in['csrf'] ?? ''))) {
        return ['ok' => false, 'code' => 'csrf', 'error' => t('La página caducó. Recárgala e inténtalo de nuevo.')];
    }
    $act = (string)($in['action'] ?? '');
    $id = (string)($in['id'] ?? '');
    if ($act === 'select') {
        $r = wp_prof_select($id, (string)($in['pin'] ?? ''));
        if (!$r[0]) return ['ok' => false, 'error' => $r[1], 'code' => $r[2]];
        $next = (string)($in['next'] ?? '');
        return ['ok' => true, 'go' => wp_prof_next_ok($next) ? $next : wp_route_url('homex')];
    }
    $fields = [
        'create' => ['name', 'avatar'],
        'update' => ['id', 'name', 'avatar', 'pin'],
        'delete' => ['id', 'pin'],
        'pin_set' => ['id', 'new_pin', 'pin'],
        'pin_clear' => ['id', 'pin'],
        'pin_check' => ['id', 'pin'],
        'pin_reset' => ['id', 'pass'],
    ];
    if (!isset($fields[$act])) return ['ok' => false, 'code' => 'action', 'error' => t('Acción no válida.')];
    $body = ['action' => $act];
    foreach ($fields[$act] as $f) {
        if (isset($in[$f]) && is_string($in[$f]) && ($in[$f] !== '' || $f === 'name')) $body[$f] = $in[$f];
    }
    $j = wp_prof_api($body, $code);
    if (!is_array($j)) return ['ok' => false, 'code' => 'net', 'error' => t('No se pudo conectar con el servidor. Inténtalo de nuevo.')];
    if (empty($j['success'])) return ['ok' => false, 'code' => (string)($j['code'] ?? ''), 'error' => (string)($j['error'] ?? t('No se pudo guardar. Inténtalo de nuevo.'))];
    // el panel contesta el estado completo: la sesión queda al día (nombre o avatar del perfil elegido, o eliminado)
    $s = wp_prof_apply(wp_prof_state(), $j);
    wp_prof_save($s);
    if (empty($s['on'])) return ['ok' => true, 'off' => true, 'go' => wp_route_url('homex')];
    return ['ok' => true, 'state' => wp_prof_public($j, $s)];
}
