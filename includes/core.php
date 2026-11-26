<?php
/**
 * Núcleo compartido de la WebPlayer.
 * - Sesión segura (sin bloqueos entre peticiones)
 * - Lectura de DNS/servidores (desde el panel, ver includes/panel.php)
 * - Llamadas a la API Xtream con caché en disco (rápido y sin recargar)
 * - Proxy firmado para video/imágenes (compatibilidad HTTPS)
 * - Filtros inteligentes por plataforma y género
 */
if (defined('WP_CORE_LOADED')) {
    return;
}
define('WP_CORE_LOADED', true);
define('WP_ROOT', dirname(__DIR__));
define('WP_UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
define('WP_NOIMG', 'assets/nf/noposter.svg');
define('WP_LOGO', 'assets/img/Logo.png');
// versión de la web player (abajo a la izquierda en la pantalla de perfiles): subirla con cada cambio de la web
define('WP_VERSION', '3.0.3');
// dominio propio por un Worker de Cloudflare (opcional, antes de todo lo que usa el dominio o la IP)
require_once __DIR__ . '/edge.php';
require_once __DIR__ . '/i18n.php';
require_once __DIR__ . '/catalog_fast.php';
require_once __DIR__ . '/xt_relay.php';


/**
 * Claves de TMDB (carátulas, fondos, elenco y tráileres), en el orden en que se usan:
 *  1. 'tmdb_key' de includes/panel_secret.php (o WP_TMDB_KEY), la del hosting de la web (no se sube a GitHub);
 *  2. la guardada en el panel (Ajustes del dueño, o la del distribuidor con su número), que el panel manda con el token.
 * Una clave que TMDB rechazó (401) se salta un día (wp_tmdb_key_bad) y se usa la siguiente. Un distribuidor con «Solo
 * sus recursos» nunca usa la del hosting. Sin ninguna: TMDB por el panel (wp_tmdb_via_panel) y, sin eso, sin TMDB.
 */
function wp_tmdb_key_list()
{
    static $memo = null;
    if ($memo) return $memo; // sin ninguna no se guarda: la del panel puede llegar más adelante en el mismo pedido
    $own = defined('WP_TMDB_KEY') ? (string)constant('WP_TMDB_KEY') : '';
    $file = __DIR__ . '/panel_secret.php';
    if ($own === '' && is_file($file)) {
        $cfg = include $file;
        if (is_array($cfg)) $own = trim((string)($cfg['tmdb_key'] ?? ''));
    }
    $panel = '';
    if (function_exists('wp_panel_ck')) {
        $p = wp_cache_get(wp_panel_ck('panel|tmdbkey'), 30 * 86400, $stale);
        $panel = is_string($p) ? $p : (is_string($stale) ? $stale : '');
    }
    // «Solo sus recursos»: el distribuidor nunca usa nada del dueño
    $dist = function_exists('wp_panel_tenant') && wp_panel_tenant() !== '';
    $cfg = $dist && function_exists('wp_tenant_cfg') ? wp_tenant_cfg() : null;
    if (is_array($cfg) && empty($cfg['features']['hosting_video'])) $own = '';
    $list = [];
    foreach ([$own, $panel] as $k) {
        $k = trim((string)$k);
        if (preg_match('/^[0-9a-f]{32}$/i', $k) && !in_array($k, $list, true) && !wp_cache_get('tmdb|badkey|' . md5($k), 86400)) $list[] = $k;
    }
    return $memo = $list;
}

/** TMDB rechazó esta clave (401): se salta un día y va la siguiente. */
function wp_tmdb_key_bad($key)
{
    if ($key !== '') wp_cache_set('tmdb|badkey|' . md5($key), 1);
}

/** La clave de TMDB en uso (la primera de wp_tmdb_key_list) o ''. */
function wp_tmdb_key()
{
    $l = wp_tmdb_key_list();
    return $l ? $l[0] : '';
}

/**
 * Sin clave propia (un distribuidor que no puso la suya): TMDB por el panel (api/tmdb.php, con la clave del dueño y su
 * caché de 24 h), como Roku, Vega y Android, que también la buscan ahí. Nunca para un distribuidor con «Solo sus
 * recursos» (Distribuidores del panel): ese usa solo lo suyo.
 */
function wp_tmdb_via_panel()
{
    static $on = null;
    if ($on !== null) return $on;
    if (wp_tmdb_key() !== '' || !function_exists('wp_panel_base') || wp_panel_base() === '') return $on = false;
    $cfg = function_exists('wp_tenant_cfg') ? wp_tenant_cfg() : null;
    return $on = !(is_array($cfg) && empty($cfg['features']['hosting_video']));
}

/** ¿Hay TMDB para esta línea (su clave o el panel)? */
function wp_tmdb_on()
{
    return wp_tmdb_key() !== '' || wp_tmdb_via_panel();
}

/** Dirección de TMDB para $path ('search/movie', 'tv/123/season/1'…) con $query: directa con la clave o por el panel. */
function wp_tmdb_url($path, $query = '')
{
    $path = trim((string)$path, '/');
    $query = ltrim((string)$query, '&');
    if (wp_tmdb_key() !== '') return 'https://api.themoviedb.org/3/' . $path . '?api_key=' . wp_tmdb_key() . ($query !== '' ? '&' . $query : '');
    if (!wp_tmdb_via_panel() || !preg_match('~^[a-z0-9_/]{1,80}$~i', $path)) return '';
    $base = wp_panel_base();
    // el hosting llega al panel solo por http (SSL quitado o vencido): igual que wp_panel_request
    if (wp_cache_get('panel|mode', 3600) === 2 && stripos($base, 'https://') === 0) $base = 'http://' . substr($base, 8);
    return $base . 'tmdb.php?path=' . $path . ($query !== '' ? '&' . $query : '');
}

// Duración de los enlaces firmados del proxy (segundos)
define('WP_SIGN_TTL', 43200);

/* ------------------------------------------------------------------ */
/* HTTPS / sesión                                                      */
/* ------------------------------------------------------------------ */

function wp_is_https()
{
    if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') return true;
    if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && stripos($_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false) return true;
    if (isset($_SERVER['HTTP_X_FORWARDED_SSL']) && strtolower($_SERVER['HTTP_X_FORWARDED_SSL']) === 'on') return true;
    if (isset($_SERVER['HTTP_CF_VISITOR']) && stripos($_SERVER['HTTP_CF_VISITOR'], 'https') !== false) return true;
    if (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443) return true;
    return false;
}

function wp_session_start()
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    // La cookie de sesión debe ser "secure" solo en https. Se fija por ini_set (no depende de
    // headers_sent ni del php.ini del hosting): si el hosting fuerza secure=1 y la web está en
    // http, el navegador descarta la cookie y el login se recarga sin dar acceso.
    @ini_set('session.use_strict_mode', '1');
    @ini_set('session.use_only_cookies', '1');
    @ini_set('session.gc_maxlifetime', '86400');
    @ini_set('session.cookie_secure', wp_is_https() ? '1' : '0');
    @ini_set('session.cookie_httponly', '1');
    @ini_set('session.cookie_samesite', 'Lax');
    @ini_set('session.cookie_path', '/');
    // Nombre de cookie distinto en http y en https: si el navegador guardó una cookie "secure" cuando la
    // web tenía SSL, una página http no puede reemplazarla (regla de los navegadores) y el login se
    // recargaba sin entrar. Con otro nombre no chocan.
    if (!headers_sent()) session_name(wp_is_https() ? 'WPSESS_S' : 'WPSESS');
    if (!headers_sent()) {
        $opts = [
            'lifetime' => 0,
            'path' => '/',
            'secure' => wp_is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ];
        if (PHP_VERSION_ID >= 70300) {
            session_set_cookie_params($opts);
        } else {
            session_set_cookie_params(0, $opts['path'] . '; samesite=Lax', '', $opts['secure'], true);
        }
    }
    @session_start();
}

/** Lee la sesión y la libera para que las peticiones paralelas no se bloqueen. */
function wp_session_read_close()
{
    wp_session_start();
    $data = $_SESSION;
    session_write_close();
    return $data;
}

function wp_security_headers()
{
    if (headers_sent()) return;
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-XSS-Protection: 1; mode=block');
    header_remove('X-Powered-By');
}

function wp_setcookie($name, $value, $expires = 0, $httponly = true)
{
    if (PHP_VERSION_ID >= 70300) {
        return setcookie($name, $value, ['expires' => $expires, 'path' => '/', 'secure' => wp_is_https(), 'httponly' => $httponly, 'samesite' => 'Lax']);
    }
    return setcookie($name, $value, $expires, '/; samesite=Lax', '', wp_is_https(), $httponly);
}

function e($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

/* ------------------------------------------------------------------ */
/* Archivos de configuración                                           */
/* ------------------------------------------------------------------ */

function wp_json_file($path, $default = [])
{
    if (!is_file($path)) return $default;
    $data = json_decode((string)@file_get_contents($path), true);
    return is_array($data) ? $data : $default;
}

/**
 * Servidores (DNS) que entrega el panel, en orden => [ ['id'=>'1','name'=>'Servidor 1','url'=>..], ... ]
 * Ver includes/panel.php (caché de 10 minutos y última copia buena).
 */
function wp_dns_list()
{
    $list = [];
    foreach (wp_panel_dns_urls() as $i => $url) {
        $list[] = ['id' => (string)($i + 1), 'name' => t('Servidor {n}', ['n' => $i + 1]), 'url' => rtrim($url, '/')];
    }
    return $list;
}

/* ------------------------------------------------------------------ */
/* Caché en disco                                                      */
/* ------------------------------------------------------------------ */

function wp_cache_dir($sub = '')
{
    static $base = null;
    if ($base === null) {
        $base = WP_ROOT . '/includes/cache';
        if (!is_dir($base)) @mkdir($base, 0775, true);
        if (!is_dir($base) || !is_writable($base)) {
            $base = rtrim(sys_get_temp_dir(), '/') . '/wp_cache_' . substr(md5(WP_ROOT), 0, 8);
            if (!is_dir($base)) @mkdir($base, 0700, true);
        }
    }
    $dir = $sub ? $base . '/' . $sub : $base;
    if ($sub && !is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}

function wp_cache_get($key, $ttl, &$stale = null)
{
    $file = wp_cache_dir('data') . '/' . md5($key) . '.json';
    $stale = null;
    if (!is_file($file)) return null;
    $age = time() - (int)@filemtime($file);
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') return null;
    $data = json_decode($raw, true);
    if ($data === null && $raw !== 'null') return null;
    if ($age <= $ttl) return $data;
    $stale = $data;
    return null;
}

function wp_cache_set($key, $data)
{
    // modo navegador: esta página espera datos del navegador y no se va a mostrar (sale «Cargando…»): lo que calculó
    // con datos vacíos no se guarda (si no, quedaría vacío hasta que venza)
    if (function_exists('wp_xt_blocking') && wp_xt_blocking() && strpos($key, 'xtneed|') !== 0 && strpos($key, 'xtbg|') !== 0) return;
    $file = wp_cache_dir('data') . '/' . md5($key) . '.json';
    $tmp = $file . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) !== false) {
        @rename($tmp, $file);
    }
    if (mt_rand(1, 500) === 1) {
        // limpieza ocasional de la caché vieja
        foreach ((array)glob(wp_cache_dir('data') . '/*') as $old) {
            if (@filemtime($old) < time() - 10 * 86400) @unlink($old);
        }
    }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function wp_curl($url, $timeout = 12)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_CONNECTTIMEOUT => min(6, $timeout),
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => WP_UA,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_ENCODING => '',
    ]);
    wp_doh_apply($ch, $url);
    return $ch;
}

