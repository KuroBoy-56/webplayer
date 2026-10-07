<?php
/* Estado del hosting: conexión con el panel (progreso y favoritos), procesos y ffmpeg. Solo con sesión iniciada. */
include "session.php";
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
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['do'] ?? '') === 'kill') {
    $n = 0;
    if (wp_fn_ok('exec')) { @exec('pkill -u "$(id -un)" -x ffmpeg; pkill -u "$(id -un)" -x ffprobe; echo ok', $o); $n = 1; }
    elseif (wp_fn_ok('shell_exec')) { @shell_exec('pkill -u "$(id -un)" -x ffmpeg; pkill -u "$(id -un)" -x ffprobe'); $n = 1; }
    $msg = $n ? 'Conversiones detenidas.' : 'El hosting no permite detener procesos desde PHP.';
}

$base = wp_panel_base();
$host = (string)parse_url($base, PHP_URL_HOST);
$rows = [
    'https (normal)' => st_try($base . 'progress.php', true),
    'https (sin revisar certificado)' => st_try($base . 'progress.php', false),
    'http' => st_try('http://' . substr($base, 8) . 'progress.php', false),
];
$ud = wp_panel_userdata(true);

$ps = '';
if (wp_fn_ok('exec')) { @exec('ps -u "$(id -un)" -o pid=,etime=,comm= 2>/dev/null', $pl); $ps = implode("\n", (array)$pl); }
elseif (wp_fn_ok('shell_exec')) $ps = (string)@shell_exec('ps -u "$(id -un)" -o pid=,etime=,comm= 2>/dev/null');
$lines = array_filter(array_map('trim', explode("\n", $ps)));
$nff = count(array_filter($lines, function ($l) { return preg_match('/ff(mpeg|probe)$/', $l); }));

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

    <h2 style="font-size:18px;margin-top:22px">Últimos guardados de progreso</h2>
    <?php $plog = wp_cache_get('progress|log', 864000); $plog = is_array($plog) ? $plog : []; ?>
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
    <h2 style="font-size:18px;margin-top:22px">Procesos de tu cuenta en el hosting</h2>
    <p style="color:#aaa"><?php echo $lines ? 'Procesos activos: <b>' . count($lines) . '</b> · ffmpeg/ffprobe: <b>' . $nff . '</b>' : 'El hosting no deja ver los procesos.'; ?></p>
    <?php if ($lines): ?><pre style="background:#111;padding:10px;max-height:240px;overflow:auto;font-size:12px"><?php echo e(implode("\n", array_slice($lines, 0, 60))); ?></pre><?php endif; ?>
    <form method="post"><input type="hidden" name="do" value="kill"><button class="nf-btn nf-btn-red" type="submit">Detener todas las conversiones (ffmpeg)</button></form>
    <p style="color:#aaa;margin-top:16px">ffmpeg: <b><?php echo wp_bin('ffmpeg') ? 'instalado' : 'NO instalado'; ?></b> · ffprobe: <b><?php echo wp_bin('ffprobe') ? 'instalado' : 'NO instalado'; ?></b> · ejecutar programas: <b><?php echo e(wp_exec_mode() ?: 'bloqueado'); ?></b></p>
    <p style="color:#aaa">PHP <?php echo e(PHP_VERSION); ?> · página en <?php echo wp_is_https() ? 'https' : 'http'; ?></p>
</section>
<?php include "footer.php"; ?>
