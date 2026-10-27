<?php
/*
 * Reproducción directa cuando la página es HTTPS pero el servidor IPTV entrega el video por HTTP.
 *
 * Un navegador no deja que una página https reproduzca video http (contenido mixto) y
 * hls.js/mpegts.js necesitan permisos CORS del servidor IPTV. Como el video nunca debe
 * pasar por el hosting, en ese caso el reproductor se abre en http://…/play.php: así el
 * navegador lee el video directo del servidor IPTV, igual que antes de usar HTTPS.
 *
 * play.php no usa la cookie de sesión (es https-only): recibe un enlace cifrado con
 * AES-256-GCM (llave propia del hosting) que caduca en 12 horas.
 */

const WP_HANDOFF_TTL = 43200;

function wp_handoff_key()
{
    return hash('sha256', wp_secret() . '|handoff', true);
}

function wp_handoff_make(array $data, $ttl = WP_HANDOFF_TTL)
{
    $data['exp'] = time() + $ttl;
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt(json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 'aes-256-gcm', wp_handoff_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return $ct === false ? '' : wp_b64u_enc($iv . $tag . $ct);
}

function wp_handoff_open($tok)
{
    $raw = wp_b64u_dec((string)$tok);
    if (!is_string($raw) || strlen($raw) < 29) return null;
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', wp_handoff_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    $d = $pt === false ? null : json_decode($pt, true);
    if (!is_array($d) || (int)($d['exp'] ?? 0) < time()) return null;
    return $d;
}

/**
 * Enlace http://…/play.php para este contenido, o '' si no hace falta (la página ya es http).
 * $v = ['kind' => movie|series|live, 'id', 'ext', 'slug', 'series_id', 'title', 'subtitle', 'resume', 'back', 'next']
 */
function wp_handoff_url(array $v)
{
    if (!wp_is_https() || !function_exists('openssl_encrypt')) return '';
    $u = wp_user();
    $tok = wp_handoff_make($v + [
        'srv' => $u['server'],
        'usr' => $u['username'],
        'pwd' => $u['password'],
        'pt' => wp_panel_token(),
        'dt' => wp_panel_tenant(),
        'dm' => wp_is_demo() ? 1 : 0,
    ]);
    if ($tok === '') return '';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    // como token (sin el nombre del archivo): vale sin sesión, el enlace http no comparte la cookie de la web https
    $rt = wp_route_token('play.php', 'd=' . $tok, false);
    return 'http://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/' . ($rt !== '' ? $rt : 'play.php?d=' . $tok);
}

/** Vuelve absoluto un enlace relativo de la web (para usarlo desde play.php en http). */
function wp_handoff_abs($rel)
{
    if ($rel === '' || preg_match('#^https?://#i', $rel)) return $rel;
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return 'https://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/' . ltrim($rel, '/');
}

/**
 * ¿El navegador puede leer este contenido directo por https desde esta página?
 * Prueba desde el hosting (solo unos bytes, el video no pasa por aquí): certificado válido,
 * que las redirecciones sigan en https y, para hls/mpegts, que el servidor permita CORS.
 * Resultado en caché 6 horas por servidor y tipo.
 */
function wp_direct_https_ok($kind, $id, $ext, $needCors)
{
    $url = wp_client_stream_url($kind, $id, $ext);
    if (stripos($url, 'https://') !== 0) return false;
    $ck = 'directok2|' . wp_user()['server'] . '|' . $kind . '|' . $ext;
    $hit = wp_cache_get($ck, 21600);
    if (is_array($hit)) return $needCors ? $hit['cors'] : $hit['ok'];
    $origin = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $hdr = [];
    $got = 0;
    $ch = curl_init($url);
    wp_doh_apply($ch, $url);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 6,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 6,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => WP_UA,
        CURLOPT_HTTPHEADER => ['Range: bytes=0-1023', 'Origin: ' . $origin],
        CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$hdr) {
            $p = strpos($h, ':');
            if ($p !== false) $hdr[strtolower(trim(substr($h, 0, $p)))] = trim(substr($h, $p + 1));
            return strlen($h);
        },
        // se corta en cuanto llegan los primeros bytes (en vivo el flujo no termina)
        CURLOPT_WRITEFUNCTION => function ($c, $d) use (&$got) { $got += strlen($d); return $got > 1024 ? -1 : strlen($d); },
    ]);
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $final = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $err = curl_errno($ch);
    curl_close($ch);
    // CURLE_WRITE_ERROR (23) es el corte voluntario
    $ok = ($err === 0 || $err === 23) && $code >= 200 && $code < 300 && stripos($final, 'https://') === 0;
    $acao = $hdr['access-control-allow-origin'] ?? '';
    $res = ['ok' => $ok, 'cors' => $ok && ($acao === '*' || strcasecmp($acao, $origin) === 0)];
    wp_cache_set($ck, $res);
    return $needCors ? $res['cors'] : $res['ok'];
}

/**
 * Si desde https no hay ninguna fuente directa que funcione, devuelve true:
 * la página debe abrir el reproductor http (play.php) de inmediato.
 */
function wp_needs_handoff($kind, $id, array $sources)
{
    if (!wp_is_https()) return false;
    // el video http lo entrega el hosting (proxy.php): nunca hace falta abrir el reproductor por http
    foreach ($sources as $s) if (!empty($s['host'])) return false;
    if (wp_https_relay() !== '') return false; // el relay https (Cloudflare) entrega el video sin pasar por el hosting
    foreach ($sources as $s) {
        if (wp_direct_https_ok($kind, $id, $s['ext'], $s['engine'] !== 'native')) return false;
    }
    return true;
}
