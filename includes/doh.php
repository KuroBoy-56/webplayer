<?php
/* El botón DNS se quitó de la web player (solo existe en Android, Windows y Roku).
 *
 * wp_doh_apply(): curl resuelve los nombres en un hilo aparte. Cuando el hosting llega a su límite
 * de procesos ese hilo no puede crearse ("getaddrinfo() thread failed to start") y TODA petición
 * falla. Aquí el nombre se resuelve con gethostbyname() (sin hilos) y se le pasa la IP a curl.
 * La IP queda en caché 30 minutos. */
function wp_dns_choice() { return 'auto'; }

function wp_resolve_ip($host)
{
    static $memo = [];
    $host = strtolower((string)$host);
    if ($host === '' || filter_var($host, FILTER_VALIDATE_IP)) return '';
    if (isset($memo[$host])) return $memo[$host];
    $hit = function_exists('wp_cache_get') ? wp_cache_get('ip|' . $host, 1800) : null;
    if (is_string($hit) && $hit !== '') return $memo[$host] = $hit;
    $ip = @gethostbyname($host);
    if (!filter_var($ip, FILTER_VALIDATE_IP)) return $memo[$host] = '';
    if (function_exists('wp_cache_set')) wp_cache_set('ip|' . $host, $ip);
    return $memo[$host] = $ip;
}

function wp_doh_apply($ch, $url)
{
    $p = parse_url((string)$url);
    $host = (string)($p['host'] ?? '');
    $ip = wp_resolve_ip($host);
    if ($ip === '') return;
    $port = (int)($p['port'] ?? (strtolower((string)($p['scheme'] ?? 'http')) === 'https' ? 443 : 80));
    @curl_setopt($ch, CURLOPT_RESOLVE, [$host . ':' . $port . ':' . $ip]);
}

function wp_doh_ffmpeg($url) { return [$url, []]; }