function wp_http_get($url, $timeout = 12, &$code = null)
{
    $ch = wp_curl($url, $timeout);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch);
    curl_close($ch);
    if ($err || $body === false) return null;
    return $body;
}

/** El servidor real detrás de una DNS (inicio de sesión): esquema + IP + puerto. Dos DNS con otro nombre y la misma IP y
 * puerto son el mismo XUI: se le pregunta una sola vez (cada pregunta con datos equivocados es un intento fallido para
 * su protección contra flood, y todos los usuarios de la web salen con la IP del hosting). */
function wp_login_endpoint($url)
{
    $p = parse_url((string)$url);
    $scheme = strtolower((string)($p['scheme'] ?? 'http'));
    $host = strtolower((string)($p['host'] ?? ''));
    $port = (int)($p['port'] ?? ($scheme === 'https' ? 443 : 80));
    $ip = wp_resolve_ip($host);
    return $scheme . '://' . ($ip !== '' ? $ip : $host) . ':' . $port . rtrim((string)($p['path'] ?? ''), '/');
}

/**
 * Varias peticiones en paralelo. $urls = [key => url]. Devuelve [key => body|null].
 * $stopWhen(key, body) puede devolver true para cortar el resto (p. ej. login encontrado).
 */
// $fails (opcional): [key => motivo] de los que no dieron respuesta (error de conexión o código HTTP), para el reporte
function wp_http_multi(array $urls, $timeout = 12, $stopWhen = null, &$fails = null)
{
    $fails = [];
    $out = array_fill_keys(array_keys($urls), null);
    if (!$urls) return $out;
    $mh = curl_multi_init();
    $handles = [];
    foreach ($urls as $k => $u) {
        $ch = wp_curl($u, $timeout);
        curl_multi_add_handle($mh, $ch);
        $handles[(int)$ch] = [$k, $ch];
    }
    $stop = false;
    do {
        $status = curl_multi_exec($mh, $running);
        while ($info = curl_multi_info_read($mh)) {
            $ch = $info['handle'];
            list($k) = $handles[(int)$ch];
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $body = curl_multi_getcontent($ch);
            if ($info['result'] !== CURLE_OK) {
                $fails[$k] = 'curl ' . $info['result'] . ' ' . curl_error($ch);
            } elseif ($code < 200 || $code >= 400 || $body === '') {
                $fails[$k] = 'HTTP ' . $code . ($body === '' ? ' vacío' : '');
            }
            if ($info['result'] === CURLE_OK && $code >= 200 && $code < 400 && $body !== '') {
                $out[$k] = $body;
                if ($stopWhen && $stopWhen($k, $body)) {
                    $stop = true;
                }
            }
        }
        if ($stop) break;
        if ($running) curl_multi_select($mh, 0.2);
    } while ($running && $status === CURLM_OK);
    foreach ($handles as $h) {
        curl_multi_remove_handle($mh, $h[1]);
        curl_close($h[1]);
    }
    curl_multi_close($mh);
    return $out;
}

/* ------------------------------------------------------------------ */
/* Xtream API                                                          */
/* ------------------------------------------------------------------ */

function wp_user()
{
    global $username, $password, $get_dns;
    return [
        'server' => rtrim((string)($get_dns ?? ($_SESSION['server'] ?? '')), '/'),
        'username' => (string)($username ?? ($_SESSION['username'] ?? '')),
        'password' => (string)($password ?? ($_SESSION['password'] ?? '')),
    ];
}

function xt_url($action = null, array $params = [])
{
    $u = wp_user();
    $url = $u['server'] . '/player_api.php?username=' . urlencode($u['username']) . '&password=' . urlencode($u['password']);
    if ($action) $url .= '&action=' . urlencode($action);
    if ($params) $url .= '&' . http_build_query($params);
    return $url;
}

function xt_cache_key($action, array $params)
{
    $u = wp_user();
    // con una huella de la contraseña: en el modo navegador (includes/xt_client.php) la web guarda lo que trae el
    // navegador, y alguien con una contraseña inventada nunca llena la caché de la línea de otro
    return 'xt|' . $u['server'] . '|' . $u['username'] . '|' . substr(sha1('wpx|' . $u['password']), 0, 10) . '|' . $action . '|' . http_build_query($params);
}

/**
 * Llamada a la API con caché. Si el servidor falla se usa la última copia guardada. Con un perfil infantil
 * (includes/kids.php) los canales en vivo llegan ya filtrados (la caché guarda siempre la respuesta completa).
 */
function xt_get($action, array $params = [], $ttl = 600, $timeout = 15)
{
    $data = xt_get_raw($action, $params, $ttl, $timeout);
    if ($action === 'get_live_streams' && is_array($data) && function_exists('wp_kids_on') && wp_kids_on()) return wp_kids_live_filter($data);
    return $data;
}

