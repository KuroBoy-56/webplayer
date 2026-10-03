<?php
/**
 * Núcleo compartido de la WebPlayer.
 * - Sesión segura (sin bloqueos entre peticiones)
 * - Lectura de DNS/servidores
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

// true = todo el video pasa por el servidor (oculta la DNS al navegador, consume más ancho de banda)
if (!defined('WP_FORCE_PROXY')) {
    define('WP_FORCE_PROXY', false);
}

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
    if (!headers_sent()) {
        $params = session_get_cookie_params();
        $opts = [
            'lifetime' => 0,
            'path' => $params['path'] ?: '/',
            'secure' => wp_is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ];
        if (PHP_VERSION_ID >= 70300) {
            session_set_cookie_params($opts);
        } else {
            session_set_cookie_params(0, $opts['path'] . '; samesite=Lax', '', $opts['secure'], true);
        }
        @ini_set('session.use_strict_mode', '1');
        @ini_set('session.use_only_cookies', '1');
        @ini_set('session.gc_maxlifetime', '86400');
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

function wp_admin_config()
{
    return wp_json_file(WP_ROOT . '/includes/admin/admin.json');
}

function wp_dns_config()
{
    return wp_json_file(WP_ROOT . '/includes/dns/dns.json');
}

/** Lista de servidores configurados (en orden) => [ ['id'=>1,'name'=>..,'url'=>..], ... ] */
function wp_dns_list()
{
    $json = wp_dns_config();
    $n = isset($json['dns_number']) ? $json['dns_number'] : 'no';
    $n = ($n === 'no' || (int)$n < 1) ? 1 : min(6, (int)$n);
    $list = [];
    for ($i = 1; $i <= $n; $i++) {
        $url = trim((string)($json['server' . $i] ?? ''));
        if ($url === '') continue;
        if (!preg_match('~^https?://~i', $url)) $url = 'http://' . $url;
        $list[] = ['id' => (string)$i, 'name' => (string)($json['server' . $i . '_name'] ?? ('Server ' . $i)), 'url' => rtrim($url, '/')];
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
 * Enlace firmado hacia proxy.php / img.php.
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
 * Base https del servidor IPTV si lo soporta (server_info.https_port), p. ej. https://host:25463
 * Así en un sitio https el video va directo del servidor al navegador, sin pasar por el hosting.
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
    if ($hp <= 0) return $memo = null;
    $base = 'https://' . $p['host'] . ($hp === 443 ? '' : ':' . $hp);
    // Sólo sirve si el navegador acepta el certificado: una IP o un certificado vencido harían fallar el video.
    if (filter_var($p['host'], FILTER_VALIDATE_IP)) return $memo = null;
    $ck = 'httpsok|' . $base;
    $ok = wp_cache_get($ck, 21600);
    if ($ok === null) {
        $ch = curl_init($base . '/player_api.php');
        curl_setopt_array($ch, [CURLOPT_NOBODY => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 6,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_USERAGENT => WP_UA]);
        curl_exec($ch);
        $ok = curl_errno($ch) === 0 && (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE) > 0 ? 1 : 0;
        curl_close($ch);
        wp_cache_set($ck, $ok);
    }
    return $memo = ($ok ? $base : null);
}

/**
 * Fuentes de reproducción en orden de prueba para NFPlayer.
 * $exts = extensiones a probar (p. ej. ['mp4','mkv','m3u8']).
 */
function wp_play_sources($kind, $id, array $exts)
{
    $out = [];
    $https = wp_is_https();
    $hbase = $https && !WP_FORCE_PROXY ? wp_server_https_base() : null;
    foreach ($exts as $x) {
        $u = wp_stream_url($kind, $id, $x);
        $engine = $x === 'm3u8' ? 'hls' : ($x === 'ts' ? 'mpegts' : 'native');
        if (!WP_FORCE_PROXY) {
            if (!$https || stripos($u, 'https://') === 0) {
                $out[] = ['url' => $u, 'engine' => $engine];
            } elseif ($hbase) {
                $out[] = ['url' => $hbase . substr($u, strlen(rtrim(wp_user()['server'], '/'))), 'engine' => $engine, 'quick' => 1];
            }
        }
        $out[] = ['url' => wp_proxy_url($u), 'engine' => $engine];
    }
    return $out;
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

/* ------------------------------------------------------------------ */
/* Progreso / favoritos (mismos archivos de siempre)                   */
/* ------------------------------------------------------------------ */

function wp_progress_all()
{
    return wp_json_file(WP_ROOT . '/progress.json');
}

function wp_user_progress($username)
{
    $all = wp_progress_all();
    return isset($all[$username]) && is_array($all[$username]) ? $all[$username] : [];
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

function wp_is_admin()
{
    return !empty($_SESSION['is_admin']);
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
    $t = preg_replace('/\([^)]*\)|\[[^\]]*\]/', '', (string)$title);
    $t = preg_replace('/^\s*(?:[A-Z]{2,3}|4K|HD|FHD|LAT|SUB|ES|VOSE)\s*[-|:]\s*/u', '', $t); // prefijos "LAT - ", "4K | "
    $t = preg_replace('/\b(?:19|20)\d{2}\b\s*$/', '', $t);
    return trim(preg_replace('/\s+/', ' ', $t), " -|:");
}

/** Busca el id de TMDB por título (+ año) sin pedir más datos. */
function wp_tmdb_search($type, $title, $year = '')
{
    $q = wp_tmdb_clean_title($title);
    if ($q === '' || !WP_TMDB_KEY) return null;
    $ck = 'tmdbs|' . $type . '|' . wp_norm_title($q) . '|' . $year;
    $hit = wp_cache_get($ck, 2592000);
    if (is_array($hit)) return $hit['r'];
    $url = 'https://api.themoviedb.org/3/search/' . $type . '?api_key=' . WP_TMDB_KEY . '&language=es-ES&include_adult=false&query=' . urlencode($q);
    if ($year) $url .= ($type === 'tv' ? '&first_air_date_year=' : '&year=') . (int)$year;
    $body = wp_http_get($url, 5);
    $s = $body ? json_decode($body, true) : null;
    $r = !empty($s['results'][0]['id']) ? $s['results'][0] : null;
    if (!$r && $year && is_array($s)) return wp_tmdb_search($type, $title, '');
    if ($body !== null) wp_cache_set($ck, ['r' => $r]);
    return $r;
}

/**
 * Datos completos de TMDB. $type = 'movie' | 'tv'. Usa el tmdb_id del servidor si existe (más exacto).
 * Devuelve ['id','poster','backdrop','cast','trailer','overview'] (caché 7 días).
 */
function wp_tmdb_details($type, $tmdbId, $title, $year = '')
{
    $tmdbId = preg_replace('/\D/', '', (string)$tmdbId);
    $ck = 'tmdbd|' . $type . '|' . ($tmdbId ?: wp_norm_title($title) . '|' . $year);
    $d = wp_cache_get($ck, 604800);
    if (is_array($d)) return $d;
    $d = ['id' => null, 'poster' => '', 'backdrop' => '', 'cast' => [], 'trailer' => '', 'overview' => ''];
    if (!WP_TMDB_KEY) return $d;
    if (!$tmdbId) {
        $r = wp_tmdb_search($type, $title, $year);
        $tmdbId = $r['id'] ?? '';
    }
    if ($tmdbId) {
        $body = wp_http_get('https://api.themoviedb.org/3/' . $type . '/' . $tmdbId . '?api_key=' . WP_TMDB_KEY
            . '&language=es-ES&append_to_response=credits,videos&include_video_language=es,en,null', 5);
        $j = $body ? json_decode($body, true) : null;
        if (is_array($j) && !empty($j['id'])) {
            $d['id'] = $j['id'];
            $d['poster'] = !empty($j['poster_path']) ? 'https://image.tmdb.org/t/p/w500' . $j['poster_path'] : '';
            $d['backdrop'] = !empty($j['backdrop_path']) ? 'https://image.tmdb.org/t/p/w1280' . $j['backdrop_path'] : '';
            $d['overview'] = (string)($j['overview'] ?? '');
            foreach (array_slice($j['credits']['cast'] ?? [], 0, 12) as $a) {
                $d['cast'][] = ['n' => $a['name'] ?? '', 'c' => $a['character'] ?? '', 'p' => !empty($a['profile_path']) ? 'https://image.tmdb.org/t/p/w185' . $a['profile_path'] : ''];
            }
            $vids = $j['videos']['results'] ?? [];
            usort($vids, function ($a, $b) { return (($b['iso_639_1'] ?? '') === 'es') <=> (($a['iso_639_1'] ?? '') === 'es'); });
            foreach ($vids as $v) {
                if (($v['site'] ?? '') === 'YouTube' && in_array($v['type'] ?? '', ['Trailer', 'Teaser'], true)) { $d['trailer'] = $v['key']; break; }
            }
        }
    }
    wp_cache_set($ck, $d);
    return $d;
}

/**
 * Carátulas TMDB para varias tarjetas a la vez (en paralelo, caché 30 días).
 * $items = [['k' => clave, 't' => 'movie'|'series', 'tm' => tmdb_id, 'n' => nombre, 'y' => año], ...]
 * Devuelve [clave => url w342].
 */
function wp_tmdb_posters(array $items)
{
    $out = [];
    $need = [];
    foreach ($items as $it) {
        $type = ($it['t'] ?? '') === 'series' ? 'tv' : 'movie';
        $tm = preg_replace('/\D/', '', (string)($it['tm'] ?? ''));
        $ck = 'tmdbp|' . $type . '|' . ($tm ?: wp_norm_title(wp_tmdb_clean_title($it['n'] ?? '')) . '|' . ($it['y'] ?? ''));
        $hit = wp_cache_get($ck, 2592000);
        if (is_array($hit)) {
            if ($hit['p']) $out[$it['k']] = $hit['p'];
            continue;
        }
        $q = wp_tmdb_clean_title($it['n'] ?? '');
        if (!$tm && $q === '') continue;
        $url = $tm
            ? 'https://api.themoviedb.org/3/' . $type . '/' . $tm . '?api_key=' . WP_TMDB_KEY . '&language=es-ES'
            : 'https://api.themoviedb.org/3/search/' . $type . '?api_key=' . WP_TMDB_KEY . '&language=es-ES&include_adult=false&query=' . urlencode($q)
                . (!empty($it['y']) ? ($type === 'tv' ? '&first_air_date_year=' : '&year=') . (int)$it['y'] : '');
        $need[$it['k']] = ['ck' => $ck, 'url' => $url, 'tm' => $tm];
    }
    if ($need && WP_TMDB_KEY) {
        $urls = [];
        foreach ($need as $k => $n) $urls[$k] = $n['url'];
        foreach (wp_http_multi($urls, 6) as $k => $body) {
            if ($body === null || $body === false || $body === '') continue;
            $j = json_decode($body, true);
            if (!is_array($j)) continue;
            $r = $need[$k]['tm'] ? $j : ($j['results'][0] ?? null);
            $p = !empty($r['poster_path']) ? 'https://image.tmdb.org/t/p/w342' . $r['poster_path'] : '';
            wp_cache_set($need[$k]['ck'], ['p' => $p]);
            if ($p) $out[$k] = $p;
        }
    }
    return $out;
}


/* ------------------------------------------------------------------ */
/* FFmpeg opcional: audio Dolby (AC3/E-AC3/DTS), pistas y subtítulos   */
/* ------------------------------------------------------------------ */

/** Ruta de un binario (ffmpeg|ffprobe) o null. Se puede subir un ffmpeg estático a la carpeta bin/. */
function wp_bin($name)
{
    static $memo = [];
    if (array_key_exists($name, $memo)) return $memo[$name];
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    if (!function_exists('proc_open') || in_array('proc_open', $disabled, true)) return $memo[$name] = null;
    $const = 'WP_' . strtoupper($name);
    $cands = [];
    if (defined($const)) $cands[] = constant($const);
    $cands[] = WP_ROOT . '/bin/' . $name;
    $cands[] = '/usr/bin/' . $name;
    $cands[] = '/usr/local/bin/' . $name;
    $cands[] = '/opt/homebrew/bin/' . $name;
    foreach ($cands as $c) {
        if ($c && @is_file($c) && @is_executable($c)) return $memo[$name] = $c;
    }
    return $memo[$name] = null;
}

/** Información de pistas (ffprobe) con caché de 7 días. */
function wp_probe($url)
{
    $ck = 'probe|' . md5($url);
    $hit = wp_cache_get($ck, 604800);
    if (is_array($hit)) return $hit;
    $bin = wp_bin('ffprobe');
    if (!$bin) return null;
    $cmd = [$bin, '-v', 'error', '-user_agent', WP_UA, '-rw_timeout', '15000000', '-show_entries',
        'format=duration:stream=index,codec_type,codec_name,channels,profile:stream_tags=language,title:stream_disposition=default,forced',
        '-of', 'json', $url];
    $out = wp_run($cmd, 25);
    $j = $out ? json_decode($out, true) : null;
    if (!is_array($j)) return null;
    $res = ['dur' => (float)($j['format']['duration'] ?? 0), 'video' => '', 'audio' => [], 'subs' => []];
    $ai = 0; $si = 0;
    foreach ($j['streams'] ?? [] as $st) {
        $type = $st['codec_type'] ?? '';
        $lang = strtolower((string)($st['tags']['language'] ?? ''));
        $title = (string)($st['tags']['title'] ?? '');
        if ($type === 'video' && $res['video'] === '' && ($st['codec_name'] ?? '') !== 'mjpeg' && ($st['codec_name'] ?? '') !== 'png') {
            $res['video'] = (string)($st['codec_name'] ?? '');
        } elseif ($type === 'audio') {
            $res['audio'][] = ['i' => $ai++, 'codec' => (string)($st['codec_name'] ?? ''), 'ch' => (int)($st['channels'] ?? 0),
                'lang' => $lang, 'title' => $title, 'def' => !empty($st['disposition']['default'])];
        } elseif ($type === 'subtitle') {
            $c = (string)($st['codec_name'] ?? '');
            $res['subs'][] = ['i' => $si++, 'codec' => $c, 'lang' => $lang, 'title' => $title, 'forced' => !empty($st['disposition']['forced']),
                'text' => in_array($c, ['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'srt'], true)];
        }
    }
    wp_cache_set($ck, $res);
    return $res;
}

/** Ejecuta un comando sin shell y devuelve stdout (o null). */
function wp_run(array $cmd, $timeout = 20)
{
    $line = implode(' ', array_map('escapeshellarg', $cmd));
    $p = @proc_open($line, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($p)) return null;
    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);
    $out = '';
    $end = microtime(true) + $timeout;
    while (microtime(true) < $end) {
        $r = [$pipes[1], $pipes[2]]; $w = null; $x = null;
        if (@stream_select($r, $w, $x, 1) === false) break;
        foreach ($r as $fh) {
            $chunk = fread($fh, 65536);
            if ($fh === $pipes[1] && $chunk !== false) $out .= $chunk;
        }
        $st = proc_get_status($p);
        if (!$st['running']) { $out .= stream_get_contents($pipes[1]); break; }
    }
    @fclose($pipes[1]); @fclose($pipes[2]);
    $st = proc_get_status($p);
    if ($st['running']) @proc_terminate($p, 9);
    @proc_close($p);
    return $out !== '' ? $out : null;
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
