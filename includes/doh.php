<?php
/**
 * DNS elegido por el usuario (botón "DNS").
 * El navegador no deja cambiar su DNS, así que la elección se aplica a las
 * peticiones que hace el hosting: API Xtream, proxy de video, imágenes, panel y ffmpeg.
 * Se resuelve con DNS sobre HTTPS (formato estándar RFC 8484, sirve con todos los
 * proveedores, también OpenDNS que no tiene API JSON) y se fija la IP con
 * CURLOPT_RESOLVE (caché de hasta 10 minutos). Si el PHP trae CURLOPT_DOH_URL
 * (PHP 8.2+ con curl 7.62+), también se usa para las redirecciones a otros hosts.
 */
require_once __DIR__ . '/core.php';

function wp_dns_providers()
{
    return [
        'auto' => ['label' => 'Automático', 'desc' => 'El DNS normal del hosting. Recomendado si todo funciona bien.', 'doh' => ''],
        'cloudflare' => ['label' => 'Cloudflare', 'desc' => 'Rápido y privado (1.1.1.1). Útil si tu proveedor de internet resuelve lento.', 'doh' => 'https://cloudflare-dns.com/dns-query'],
        'google' => ['label' => 'Google', 'desc' => 'Estable y muy disponible (8.8.8.8).', 'doh' => 'https://dns.google/dns-query'],
        'quad9' => ['label' => 'Quad9', 'desc' => 'Bloquea dominios peligrosos (malware y fraude).', 'doh' => 'https://dns.quad9.net/dns-query'],
        'adguard' => ['label' => 'AdGuard', 'desc' => 'Sin rastreo ni anuncios.', 'doh' => 'https://dns.adguard-dns.com/dns-query'],
        'nextdns' => ['label' => 'NextDNS', 'desc' => 'Anti-bloqueo geográfico: ayuda cuando un servidor está bloqueado por DNS en tu zona.', 'doh' => 'https://dns.nextdns.io/dns-query'],
        'opendns' => ['label' => 'OpenDNS', 'desc' => 'DNS de Cisco, confiable y con protección contra phishing.', 'doh' => 'https://doh.opendns.com/dns-query'],
    ];
}

/** Elección actual (cookie "wp_dns"; no es un dato secreto). */
function wp_dns_choice()
{
    static $c = null;
    if ($c !== null) return $c;
    $v = (string)($_COOKIE['wp_dns'] ?? 'auto');
    $p = wp_dns_providers();
    return $c = isset($p[$v]) ? $v : 'auto';
}

function wp_dns_doh_url()
{
    $p = wp_dns_providers();
    return $p[wp_dns_choice()]['doh'];
}

/** Arma una consulta DNS (tipo A o AAAA) en formato binario. */
function wp_doh_query($host, $type = 1)
{
    $q = pack('n6', 0, 0x0100, 1, 0, 0, 0);
    foreach (explode('.', rtrim($host, '.')) as $label) {
        if ($label === '' || strlen($label) > 63) return null;
        $q .= chr(strlen($label)) . $label;
    }
    return $q . "\0" . pack('n2', $type, 1);
}

/** Salta un nombre DNS (con compresión) y devuelve la nueva posición. */
function wp_doh_skip_name($msg, $pos)
{
    $len = strlen($msg);
    while ($pos < $len) {
        $l = ord($msg[$pos]);
        if ($l === 0) return $pos + 1;
        if (($l & 0xC0) === 0xC0) return $pos + 2;
        $pos += $l + 1;
    }
    return $len;
}

