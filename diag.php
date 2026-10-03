<?php
/* Diagnóstico de reproducción: prueba desde el hosting cómo responde el servidor IPTV a cada formato. */
include "session.php";
include "config.php";

$id = preg_replace('/[^0-9]/', '', (string)($_GET['id'] ?? ''));
$slug = in_array($_GET['slug'] ?? '', ['movie', 'series', 'live'], true) ? $_GET['slug'] : 'movie';
$ext = strtolower(preg_replace('/[^a-z0-9]/i', '', (string)($_GET['ext'] ?? ''))) ?: 'mp4';
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
    $rows[] = ['ext' => $x, 'r' => diag_probe(wp_stream_url($kind, $id, $x))];
}
$https_base = wp_server_https_base();
$page_title = 'Diagnóstico';
include "header.php";
?>
<section class="nf-section" style="padding-top:90px;max-width:900px">
    <h1 style="margin:0 0 6px">Diagnóstico de reproducción</h1>
    <p style="color:#aaa;margin:0 0 18px">Prueba hecha desde tu hosting hacia el servidor IPTV. Haz una captura de esta pantalla y envíala si un contenido no reproduce.</p>
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
    <p style="color:#aaa;margin-top:18px;font-size:14px">
        Página en HTTPS: <b><?php echo wp_is_https() ? 'sí' : 'no'; ?></b> ·
        Conexión directa HTTPS al servidor IPTV: <b><?php echo $https_base ? 'sí (puerto ' . e(parse_url($https_base, PHP_URL_PORT) ?: '443') . ')' : 'no (el video pasa por el proxy seguro)'; ?></b> ·
        PHP <?php echo e(PHP_VERSION); ?> ·
        Conversión de audio Dolby (ffmpeg): <b><?php echo wp_bin('ffmpeg') && wp_bin('ffprobe') ? 'disponible' : 'no disponible'; ?></b>
    </p>
    <?php if (!(wp_bin('ffmpeg') && wp_bin('ffprobe'))): ?>
    <p style="color:#aaa;font-size:14px;max-width:760px">Sin ffmpeg, el audio Dolby (AC3/E-AC3/DTS) de algunos contenidos 4K no se escucha en Chrome. Puedes subir los archivos <b>ffmpeg</b> y <b>ffprobe</b> estáticos para Linux a la carpeta <b>bin/</b> de tu web player (con permiso de ejecución 755), o abrir ese contenido en Safari, Microsoft Edge o VLC.</p>
    <?php endif; ?>
    <?php if ($slug !== 'live' && wp_bin('ffprobe') && ($pi = wp_probe(wp_stream_url($slug === 'series' ? 'series' : 'movie', $id, $ext)))): ?>
    <h2 style="font-size:18px;margin:22px 0 8px">Pistas del archivo</h2>
    <p style="color:#ccc;font-size:14px;line-height:1.7">
        Video: <b><?php echo e(strtoupper($pi['video'] ?: '—')); ?></b><br>
        Audio: <?php foreach ($pi['audio'] as $a) echo '<b>' . e((wp_lang_name($a['lang']) ?: 'Pista ' . ($a['i'] + 1)) . ' ' . strtoupper($a['codec']) . ($a['ch'] >= 6 ? ' 5.1' : '')) . '</b> &nbsp; '; ?><br>
        Subtítulos: <?php echo $pi['subs'] ? implode(', ', array_map(function ($x) { return e(wp_lang_name($x['lang']) ?: 'Pista ' . ($x['i'] + 1)); }, $pi['subs'])) : 'ninguno'; ?>
    </p>
    <?php endif; ?>
</section>
<?php include "footer.php"; ?>
