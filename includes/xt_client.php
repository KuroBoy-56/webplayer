<?php
/**
 * Modo navegador: el navegador de cada usuario le pide los datos al servidor IPTV (player_api.php) con SU propia IP y
 * se los pasa a la web (xtfill.php). El hosting no le pregunta nada al servidor IPTV: todos los usuarios de la web
 * salían con la IP del hosting, y XUI la bloqueaba (protección contra flood: muchos pedidos o intentos fallidos desde
 * la misma IP). Ver docs/LOGIN-SERVIDORES.md del panel.
 *
 *  - Se elige al iniciar sesión: si el navegador pudo leer player_api.php directo (el servidor da permiso CORS y, con la
 *    web en https, también tiene https), la sesión queda con xt_client = 1. Si no, todo sigue como antes (por el hosting).
 *  - xt_get_raw() (includes/core.php): lo que está guardado se usa; lo vencido se usa igual y el navegador lo renueva
 *    después (en segundo plano); lo que falta se le pide al navegador antes de mostrar la página (wp_xt_output: en lugar
 *    de la página sale «Cargando…», el navegador lo trae, lo manda y la página se vuelve a cargar). En las cargas en
 *    segundo plano (api.php…) la respuesta es {"xtneed": [...]} y assets/nf/xtfill.js lo trae y repite el pedido.
 *  - Si el navegador no puede (sin permiso CORS, sin red), xtfill.php?fail=1 pasa la sesión al hosting y lo avisa al panel.
 */
if (defined('WP_XT_CLIENT_LOADED')) {
    return;
}
define('WP_XT_CLIENT_LOADED', true);

$GLOBALS['wp_xt_needs'] = [];

/** ¿La sesión usa el modo navegador? */
function wp_xt_client()
{
    return !empty($_SESSION['xt_client']) && !empty($_SESSION['server']);
}

function wp_xt_sid()
{
    $id = session_id();
    return is_string($id) && $id !== '' ? $id : '';
}

/** Lo que el navegador tiene que traer: [id => ['u' => dirección, 'b' => 1 si la página lo espera]]. */
function wp_xt_need($action, array $params, $blocking)
{
    $sid = wp_xt_sid();
    if ($sid === '') return;
    $ck = xt_cache_key($action, $params);
    $id = substr(sha1($ck), 0, 20);
    $needs = &$GLOBALS['wp_xt_needs'];
    if (isset($needs[$id])) {
        if ($blocking) $needs[$id]['b'] = 1;
        return;
    }
    // un servidor http con la web en https: por el puente del Worker (includes/xt_relay.php)
    $needs[$id] = ['id' => $id, 'u' => wp_xt_browser_url(xt_url($action, $params)), 'b' => $blocking ? 1 : 0];
    wp_cache_set('xtneed|' . $sid . '|' . $id, ['ck' => $ck, 'a' => (string)$action]);
    if (!$blocking) {
        // lo vencido se renueva en la próxima página (también si esto fue una carga en segundo plano)
        $pk = 'xtbg|' . $sid;
        $bg = wp_cache_get($pk, 1800);
        $bg = is_array($bg) ? $bg : [];
        if (!isset($bg[$id])) {
            $bg[$id] = ['id' => $id, 'u' => $needs[$id]['u'], 'b' => 0];
            if (count($bg) > 40) $bg = array_slice($bg, -40, null, true);
            wp_cache_set($pk, $bg);
        }
    }
}

/**
 * ¿Esta página se muestra sin esperar el catálogo completo (web player 2.9.1)? Inicio, Películas, Series, Explorar y
 * las fichas lo definen (WP_XT_SOFT): salen al momento y sus filas se llenan solas a medida que llega el catálogo, en
 * lugar de la pantalla «Cargando…». Nunca en un perfil infantil (su filtro necesita el catálogo).
 */
function wp_xt_soft()
{
    return defined('WP_XT_SOFT') && !(function_exists('wp_kids_on') && wp_kids_on());
}

/** ¿El catálogo ligero de este tipo ya está (aunque esté vencido)? */
function wp_catalog_have($type)
{
    $data = wp_cache_get('slim2|' . ($type === 'series' ? 'series' : 'movie') . '|' . xt_cache_key('', []), 1800, $stale);
    return $data !== null || (is_array($stale) && $stale);
}

/**
 * Los títulos de una categoría sin esperar el catálogo completo (filas y «Ver todo» de una categoría): el navegador
 * trae solo esa categoría (unos KB) y el catálogo completo sigue llegando por detrás. null si no aplica (ya está el
 * catálogo, no es el modo navegador o es un perfil infantil).
 */