/** Lee las respuestas A/AAAA de un mensaje DNS => [ips, ttl] */
function wp_doh_parse($msg, $type)
{
    if (strlen($msg) < 12) return [[], 0];
    $h = unpack('nid/nflags/nqd/nan', substr($msg, 0, 8));
    if (($h['flags'] & 0x000F) !== 0) return [[], 0];
    $pos = 12;
    for ($i = 0; $i < $h['qd']; $i++) $pos = wp_doh_skip_name($msg, $pos) + 4;
    $ips = [];
    $ttl = 600;
    for ($i = 0; $i < $h['an'] && $pos < strlen($msg); $i++) {
        $pos = wp_doh_skip_name($msg, $pos);
        if ($pos + 10 > strlen($msg)) break;
        $rr = unpack('ntype/nclass/Nttl/nlen', substr($msg, $pos, 10));
        $pos += 10;
        $data = substr($msg, $pos, $rr['len']);
        $pos += $rr['len'];
        if ($rr['type'] === $type && (($type === 1 && strlen($data) === 4) || ($type === 28 && strlen($data) === 16))) {
            $ip = inet_ntop($data);
            if ($ip !== false) {
                $ips[] = $ip;
                $ttl = min($ttl, max(60, $rr['ttl']));
            }
        }
    }
    return [$ips, $ttl];
}

/** Resuelve un host con el DNS elegido. Devuelve una IP o null (entonces se usa el DNS normal). */
function wp_doh_resolve($host)
{
    $doh = wp_dns_doh_url();
    $host = strtolower(trim((string)$host, '[]'));
    if ($doh === '' || $host === '' || filter_var($host, FILTER_VALIDATE_IP) || !function_exists('curl_init')) return null;
    if ($host === 'localhost' || $host === strtolower((string)parse_url($doh, PHP_URL_HOST))) return null;
    static $memo = [];
    $ck = 'doh|' . wp_dns_choice() . '|' . $host;
    if (array_key_exists($ck, $memo)) return $memo[$ck];
    $hit = wp_cache_get($ck, 600);
    if (is_array($hit) && isset($hit['ip'], $hit['exp']) && $hit['exp'] > time()) return $memo[$ck] = ($hit['ip'] ?: null);

    $ip = null;
    $ttl = 120; // si falla, se reintenta en 2 minutos
    foreach ([1, 28] as $type) {
        $q = wp_doh_query($host, $type);
        if ($q === null) break;
        $ch = curl_init($doh . '?dns=' . rtrim(strtr(base64_encode($q), '+/', '-_'), '='));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 4,
            CURLOPT_HTTPHEADER => ['Accept: application/dns-message'],
            CURLOPT_USERAGENT => WP_UA,
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body === false || $code !== 200) break;
        list($ips, $t) = wp_doh_parse((string)$body, $type);
        if ($ips) {
            $ip = $ips[0];
            $ttl = $t;
            break;
        }
    }
    wp_cache_set($ck, ['ip' => (string)$ip, 'exp' => time() + $ttl]);
    return $memo[$ck] = $ip;
}

/** Aplica el DNS elegido a un handle de curl. */
function wp_doh_apply($ch, $url)
{
    if (wp_dns_choice() === 'auto') return;
    $p = parse_url((string)$url);
    if (!$p || empty($p['host'])) return;
    $port = isset($p['port']) ? (int)$p['port'] : (strtolower($p['scheme'] ?? 'http') === 'https' ? 443 : 80);
    $ip = wp_doh_resolve($p['host']);
    // Si el proveedor DoH no responde desde el hosting se usa el DNS normal (nunca se corta el video)
    if ($ip === null) return;
    curl_setopt($ch, CURLOPT_RESOLVE, [$p['host'] . ':' . $port . ':' . (strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip)]);
    if (defined('CURLOPT_DOH_URL')) {
        $v = curl_version();
        if (($v['version_number'] ?? 0) >= 0x073E00) @curl_setopt($ch, CURLOPT_DOH_URL, wp_dns_doh_url());
    }
}

/**
 * Para ffmpeg/ffprobe (no usan curl): en enlaces http:// se cambia el host por la IP
 * resuelta y se envía la cabecera Host original. Devuelve [url, opciones extra].
 */
function wp_doh_ffmpeg($url)
{
    if (wp_dns_choice() === 'auto' || stripos((string)$url, 'http://') !== 0) return [$url, []];
    $p = parse_url($url);
    if (empty($p['host'])) return [$url, []];
    $ip = wp_doh_resolve($p['host']);
    if ($ip === null || strpos($ip, ':') !== false) return [$url, []];
    $hostHdr = $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    $new = preg_replace('~^http://[^/:]+~i', 'http://' . $ip, $url, 1);
    return [$new, ['-headers', 'Host: ' . $hostHdr . "\r\n"]];
}
