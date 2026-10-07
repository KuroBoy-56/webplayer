<?php
/* Diagnóstico de reproducción: prueba desde el hosting cómo responde el servidor IPTV a cada formato. */
include "session.php";
include "config.php";

$id = preg_replace('/[^0-9]/', '', (string)($_GET['id'] ?? ''));
$slug = in_array($_GET['slug'] ?? '', ['movie', 'series', 'live'], true) ? $_GET['slug'] : 'movie';
$ext = strtolower(preg_replace('/[^a-z0-9]/i', '', (string)($_GET['ext'] ?? ''))) ?: 'mp4';
$series_id = preg_replace('/[^0-9]/', '', (string)($_GET['series_id'] ?? ''));
$back = $slug === 'live' ? 'tvguide.php?id=' . $id . '&slug=live'
    : 'video_player.php?id=' . $id . '&slug=' . $slug . '&ext=' . rawurlencode($ext) . ($series_id ? '&series_id=' . $series_id : '');
$exts = $slug === 'live' ? ['m3u8', 'ts'] : array_values(array_unique(['mp4', $ext, 'm3u8']));

function diag_probe($url)
{
    $r = ['code' => 0, 'type' => '', 'len' => '', 'range' => 'no', 'final' => '', 'ms' => 0, 'err' => ''];
    $t = microtime(true);
    $ch = curl_init($url);
    wp_doh_apply($ch, $url);
    $hdr = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 8,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_USERAGENT => WP_UA,
        CURLOPT_HTTPHEADER => ['Range: bytes=0-1023'],
        CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$hdr) {
            $p = strpos($h, ':');
            if ($p !== false) $hdr[strtolower(trim(substr($h, 0, $p)))] = trim(substr($h, $p + 1));
            return strlen($h);
        },
    ]);
    $body = curl_exec($ch);
    $r['code'] = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $r['final'] = (string)parse_url((string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL), PHP_URL_HOST);
    $r['err'] = curl_errno($ch) ? curl_error($ch) : '';
    curl_close($ch);
    $r['ms'] = (int)round((microtime(true) - $t) * 1000);
    $r['type'] = $hdr['content-type'] ?? '';
    $r['len'] = $hdr['content-range'] ?? ($hdr['content-length'] ?? '');
    $r['range'] = $r['code'] === 206 ? 'sí' : 'no';
    if (is_string($body) && strncmp(ltrim($body), '#EXTM3U', 7) === 0) $r['type'] .= ' (lista HLS)';
    elseif (stripos($r['type'], 'text/html') !== false) { $r['type'] = 'No disponible en este formato'; $r['bad'] = true; }
    return $r;
}

$rows = [];
foreach ($exts as $x) {
    $kind = $slug === 'series' ? 'series' : $slug;
    $rows[] = ['ext' => $x, 'r' => diag_probe(wp_client_stream_url($kind, $id, $x))];
}
$https_base = wp_server_https_base();