function wp_cat_list_quick($type, $cat, $sort)
{
    if (!wp_xt_client() || $cat === '' || wp_catalog_have($type) || (function_exists('wp_kids_on') && wp_kids_on())) return null;
    $act = $type === 'series' ? 'get_series' : 'get_vod_streams';
    wp_xt_need($act, [], false);
    $raw = xt_get($act, ['category_id' => $cat], 1800, 20);
    $list = is_array($raw) ? wp_catalog_slim($type, $raw) : [];
    if ($sort === 'recent') wp_sort_items($list, 'added');
    elseif ($sort === 'az') wp_sort_items($list, 'name', false);
    elseif ($sort === 'rating') wp_sort_items($list, 'rating');
    return $list;
}

/** ¿Hay algo que la página espera del navegador? */
function wp_xt_blocking()
{
    foreach ($GLOBALS['wp_xt_needs'] as $n) {
        if (!empty($n['b'])) return true;
    }
    return false;
}

/** Lo que se renueva en segundo plano en esta página. */
function wp_xt_background()
{
    $sid = wp_xt_sid();
    $bg = $sid !== '' ? wp_cache_get('xtbg|' . $sid, 1800) : null;
    $out = is_array($bg) ? $bg : [];
    foreach ($GLOBALS['wp_xt_needs'] as $id => $n) {
        if (empty($n['b'])) $out[$id] = $n;
    }
    return array_values($out);
}

/** La dirección de xtfill.php (no tiene token propio: no está en WP_ROUTE_PAGES). */
function wp_xt_config()
{
    return ['fill' => 'xtfill.php', 'v' => 1];
}

/**
 * La salida de la página (desde wp_route_rewrite): sin modo navegador, igual. Si la página esperaba algo del
 * navegador: «Cargando…» (o {"xtneed"} en las cargas en segundo plano). Si no: el script del modo navegador.
 */
function wp_xt_output($out)
{
    if (!wp_xt_client()) return $out;
    $trim = ltrim((string)$out);
    $isJson = $trim !== '' && ($trim[0] === '{' || $trim[0] === '[');
    if (!$isJson) {
        foreach (headers_list() as $h) {
            if (stripos($h, 'content-type:') === 0 && stripos($h, 'json') !== false) $isJson = true;
        }
    }
    if (wp_xt_blocking()) {
        $needs = array_values(array_filter($GLOBALS['wp_xt_needs'], function ($n) { return !empty($n['b']); }));
        if ($isJson) return json_encode(['xtneed' => $needs], JSON_UNESCAPED_SLASHES);
        return wp_xt_loader($needs);
    }
    if (!$isJson && stripos($out, '</head>') !== false) {
        $cfg = wp_xt_config() + ['bg' => wp_xt_background()];
        $tag = '<script>window.XT_CFG=' . json_encode($cfg, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) . ';</script>'
            . '<script src="assets/nf/xtfill.js?v=2"></script>';
        $out = preg_replace('~</head>~i', $tag . '</head>', $out, 1);
    }
    return $out;
}

/** «Cargando…» mientras el navegador trae lo que falta (después la página se vuelve a cargar). */
function wp_xt_loader(array $needs)
{
    $cfg = wp_xt_config() + ['need' => $needs];
    return '<!DOCTYPE html><html lang="' . e(wp_lang()) . '"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
        . '<meta name="robots" content="noindex"><title>' . e(t('Cargando...')) . '</title>'
        // sin transición entre páginas (esta no la pide): si no, Chrome deja un error en la consola
        . '<script>addEventListener("pagereveal",function(e){var v=e.viewTransition;if(!v)return;v.skipTransition();[v.ready,v.finished,v.updateCallbackDone].forEach(function(p){if(p&&p.catch)p.catch(function(){});});});'
        . 'addEventListener("pageswap",function(e){var v=e.viewTransition;if(v){v.skipTransition();[v.ready,v.finished,v.updateCallbackDone].forEach(function(p){if(p&&p.catch)p.catch(function(){});});}});</script>'
        . '<style>@view-transition{navigation:auto}html,body{margin:0;height:100%;background:#000;color:#ddd;font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'
        . '.xt-l{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;padding:0 24px}'
        . '.xt-s{width:46px;height:46px;border:4px solid rgba(255,255,255,.18);border-top-color:#e50914;border-radius:50%;animation:xt 1s linear infinite}'
        . '@keyframes xt{to{transform:rotate(360deg)}}.xt-e{color:#ff8a8a;max-width:420px}</style>'
        . '<script>window.XT_CFG=' . json_encode($cfg, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) . ';window.XT_T='
        . json_encode(['err' => t('No se pudo cargar el contenido. Revisa tu conexión e inténtalo de nuevo.')], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) . ';</script>'
        . '<script src="assets/nf/xtfill.js?v=2"></script></head><body><div class="xt-l"><div class="xt-s"></div><div id="xtMsg">' . e(t('Cargando...')) . '</div></div></body></html>';
}

