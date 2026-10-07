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
    <p style="color:#aaa;font-size:14px;max-width:760px">El video va siempre directo del servidor IPTV a tu navegador (no pasa por el hosting). Si un formato no se puede reproducir en el navegador (por ejemplo MKV o HEVC en iPhone), ábrelo en VLC.</p>
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
