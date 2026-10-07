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


// Clave de TMDB (carátulas, fondos, elenco y tráileres)
if (!defined('WP_TMDB_KEY')) {
    define('WP_TMDB_KEY', '0c23c3f0458f0f9e4d0a35048d3a199a');
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
        $list[] = ['id' => (string)($i + 1), 'name' => 'Servidor ' . ($i + 1), 'url' => rtrim($url, '/')];
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

/**
 * Varias peticiones en paralelo. $urls = [key => url]. Devuelve [key => body|null].
 * $stopWhen(key, body) puede devolver true para cortar el resto (p. ej. login encontrado).
 */
function wp_http_multi(array $urls, $timeout = 12, $stopWhen = null)
{
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
    return 'xt|' . $u['server'] . '|' . $u['username'] . '|' . $action . '|' . http_build_query($params);
}

/** Llamada a la API con caché. Si el servidor falla se usa la última copia guardada. */
function xt_get($action, array $params = [], $ttl = 600, $timeout = 15)
{
    static $memo = [];
    $key = xt_cache_key($action, $params);
    if (isset($memo[$key])) return $memo[$key];
    $data = wp_cache_get($key, $ttl, $stale);
    if ($data !== null) return $memo[$key] = $data;
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
function xt_multi(array $reqs, $ttl = 86400, $timeout = 10)
{
    $out = [];
    $missing = [];
    $stales = [];
    foreach ($reqs as $k => $r) {
        $ck = xt_cache_key($r[0], $r[1]);
        $data = wp_cache_get($ck, $ttl, $stale);
        if ($data !== null) {
            $out[$k] = $data;
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
    @file_put_contents($file, "<?php exit; ?>\n" . $s);
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
function wp_proxy_url($url, $script = 'img.php')
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
 * Fuentes de reproducción en orden de prueba para NFPlayer, siempre directas al servidor IPTV.
 * $exts = extensiones a probar (p. ej. ['mp4','mkv','m3u8']).
 */
function wp_play_sources($kind, $id, array $exts)
{
    $out = [];
    $relay = wp_is_https() ? wp_https_relay() : '';
    foreach ($exts as $x) {
        $engine = $x === 'm3u8' ? 'hls' : ($x === 'ts' ? 'mpegts' : 'native');
        $url = wp_client_stream_url($kind, $id, $x);
        // página https y el servidor IPTV sin https válido: se usa el relay https propio (Cloudflare), no el hosting
        if ($relay !== '' && !wp_direct_https_ok($kind, $id, $x, $engine !== 'native')) $url = wp_relay_url(wp_stream_url($kind, $id, $x));
        $out[] = ['url' => $url, 'engine' => $engine, 'ext' => $x];
    }
    return $out;
}

/**
 * Relay HTTPS opcional: un Cloudflare Worker de tu cuenta (cloudflare/relay-worker.js) que entrega
 * por https el video http del servidor IPTV. El video va servidor IPTV → Cloudflare → navegador:
 * nunca pasa por el hosting. Se activa creando includes/https_relay.php (ver https_relay.sample.php).
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
    if (wp_is_https() && stripos($url, 'http://') === 0) {
        return wp_proxy_url($url, 'img.php');
    }
    return $url;
}

/**
 * Logo de canal: siempre pasa por img.php (caché 7 días). Así cargan también los logos
 * de servidores que bloquean el enlace directo, con certificado vencido o en http.
 * Si el logo no existe o falla, se muestra el logo del webplayer.
 */
function wp_logo($url)
{
    $url = trim((string)$url);
    if ($url === '' || !preg_match('~^https?://[^/\s]+~i', $url)) return WP_LOGO;
    return wp_proxy_url($url, 'img.php') . '&fb=1';
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
    return [
        'netflix' => ['label' => 'Netflix', 'img' => 'img/netflix.webp', 'kw' => ['netflix'], 'color' => '#e50914'],
        'disney' => ['label' => 'Disney+', 'img' => 'img/DisneY.webp', 'kw' => ['disney', 'pixar', 'star+', 'star plus'], 'color' => '#113ccf'],
        'max' => ['label' => 'HBO Max', 'img' => 'img/MAx.webp', 'kw' => ['hbo', '/\bmax\b/'], 'color' => '#5822b4'],
        'prime' => ['label' => 'Prime Video', 'img' => 'img/prime.webp', 'kw' => ['amazon', 'prime'], 'color' => '#00a8e1'],
        'marvel' => ['label' => 'Marvel', 'img' => 'img/marvel.webp', 'kw' => ['marvel', '/\bmcu\b/'], 'color' => '#ec1d24'],
        'apple' => ['label' => 'Apple TV+', 'img' => 'img/appletv.webp', 'kw' => ['apple'], 'color' => '#555'],
        'paramount' => ['label' => 'Paramount+', 'img' => 'img/paramount.webp', 'kw' => ['paramount'], 'color' => '#0064ff'],
        'dc' => ['label' => 'DC', 'img' => 'img/dc.webp', 'kw' => ['/\bdc\b/', 'dc comics'], 'color' => '#0476f2'],
        'xmas' => ['label' => 'Navidad', 'img' => 'img/xmas.webp', 'kw' => ['navidad', 'navide', 'christmas', 'xmas'], 'color' => '#1f7a3a'],
        'halloween' => ['label' => 'Halloween', 'img' => 'img/halloween.webp', 'kw' => ['halloween', 'terror', 'horror'], 'color' => '#ff6a00'],
    ];
}

function wp_genres()
{
    return [
        'accion' => ['label' => 'Acción', 'kw' => ['accion', 'action', 'artes marciales']],
        'suspenso' => ['label' => 'Suspenso', 'kw' => ['suspenso', 'suspense', 'thriller', 'misterio', 'mystery', 'intriga']],
        'aventura' => ['label' => 'Aventura', 'kw' => ['aventura', 'adventure']],
        'anime' => ['label' => 'Anime', 'kw' => ['anime', 'crunchyroll', 'otaku']],
        'drama' => ['label' => 'Drama', 'kw' => ['drama']],
        'comedia' => ['label' => 'Comedia', 'kw' => ['comedia', 'comedy', 'humor']],
        'terror' => ['label' => 'Terror', 'kw' => ['terror', 'horror', 'miedo']],
        'scifi' => ['label' => 'Ciencia ficción', 'kw' => ['ciencia ficcion', 'sci-fi', 'scifi', 'science fiction', 'ficcion']],
        'fantasia' => ['label' => 'Fantasía', 'kw' => ['fantasia', 'fantasy']],
        'romance' => ['label' => 'Romance', 'kw' => ['romance', 'romantic', 'romantica', 'romantico', 'amor']],
        'crimen' => ['label' => 'Crimen', 'kw' => ['crimen', 'crime', 'policia', 'policiaco', 'mafia']],
        'animacion' => ['label' => 'Animación', 'kw' => ['animacion', 'animation', 'animada', 'animado', 'cartoon', 'dibujos']],
        'infantil' => ['label' => 'Infantil y familia', 'kw' => ['infantil', 'kids', 'ninos', 'familia', 'family', 'familiar']],
        'documental' => ['label' => 'Documentales', 'kw' => ['documental', 'documentary', 'docu']],
        'belica' => ['label' => 'Bélicas', 'kw' => ['belica', 'belico', 'guerra', 'war']],
        'dorama' => ['label' => 'Doramas', 'kw' => ['dorama', 'k-drama', 'kdrama', 'corea', 'korean', 'asiatic']],
        'novela' => ['label' => 'Novelas', 'kw' => ['novela', 'telenovela']],
        'western' => ['label' => 'Western', 'kw' => ['western', 'vaquer', 'oeste']],
        'musical' => ['label' => 'Música', 'kw' => ['musical', 'music', 'musica', 'concierto']],
        'deportes' => ['label' => 'Deportes', 'kw' => ['deporte', 'sport', 'futbol']],
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

function wp_categories($type)
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
    static $memo = [];
    if (isset($memo[$type])) return $memo[$type];
    $key = 'slim2|' . $type . '|' . xt_cache_key('', []);
    $data = wp_cache_get($key, 1800, $stale);
    if ($data !== null) return $memo[$type] = $data;

    $raw = xt_get($type === 'series' ? 'get_series' : 'get_vod_streams', [], 1800, 40);
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
    if ($slim) {
        wp_cache_set($key, $slim);
    } elseif (is_array($stale)) {
        $slim = $stale;
    }
    return $memo[$type] = $slim;
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

    if ($sort === 'az') {
        usort($result, function ($a, $b) { return strnatcasecmp($a['name'], $b['name']); });
    } elseif ($sort === 'rating') {
        usort($result, function ($a, $b) { return $b['rating'] <=> $a['rating']; });
    } elseif ($sort === 'recent') {
        usort($result, function ($a, $b) { return $b['added'] <=> $a['added']; });
    }
    return $result;
}

/** Formato de tarjeta para el frontend. */
function wp_card($it, $t = null)
{
    $t = $t ?: ($it['t'] ?? 'movie');
    $id = $it['id'];
    return [
        't' => $t,
        'id' => $id,
        'n' => $it['name'],
        'i' => wp_img($it['icon']),
        'r' => $it['rating'] ? round((float)$it['rating'], 1) : '',
        'y' => $it['year'] ?? '',
        'tm' => $it['tm'] ?? '',
        'u' => $t === 'series' ? 'seriesvideo.php?id=' . rawurlencode($id) : 'Movie_description.php?id=' . rawurlencode($id),
    ];
}

/** Elementos presentes en el catálogo de cada plataforma (para mostrar sólo las que existen). */
function wp_available_platforms()
{
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
    return $out;
}

function wp_available_genres($type = 'all')
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
    if (!WP_TMDB_KEY) return null;
    list($q, $y2) = wp_tmdb_parse($name);
    $year = preg_replace('/\D/', '', (string)$year) ?: $y2;
    $tmdbId = preg_replace('/\D/', '', (string)$tmdbId);
    $ck = 'tmdbf2|' . $type . '|' . ($tmdbId ? 'id' . $tmdbId : wp_norm_title($q) . '|' . $year);
    $hit = wp_cache_get($ck, 2592000);
    if (is_array($hit) && ($hit['r'] || time() - (int)($hit['t'] ?? 0) < 172800)) return $hit['r'];
    $base = 'https://api.themoviedb.org/3/';
    $key = 'api_key=' . WP_TMDB_KEY;
    $r = null;
    $netOk = false;
    if ($tmdbId) {
        $body = wp_http_get($base . $type . '/' . $tmdbId . '?' . $key . '&language=es-MX', 6);
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
            $url = $base . 'search/' . $tr[0] . '?' . $key . '&language=es-MX&include_adult=false&query=' . urlencode($tr[1])
                . ($tr[2] ? ($tr[0] === 'tv' ? '&first_air_date_year=' : '&primary_release_year=') . (int)$tr[2] : '');
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
 * Devuelve ['id','poster','backdrop','cast','trailer','overview'] (caché 7 días).
 */
function wp_tmdb_details($type, $tmdbId, $title, $year = '')
{
    $ck = 'tmdbd2|' . $type . '|' . (preg_replace('/\D/', '', (string)$tmdbId) ?: wp_norm_title(wp_tmdb_clean_title($title)) . '|' . $year);
    $d = wp_cache_get($ck, 604800);
    if (is_array($d) && ($d['id'] || time() - (int)($d['_t'] ?? 0) < 172800)) return $d;
    $d = ['id' => null, 'poster' => '', 'backdrop' => '', 'cast' => [], 'trailer' => '', 'overview' => '', '_t' => time()];
    if (!WP_TMDB_KEY) return $d;
    $r = wp_tmdb_find($type, $title, $year, $tmdbId);
    if (!$r) { wp_cache_set($ck, $d); return $d; }
    $rtype = $r['_type'] ?? $type;
    $body = wp_http_get('https://api.themoviedb.org/3/' . $rtype . '/' . $r['id'] . '?api_key=' . WP_TMDB_KEY
        . '&language=es-MX&append_to_response=credits,aggregate_credits,videos,images&include_video_language=es,en,null&include_image_language=es,en,null', 7);
    $j = $body ? json_decode($body, true) : null;
    if (!is_array($j) || empty($j['id'])) $j = $r;
    $d['id'] = $j['id'];
    $poster = $j['poster_path'] ?? ($r['poster_path'] ?? '');
    if (!$poster && !empty($j['images']['posters'][0]['file_path'])) $poster = $j['images']['posters'][0]['file_path'];
    $back = $j['backdrop_path'] ?? ($r['backdrop_path'] ?? '');
    if (!$back && !empty($j['images']['backdrops'][0]['file_path'])) $back = $j['images']['backdrops'][0]['file_path'];
    $d['poster'] = $poster ? 'https://image.tmdb.org/t/p/w500' . $poster : '';
    $d['backdrop'] = $back ? 'https://image.tmdb.org/t/p/w1280' . $back : '';
    $d['overview'] = trim((string)($j['overview'] ?? ''));
    if ($d['overview'] === '') {
        // sin descripción en español: se intenta España y luego inglés
        foreach (['es-ES', 'en-US'] as $lang) {
            $b2 = wp_http_get('https://api.themoviedb.org/3/' . $rtype . '/' . $j['id'] . '?api_key=' . WP_TMDB_KEY . '&language=' . $lang, 5);
            $j2 = $b2 ? json_decode($b2, true) : null;
            if (!empty($j2['overview'])) { $d['overview'] = trim($j2['overview']); break; }
        }
    }
    $cast = $j['credits']['cast'] ?? [];
    if (!$cast && !empty($j['aggregate_credits']['cast'])) {
        foreach ($j['aggregate_credits']['cast'] as $a) $cast[] = ['name' => $a['name'] ?? '', 'character' => $a['roles'][0]['character'] ?? '', 'profile_path' => $a['profile_path'] ?? ''];
    }
    foreach (array_slice($cast, 0, 15) as $a) {
        $d['cast'][] = ['n' => $a['name'] ?? '', 'c' => $a['character'] ?? '', 'p' => !empty($a['profile_path']) ? 'https://image.tmdb.org/t/p/w185' . $a['profile_path'] : ''];
    }
    $vids = $j['videos']['results'] ?? [];
    usort($vids, function ($a, $b) { return (($b['iso_639_1'] ?? '') === 'es') <=> (($a['iso_639_1'] ?? '') === 'es'); });
    foreach ($vids as $v) {
        if (($v['site'] ?? '') === 'YouTube' && in_array($v['type'] ?? '', ['Trailer', 'Teaser'], true)) { $d['trailer'] = $v['key']; break; }
    }
    if ($body !== null) wp_cache_set($ck, $d);
    return $d;
}

/**
 * Carátulas TMDB para varias tarjetas a la vez. Primera pasada en paralelo (tmdb_id o búsqueda con año);
 * las que no se encuentran pasan por la búsqueda rigurosa wp_tmdb_find (máx. 10 por petición para no demorar).
 * $items = [['k' => clave, 't' => 'movie'|'series', 'tm' => tmdb_id, 'n' => nombre, 'y' => año], ...]
 * Devuelve [clave => url w342].
 */
function wp_tmdb_posters(array $items)
{
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
            if ($hit['p']) $out[$it['k']] = $hit['p'];
            continue;
        }
        if (!$tm && $q === '') continue;
        $url = $tm
            ? 'https://api.themoviedb.org/3/' . $type . '/' . $tm . '?api_key=' . WP_TMDB_KEY . '&language=es-MX'
            : 'https://api.themoviedb.org/3/search/' . $type . '?api_key=' . WP_TMDB_KEY . '&language=es-MX&include_adult=false&query=' . urlencode($q)
                . ($y ? ($type === 'tv' ? '&first_air_date_year=' : '&primary_release_year=') . (int)$y : '');
        $need[$it['k']] = ['ck' => $ck, 'url' => $url, 'tm' => $tm, 'q' => $q, 'y' => $y, 'type' => $type, 'n' => $it['n'] ?? ''];
    }
    if ($need && WP_TMDB_KEY) {
        $urls = [];
        foreach ($need as $k => $n) $urls[$k] = $n['url'];
        foreach (wp_http_multi($urls, 6) as $k => $body) {
            if ($body === null || $body === false || $body === '') continue; // sin respuesta: se reintenta en la próxima visita
            $j = json_decode($body, true);
            if (!is_array($j)) continue;
            $r = $need[$k]['tm'] ? (!empty($j['id']) ? $j : null) : wp_tmdb_pick((array)($j['results'] ?? []), $need[$k]['q'], $need[$k]['y']);
            $p = !empty($r['poster_path']) ? 'https://image.tmdb.org/t/p/w342' . $r['poster_path'] : '';
            if ($p) { wp_cache_set($need[$k]['ck'], ['p' => $p, 't' => time()]); $out[$k] = $p; }
            else $slow[$k] = $need[$k];
        }
        // segunda pasada rigurosa para las que no aparecieron
        $deadline = microtime(true) + 12;
        foreach (array_slice($slow, 0, 10, true) as $k => $n) {
            if (microtime(true) > $deadline) break;
            $r = wp_tmdb_find($n['type'], $n['n'], $n['y'], $n['tm']);
            if (!$r && $n['tm']) $r = wp_tmdb_find($n['type'], $n['n'], $n['y']); // el tmdb_id del servidor puede estar mal
            $p = !empty($r['poster_path']) ? 'https://image.tmdb.org/t/p/w342' . $r['poster_path'] : '';
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
    return $m[$c] ?? ($c !== '' && $c !== 'und' ? strtoupper($c) : '');
}

require_once __DIR__ . '/panel.php';
require_once __DIR__ . '/handoff.php';
