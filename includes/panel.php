<?php
/**
 * Conexión con el panel (todo se administra desde el panel).
 * - Lista de DNS: api/login.php acción fetch_dns (cifrada con la llave maestra)
 * - Seguir viendo y favoritos: api/progress.php (token por usuario)
 * - Guía de respaldo: api/epg.php
 * - Agenda deportiva: api/sports.php
 *
 * La llave maestra se lee de includes/panel_secret.php (no se sube a GitHub).
 */
if (defined('WP_PANEL_LOADED')) {
    return;
}
define('WP_PANEL_LOADED', true);
require_once __DIR__ . '/core.php';

// Dirección del panel codificada (XOR "KURO" -> base64 -> hex)
define('WP_PANEL_ENC', '4979456d507a6876665741734e4341715053773850796f374e794d34657a3475507a67694e32553250534a6b4f444d38507a41675944733050436f6e656a4d2f496e6f6949796f734e7a30554e43496d5a53553650773d3d');
define('WP_PANEL_DNS_TTL', 600);

/** Carpeta api/ del panel (termina en "/"). */
function wp_panel_base()
{
    static $base = null;
    if ($base !== null) return $base;
    $bin = base64_decode((string)@hex2bin(WP_PANEL_ENC), true);
    $key = 'KURO';
    $url = '';
    for ($i = 0, $n = strlen((string)$bin); $i < $n; $i++) {
        $url .= $bin[$i] ^ $key[$i % 4];
    }
    $base = preg_match('~^https?://~i', $url) ? substr($url, 0, strrpos($url, '/') + 1) : '';
    return $base;
}

function wp_panel_config()
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $cfg = [];
    $file = __DIR__ . '/panel_secret.php';
    if (is_file($file)) {
        $data = include $file;
        if (is_array($data)) $cfg = $data;
    }
    return $cfg;
}

/** Llave maestra en binario (32 bytes) o null si falta. */
function wp_panel_key()
{
    $hex = trim((string)(wp_panel_config()['master_key_hex'] ?? ''));
    return preg_match('/^[0-9a-fA-F]{64}$/', $hex) ? hex2bin($hex) : null;
}

function wp_panel_ready()
{
    return wp_panel_key() !== null && wp_panel_base() !== '' && function_exists('openssl_encrypt');
}

/* ------------------------------------------------------------------ */
/* Cifrado AES-256-GCM + HKDF (igual que el panel)                     */
/* ------------------------------------------------------------------ */

function wp_panel_hkdf($ikm, $salt, $len = 32)
{
    $prk = hash_hmac('sha256', $ikm, $salt, true);
    return substr(hash_hmac('sha256', "\x01", $prk, true), 0, $len);
}