function xt_get_raw($action, array $params = [], $ttl = 600, $timeout = 15)
{
    static $memo = [];
    $key = xt_cache_key($action, $params);
    if (isset($memo[$key])) return $memo[$key];
    $data = wp_cache_get($key, $ttl, $stale);
    if ($data !== null) return $memo[$key] = $data;
    // modo navegador (includes/xt_client.php): el hosting nunca le pide al servidor IPTV. Lo vencido se usa y el
    // navegador lo renueva después; lo que falta se le pide al navegador antes de mostrar la página
    if (wp_xt_client()) {
        if (is_array($stale)) {
            wp_xt_need($action, $params, false);
            return $memo[$key] = $stale;
        }
        // catálogo completo en una página que se muestra por partes (wp_xt_soft): la página sale ya y el navegador lo
        // trae por detrás; las filas (api.php) sí lo esperan, cada una por su lado
        if (!$params && ($action === 'get_vod_streams' || $action === 'get_series') && wp_xt_soft()) {
            wp_xt_need($action, $params, false);
            return $memo[$key] = [];
        }
        wp_xt_need($action, $params, true);
        return $memo[$key] = [];
    }
    // los catálogos grandes vencidos se usan ya y se renuevan después de contestar (includes/catalog_fast.php): antes
    // cada 30 min una página esperaba que el hosting bajara el catálogo entero del servidor IPTV
    if (is_array($stale) && $stale && wp_xt_refresh_later($action, $params, $timeout)) return $memo[$key] = $stale;
    // Bloqueo: si otra petición ya está descargando lo mismo, se espera y se reutiliza
    $lock = @fopen(wp_cache_dir('data') . '/' . md5($key) . '.lock', 'c');
    if ($lock) {
        @flock($lock, LOCK_EX);
        $data = wp_cache_get($key, $ttl, $stale);
        if ($data !== null) {
            @flock($lock, LOCK_UN);
            @fclose($lock);
            return $memo[$key] = $data;
        }
    }
    $body = wp_http_get(xt_url($action, $params), $timeout, $code);
    $json = $body !== null ? json_decode($body, true) : null;
    if (is_array($json)) wp_cache_set($key, $json);
    if ($lock) {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
    if (is_array($json)) return $memo[$key] = $json;
    return $memo[$key] = (is_array($stale) ? $stale : []);
}

/** Varias llamadas en paralelo con caché. $reqs = [key => [action, params]] */
/** Varios pedidos al servidor IPTV a la vez. En el modo navegador lo que falta lo trae el navegador: con $wait la página
 *  lo espera («Cargando…» / {"xtneed"}); sin $wait se usa lo que ya está y lo demás se trae por detrás. */
function xt_multi(array $reqs, $ttl = 86400, $timeout = 10, $wait = true)
{
    $out = [];
    $missing = [];
    $stales = [];
    foreach ($reqs as $k => $r) {
        $ck = xt_cache_key($r[0], $r[1]);
        $data = wp_cache_get($ck, $ttl, $stale);
        if ($data !== null) {
            $out[$k] = $data;
        } elseif (wp_xt_client()) {
            // modo navegador: lo trae el navegador (includes/xt_client.php)
            wp_xt_need($r[0], $r[1], $wait && !is_array($stale));
            $out[$k] = is_array($stale) ? $stale : [];
        } else {
            $missing[$k] = xt_url($r[0], $r[1]);
            $stales[$k] = $stale;
        }
    }
    if ($missing) {
        $res = wp_http_multi($missing, $timeout);
        foreach ($res as $k => $body) {
            $json = $body !== null ? json_decode($body, true) : null;
            if (is_array($json)) {
                wp_cache_set(xt_cache_key($reqs[$k][0], $reqs[$k][1]), $json);
                $out[$k] = $json;
            } else {
                $out[$k] = is_array($stales[$k]) ? $stales[$k] : [];
            }
        }
    }
    return $out;
}

function wp_stream_url($kind, $id, $ext)
{
    $u = wp_user();
    $ext = preg_replace('/[^a-z0-9]/i', '', (string)$ext) ?: 'mp4';
    return $u['server'] . '/' . $kind . '/' . rawurlencode($u['username']) . '/' . rawurlencode($u['password']) . '/' . rawurlencode((string)$id) . '.' . $ext;
}

/* ------------------------------------------------------------------ */
/* Firmas / proxy                                                      */
/* ------------------------------------------------------------------ */

function wp_secret()
{
    static $s = null;
    if ($s !== null) return $s;
    $file = wp_cache_dir() . '/.key.php';
    if (is_file($file)) {
        $raw = (string)@file_get_contents($file);
        if (preg_match('/([a-f0-9]{64})/', $raw, $m)) return $s = $m[1];
    }
    $s = bin2hex(random_bytes(32));
    if (@file_put_contents($file, "<?php exit; ?>\n" . $s) === false || !is_file($file)) {
        // no se pudo guardar (disco lleno o carpeta sin permiso): una clave fija sacada de la llave del panel. Una al azar
        // cambiaría en cada página y img.php rechazaría la firma de todos los logos de canales (2.9.11)
        $mk = function_exists('wp_panel_config') ? trim((string)(wp_panel_config()['master_key_hex'] ?? '')) : '';
        $s = hash_hmac('sha256', 'wp-secret-v1|' . WP_ROOT, $mk !== '' ? $mk : php_uname('n') . '|' . __FILE__);
    }
    return $s;
}

function wp_b64u_enc($s)
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function wp_b64u_dec($s)
{
    return base64_decode(strtr($s, '-_', '+/'));
}

function wp_sign($url)
{
    return substr(hash_hmac('sha256', $url, wp_secret()), 0, 32);
}

/**
 * Enlace firmado hacia img.php (imágenes; el video nunca pasa por el hosting).
 * La firma caduca (WP_SIGN_TTL) y no depende de cookies: el reproductor nativo
 * del iPhone (AVPlayer) a veces pide el video sin enviar la cookie de sesión.
 */
function wp_proxy_url($url, $script = 'proxy.php')
{
    if ($script !== 'img.php') {
        $exp = (int)(ceil((time() + WP_SIGN_TTL) / 600) * 600); // redondeado: el navegador puede reutilizar caché
        return $script . '?u=' . wp_b64u_enc($url) . '&e=' . $exp . '&s=' . wp_sign($url . '|' . $exp);
    }
    return $script . '?u=' . wp_b64u_enc($url) . '&s=' . wp_sign($url);
}

function wp_verify_signed(&$url)
{
    $u = isset($_GET['u']) ? wp_b64u_dec((string)$_GET['u']) : '';
    $s = isset($_GET['s']) ? (string)$_GET['s'] : '';
    if (!$u || !$s || !preg_match('~^https?://~i', $u)) return false;
    if (isset($_GET['e'])) {
        $exp = (int)$_GET['e'];
        if ($exp < time() || !hash_equals(wp_sign($u . '|' . $exp), $s)) return false;
    } elseif (!hash_equals(wp_sign($u), $s)) {
        return false;
    }
    $url = $u;
    return true;
}

/**
 * Base https del servidor IPTV, p. ej. https://host o https://host:25463
 * - Si la DNS ya es https, se usa tal cual.
 * - Si no, se usa server_info.https_port (o el 443) del servidor IPTV.
 * El video siempre va directo del servidor IPTV al navegador: nunca pasa por el hosting.
 */
function wp_server_https_base()
{
    static $memo = false;
    if ($memo !== false) return $memo;
    $u = wp_user();
    $p = parse_url((string)$u['server']);
    if (!$p || empty($p['host'])) return $memo = null;
    if (strtolower($p['scheme'] ?? '') === 'https') return $memo = rtrim($u['server'], '/');
    $info = xt_get(null, [], 21600, 8);
    $si = is_array($info['server_info'] ?? null) ? $info['server_info'] : [];
    $hp = (int)($si['https_port'] ?? 0);
    if ($hp <= 0) $hp = 443;
    return $memo = 'https://' . $p['host'] . ($hp === 443 ? '' : ':' . $hp);
}

/** URL del contenido para el navegador: https cuando la página es https (evita contenido mixto). */
function wp_client_stream_url($kind, $id, $ext)
{
    $u = wp_stream_url($kind, $id, $ext);
    if (!wp_is_https() || stripos($u, 'https://') === 0) return $u;
    $hb = wp_server_https_base();
    return $hb ? $hb . substr($u, strlen(rtrim(wp_user()['server'], '/'))) : $u;
}

/**
 * Fuentes de reproducción en orden de prueba para NFPlayer.
 * $exts = extensiones a probar (p. ej. ['mp4','mkv','m3u8']).
 *
 * El video nunca pasa por el hosting (2.9.1). Página http (o video https): el navegador lo lee directo del servidor
 * IPTV y, en películas y episodios, la VPS / VDS de la línea queda de respaldo (con varios audios, el motor MP4 del
 * reproductor elige el idioma con ella). Página https y video http (el navegador lo bloquearía): la VPS / VDS de la
 * línea lo entrega por https; sin máquina, la página abre el reproductor por http (play.php, también directo).
 */
function wp_play_sources($kind, $id, array $exts)
{
    $out = [];
    $extra = [];
    $https = wp_is_https();
    // el video nunca pasa por este hosting (2.9.1): directo del servidor IPTV o por la VPS / VDS de la línea
    $multi = null;
    foreach ($exts as $x) {
        $engine = $x === 'm3u8' ? 'hls' : ($x === 'ts' ? 'mpegts' : 'native');
        $u = wp_stream_url($kind, $id, $x);
        if ($https && wp_via_hosting($u)) {
            // web en https y video http: la VPS / VDS de la línea lo entrega por https (servidor IPTV → VPS / VDS →
            // navegador, con permiso CORS; nunca por el hosting ni por Cloudflare). Si no hay máquina: play.php por http
            // (wp_needs_handoff), que también va directo del servidor IPTV
            $vr = wp_vps_relay($u);
            if ($vr !== '') $out[] = ['url' => $vr, 'engine' => $engine, 'ext' => $x, 'cors' => true, 'relay' => 1];
            continue;
        }
        if ($multi === null) $multi = wp_content_multi_audio($kind, $id, $exts, true) === true;
        $vod = $kind !== 'live' && $engine === 'native';
        // el servidor IPTV entrega por https y con permiso CORS: el navegador elige el idioma solo,
        // directo del servidor IPTV. No se agrega nada por el hosting.
        if ($vod && wp_direct_cors($u)) {
            $d = ['url' => $u, 'engine' => $engine, 'ext' => $x, 'cors' => true];
            if (!$multi) $d['alt'] = 1;
            $out[] = $d;
            continue;
        }
        $out[] = ['url' => $u, 'engine' => $engine, 'ext' => $x];
        if ($vod) {
            // fuente de respaldo por la VPS / VDS de la línea (antes era el hosting). Si ya se sabe que trae varios
            // audios, el motor MP4 arranca con ella. Si no (alt), solo se usa cuando el navegador descubre varios audios
            // (iPhone) o si lo directo falla. Sin máquina, no hay respaldo: nunca el hosting.
            $vr = wp_vps_relay($u);
            if ($vr !== '') {
                $p = ['url' => $vr, 'engine' => $engine, 'ext' => $x, 'cors' => true, 'relay' => 1];
                if (!$multi) $p['alt'] = 1;
                $extra[] = $p;
            }
        }
    }
    return array_merge($out, $extra);
}

/**
 * Enlace https del video por la VPS / VDS de la línea (api/media_web.php?do=link del panel): la VDS propia del
 * distribuidor si la eligió, si no la del dueño; nunca un hosting ni Cloudflare. '' si no hay máquina (o no tiene
 * https y la web sí). Caché 5 h por contenido (el enlace firmado vale 6 h); si no hay máquina, 2 min sin preguntar.
 */
function wp_vps_relay($url)
{
    static $memo = [];
    $ck = 'vrelay|' . md5($url);
    if (isset($memo[$ck])) return $memo[$ck];
    $hit = wp_cache_get($ck, 5 * 3600);
    if (is_string($hit) && $hit !== '') return $memo[$ck] = $hit;
    $no = wp_panel_ck('vrelay_no');
    if (wp_cache_get($no, 120)) return $memo[$ck] = '';
    if (!wp_panel_ready() || wp_panel_base() === '') return $memo[$ck] = '';
    $tok = function_exists('wp_panel_tok') ? wp_panel_tok() : wp_panel_token();
    $link = '';
    if ($tok !== '') {
        $res = wp_panel_request('media_web.php?do=link&token=' . rawurlencode($tok) . '&u=' . wp_b64u_enc($url), null, [], 5, $code);
        $j = is_string($res) ? json_decode($res, true) : null;
        $link = is_array($j) && is_string($j['url'] ?? null) && preg_match('~^https?://~i', $j['url']) ? $j['url'] : '';
        // la página es https: un enlace http de la máquina lo bloquearía el navegador
        if ($link !== '' && wp_is_https() && stripos($link, 'https://') !== 0) $link = '';
    }
    if ($link === '') { wp_cache_set($no, 1); return $memo[$ck] = ''; }
    wp_cache_set($ck, $link);
    return $memo[$ck] = $link;
}

/** Código, destino final y cabecera (de la última respuesta) de una petición, sin descargar el cuerpo. */
function wp_cors_head($url, $method, array $hdrs, $follow)
{
    $h = [];
    $ch = curl_init($url);
    wp_doh_apply($ch, $url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_FOLLOWLOCATION => $follow, CURLOPT_MAXREDIRS => 8,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_USERAGENT => WP_UA, CURLOPT_HTTPHEADER => $hdrs, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADERFUNCTION => function ($c, $l) use (&$h) {
            if (stripos($l, 'HTTP/') === 0) $h = []; // cada redirección trae sus propias cabeceras: vale la última
            elseif (($p = strpos($l, ':')) !== false) $h[strtolower(trim(substr($l, 0, $p)))] = trim(substr($l, $p + 1));
            return strlen($l);
        },
        CURLOPT_WRITEFUNCTION => function ($c, $d) { return -1; }, // basta con las cabeceras
    ]);
    curl_exec($ch);
    $r = ['code' => (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'final' => (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL), 'h' => $h];
    curl_close($ch);
    return $r;
}

/** ¿El contenido se reproduce directo del servidor IPTV (sin pasar todo por el hosting)? */
function wp_content_direct($kind, $id, array $exts)
{
    $u = wp_tracks_target($kind, $id, $exts);
    return $u !== '' && (!wp_is_https() || !wp_via_hosting($u));
}

/**
 * ¿El servidor IPTV entrega este video por https y con permiso CORS para esta web?
 * Con eso el navegador puede separar los idiomas por su cuenta y el hosting no trabaja.
 * Se detecta solo: el día que el proveedor lo active, se usa sin cambiar nada (caché 6 h por servidor).
 */
function wp_direct_cors($url)
{
    static $memo = [];
    $url = (string)$url;
    if (stripos($url, 'https://') !== 0) return false; // la DNS del proveedor es http: no hay nada que probar
    $p = parse_url($url);
    $seg = preg_match('~^/([^/]+)/~', (string)($p['path'] ?? ''), $m) ? strtolower($m[1]) : '';
    $origin = (wp_is_https() ? 'https://' : 'http://') . (string)($_SERVER['HTTP_HOST'] ?? '');
    $ck = 'dcors|' . strtolower((string)($p['host'] ?? '')) . ':' . ($p['port'] ?? '') . '|' . $seg . '|' . strtolower(pathinfo((string)($p['path'] ?? ''), PATHINFO_EXTENSION)) . '|' . $origin;
    if (isset($memo[$ck])) return $memo[$ck];
    $hit = wp_cache_get($ck, 21600);
    if (is_array($hit)) return $memo[$ck] = !empty($hit['ok']);
    $allow = function ($h) use ($origin) { $v = rtrim((string)($h['access-control-allow-origin'] ?? ''), '/'); return $v === '*' || strcasecmp($v, $origin) === 0; };
    $lists = function ($h, $k, $want) { $v = strtolower((string)($h[$k] ?? '')); return $v === '*' || in_array($want, array_map('trim', explode(',', $v)), true); };
    // 1) el video (con redirecciones): destino https, permiso para esta web y el tamaño visible (Content-Range)
    $g = wp_cors_head($url, 'GET', ['Range: bytes=0-1', 'Origin: ' . $origin], true);
    $ok = $g['code'] >= 200 && $g['code'] < 300 && stripos($g['final'], 'https://') === 0 && $allow($g['h'])
        && $lists($g['h'], 'access-control-expose-headers', 'content-range');
    // tras una redirección a otro servidor el navegador manda Origin "null": solo sirve el permiso "*"
    if ($ok && strcasecmp((string)parse_url($g['final'], PHP_URL_HOST), (string)($p['host'] ?? '')) !== 0) $ok = ($g['h']['access-control-allow-origin'] ?? '') === '*';
    // 2) el permiso previo que pide el navegador por la cabecera Range (sin redirecciones, como el navegador)
    if ($ok) {
        $o = wp_cors_head($url, 'OPTIONS', ['Origin: ' . $origin, 'Access-Control-Request-Method: GET', 'Access-Control-Request-Headers: range'], false);
        $ok = $o['code'] >= 200 && $o['code'] < 300 && $allow($o['h']) && $lists($o['h'], 'access-control-allow-headers', 'range');
    }
    wp_cache_set($ck, ['ok' => $ok]);
    return $memo[$ck] = $ok;
}

/**
 * ¿El contenido (película o episodio) trae más de una pista de audio? Se lee la cabecera del archivo, sin ffmpeg.
 * $cacheOnly: solo lo ya averiguado (true/false) o null si aún no se sabe; así la página no espera al servidor IPTV.
 */
function wp_content_multi_audio($kind, $id, array $exts, $cacheOnly = false)
{
    $u = wp_tracks_target($kind, $id, $exts);
    if ($u === '') return false;
    $n = wp_audio_track_count($u, $cacheOnly, false, wp_tracks_panel_url($kind, $id, $exts));
    if ($n <= 0) return $cacheOnly ? null : false; // 0 = no se pudo leer: sigue siendo desconocido
    return $n > 1;
}

/** Enlace del archivo cuyas pistas se cuentan (la primera extensión que no es m3u8/ts). */
function wp_tracks_target($kind, $id, array $exts)
{
    if ($kind === 'live') return '';
    foreach ($exts as $x) {
        if (!in_array($x, ['m3u8', 'ts'], true)) return wp_stream_url($kind, $id, $x);
    }
    return '';
}

/**
 * La ficha pide los idiomas apenas se abre (como Roku, Vega y LG): solo se le pregunta al panel (tracks.php&warm=1,
 * sin tocar el servidor IPTV), así al pulsar Reproducir el reproductor ya sabe los idiomas y arranca con el elegido.
 */
function wp_tracks_warm_url($kind, $id, $ext)
{
    $ext = strtolower(preg_replace('/[^a-z0-9]/i', '', (string)$ext)) ?: 'mp4';
    $read = in_array($ext, ['mkv', 'avi', 'mov', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', 'divx', 'xvid', '3gp'], true) ? 'mp4' : $ext;
    return wp_proxy_url(wp_stream_url($kind, $id, $read), 'tracks.php') . '&x=' . rawurlencode($ext) . '&warm=1';
}

/** <script> que pide los idiomas en segundo plano al abrir la ficha */
function wp_tracks_warm_script($url)
{
    if ($url === '') return '';
    return '<script>(window.requestIdleCallback||setTimeout)(function(){try{fetch(' . json_encode($url, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP)
        . ',{credentials:"same-origin"}).catch(function(){})}catch(e){}});</script>';
}

/** Enlace del contenido con su extensión real (la última que no es m3u8/ts): así lo identifican el panel y las apps. */
function wp_tracks_panel_url($kind, $id, array $exts)
{
    if ($kind === 'live') return '';
    $real = '';
    foreach ($exts as $x) if (!in_array($x, ['m3u8', 'ts'], true)) $real = $x;
    return $real === '' ? '' : wp_stream_url($kind, $id, $real);
}

/**
 * ¿Este enlace pasa por el hosting? Solo si el servidor IPTV lo entrega por http.
 * El día que la DNS del servidor IPTV sea https, todo va directo y el hosting queda libre.
 */
function wp_via_hosting($url)
{
    $url = (string)$url;
    if (stripos($url, 'https://') !== 0) return true;
    // la DNS es https pero muchos servidores IPTV redirigen el video a otro servidor por http
    // (p. ej. https://dns → http://IP): el navegador lo bloquearía, así que también pasa por el hosting.
    return wp_final_is_http($url);
}

/** ¿El enlace https termina, tras las redirecciones, en http? Se prueba una vez por servidor y tipo (caché 6 h). */
function wp_final_is_http($url)
{
    static $memo = [];
    $p = parse_url($url);
    $seg = preg_match('~^/([^/]+)/~', (string)($p['path'] ?? ''), $m) ? strtolower($m[1]) : '';
    $ck = 'finalhttp|' . strtolower((string)($p['host'] ?? '')) . ':' . ($p['port'] ?? '') . '|' . $seg . '|' . strtolower(pathinfo((string)($p['path'] ?? ''), PATHINFO_EXTENSION));
    if (isset($memo[$ck])) return $memo[$ck];
    $hit = wp_cache_get($ck, 21600);
    if (is_array($hit)) return $memo[$ck] = !empty($hit['http']);
    $ch = curl_init($url);
    wp_doh_apply($ch, $url);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 8, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_USERAGENT => WP_UA,
        CURLOPT_HTTPHEADER => ['Range: bytes=0-1'], CURLOPT_RETURNTRANSFER => true,
        CURLOPT_WRITEFUNCTION => function ($c, $d) { $k = (int)curl_getinfo($c, CURLINFO_RESPONSE_CODE); return $k >= 200 && $k < 300 ? -1 : strlen($d); }, // se corta al llegar el video
    ]);
    curl_exec($ch);
    $final = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    // sin respuesta no se sabe: se usa el hosting (siempre funciona) y se vuelve a probar en 6 h
    $http = $code === 0 || stripos($final, 'https://') !== 0;
    wp_cache_set($ck, ['http' => $http]);
    return $memo[$ck] = $http;
}

/**
 * Relay de Cloudflare de versiones anteriores: ya no se usa para reproducir (el video de la web en https va por la
 * VPS / VDS de la línea, wp_vps_relay). Solo lo muestra el diagnóstico si quedó includes/https_relay.php.
 */
function wp_https_relay()
{
    static $r = null;
    if ($r !== null) return $r;
    $f = __DIR__ . '/https_relay.php';
    $v = is_file($f) ? (include $f) : '';
    $v = is_string($v) ? rtrim(trim($v), '/') : '';
    return $r = preg_match('~^https://[a-z0-9.-]+(:\d+)?(/[^\s]*)?$~i', $v) ? $v : '';
}

/** http://host:puerto/ruta → https://relay/http/host:puerto/ruta (las rutas relativas de HLS siguen funcionando) */
function wp_relay_url($url)
{
    $relay = wp_https_relay();
    $p = parse_url($url);
    if ($relay === '' || !$p || empty($p['host'])) return $url;
    $hp = $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    return $relay . '/' . strtolower($p['scheme'] ?? 'http') . '/' . $hp . ($p['path'] ?? '/') . (isset($p['query']) ? '?' . $p['query'] : '');
}

/** URL de imagen segura: en sitios HTTPS las imágenes http pasan por img.php (evita contenido mixto). */
function wp_img($url, $fallback = WP_NOIMG)
{
    $url = trim((string)$url);
    if ($url === '' || !preg_match('~^https?://~i', $url) || $url === 'https://image.tmdb.org/t/p/w600_and_h900_bestv2') {
        return $fallback;
    }
    // por el puente del Worker de Cloudflare (no por el hosting): includes/xt_relay.php
    $r = wp_xt_relay_img($url);
    if ($r !== '') return $r;
    if (wp_is_https() && stripos($url, 'http://') === 0) {
        return wp_proxy_url($url, 'img.php');
    }
    return $url;
}

/**
 * Logo de canal: siempre pasa por img.php (caché 7 días). Así cargan también los logos
 * de servidores que bloquean el enlace directo, con certificado vencido o en http.
 * Si el logo no existe o falla, se muestra el de la marca (wp_channel_fallback: el del dueño solo con Omitir).
 */
function wp_logo($url)
{
    $url = trim((string)$url);
    if ($url === '' || !preg_match('~^https?://[^/\s]+~i', $url)) return wp_channel_fallback();
    return wp_proxy_url($url, 'img.php') . '&fb=1';
}

/**
 * Direcciones del logo de un canal, en orden; la página pasa a la siguiente si una no carga y, si no carga ninguna,
 * pone el logo de la marca (wp_channel_fallback). Antes todo dependía de img.php del hosting: si el servidor IPTV (o el
 * sitio de los logos) bloquea la IP del hosting —el mismo motivo del modo navegador— o el hosting no puede guardar en su
 * caché, todos los canales quedaban con el logo de la marca. Ahora (2.9.10 / 2.9.11), como en las apps de TV:
 *   1. directo desde el navegador, con la IP del cliente (logo https, o la web en http)
 *   2. el puente del Worker de Cloudflare (logo http con la web en https; no para servidores con IP)
 *   3. img.php del hosting (&fb=2: si no puede, 404 y la página sigue)
 *   4. la caché de imágenes del panel (otra IP; logos de 80 px o más)
 *   5. la misma dirección por https, desde el navegador (logo http con la web en https)
 */
function wp_logo_sources($url)
{
    $url = trim((string)$url);
    if ($url === '' || !preg_match('~^https?://[^/\s]+~i', $url)) return [wp_channel_fallback()];
    $enc = preg_replace_callback('/[^\x21-\x7e]/', function ($m) { return rawurlencode($m[0]); }, $url);
    $page = wp_is_https();
    $isHttps = stripos($url, 'https://') === 0;
    $out = [];
    if ($isHttps || !$page) $out[] = $enc;
    $r = function_exists('wp_xt_relay_img') ? wp_xt_relay_img($url) : '';
    if ($r !== '') $out[] = $r;
    $out[] = wp_proxy_url($url, 'img.php') . '&fb=2';
    $p = wp_panel_logo_url($url);
    if ($p !== '') $out[] = $p;
    if (!$isHttps && $page) $out[] = preg_replace('~^http://~i', 'https://', $enc);
    return array_values(array_unique($out));
}

/** El logo por img.php del panel (lo baja el panel desde su IP y lo guarda para todas las apps), o ''. */
function wp_panel_logo_url($url)
{
    if (!function_exists('wp_panel_img_base') || !function_exists('wp_panel_token')) return '';
    $b = wp_panel_img_base();
    $tok = $b !== '' ? wp_panel_token() : '';
    return $tok === '' ? '' : $b . 'img.php?w=200&token=' . rawurlencode($tok) . '&u=' . wp_b64u_enc($url);
}

/* ------------------------------------------------------------------ */
/* Catálogo ligero + filtros inteligentes                              */
/* ------------------------------------------------------------------ */

function wp_norm($s)
{
    $s = mb_strtolower((string)$s, 'UTF-8');
    $s = strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n', 'à' => 'a', 'è' => 'e', 'ì' => 'i', 'ò' => 'o', 'ù' => 'u', 'ç' => 'c', 'â' => 'a', 'ê' => 'e', 'ô' => 'o']);
    return $s;
}

function wp_norm_title($s)
{
    $s = wp_norm($s);
    $s = preg_replace('/\[[^\]]*\]|\([^)]*\)|\b(19|20)\d{2}\b/u', ' ', $s);
    $s = preg_replace('/\b(4k|uhd|fhd|hd|sd|lat|latino|cast|castellano|sub|subt|subtitulado|dual|multi|es|en|vose|1080p|720p)\b/u', ' ', $s);
    $s = preg_replace('/[^a-z0-9]+/u', '', $s);
    return $s;
}

function wp_platforms()
{
    // el distribuidor no separa su contenido por plataformas: sin filas, tiles ni filtros de plataforma
    if (function_exists('wp_tenant_feature') && !wp_tenant_feature('platforms')) return [];
    return [
        'netflix' => ['label' => 'Netflix', 'img' => 'img/netflix.webp', 'kw' => ['netflix'], 'color' => '#e50914'],
        'disney' => ['label' => 'Disney+', 'img' => 'img/DisneY.webp', 'kw' => ['disney', 'pixar', 'star+', 'star plus'], 'color' => '#113ccf'],
        'max' => ['label' => 'HBO Max', 'img' => 'img/MAx.webp', 'kw' => ['hbo', '/\bmax\b/'], 'color' => '#5822b4'],
        'prime' => ['label' => 'Prime Video', 'img' => 'img/prime.webp', 'kw' => ['amazon', 'prime'], 'color' => '#00a8e1'],
        'marvel' => ['label' => 'Marvel', 'img' => 'img/marvel.webp', 'kw' => ['marvel', '/\bmcu\b/'], 'color' => '#ec1d24'],
        'apple' => ['label' => 'Apple TV+', 'img' => 'img/appletv.webp', 'kw' => ['apple'], 'color' => '#555'],
        'paramount' => ['label' => 'Paramount+', 'img' => 'img/paramount.webp', 'kw' => ['paramount'], 'color' => '#0064ff'],
        'dc' => ['label' => 'DC', 'img' => 'img/dc.webp', 'kw' => ['/\bdc\b/', 'dc comics'], 'color' => '#0476f2'],
        'xmas' => ['label' => t('Navidad'), 'img' => 'img/xmas.webp', 'kw' => ['navidad', 'navide', 'christmas', 'xmas'], 'color' => '#1f7a3a'],
        'halloween' => ['label' => 'Halloween', 'img' => 'img/halloween.webp', 'kw' => ['halloween', 'terror', 'horror'], 'color' => '#ff6a00'],
    ];
}

function wp_genres()
{
    return [
        'accion' => ['label' => t('Acción'), 'kw' => ['accion', 'action', 'artes marciales']],
        'suspenso' => ['label' => t('Suspenso'), 'kw' => ['suspenso', 'suspense', 'thriller', 'misterio', 'mystery', 'intriga']],
        'aventura' => ['label' => t('Aventura'), 'kw' => ['aventura', 'adventure']],
        'anime' => ['label' => 'Anime', 'kw' => ['anime', 'crunchyroll', 'otaku']],
        'drama' => ['label' => 'Drama', 'kw' => ['drama']],
        'comedia' => ['label' => t('Comedia'), 'kw' => ['comedia', 'comedy', 'humor']],
        'terror' => ['label' => t('Terror'), 'kw' => ['terror', 'horror', 'miedo']],
        'scifi' => ['label' => t('Ciencia ficción'), 'kw' => ['ciencia ficcion', 'sci-fi', 'scifi', 'science fiction', 'ficcion']],
        'fantasia' => ['label' => t('Fantasía'), 'kw' => ['fantasia', 'fantasy']],
        'romance' => ['label' => 'Romance', 'kw' => ['romance', 'romantic', 'romantica', 'romantico', 'amor']],
        'crimen' => ['label' => t('Crimen'), 'kw' => ['crimen', 'crime', 'policia', 'policiaco', 'mafia']],
        'animacion' => ['label' => t('Animación'), 'kw' => ['animacion', 'animation', 'animada', 'animado', 'cartoon', 'dibujos']],
        'infantil' => ['label' => t('Infantil y familia'), 'kw' => ['infantil', 'kids', 'ninos', 'familia', 'family', 'familiar']],
        'documental' => ['label' => t('Documentales'), 'kw' => ['documental', 'documentary', 'docu']],
        'belica' => ['label' => t('Bélicas'), 'kw' => ['belica', 'belico', 'guerra', 'war']],
        'dorama' => ['label' => t('Doramas'), 'kw' => ['dorama', 'k-drama', 'kdrama', 'corea', 'korean', 'asiatic']],
        'novela' => ['label' => t('Novelas'), 'kw' => ['novela', 'telenovela']],
        'western' => ['label' => 'Western', 'kw' => ['western', 'vaquer', 'oeste']],
        'musical' => ['label' => t('Música'), 'kw' => ['musical', 'music', 'musica', 'concierto']],
        'deportes' => ['label' => t('Deportes'), 'kw' => ['deporte', 'sport', 'futbol']],
    ];
}

function wp_kw_match($text, array $keywords)
{
    $t = wp_norm($text);
    foreach ($keywords as $kw) {
        if ($kw !== '' && $kw[0] === '/') {
            if (preg_match($kw . 'u', $t)) return true;
        } elseif (strpos($t, $kw) !== false) {
            return true;
        }
    }
    return false;
}

/** Categorías de películas, series o en vivo (con un perfil infantil, solo las que tienen algo para niños). */
function wp_categories($type)
{
    $cats = wp_categories_raw($type);
    return function_exists('wp_kids_on') && wp_kids_on() ? wp_kids_categories($type, $cats) : $cats;
}

function wp_categories_raw($type)
{
    $action = $type === 'series' ? 'get_series_categories' : ($type === 'live' ? 'get_live_categories' : 'get_vod_categories');
    $cats = xt_get($action, [], 1800);
    return is_array($cats) ? array_values(array_filter($cats, 'is_array')) : [];
}

function wp_category_names($type)
{
    $map = [];
    foreach (wp_categories($type) as $c) {
        $map[(string)($c['category_id'] ?? '')] = (string)($c['category_name'] ?? '');
    }
    return $map;
}

/**
 * Catálogo completo en formato ligero (se guarda aparte para cargar muy rápido).
 * movie:  [id, name, icon, cat, cats, added, rating, ext, genre]
 * series: [id, name, icon, cat, cats, added, rating, genre, year]
 */
function wp_catalog($type)
{
    $list = wp_catalog_raw($type);
    // perfil infantil: solo lo que pasa el filtro (includes/kids.php); la caché guarda siempre el catálogo completo
    return function_exists('wp_kids_on') && wp_kids_on() ? wp_kids_catalog($type, $list) : $list;
}

function wp_catalog_raw($type)
{
    static $memo = [];
    if (isset($memo[$type])) return $memo[$type];
    $key = 'slim2|' . $type . '|' . xt_cache_key('', []);
    $data = wp_cache_get($key, 1800, $stale);
    if ($data !== null) return $memo[$type] = $data;
    $act = $type === 'series' ? 'get_series' : 'get_vod_streams';
    // vencido y el catálogo completo también: se usa el ligero de antes y los dos se renuevan después de contestar
    // (includes/catalog_fast.php). Así nadie espera a que se lea el catálogo completo (20-40 MB).
    $rawAge = time() - (int)@filemtime(wp_cache_file_of(xt_cache_key($act, [])));
    if (is_array($stale) && $stale && $rawAge > 1800 && wp_xt_refresh_later($act, [], 40)) return $memo[$type] = $stale;

    $raw = xt_get($act, [], 1800, 40);
    $slim = wp_catalog_slim($type, $raw);
    if ($slim) {
        wp_cache_set($key, $slim);
    } elseif (is_array($stale)) {
        $slim = $stale;
    }
    return $memo[$type] = $slim;
}

/** El catálogo ligero de la respuesta de get_vod_streams / get_series. */
function wp_catalog_slim($type, $raw)
{
    $slim = [];
    if (is_array($raw)) {
        foreach ($raw as $it) {
            if (!is_array($it)) continue;
            $cats = [];
            if (!empty($it['category_ids']) && is_array($it['category_ids'])) {
                foreach ($it['category_ids'] as $c) $cats[] = (string)$c;
            }
            $cat = (string)($it['category_id'] ?? ($cats[0] ?? ''));
            if ($cat !== '' && !in_array($cat, $cats, true)) $cats[] = $cat;
            if ($type === 'series') {
                $added = (int)($it['last_modified'] ?? 0);
                $slim[] = [
                    'id' => (string)($it['series_id'] ?? ''),
                    'name' => (string)($it['name'] ?? ''),
                    'icon' => (string)($it['cover'] ?? ''),
                    'cat' => $cat,
                    'cats' => $cats,
                    'added' => $added,
                    'rating' => (float)($it['rating'] ?? 0),
                    'genre' => (string)($it['genre'] ?? ''),
                    'year' => (string)($it['year'] ?? substr((string)($it['releaseDate'] ?? ($it['release_date'] ?? '')), 0, 4)),
                    'tm' => preg_replace('/\D/', '', (string)($it['tmdb'] ?? ($it['tmdb_id'] ?? ''))),
                ];
            } else {
                $slim[] = [
                    'id' => (string)($it['stream_id'] ?? ''),
                    'name' => (string)($it['name'] ?? ''),
                    'icon' => (string)($it['stream_icon'] ?? ''),
                    'cat' => $cat,
                    'cats' => $cats,
                    'added' => (int)($it['added'] ?? 0),
                    'rating' => (float)($it['rating'] ?? 0),
                    'ext' => (string)($it['container_extension'] ?? ''),
                    'genre' => (string)($it['genre'] ?? ''),
                    'year' => (string)($it['year'] ?? ''),
                    'tm' => preg_replace('/\D/', '', (string)($it['tmdb'] ?? ($it['tmdb_id'] ?? ''))),
                ];
            }
        }
    }
    return $slim;
}

/** Género guardado al abrir fichas (aprendizaje progresivo). */
function wp_genre_index_get()
{
    $d = wp_cache_get('genreidx|' . wp_user()['server'], 86400 * 365);
    return is_array($d) ? $d : [];
}

function wp_genre_index_put($type, $id, $genre)
{
    $genre = trim((string)$genre);
    if ($genre === '' || $id === '') return;
    $idx = wp_genre_index_get();
    $k = $type . ':' . $id;
    if (isset($idx[$k]) && $idx[$k] === $genre) return;
    $idx[$k] = $genre;
    if (count($idx) > 60000) $idx = array_slice($idx, -50000, null, true);
    wp_cache_set('genreidx|' . wp_user()['server'], $idx);
}

/**
 * Filtro inteligente.
 * $type: movie|series|all, $platform: clave de wp_platforms(), $genre: clave de wp_genres(), $cat: category_id
 */
function wp_filter($type, $platform = '', $genre = '', $cat = '', $q = '', $sort = 'recent')
{
    $types = $type === 'all' ? ['movie', 'series'] : [$type === 'series' ? 'series' : 'movie'];
    $platforms = wp_platforms();
    $genres = wp_genres();
    $pkw = ($platform && isset($platforms[$platform])) ? $platforms[$platform]['kw'] : null;
    $gkw = ($genre && isset($genres[$genre])) ? $genres[$genre]['kw'] : null;
    $qn = $q !== '' ? wp_norm($q) : '';
    $gidx = $gkw ? wp_genre_index_get() : [];
    $result = [];

    foreach ($types as $t) {
        $catNames = wp_category_names($t);
        $list = wp_catalog($t);
        $platCats = [];
        $genreCats = [];
        foreach ($catNames as $cid => $cname) {
            if ($pkw && wp_kw_match($cname, $pkw)) $platCats[$cid] = true;
            if ($gkw && wp_kw_match($cname, $gkw)) $genreCats[$cid] = true;
        }
        if ($pkw && !$platCats) continue;

        // títulos presentes en categorías del género (cruce inteligente por nombre)
        $genreTitles = [];
        if ($gkw && $genreCats) {
            foreach ($list as $it) {
                foreach ($it['cats'] as $c) {
                    if (isset($genreCats[$c])) {
                        $genreTitles[wp_norm_title($it['name'])] = true;
                        break;
                    }
                }
            }
        }

        foreach ($list as $it) {
            if ($cat !== '' && !in_array((string)$cat, $it['cats'], true)) continue;
            if ($pkw) {
                $ok = false;
                foreach ($it['cats'] as $c) {
                    if (isset($platCats[$c])) { $ok = true; break; }
                }
                if (!$ok) continue;
            }
            if ($gkw) {
                $ok = false;
                foreach ($it['cats'] as $c) {
                    if (isset($genreCats[$c])) { $ok = true; break; }
                }
                if (!$ok && $it['genre'] !== '' && wp_kw_match($it['genre'], $gkw)) $ok = true;
                if (!$ok && isset($gidx[$t . ':' . $it['id']]) && wp_kw_match($gidx[$t . ':' . $it['id']], $gkw)) $ok = true;
                if (!$ok && $genreTitles && isset($genreTitles[wp_norm_title($it['name'])])) $ok = true;
                if (!$ok && $genre === 'anime' && wp_kw_match($it['name'], ['anime'])) $ok = true;
                if (!$ok) continue;
            }
            if ($qn !== '' && strpos(wp_norm($it['name']), $qn) === false) continue;
            $it['t'] = $t;
            $result[] = $it;
        }
    }

    // el mismo orden que usort, mucho más rápido (includes/catalog_fast.php)
    if ($sort === 'az') {
        wp_sort_items($result, 'name');
    } elseif ($sort === 'rating') {
        wp_sort_items($result, 'rating');
    } elseif ($sort === 'recent') {
        wp_sort_items($result, 'added');
    }
    return $result;
}

/** Formato de tarjeta para el frontend. */
function wp_card($it, $t = null)
{
    $t = $t ?: ($it['t'] ?? 'movie');
    $id = $it['id'];
    // carátula por la caché del panel (copia pública → img.php → original); 'f' = las siguientes si una no carga
    $src = wp_poster_sources($t, $it['icon'], $it['name'], $it['year'] ?? '', $it['tm'] ?? '');
    return [
        't' => $t,
        'id' => $id,
        'n' => $it['name'],
        'i' => $src ? array_shift($src) : WP_NOIMG,
        'f' => $src,
        'r' => $it['rating'] ? round((float)$it['rating'], 1) : '',
        'y' => $it['year'] ?? '',
        'tm' => $it['tm'] ?? '',
        // como token (las respuestas JSON no pasan por la reescritura de enlaces de la página)
        'u' => wp_route_url($t === 'series' ? 'seriesvideo.php?id=' . rawurlencode($id) : 'Movie_description.php?id=' . rawurlencode($id)),
    ];
}

/** Elementos presentes en el catálogo de cada plataforma (para mostrar sólo las que existen). */
function wp_available_platforms()
{
    static $memo = null; // la página lo pide varias veces (tiles, filas, chips)
    if ($memo !== null) return $memo;
    $out = [];
    $names = array_merge(array_values(wp_category_names('movie')), array_values(wp_category_names('series')));
    foreach (wp_platforms() as $k => $p) {
        foreach ($names as $n) {
            if (wp_kw_match($n, $p['kw'])) {
                $out[$k] = $p;
                break;
            }
        }
    }
    return $memo = $out;
}

function wp_available_genres($type = 'all')
{
    // se calcula una vez por catálogo (recorre las series): includes/catalog_fast.php
    $types = $type === 'all' ? ['movie', 'series'] : [$type === 'series' ? 'series' : 'movie'];
    $keys = wp_cat_derive('avgen|' . $type, $types, function () use ($type) { return array_keys(wp_available_genres_calc($type)); });
    $all = wp_genres();
    $out = [];
    foreach ((array)$keys as $k) {
        if (isset($all[$k])) $out[$k] = $all[$k];
    }
    return $out;
}

function wp_available_genres_calc($type = 'all')
{
    $out = [];
    $names = [];
    if ($type !== 'series') $names = array_merge($names, array_values(wp_category_names('movie')));
    if ($type !== 'movie') $names = array_merge($names, array_values(wp_category_names('series')));
    $seriesGenres = '';
    if ($type !== 'movie') {
        $i = 0;
        foreach (wp_catalog('series') as $s) {
            if ($s['genre'] !== '') { $seriesGenres .= ' ' . $s['genre']; if (++$i > 3000) break; }
        }
    }
    foreach (wp_genres() as $k => $g) {
        $found = wp_kw_match($seriesGenres, $g['kw']);
        if (!$found) {
            foreach ($names as $n) {
                if (wp_kw_match($n, $g['kw'])) { $found = true; break; }
            }
        }
        if ($found) $out[$k] = $g;
    }
    return $out;
}

/**
 * Código del motivo en la página de error de XUI.one («Debug Mode»): en lugar de JSON el servidor contesta 200 con una
 * página HTML («XUI.ONE INVALID_CREDENTIALS Username or password is invalid.», EXPIRED, BANNED…). null si no es una.
 * Igual que Xtream.xuiError de Android y src/lib/xui.ts de Vega.
 */
function wp_xui_error($body)
{
    $body = (string)$body;
    if ($body === '' || stripos($body, 'XUI') === false) return null;
    $text = preg_replace('~<(style|script|title)[^>]*>.*?</\1>~is', ' ', $body);
    // etiquetas por espacios: el código va en otro elemento («<h1>XUI.ONE</h1><h2>INVALID_CREDENTIALS</h2>»)
    $text = preg_replace('~\s+~', ' ', (string)preg_replace('~<[^>]*>~', ' ', (string)$text));
    return preg_match('~XUI\.(?:ONE|one)\s+([A-Z][A-Z0-9_]{2,})~', (string)$text, $m) ? $m[1] : null;
}

/** Protección básica contra fuerza bruta en el login. */
function wp_rate_limited($bucket, $max = 12, $window = 300)
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0';
    $key = 'rl|' . $bucket . '|' . $ip;
    $d = wp_cache_get($key, $window);
    $d = is_array($d) ? $d : [];
    $now = time();
    $d = array_values(array_filter($d, function ($ts) use ($now, $window) { return $ts > $now - $window; }));
    if (count($d) >= $max) return true;
    $d[] = $now;
    wp_cache_set($key, $d);
    return false;
}

