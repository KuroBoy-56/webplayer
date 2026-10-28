<?php
/* Estado del hosting: conexión con el panel (progreso y favoritos) y ffmpeg. Solo con sesión iniciada.
 * Cada usuario ve solo lo suyo: sus guardados de progreso, nunca los de otros. Los procesos del hosting
 * y detener conversiones se manejan desde el panel (Guía EPG › motor multimedia). */
include "session.php";
require_once __DIR__ . '/includes/progress_save.php';
@set_time_limit(60);

function st_try($url, $verify)
{
    $t = microtime(true);
    $ch = curl_init($url);
    wp_doh_apply($ch, $url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT => 8, CURLOPT_USERAGENT => WP_UA, CURLOPT_SSL_VERIFYPEER => $verify, CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0]);
    curl_exec($ch);
    $r = ['code' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'err' => curl_errno($ch) ? curl_errno($ch) . ' ' . curl_error($ch) : '',
        'ms' => (int)round((microtime(true) - $t) * 1000), 'loc' => (string)curl_getinfo($ch, CURLINFO_REDIRECT_URL)];
    curl_close($ch);
    return $r;
}

$msg = '';

$base = wp_panel_base();
$host = (string)parse_url($base, PHP_URL_HOST);
$rows = [
    'https (normal)' => st_try($base . 'progress.php', true),
    'https (sin revisar certificado)' => st_try($base . 'progress.php', false),
    'http' => st_try('http://' . substr($base, 8) . 'progress.php', false),
];
$ud = wp_panel_userdata(true);


$page_title = 'Estado';
include "header.php";
?>
<section class="nf-section" style="padding-top:90px;max-width:820px;font-size:15px">
    <h1 style="margin:0 0 12px">Estado del hosting</h1>
    <?php if ($msg): ?><p style="color:#46d369"><b><?php echo e($msg); ?></b></p><?php endif; ?>
    <h2 style="font-size:18px">Panel (progreso y favoritos)</h2>
    <p style="color:#aaa">Servidor: <b><?php echo e($host); ?></b> → IP <b><?php echo e(wp_resolve_ip($host) ?: 'no se pudo resolver'); ?></b></p>
    <table style="width:100%;border-collapse:collapse">
        <?php foreach ($rows as $k => $r): $ok = !$r['err'] && $r['code'] > 0 && ($r['code'] < 300 || $r['code'] >= 400) && !$r['loc']; ?>
        <tr style="border-bottom:1px solid #333">
            <td style="padding:6px"><?php echo e($k); ?></td>
            <td style="color:<?php echo $ok ? '#46d369' : '#e87c03'; ?>">código <?php echo (int)$r['code']; ?> · <?php echo (int)$r['ms']; ?> ms<?php echo $r['err'] ? ' · ' . e($r['err']) : ''; ?><?php echo $r['loc'] ? ' · redirige a ' . e($r['loc']) : ''; ?></td>
        </tr>
        <?php endforeach; ?>
    </table>
    <p style="color:#aaa">Tu progreso en el panel: <b><?php echo count($ud['progress']); ?></b> títulos · favoritos: <b><?php echo count($ud['favorites']); ?></b>
        <?php if (!empty($GLOBALS['wp_panel_last_error'])): ?> · último error: <?php echo e($GLOBALS['wp_panel_last_error']); ?><?php endif; ?></p>

    <h2 style="font-size:18px;margin-top:22px">Lo que el panel tiene guardado ahora</h2>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <?php foreach (array_slice($ud['progress'], 0, 15, true) as $pt => $pp): if (!is_array($pp)) continue; ?>
        <tr style="border-bottom:1px solid #333">
            <td style="padding:4px"><?php echo e($pt); ?></td>
            <td><?php echo e(($pp['type'] ?? '') . ' ' . ($pp['id'] ?? '')); ?></td>
            <td style="white-space:nowrap"><?php echo e(gmdate('H:i:s', (int)($pp['position'] ?? 0))); ?></td>
            <td style="white-space:nowrap;color:#aaa"><?php $u = @strtotime((string)($pp['updatedAt'] ?? '')); echo $u ? e(date('d/m H:i', $u)) : '—'; ?></td>
        </tr>
        <?php endforeach; ?>
    </table></div>
    <h2 style="font-size:18px;margin-top:22px">Últimos guardados de progreso</h2>
    <?php
    $plog = wp_cache_get('progress|log', 864000);
    $me = wp_progress_log_owner($username);
    $plog = array_slice(array_values(array_filter(is_array($plog) ? $plog : [], function ($l) use ($me) {
        return is_array($l) && isset($l['u']) && hash_equals((string)$l['u'], $me);
    })), 0, 30);
    ?>
    <?php if (!$plog): ?><p style="color:#e87c03">Ningún intento de guardado ha llegado al hosting.</p><?php else: ?>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <?php foreach ($plog as $l): ?>
        <tr style="border-bottom:1px solid #333">
            <td style="padding:4px;white-space:nowrap"><?php echo e(date('H:i:s', (int)$l['t'])); ?></td>
            <td><?php echo e($l['slug'] . ' ' . $l['id']); ?></td>
            <td><?php echo e($l['title']); ?></td>
            <td style="white-space:nowrap"><?php echo e(gmdate('H:i:s', (int)$l['pos'])); ?></td>
            <td style="color:<?php echo $l['ok'] ? '#46d369' : '#e87c03'; ?>"><?php echo $l['ok'] ? 'guardado' : 'NO: ' . e($l['why'] ?: ('panel ' . $l['err'])); ?></td>
        </tr>
        <?php endforeach; ?>
    </table></div>
    <?php endif; ?>
    <p style="color:#aaa;margin-top:16px">Conversión de audio, subtítulos y video: en la VPS / VDS del panel (el hosting no usa ffmpeg).</p>
    <p style="color:#aaa">PHP <?php echo e(PHP_VERSION); ?> · página en <?php echo wp_is_https() ? 'https' : 'http'; ?></p>
</section>
<?php include "footer.php"; ?>