/** base64(salt16 + iv12 + cifrado + tag16) */
function wp_panel_encrypt($plain)
{
    $key = wp_panel_key();
    if ($key === null) return null;
    $salt = random_bytes(16);
    $iv = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt((string)$plain, 'aes-256-gcm', wp_panel_hkdf($key, $salt), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    if ($cipher === false) return null;
    return base64_encode($salt . $iv . $cipher . $tag);
}

function wp_panel_decrypt($b64)
{
    $key = wp_panel_key();
    $bin = base64_decode(trim((string)$b64), true);
    if ($key === null || $bin === false || strlen($bin) < 16 + 12 + 16) return null;
    $salt = substr($bin, 0, 16);
    $iv = substr($bin, 16, 12);
    $tag = substr($bin, -16);
    $cipher = substr($bin, 28, -16);
    $plain = openssl_decrypt($cipher, 'aes-256-gcm', wp_panel_hkdf($key, $salt), OPENSSL_RAW_DATA, $iv, $tag);
    return $plain === false ? null : $plain;
}

/* ------------------------------------------------------------------ */
/* HTTP hacia el panel                                                 */
/* ------------------------------------------------------------------ */

/**
 * Petición al panel. $body: array (se envía como JSON), string (formulario ya armado) o null (GET).
 * Devuelve el cuerpo o null; $code recibe el código HTTP.
 */
function wp_panel_request($endpoint, $body = null, array $headers = [], $timeout = 8, &$code = null)
{
    $code = 0;
    $base = wp_panel_base();
    if ($base === '' || !function_exists('curl_init')) return null;
    if (is_array($body)) {
        $post = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $headers[] = 'Content-Type: application/json';
    } elseif (is_string($body)) {
        $post = $body;
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    } else {
        $post = null;
    }
    $headers[] = 'Accept: application/json';
    // panel caído hace menos de 1 minuto: no se espera otra vez (las páginas no se ponen lentas)
    if (wp_cache_get('panel|down', 60)) return null;
    // 1) https normal  2) https sin revisar el certificado (SSL quitado o vencido)  3) http
    $tries = [[$base, true], [$base, false]];
    if (stripos($base, 'https://') === 0) $tries[] = ['http://' . substr($base, 8), false];
    $last = wp_cache_get('panel|mode', 3600);
    if (is_int($last) && isset($tries[$last])) $tries = array_merge([$tries[$last]], $tries);
    foreach ($tries as $i => $t) {
        $url = $t[0] . $endpoint;
        $ch = curl_init($url);
        wp_doh_apply($ch, $url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => WP_UA,
            CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => $t[1],
            CURLOPT_SSL_VERIFYHOST => $t[1] ? 2 : 0,
            CURLOPT_HTTPHEADER => $headers,
        ];
        if ($post !== null) {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = $post;
        }
        curl_setopt_array($ch, $opts);
        $res = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_errno($ch);
        $GLOBALS['wp_panel_last_error'] = $err ? $err . ' ' . curl_error($ch) : '';
        curl_close($ch);
        // http que redirige a https (o https que ya no responde): se prueba la siguiente forma
        if (!$err && $res !== false && $code > 0 && ($code < 300 || $code >= 400)) {
            $mode = array_search($t, [[$base, true], [$base, false], ['http://' . substr($base, 8), false]], true);
            if ($mode !== false && $mode !== $last) wp_cache_set('panel|mode', $mode);
            return (string)$res;
        }
    }
    wp_cache_set('panel|down', 1);
    return null;
}

/* ------------------------------------------------------------------ */
/* DNS desde el panel (caché 10 min + última copia buena)               */
/* ------------------------------------------------------------------ */

function wp_panel_last_dns_file()
{
    return wp_cache_dir('panel') . '/dns_last.json';
}

/** Lista de URLs de DNS tal como las entrega el panel. */
function wp_panel_dns_urls()
{
    static $memo = null;
    if ($memo !== null) return $memo;
    $urls = wp_cache_get('panel|dns', WP_PANEL_DNS_TTL, $stale);
    if (is_array($urls) && $urls) return $memo = $urls;

    $fresh = null;
    if (wp_panel_ready()) {
        $payload = wp_panel_encrypt(json_encode(['app' => 'webplayer', 't' => time()]));
        $body = $payload ? wp_panel_request('login.php', http_build_query(['action' => 'fetch_dns', 'data' => $payload]), [], 8, $code) : null;
        if ($body !== null && $code === 200) {
            $plain = wp_panel_decrypt($body);
            $list = $plain !== null ? json_decode($plain, true) : null;
            if (is_array($list)) {
                $fresh = [];
                foreach ($list as $u) {
                    $u = rtrim(trim(is_array($u) ? (string)($u['url'] ?? '') : (string)$u), '/');
                    if ($u === '') continue;
                    if (!preg_match('~^https?://~i', $u)) $u = 'http://' . $u;
                    $fresh[] = $u;
                }
                $fresh = array_values(array_unique($fresh));
            }
        }
    }
    if ($fresh) {
        wp_cache_set('panel|dns', $fresh);
        @file_put_contents(wp_panel_last_dns_file(), json_encode($fresh, JSON_UNESCAPED_SLASHES), LOCK_EX);
        return $memo = $fresh;
    }
    // El panel no respondió: se usa la última lista buena
    if (is_array($stale) && $stale) return $memo = $stale;
    $last = wp_json_file(wp_panel_last_dns_file());
    return $memo = (is_array($last) ? array_values($last) : []);
}

/* ------------------------------------------------------------------ */
/* Token por usuario (progress.php acción auth)                        */
/* ------------------------------------------------------------------ */

/** Pide un token al panel con el usuario y la contraseña de la línea. */
function wp_panel_auth($user, $pass)
{
    if (!wp_panel_ready() || $user === '' || $pass === '') return '';
    $body = wp_panel_request('progress.php', ['action' => 'auth', 'user' => (string)$user, 'pass' => (string)$pass], [], 8, $code);
    $j = $body !== null ? json_decode($body, true) : null;
    return (is_array($j) && !empty($j['token']) && is_string($j['token'])) ? $j['token'] : '';
}

function wp_panel_token()
{
    return (string)($_SESSION['panel_token'] ?? '');
}

/** Guarda un token nuevo en la sesión (si todavía se puede escribir). */
function wp_panel_store_token($token)
{
    $_SESSION['panel_token'] = $token;
    // play.php (reproductor http) no tiene sesión que guardar
    if (defined('WP_HANDOFF') || session_status() === PHP_SESSION_ACTIVE) return;
    if (headers_sent()) return;
    $mem = $_SESSION;
    wp_session_start();
    if (session_status() === PHP_SESSION_ACTIVE) {
        if (($_SESSION['username'] ?? '') === ($mem['username'] ?? '')) $_SESSION['panel_token'] = $token;
        $all = $_SESSION;
        session_write_close();
        $_SESSION = $all;
    } else {
        $_SESSION = $mem;
    }
}

/**
 * Llamada autenticada (token Bearer). Si el token caducó, se renueva con la
 * línea de la sesión y se repite una vez. Devuelve el JSON decodificado o null.
 */
function wp_panel_call($endpoint, $body = null, $timeout = 8)
{
    if (!wp_panel_ready()) return null;
    $token = wp_panel_token();
    for ($try = 0; $try < 2; $try++) {
        if ($token === '') {
            $u = wp_user();
            $token = wp_panel_auth($u['username'], $u['password']);
            if ($token === '') return null;
            wp_panel_store_token($token);
        }
        $res = wp_panel_request($endpoint, $body, ['Authorization: Bearer ' . $token], $timeout, $code);
        if ($code === 401 && $try === 0) {
            $token = '';
            continue;
        }
        if ($res === null || $code < 200 || $code >= 300) return null;
        $j = json_decode($res, true);
        return is_array($j) ? $j : null;
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Seguir viendo y favoritos (en el panel, nada local)                  */
/* ------------------------------------------------------------------ */

/** {progress: {...}, favorites: [...]} del usuario (una vez por petición). */
function wp_panel_userdata($refresh = false)
{
    static $memo = null;
    if ($memo !== null && !$refresh) return $memo;
    $j = wp_panel_call('progress.php?v=2', null, 6);
    $memo = [
        'progress' => (is_array($j) && is_array($j['progress'] ?? null)) ? $j['progress'] : [],
        'favorites' => (is_array($j) && is_array($j['favorites'] ?? null)) ? $j['favorites'] : [],
    ];
    return $memo;
}

function wp_panel_post($action, array $data)
{
    $j = wp_panel_call('progress.php', ['action' => $action] + $data, 8);
    return is_array($j) && !empty($j['success']);
}

/** Solo URLs http(s), como las acepta el panel. */
function wp_panel_url($u)
{
    $u = trim((string)$u);
    return preg_match('~^https?://~i', $u) ? $u : '';
}

/**
 * Progreso del usuario con el formato que usan las páginas:
 * ['movie_ID' | 'series_EPISODIO' => [stream_id, series_id, type, title, poster_url, current_time, total_time, last_watched]]
 */
function wp_user_progress($username = '')
{
    $out = [];
    foreach (wp_panel_userdata()['progress'] as $title => $p) {
        if (!is_array($p)) continue;
        $type = (string)($p['type'] ?? 'movie');
        $id = preg_replace('/[^0-9]/', '', (string)($p['id'] ?? ''));
        if ($id === '' || $type === 'live') continue;
        $isSeries = in_array($type, ['episode', 'series'], true);
        $seriesId = preg_replace('/[^0-9]/', '', (string)($p['seriesId'] ?? ''));
        if ($isSeries && $seriesId === '') continue;
        $key = ($isSeries ? 'series_' : 'movie_') . $id;
        $out[$key] = [
            'stream_id' => $id,
            'series_id' => $isSeries ? $seriesId : '0',
            'type' => $isSeries ? 'series' : 'movie',
            'title' => (string)$title,
            'poster_url' => (string)($p['poster'] ?? ''),
            'current_time' => (int)($p['position'] ?? 0),
            'total_time' => (int)($p['duration'] ?? 0),
            'last_watched' => (int)@strtotime((string)($p['updatedAt'] ?? '')),
        ];
    }
    return $out;
}

/** Favoritos del usuario: [ [stream_id, type, title, poster_url, category_id, added_at], ... ] más nuevos primero. */
function wp_user_favorites($type = null)
{
    $out = [];
    foreach (wp_panel_userdata()['favorites'] as $f) {
        if (!is_array($f)) continue;
        $t = (string)($f['type'] ?? '');
        $id = (string)($f['id'] ?? '');
        if ($id === '' || ($type !== null && $t !== $type)) continue;
        $out[] = [
            'stream_id' => $id,
            'type' => $t,
            'title' => (string)($f['title'] ?? ''),
            'poster_url' => (string)($f['poster'] ?? ''),
            'category_id' => (string)($f['categoryId'] ?? ''),
            'added_at' => (int)@strtotime((string)($f['addedAt'] ?? '')),
        ];
    }
    usort($out, function ($a, $b) { return $b['added_at'] - $a['added_at']; });
    return $out;
}

function wp_is_favorite($type, $id)
{
    foreach (wp_user_favorites($type) as $f) {
        if ((string)$f['stream_id'] === (string)$id) return true;
    }
    return false;
}

/* ------------------------------------------------------------------ */
/* Guía de respaldo (api/epg.php)                                      */
/* ------------------------------------------------------------------ */

/**
 * $channels = [ ['id' => .., 'epg' => .., 'name' => ..], ... ]
 * Devuelve [id => [ ['s','e','t','d'], ... ]]. Caché corta por canal.
 */
function wp_panel_epg(array $channels, $ttl = 900)
{
    $out = [];
    $missing = [];
    foreach ($channels as $c) {
        $id = (string)($c['id'] ?? '');
        if ($id === '') continue;
        $ch = ['id' => $id, 'epg' => (string)($c['epg'] ?? ''), 'name' => (string)($c['name'] ?? '')];
        $ck = 'pepg|' . md5($ch['id'] . '|' . $ch['epg'] . '|' . $ch['name']);
        $hit = wp_cache_get($ck, $ttl, $stale);
        if (is_array($hit)) {
            $out[$id] = $hit;
        } else {
            $missing[$id] = $ch;
            $out[$id] = is_array($stale) ? $stale : [];
        }
    }
    if ($missing) {
        $j = wp_panel_call('epg.php', ['channels' => array_values(array_slice($missing, 0, 400, true))], 10);
        if (is_array($j)) {
            $map = is_array($j['epg'] ?? null) ? $j['epg'] : [];
            foreach ($missing as $id => $ch) {
                $list = [];
                foreach ((is_array($map[$id] ?? null) ? $map[$id] : []) as $p) {
                    if (!is_array($p)) continue;
                    $list[] = ['s' => (int)($p['s'] ?? 0), 'e' => (int)($p['e'] ?? 0), 't' => (string)($p['t'] ?? ''), 'd' => (string)($p['d'] ?? '')];
                }
                wp_cache_set('pepg|' . md5($ch['id'] . '|' . $ch['epg'] . '|' . $ch['name']), $list);
                $out[$id] = $list;
            }
            wp_cache_set('pepg|status', ['t' => time(), 'updated' => (int)($j['updated'] ?? 0)]);
        }
    }
    $now = time();
    foreach ($out as $id => $list) {
        $out[$id] = array_values(array_filter($list, function ($p) use ($now) { return $p['e'] > $now - 1800; }));
    }
    return $out;
}

/* ------------------------------------------------------------------ */
/* Agenda deportiva (api/sports.php)                                   */
/* ------------------------------------------------------------------ */

/** {events: [...], sports: {...}, match: {...}} con caché de 10 min y última copia buena. */
function wp_panel_sports()
{
    $data = wp_cache_get('panel|sports', 600, $stale);
    if (is_array($data)) return $data;
    $j = wp_panel_call('sports.php', null, 12);
    if (is_array($j) && is_array($j['events'] ?? null)) {
        wp_cache_set('panel|sports', $j);
        return $j;
    }
    return is_array($stale) ? $stale : ['events' => []];
}