function wp_rate_reset($bucket)
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0';
    wp_cache_set('rl|' . $bucket . '|' . $ip, []);
}

function wp_first_key(array $a)
{
    foreach ($a as $k => $v) return $k;
    return null;
}

/**
 * Lee, modifica y guarda un archivo JSON con bloqueo (evita que se dañe
 * cuando varios usuarios guardan al mismo tiempo). Conserva el mismo formato.
 */
function wp_json_update($path, callable $fn, $flags = JSON_PRETTY_PRINT)
{
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $fp = @fopen($path, 'c+');
    if (!$fp) return false;
    @flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $data = json_decode((string)$raw, true);
    if (!is_array($data)) $data = [];
    $new = $fn($data);
    if (is_array($new)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($new, $flags));
        fflush($fp);
    }
    @flock($fp, LOCK_UN);
    fclose($fp);
    return $new;
}

/* ------------------------------------------------------------------ */
/* TMDB: carátulas en alta calidad, fondos, elenco y tráiler           */
/* ------------------------------------------------------------------ */

function wp_tmdb_clean_title($title)
{
    return wp_tmdb_parse($title)[0];
}

/**
 * Limpia el nombre que usa el servidor IPTV y separa el año:
 * "ES - Avatar: El camino del agua (2022) [4K HDR] LAT" → ["Avatar: El camino del agua", "2022"]
 */
