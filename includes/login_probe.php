<?php
/**
 * Inicio de sesión con varias DNS (login.php): en qué orden se prueban y, si ninguna deja entrar, por qué.
 *
 * Todos los usuarios de la web salen a internet con la IP del hosting. Cada DNS donde el usuario no existe le cuenta a
 * XUI un intento fallido desde esa IP, y XUI la bloquea al juntar varios (protección contra flood): después el hosting
 * no puede conectarse a nada de ese servidor («curl 7 Failed to connect…» en todas las DNS) y nadie entra por la web.
 * Con un número de distribuidor pasaba más: fetch_dns trae sus DNS y, si no está aislado, también las del dueño, y se
 * probaban todas a la vez. Ahora se prueban de a una, primero la que más usuarios de ese distribuidor usan
 * (wp_login_order), y se para en la primera que acepta. Ver docs/LOGIN-SERVIDORES.md del panel.
 */
if (defined('WP_LOGIN_PROBE_LOADED')) {
    return;
}
define('WP_LOGIN_PROBE_LOADED', true);

/** Las DNS en el orden en que conviene probarlas: primero los servidores donde más usuarios entraron (por distribuidor). */
function wp_login_order(array $list, $tc)
{
    $hits = wp_cache_get('loginhits|' . $tc, 86400 * 180);
    $hits = is_array($hits) ? $hits : [];
    $keyed = [];
    foreach (array_values($list) as $i => $srv) {
        $keyed[] = [(int)($hits[wp_login_endpoint($srv['url'])] ?? 0), $i, $srv];
    }
    usort($keyed, function ($a, $b) { return $b[0] <=> $a[0] ?: $a[1] <=> $b[1]; });
    return array_map(function ($x) { return $x[2]; }, $keyed);
}

/** Un usuario entró por este servidor: sube en el orden para los siguientes (de ese distribuidor). */
function wp_login_hit($url, $tc)
{
    $ck = 'loginhits|' . $tc;
    $hits = wp_cache_get($ck, 86400 * 180);
    $hits = is_array($hits) ? $hits : [];
    $k = wp_login_endpoint($url);
    $hits[$k] = min(1000000, (int)($hits[$k] ?? 0) + 1);
    if (count($hits) > 200) {
        arsort($hits);
        $hits = array_slice($hits, 0, 150, true);
    }
    wp_cache_set($ck, $hits);
}

/**
 * Conexión TCP a varios destinos a la vez. $targets = [clave => [host o IP, puerto]] → [clave => true|false].
 * Solo abre y cierra la conexión (no manda nada).
 */
function wp_tcp_check(array $targets, $timeout = 3.0)
{
    $out = [];
    $socks = [];
    foreach ($targets as $k => $t) {
        list($host, $port) = $t;
        $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : (wp_resolve_ip($host) ?: $host);
        $s = @stream_socket_client('tcp://' . $ip . ':' . (int)$port, $en, $es, $timeout, STREAM_CLIENT_CONNECT | STREAM_CLIENT_ASYNC_CONNECT);
        if ($s === false) {
            $out[$k] = false;
            continue;
        }
        stream_set_blocking($s, false);
        $socks[$k] = $s;
    }
    $end = microtime(true) + $timeout;
    while ($socks && microtime(true) < $end) {
        $w = array_values($socks);
        $r = null;
        $e = null;
        if (@stream_select($r, $w, $e, 0, 200000) === false) break;
        foreach ($w as $s) {
            $k = array_search($s, $socks, true);
            if ($k === false) continue;
            // terminó de conectar: con el otro lado conocido conectó; si no, la conexión falló
            $out[$k] = @stream_socket_get_name($s, true) !== false;
            fclose($s);
            unset($socks[$k]);
        }
    }
    foreach ($socks as $k => $s) {
        $out[$k] = false;
        fclose($s);
    }
    return $out;
}