/* Relay de Cloudflare: se prueba igual que lo pide el navegador (con Origin de esta web), solo unos bytes */
function diag_relay($url, $origin)
{
    $r = ['code' => 0, 'type' => '', 'len' => '', 'body' => '', 'loc' => '', 'ms' => 0, 'err' => '', 'acao' => ''];
    $t = microtime(true);
    $hdr = [];
    $ch = curl_init($url);
    wp_doh_apply($ch, $url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 6,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => WP_UA,
        CURLOPT_HTTPHEADER => ['Range: bytes=0-1023', 'Origin: ' . $origin],
        CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$hdr) {
            $p = strpos($h, ':');
            if ($p !== false) $hdr[strtolower(trim(substr($h, 0, $p)))] = trim(substr($h, $p + 1));
            return strlen($h);
        },
    ]);
    $body = curl_exec($ch);
    $r['code'] = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $eff = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $r['err'] = curl_errno($ch) ? curl_error($ch) : '';
    curl_close($ch);
    $r['ms'] = (int)round((microtime(true) - $t) * 1000);
    $r['type'] = $hdr['content-type'] ?? '';
    $r['len'] = $hdr['content-range'] ?? ($hdr['content-length'] ?? '');
    $r['acao'] = $hdr['access-control-allow-origin'] ?? '';
    // a qué servidor terminó yendo (sin usuario ni clave)
    if (preg_match('~/(https?)/([^/]+)/~', (string)parse_url($eff, PHP_URL_PATH), $m)) $r['loc'] = $m[2];
    if (is_string($body) && $body !== '' && (stripos($r['type'], 'video') === false && stripos($r['type'], 'octet') === false)) {
        $r['body'] = mb_substr(preg_replace('/\s+/', ' ', strip_tags($body)), 0, 80);
    }
    return $r;
}
/* proxy.php pedido por el propio hosting a sí mismo (https, como el navegador): muestra el error real si lo hay */
function diag_self($url, $h2)
{
    $r = ['code' => 0, 'hdr' => '', 'body' => '', 'len' => 0, 'err' => '', 'ms' => 0];
    $t = microtime(true);
    $hdr = '';
    $ch = curl_init($url);
    wp_doh_apply($ch, $url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 25,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_USERAGENT => WP_UA,
        CURLOPT_HTTPHEADER => ['Range: bytes=0-1023'],
        CURLOPT_HTTP_VERSION => $h2 ? (defined('CURL_HTTP_VERSION_2TLS') ? CURL_HTTP_VERSION_2TLS : CURL_HTTP_VERSION_2_0) : CURL_HTTP_VERSION_1_1,
        CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$hdr) { $hdr .= $h; return strlen($h); },
    ]);
    $body = curl_exec($ch);
    $r['code'] = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $r['err'] = curl_errno($ch) ? curl_errno($ch) . ' ' . curl_error($ch) : '';
    curl_close($ch);
    $r['ms'] = (int)round((microtime(true) - $t) * 1000);
    $r['hdr'] = trim(preg_replace('/\r?\n/', ' | ', trim($hdr)));
    $r['len'] = is_string($body) ? strlen($body) : 0;
    if (is_string($body) && $r['code'] >= 300) $r['body'] = mb_substr(preg_replace('/\s+/', ' ', strip_tags($body)), 0, 200);
    return $r;
}
$self_rows = [];
$kind2 = $slug === 'series' ? 'series' : $slug;
$u0 = wp_stream_url($kind2, $id, $exts[0]);
if (wp_via_hosting($u0)) {
    $base = (wp_is_https() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/';
    $self_rows[] = ['v' => 'HTTP/1.1', 'r' => diag_self($base . wp_proxy_url($u0), false)];
    $self_rows[] = ['v' => 'HTTP/2', 'r' => diag_self($base . wp_proxy_url($u0), true)];
}
$proxy_err = @file_get_contents(wp_cache_dir('data') . '/proxy_error.txt');
$proxy_err = $proxy_err ? implode("\n", array_slice(explode("\n", trim($proxy_err)), -3)) : '';

$relay_rows = [];
$relay_base = wp_https_relay();
if ($relay_base !== '') {
    $origin = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $kind0 = $slug === 'series' ? 'series' : $slug;
    $relay_rows[] = ['ext' => 'relay', 'r' => diag_relay($relay_base . '/', $origin)];
    foreach ($exts as $x) $relay_rows[] = ['ext' => $x, 'r' => diag_relay(wp_relay_url(wp_stream_url($kind0, $id, $x)), $origin)];
}

$page_title = 'Diagnóstico';
include "header.php";
?>
<section class="nf-section" style="padding-top:90px;max-width:900px">
    <a class="nf-btn nf-btn-white" href="<?php echo e($back); ?>" style="display:inline-flex;margin-bottom:16px">&#9654; Volver a la reproducción</a>
    <h1 style="margin:0 0 6px">Diagnóstico de reproducción</h1>
    <p style="color:#aaa;margin:0 0 18px">Prueba hecha desde tu hosting hacia el servidor IPTV (solo se leen unos bytes de cada formato). Haz una captura de esta pantalla y envíala si un contenido no reproduce.</p>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums">
        <tr style="text-align:left;color:#aaa;border-bottom:1px solid #333"><th style="padding:8px">Formato</th><th>Código</th><th>Tipo</th><th>Tamaño</th><th>Saltos (Range)</th><th>Servidor final</th><th>Tiempo</th></tr>
        <?php foreach ($rows as $row): $r = $row['r']; $ok = $r['code'] >= 200 && $r['code'] < 300 && empty($r['bad']); ?>
        <tr style="border-bottom:1px solid #222">
            <td style="padding:8px"><b>.<?php echo e($row['ext']); ?></b></td>
            <td style="color:<?php echo $ok ? '#46d369' : '#e87c03'; ?>"><?php echo $r['code'] ?: '—'; ?><?php echo $r['err'] ? ' · ' . e($r['err']) : ''; ?></td>
            <td><?php echo e($r['type'] ?: '—'); ?></td>
            <td><?php echo e($r['len'] ?: '—'); ?></td>
            <td><?php echo e($r['range']); ?></td>
            <td><?php echo e($r['final'] ?: '—'); ?></td>
            <td><?php echo (int)$r['ms']; ?> ms</td>
        </tr>
        <?php endforeach; ?>
    </table>
    </div>
    <h2 style="font-size:18px;margin:22px 0 8px">Video por tu hosting (proxy.php), probado desde este navegador</h2>
    <div id="pxres" style="font-size:14px;color:#ccc;line-height:1.9">Probando…</div>
    <script>
    (function () {
        var tests = <?php $kind1 = $slug === 'series' ? 'series' : $slug; $pt = []; foreach ($exts as $x) { $u = wp_stream_url($kind1, $id, $x); $pt[] = ['ext' => $x, 'url' => wp_via_hosting($u) ? wp_proxy_url($u) : $u, 'host' => wp_via_hosting($u)]; } echo json_encode($pt, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP); ?>;
        var box = document.getElementById('pxres'), out = [];
        function show() { box.innerHTML = out.join('<br>'); }
        tests.forEach(function (t, i) {
            out[i] = '<b>.' + t.ext + '</b> (' + (t.host ? 'por el hosting' : 'directo https') + '): probando…';
            var t0 = Date.now();
            fetch(t.url, { headers: { Range: 'bytes=0-1023' }, cache: 'no-store' }).then(function (r) {
                return r.arrayBuffer().then(function (b) {
                    out[i] = '<b>.' + t.ext + '</b> (' + (t.host ? 'por el hosting' : 'directo https') + '): código ' + r.status + ' · ' + (r.headers.get('content-type') || '—') + ' · '
                        + (r.headers.get('content-range') || r.headers.get('content-length') || '—') + ' · ' + b.byteLength + ' bytes · ' + (Date.now() - t0) + ' ms';
                    show();
                });
            }).catch(function (e) { out[i] = '<b>.' + t.ext + '</b>: <span style="color:#e87c03">error ' + (e && e.message) + '</span> · ' + (Date.now() - t0) + ' ms'; show(); });
        });
        show();
    })();
    </script>
    <h3 style="font-size:16px;margin:16px 0 6px">proxy.php pedido por el hosting a sí mismo</h3>
    <div style="font-size:13px;color:#ccc;line-height:1.7;word-break:break-word">
    <?php foreach ($self_rows as $sr): $r = $sr['r']; ?>
        <p style="margin:0 0 8px"><b><?php echo e($sr['v']); ?>:</b> código <?php echo (int)$r['code']; ?> · <?php echo (int)$r['len']; ?> bytes · <?php echo (int)$r['ms']; ?> ms<?php echo $r['err'] ? ' · <span style="color:#e87c03">' . e($r['err']) . '</span>' : ''; ?><br>
        <span style="color:#888"><?php echo e($r['hdr']); ?></span><?php echo $r['body'] ? '<br><span style="color:#e87c03">' . e($r['body']) . '</span>' : ''; ?></p>
    <?php endforeach; ?>
    <?php if (!$self_rows): ?><p>El servidor IPTV es https: no pasa por el hosting.</p><?php endif; ?>
    <p style="margin:0">Último error de PHP en proxy.php: <b><?php echo $proxy_err !== '' ? nl2br(e($proxy_err)) : 'ninguno'; ?></b></p>
    </div>
    <h2 style="font-size:18px;margin:22px 0 8px">Relay de Cloudflare</h2>
    <?php if (!$relay_rows): ?>
    <p style="color:#e87c03;font-size:14px">No está configurado: falta <b>includes/https_relay.php</b>.</p>
    <?php else: ?>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums">
        <tr style="text-align:left;color:#aaa;border-bottom:1px solid #333"><th style="padding:8px">Prueba</th><th>Código</th><th>Tipo</th><th>Tamaño</th><th>Respuesta</th><th>Servidor final</th><th>Permiso</th><th>Tiempo</th></tr>
        <?php foreach ($relay_rows as $row): $r = $row['r']; $ok = $r['code'] >= 200 && $r['code'] < 300; ?>
        <tr style="border-bottom:1px solid #222">
            <td style="padding:8px"><b><?php echo $row['ext'] === 'relay' ? 'Worker' : '.' . e($row['ext']); ?></b></td>
            <td style="color:<?php echo $ok ? '#46d369' : '#e87c03'; ?>"><?php echo $r['code'] ?: '—'; ?><?php echo $r['err'] ? ' · ' . e($r['err']) : ''; ?></td>
            <td><?php echo e($r['type'] ?: '—'); ?></td>
            <td><?php echo e($r['len'] ?: '—'); ?></td>
            <td><?php echo e($r['body'] ?: '—'); ?></td>
            <td><?php echo e($r['loc'] ?: '—'); ?></td>
            <td><?php echo e($r['acao'] ?: 'no'); ?></td>
            <td><?php echo (int)$r['ms']; ?> ms</td>
        </tr>
        <?php endforeach; ?>
    </table>
    </div>
    <?php endif; ?>
    <p style="color:#aaa;margin-top:18px;font-size:14px">
        Página en HTTPS: <b><?php echo wp_is_https() ? 'sí' : 'no'; ?></b> ·
        Video en HTTPS directo desde: <b><?php echo $https_base ? e(parse_url($https_base, PHP_URL_HOST) . ':' . (parse_url($https_base, PHP_URL_PORT) ?: '443')) : 'no'; ?></b> ·
        PHP <?php echo e(PHP_VERSION); ?>
    </p>
    <?php
    $n_audio = $slug === 'live' ? 0 : wp_audio_track_count(wp_stream_url($kind2, $id, $exts[0]));
    $dns_host = (string)parse_url(wp_user()['server'], PHP_URL_HOST);
    $dns_ip = wp_resolve_ip($dns_host);
    ?>
    <p style="color:#aaa;font-size:14px">
        Pistas de audio de este contenido: <b><?php echo $slug === 'live' ? 'no aplica (en vivo)' : ($n_audio ? $n_audio : 'no se pudo leer'); ?></b> ·
        Ruta: <b><?php echo wp_is_https() ? 'página https: el video http pasa por el hosting' : ($n_audio > 1 ? 'varios audios: por el hosting (para elegir idioma)' : 'directo del servidor IPTV'); ?></b> ·
        IP del servidor IPTV (resuelta sin hilos): <b><?php echo $dns_ip ? e($dns_host . ' → ' . $dns_ip) : 'no se pudo resolver'; ?></b>
    </p>
    <p style="color:#aaa;font-size:14px;max-width:760px">Con la página en http, el video va directo del servidor IPTV a tu navegador y solo el contenido con más de un audio pasa por tu hosting. Con la página en https, todo video http tiene que pasar por el hosting (el navegador bloquea http dentro de https). Si un formato no se puede reproducir en el navegador (por ejemplo MKV o HEVC en iPhone), ábrelo en VLC.</p>
    <?php if ($slug === 'live'): require_once __DIR__ . '/includes/epg.php';
        $sepg = xt_get('get_short_epg', ['stream_id' => $id, 'limit' => 5], 60, 8);
        $nsrv = count((array)($sepg['epg_listings'] ?? []));
        $alt = wp_epg_for($id);
        $est = wp_epg_status(); ?>
    <h2 style="font-size:18px;margin:22px 0 8px">Guía de programas (EPG)</h2>
    <p style="color:#ccc;font-size:14px;line-height:1.8">
        Guía del servidor IPTV para este canal: <b><?php echo $nsrv ? $nsrv . ' programas' : 'no envía'; ?></b><br>
        Guía de respaldo del panel para este canal: <b><?php echo $alt ? count($alt) . ' programas' : 'sin coincidencia'; ?></b><br>
        Última consulta al panel: <b><?php echo $est && !empty($est['t']) ? e(date('d/m H:i', (int)$est['t'])) . (!empty($est['updated']) ? ' · guía del panel actualizada ' . e(date('d/m H:i', (int)$est['updated'])) : '') : (wp_panel_ready() ? 'sin respuesta del panel' : 'falta includes/panel_secret.php'); ?></b><br>
    </p>
    <?php endif; ?>
    <a class="nf-btn nf-btn-white" href="<?php echo e($back); ?>" style="display:inline-flex;margin-top:18px">&#9654; Volver a la reproducción</a>
</section>
<?php include "footer.php"; ?>