function wp_tmdb_parse($title)
{
    $t = (string)$title;
    $year = '';
    if (preg_match('/[\(\[\s\.\-](19[2-9]\d|20[0-2]\d)(?=[\)\]\s\.\-]|$)/', ' ' . $t, $m)) $year = $m[1];
    $t = preg_replace('/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|【[^】]*】/u', ' ', $t);
    $t = preg_replace('/[★☆✪●♦►▶◆|_]+/u', ' | ', $t);
    // prefijos de país/idioma/calidad: "ES - ", "LAT: ", "4K | ", "|MX| ", "VIP - "
    for ($i = 0; $i < 3; $i++) {
        $t = preg_replace('/^\s*\|?\s*(?:ES|ESP|SPA|LAT|LA|MX|MEX|US|USA|UK|AR|CO|CL|PE|VE|EC|UY|PY|BO|CR|GT|DO|PR|EN|ENG|SUB|VOSE|CAST|TOP|VIP|NEW|4K|8K|UHD|FHD|HD|SD|HDR|DV|LATINO|CASTELLANO|SUBTITULADO|NUEVO|ESTRENO|PPV|NF|NETFLIX|AMZ|DSNP|HBO|MAX|4K-ES|4K-LAT)\s*[\-|:–—»]\s*/iu', '', $t);
    }
    $tags = '4k|8k|uhd|2160p|1080p|720p|480p|fhd|hd|sd|hdr10\+?|hdr|dv|dolby\s*vision|dolby|atmos|hevc|x265|x264|h\.?265|h\.?264|10bit|remux|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|dvdrip|hdrip|'
        . 'lat|latino|castellano|esp|espanol|español|spa|subt|subtitulado|vose|dual|multi|eng|ingles|inglés|extendida|imax';
    $t = preg_replace('/(?<![\p{L}\d])(?:' . $tags . ')(?![\p{L}\d])/iu', ' ', $t);
    $t = preg_replace('/(?<![\p{L}\d])(?:19[2-9]\d|20[0-2]\d)\s*$/u', ' ', trim($t));
    $t = trim(preg_replace('/\s+/u', ' ', $t), " -|:.–—_,");
    if ($t === '') $t = trim((string)$title);
    return [$t, $year];
}