/** El navegador no pudo leer el servidor IPTV: la sesión vuelve al hosting (y el panel se entera, una vez al día). */
function wp_xt_disable($why)
{
    wp_panel_session_set('xt_client', 0);
    $_SESSION['xt_client'] = 0;
    $host = (string)parse_url(wp_user()['server'], PHP_URL_HOST);
    $ck = 'xtoff|' . $host;
    if ($host !== '' && !wp_cache_get($ck, 86400)) {
        wp_cache_set($ck, 1);
        if (function_exists('wp_panel_report')) {
            wp_panel_report('warning', 'Web player: el navegador no pudo pedir los datos directo al servidor IPTV (' . $host . '); esta sesión sigue por el hosting',
                'Motivo: ' . mb_substr((string)$why, 0, 300) . "\nSin permiso CORS del servidor, o la web en https y el servidor solo en http. Ver docs/LOGIN-SERVIDORES.md.", 'Modo navegador');
        }
    }
}

/**
 * ¿El servidor IPTV le da permiso CORS a esta web con esta línea? Un solo pedido desde el hosting (con datos válidos,
 * así no es un intento fallido), la primera vez que un navegador entra por ese servidor: con eso, después, una
 * respuesta que el navegador no puede leer quiere decir usuario o contraseña equivocados (XUI no da el permiso).
 */
function wp_xt_cors_check($base, $user, $pass)
{
    $origin = (wp_is_https() ? 'https://' : 'http://') . (string)($_SERVER['HTTP_HOST'] ?? '');
    $ch = wp_curl(rtrim($base, '/') . '/player_api.php?username=' . urlencode($user) . '&password=' . urlencode($pass), 8);
    $hdr = [];
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Origin: ' . $origin]);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($c, $line) use (&$hdr) {
        $p = strpos($line, ':');
        if ($p !== false) $hdr[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
        return strlen($line);
    });
    $body = curl_exec($ch);
    curl_close($ch);
    $j = is_string($body) ? json_decode($body, true) : null;
    $acao = rtrim((string)($hdr['access-control-allow-origin'] ?? ''), '/');
    return is_array($j) && (int)($j['user_info']['auth'] ?? 0) === 1 && ($acao === '*' || strcasecmp($acao, $origin) === 0);
}

/**
 * Inicio de sesión desde el navegador: las direcciones que el navegador prueba, en orden (primero la última del usuario,
 * después la más usada del distribuidor). Con la web en https solo las https (una http la bloquearía el navegador).
 * $first: una por servidor real (http); $later: las https del panel.
 */
function wp_xt_login_cands(array $first, array $later, $lastUrl, $tc)
{
    $https = wp_is_https();
    $order = wp_login_order($first, $tc);
    if (is_string($lastUrl) && $lastUrl !== '') {
        usort($order, function ($a, $b) use ($lastUrl) {
            $la = wp_login_endpoint($a['url']) === wp_login_endpoint(preg_replace('~^https://~i', 'http://', $lastUrl));
            $lb = wp_login_endpoint($b['url']) === wp_login_endpoint(preg_replace('~^https://~i', 'http://', $lastUrl));
            return $lb <=> $la;
        });
    }
    $sec = [];
    foreach ($later as $s) {
        $sec[strtolower((string)parse_url($s['url'], PHP_URL_HOST))][] = $s['url'];
    }
    $out = [];
    foreach ($order as $srv) {
        $u = rtrim($srv['url'], '/');
        $p = parse_url($u);
        $host = strtolower((string)($p['host'] ?? ''));
        if ($host === '') continue;
        $port = (int)($p['port'] ?? 80);
        $alt = $sec[$host] ?? ['https://' . $host . ($port !== 80 && $port !== 443 ? ':' . $port : '') . rtrim((string)($p['path'] ?? ''), '/')];
        $list = $https ? $alt : array_merge([$u], $alt);
        // con la web en https, un servidor sin SSL (o con un certificado que el navegador rechaza) se prueba después por
        // el puente del Worker de Cloudflare (includes/xt_relay.php): así también entra desde la IP del cliente
        $relay = $https ? wp_xt_relay_base($u) : '';
        if ($relay !== '') $list[] = $relay;
        $k = wp_login_endpoint($u);
        // c = este servidor ya le dio permiso CORS a un navegador: si ahora no deja leer la respuesta, es que el usuario
        // o la contraseña no son de ahí (XUI no da el permiso con datos equivocados) y no hace falta probar por el hosting
        $out[] = ['k' => $k, 'c' => wp_cache_get('xtcors|' . $k, 180 * 86400) ? 1 : 0,
            'u' => array_values(array_unique(array_map(function ($x) { return rtrim($x, '/'); }, $list)))];
    }
    return $out;
}