/**
 * Ninguna DNS dejó conectar al hosting: ¿es el hosting, que no deja salir por ese puerto, o el servidor IPTV, que no
 * deja entrar a la IP del hosting? Prueba (a la vez, unos segundos) el mismo servidor en los puertos 80 y 443, y el
 * mismo puerto contra portquiz.net (contesta en todos los puertos). 10 minutos guardado.
 * Devuelve ['cause' => 'hosting_port'|'server_refuses'|'server_down'|'unknown', 'port' => puerto, 'text' => detalle].
 */
function wp_login_diagnose(array $urls)
{
    $hosts = [];
    foreach ($urls as $u) {
        $p = parse_url((string)$u);
        $h = strtolower((string)($p['host'] ?? ''));
        if ($h === '') continue;
        $port = (int)($p['port'] ?? (strtolower((string)($p['scheme'] ?? 'http')) === 'https' ? 443 : 80));
        $hosts[$h . ':' . $port] = [$h, $port];
        if (count($hosts) >= 4) break;
    }
    if (!$hosts) return ['cause' => 'unknown', 'port' => 0, 'text' => ''];
    $ck = 'logindiag|' . md5(json_encode(array_keys($hosts)));
    $hit = wp_cache_get($ck, 600);
    if (is_array($hit)) return $hit;
    $t = ['ref:80' => ['portquiz.net', 80]];
    foreach ($hosts as $k => list($h, $port)) {
        $t['p|' . $k] = [$h, $port];
        if ($port !== 80) $t['w|' . $h] = [$h, 80];
        if ($port !== 443) $t['s|' . $h] = [$h, 443];
        if ($port !== 80 && $port !== 443) $t['q|' . $port] = ['portquiz.net', $port];
    }
    $r = wp_tcp_check($t, 4.0);
    $lines = [];
    $cause = 'unknown';
    $badPort = 0;
    foreach ($hosts as $k => list($h, $port)) {
        $own = !empty($r['p|' . $k]);
        $web = !empty($r['w|' . $h]) || !empty($r['s|' . $h]) || ($port === 80 || $port === 443 ? $own : false);
        $out = $port === 80 || $port === 443 || !empty($r['q|' . $port]);
        $lines[] = $h . ':' . $port . ' → ' . ($own ? 'conecta' : 'no conecta') . '; mismo servidor en 80/443: ' . ($web ? 'conecta' : 'no conecta')
            . ($port !== 80 && $port !== 443 ? '; el hosting sale por el puerto ' . $port . ': ' . (!empty($r['ref:80']) ? ($out ? 'sí' : 'NO') : 'no se pudo probar') : '');
        if ($own) continue;
        if (!empty($r['ref:80']) && !$out) {
            $cause = 'hosting_port';
            $badPort = $port;
        } elseif ($cause !== 'hosting_port') {
            $cause = $web ? 'server_refuses' : 'server_down';
            $badPort = $badPort ?: $port;
        }
    }
    $why = [
        'hosting_port' => 'El HOSTING de la web no deja salir conexiones al puerto ' . $badPort . ' (firewall del hosting): pide al hosting abrir ese puerto de salida o usa una DNS en el puerto 80 / 8080.',
        'server_refuses' => 'El servidor IPTV contesta en otros puertos pero rechaza a la IP del hosting en el de la lista: XUI bloqueó la IP (protección contra flood) o un firewall. En XUI › IPs bloqueadas, desbloquéala y agrégala a las IP excluidas.',
        'server_down' => 'El servidor IPTV no deja conectar a la IP del hosting en ningún puerto: está caído o bloqueó la IP del hosting (XUI o su firewall). La «Prueba desde el panel» de abajo dice cuál de las dos.',
        'unknown' => 'No se pudo saber la causa.',
    ];
    $res = ['cause' => $cause, 'port' => $badPort, 'text' => $why[$cause] . "\n" . implode("\n", $lines)];
    wp_cache_set($ck, $res);
    return $res;
}