/** Elige el mejor resultado de TMDB: parecido del título, año y popularidad; prefiere los que tienen póster. */
function wp_tmdb_pick(array $results, $q, $year)
{
    $nq = wp_norm_title($q);
    $best = null;
    $bestScore = -1e9;
    foreach (array_slice($results, 0, 10) as $i => $r) {
        if (!is_array($r) || empty($r['id'])) continue;
        $names = [$r['title'] ?? '', $r['name'] ?? '', $r['original_title'] ?? '', $r['original_name'] ?? ''];
        $sim = 0;
        foreach ($names as $n) {
            if ($n === '') continue;
            $nn = wp_norm_title($n);
            if ($nn === $nq) { $sim = 100; break; }
            similar_text($nn, $nq, $pct);
            $sim = max($sim, $pct);
        }
        $ry = substr((string)($r['release_date'] ?? ($r['first_air_date'] ?? '')), 0, 4);
        $score = $sim - $i * 2 + min(10, log10(1 + (float)($r['popularity'] ?? 0)) * 3) + (!empty($r['poster_path']) ? 15 : -30);
        if ($year && $ry) $score += $ry === (string)$year ? 25 : (abs((int)$ry - (int)$year) <= 1 ? 10 : -15);
        if ($score > $bestScore) { $bestScore = $score; $best = $r; }
    }
    // con un título muy distinto es mejor no mostrar nada que mostrar otra película
    return $best && $bestScore > 35 ? $best : null;
}

/**
 * Busca en TMDB de forma rigurosa (caché: 30 días si encuentra, 2 días si no).
 * Orden: tmdb_id del servidor → búsqueda con año → sin año → título antes de ":" o " - " → el otro tipo (película/serie).
 * Devuelve el resultado de TMDB (id, poster_path, backdrop_path, overview...) o null.
 */
function wp_tmdb_find($type, $name, $year = '', $tmdbId = '')
{
    if (!wp_tmdb_on()) return null;
    list($q, $y2) = wp_tmdb_parse($name);
    $year = preg_replace('/\D/', '', (string)$year) ?: $y2;
    $tmdbId = preg_replace('/\D/', '', (string)$tmdbId);
    $ck = 'tmdbf2|' . $type . '|' . ($tmdbId ? 'id' . $tmdbId : wp_norm_title($q) . '|' . $year);
    $hit = wp_cache_get($ck, 2592000);
    if (is_array($hit) && ($hit['r'] || time() - (int)($hit['t'] ?? 0) < 172800)) return $hit['r'];
    $r = null;
    $netOk = false;
    if ($tmdbId) {
        $body = wp_http_get(wp_tmdb_url($type . '/' . $tmdbId, 'language=es-MX'), 6);
        $netOk = $body !== null;
        $j = $body ? json_decode($body, true) : null;
        if (is_array($j) && !empty($j['id'])) $r = $j;
    }
    if (!$r && $q !== '') {
        $tries = [];
        if ($year) $tries[] = [$type, $q, $year];
        $tries[] = [$type, $q, ''];
        foreach ([':', ' - ', ' – '] as $sep) {
            if (strpos($q, $sep) !== false) { $short = trim(explode($sep, $q)[0]); if (mb_strlen($short) >= 3) $tries[] = [$type, $short, $year]; }
        }
        $tries[] = [$type === 'tv' ? 'movie' : 'tv', $q, ''];
        foreach ($tries as $tr) {
            $url = wp_tmdb_url('search/' . $tr[0], 'language=es-MX&include_adult=false&query=' . urlencode($tr[1])
                . ($tr[2] ? ($tr[0] === 'tv' ? '&first_air_date_year=' : '&primary_release_year=') . (int)$tr[2] : ''));
            $body = wp_http_get($url, 6);
            if ($body === null) continue;
            $netOk = true;
            $s = json_decode($body, true);
            $r = wp_tmdb_pick((array)($s['results'] ?? []), $tr[1], $year);
            if ($r) { $r['_type'] = $tr[0]; break; }
        }
    }
    if ($r && !isset($r['_type'])) $r['_type'] = $type;
    if ($netOk) wp_cache_set($ck, ['r' => $r, 't' => time()]); // sin conexión a TMDB no se guarda el "no encontrado"
    return $r;
}

/** Compatibilidad: id y datos básicos por título. */
function wp_tmdb_search($type, $title, $year = '')
{
    return wp_tmdb_find($type, $title, $year);
}

/**
 * Datos completos de TMDB. $type = 'movie' | 'tv'. Usa el tmdb_id del servidor si existe (más exacto).
 * Devuelve ['id','poster','backdrop','cast','trailer','overview','ol'] (caché 7 días, por idioma de la app);
 * 'ol' = idioma TMDB en el que llegó la sinopsis ('' si no hay).
 * La búsqueda del título sigue en es-MX (wp_tmdb_find); la ficha llega en el idioma de la app.
 */
function wp_tmdb_details($type, $tmdbId, $title, $year = '', $cacheOnly = false)
{
    // sin clave para este distribuidor (ni el panel, con «Solo sus recursos»): nada de TMDB, tampoco lo de la caché
    if (!wp_tmdb_on()) return ['id' => null, 'poster' => '', 'backdrop' => '', 'cast' => [], 'trailer' => '', 'overview' => '', 'ol' => '', '_t' => time()];
    $tl = wp_tmdb_lang();
    $l2 = substr($tl, 0, 2);
    $ck = 'tmdbd4|' . $tl . '|' . $type . '|' . (preg_replace('/\D/', '', (string)$tmdbId) ?: wp_norm_title(wp_tmdb_clean_title($title)) . '|' . $year);
    $d = wp_cache_get($ck, 604800);
    if (is_array($d) && ($d['id'] || time() - (int)($d['_t'] ?? 0) < 172800)) return $d;
    // $cacheOnly: solo lo ya guardado (el destacado no espera a TMDB por lo que todavía no buscó)
    if ($cacheOnly) return null;
    $d = ['id' => null, 'poster' => '', 'backdrop' => '', 'cast' => [], 'trailer' => '', 'overview' => '', 'ol' => '', '_t' => time()];
    if (!wp_tmdb_on()) return $d;
    $r = wp_tmdb_find($type, $title, $year, $tmdbId);
    if (!$r) { wp_cache_set($ck, $d); return $d; }
    $rtype = $r['_type'] ?? $type;
    $body = wp_http_get(wp_tmdb_url($rtype . '/' . $r['id'], 'language=' . $tl . '&append_to_response=credits,aggregate_credits,videos,images&include_video_language=' . $l2 . ',es,en,null&include_image_language=' . $l2 . ',es,en,null'), 7);
    $j = $body ? json_decode($body, true) : null;
    $inLang = is_array($j) && !empty($j['id']); // ficha en el idioma de la app (si no, el resultado de la búsqueda es-MX)
    if (!$inLang) $j = $r;
    $d['id'] = $j['id'];
    $poster = $j['poster_path'] ?? ($r['poster_path'] ?? '');
    if (!$poster && !empty($j['images']['posters'][0]['file_path'])) $poster = $j['images']['posters'][0]['file_path'];
    $back = $j['backdrop_path'] ?? ($r['backdrop_path'] ?? '');
    if (!$back && !empty($j['images']['backdrops'][0]['file_path'])) $back = $j['images']['backdrops'][0]['file_path'];
    $d['poster'] = $poster ? 'https://image.tmdb.org/t/p/w500' . $poster : '';
    $d['backdrop'] = $back ? 'https://image.tmdb.org/t/p/w1280' . $back : '';
    $d['overview'] = trim((string)($j['overview'] ?? ''));
    $d['ol'] = $d['overview'] === '' ? '' : ($inLang ? $tl : 'es-MX');
    if ($d['overview'] === '') {
        // sin descripción en ese idioma: español de España (si es español) y luego inglés
        foreach (array_diff($l2 === 'es' ? ['es-ES', 'en-US'] : ['en-US'], [$tl]) as $lang) {
            $b2 = wp_http_get(wp_tmdb_url($rtype . '/' . $j['id'], 'language=' . $lang), 5);
            $j2 = $b2 ? json_decode($b2, true) : null;
            if (!empty($j2['overview'])) { $d['overview'] = trim($j2['overview']); $d['ol'] = $lang; break; }
        }
    }
    $cast = $j['credits']['cast'] ?? [];
    if (!$cast && !empty($j['aggregate_credits']['cast'])) {
        foreach ($j['aggregate_credits']['cast'] as $a) $cast[] = ['id' => $a['id'] ?? 0, 'name' => $a['name'] ?? '', 'character' => $a['roles'][0]['character'] ?? '', 'profile_path' => $a['profile_path'] ?? ''];
    }
    foreach (array_slice($cast, 0, 15) as $a) {
        $d['cast'][] = ['id' => (int)($a['id'] ?? 0), 'n' => $a['name'] ?? '', 'c' => $a['character'] ?? '', 'p' => !empty($a['profile_path']) ? 'https://image.tmdb.org/t/p/w185' . $a['profile_path'] : ''];
    }
    $vids = $j['videos']['results'] ?? [];
    usort($vids, function ($a, $b) use ($l2) { return (($b['iso_639_1'] ?? '') === $l2) <=> (($a['iso_639_1'] ?? '') === $l2); });
    foreach ($vids as $v) {
        if (($v['site'] ?? '') === 'YouTube' && in_array($v['type'] ?? '', ['Trailer', 'Teaser'], true)) { $d['trailer'] = $v['key']; break; }
    }
    if ($body !== null) wp_cache_set($ck, $d);
    return $d;
}

/**
 * Sinopsis para mostrar. En español, igual que siempre: la del servidor y, si no trae, la de TMDB.
 * En otro idioma: la de TMDB en ese idioma; si no hay (sin clave, sin coincidencia o vacía), la del servidor.
 */
function wp_tmdb_plot(array $tmdb, $serverPlot)
{
    $serverPlot = (string)$serverPlot;
    $ov = (string)($tmdb['overview'] ?? '');
    if (wp_lang() === 'es') return $serverPlot === '' ? $ov : $serverPlot;
    if ($ov !== '' && ($tmdb['ol'] ?? '') === wp_tmdb_lang()) return $ov;
    return $serverPlot !== '' ? $serverPlot : $ov;
}

/**
 * Carátulas TMDB para varias tarjetas a la vez. Primera pasada en paralelo (tmdb_id o búsqueda con año);
 * las que no se encuentran pasan por la búsqueda rigurosa wp_tmdb_find (máx. 10 por petición para no demorar).
 * $items = [['k' => clave, 't' => 'movie'|'series', 'tm' => tmdb_id, 'n' => nombre, 'y' => año], ...]
 * Devuelve [clave => url w342].
 */
function wp_tmdb_posters(array $items)
{
    if (!wp_tmdb_on()) return []; // sin clave (ni el panel): tampoco las carátulas que otro dejó en la caché
    $out = [];
    $need = [];
    $slow = [];
    foreach ($items as $it) {
        $type = ($it['t'] ?? '') === 'series' ? 'tv' : 'movie';
        $tm = preg_replace('/\D/', '', (string)($it['tm'] ?? ''));
        list($q, $y2) = wp_tmdb_parse($it['n'] ?? '');
        $y = preg_replace('/\D/', '', (string)($it['y'] ?? '')) ?: $y2;
        $ck = 'tmdbp2|' . $type . '|' . ($tm ?: wp_norm_title($q) . '|' . $y);
        $hit = wp_cache_get($ck, 2592000);
        if (is_array($hit) && ($hit['p'] || time() - (int)($hit['t'] ?? 0) < 172800)) {
            if ($hit['p']) $out[$it['k']] = str_replace('/t/p/w342/', '/t/p/w500/', $hit['p']);
            continue;
        }
        if (!$tm && $q === '') continue;
        $url = $tm
            ? wp_tmdb_url($type . '/' . $tm, 'language=es-MX')
            : wp_tmdb_url('search/' . $type, 'language=es-MX&include_adult=false&query=' . urlencode($q)
                . ($y ? ($type === 'tv' ? '&first_air_date_year=' : '&primary_release_year=') . (int)$y : ''));
        $need[$it['k']] = ['ck' => $ck, 'url' => $url, 'tm' => $tm, 'q' => $q, 'y' => $y, 'type' => $type, 'n' => $it['n'] ?? ''];
    }
    if ($need && wp_tmdb_on()) {
        $urls = [];
        foreach ($need as $k => $n) $urls[$k] = $n['url'];
        foreach (wp_http_multi($urls, 6) as $k => $body) {
            if ($body === null || $body === false || $body === '') continue; // sin respuesta: se reintenta en la próxima visita
            $j = json_decode($body, true);
            if (!is_array($j)) continue;
            // clave rechazada (401 de TMDB): la próxima vez va la siguiente (la del panel)
            if ((int)($j['status_code'] ?? 0) === 7 && wp_tmdb_key() !== '') { wp_tmdb_key_bad(wp_tmdb_key()); continue; }
            $r = $need[$k]['tm'] ? (!empty($j['id']) ? $j : null) : wp_tmdb_pick((array)($j['results'] ?? []), $need[$k]['q'], $need[$k]['y']);
            $p = !empty($r['poster_path']) ? 'https://image.tmdb.org/t/p/w500' . $r['poster_path'] : '';
            if ($p) { wp_cache_set($need[$k]['ck'], ['p' => $p, 't' => time()]); $out[$k] = $p; }
            else $slow[$k] = $need[$k];
        }
        // segunda pasada rigurosa para las que no aparecieron
        $deadline = microtime(true) + 12;
        foreach (array_slice($slow, 0, 10, true) as $k => $n) {
            if (microtime(true) > $deadline) break;
            $r = wp_tmdb_find($n['type'], $n['n'], $n['y'], $n['tm']);
            if (!$r && $n['tm']) $r = wp_tmdb_find($n['type'], $n['n'], $n['y']); // el tmdb_id del servidor puede estar mal
            $p = !empty($r['poster_path']) ? 'https://image.tmdb.org/t/p/w500' . $r['poster_path'] : '';
            wp_cache_set($n['ck'], ['p' => $p, 't' => time()]);
            if ($p) $out[$k] = $p;
        }
    }
    return $out;
}


/** Nombre legible de idioma ISO 639. */
function wp_lang_name($code)
{
    $m = ['spa' => 'Español', 'es' => 'Español', 'esp' => 'Español', 'lat' => 'Español latino', 'eng' => 'Inglés', 'en' => 'Inglés',
        'por' => 'Portugués', 'pt' => 'Portugués', 'fre' => 'Francés', 'fra' => 'Francés', 'fr' => 'Francés', 'ger' => 'Alemán', 'deu' => 'Alemán',
        'de' => 'Alemán', 'ita' => 'Italiano', 'it' => 'Italiano', 'jpn' => 'Japonés', 'ja' => 'Japonés', 'kor' => 'Coreano', 'ko' => 'Coreano',
        'chi' => 'Chino', 'zho' => 'Chino', 'rus' => 'Ruso', 'ara' => 'Árabe', 'hin' => 'Hindi', 'tur' => 'Turco', 'pol' => 'Polaco', 'dut' => 'Neerlandés', 'nld' => 'Neerlandés'];
    $c = strtolower((string)$code);
    return isset($m[$c]) ? t($m[$c]) : ($c !== '' && $c !== 'und' ? strtoupper($c) : '');
}

require_once __DIR__ . '/panel.php';
require_once __DIR__ . '/panel_img.php';
require_once __DIR__ . '/route_token.php';
require_once __DIR__ . '/error_report.php';
require_once __DIR__ . '/fake_screen.php';
require_once __DIR__ . '/handoff.php';
require_once __DIR__ . '/doh.php';
require_once __DIR__ . '/media_core.php';
require_once __DIR__ . '/audio_probe.php';
require_once __DIR__ . '/profiles.php';
require_once __DIR__ . '/kids.php';
require_once __DIR__ . '/login_probe.php';
require_once __DIR__ . '/xt_client.php';
