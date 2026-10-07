<?php
/*
 * Instala ffmpeg y ffprobe en la carpeta bin/ sin subir nada desde el celular:
 * el propio hosting descarga las versiones estáticas para Linux (GitHub, eugeneware/ffmpeg-static)
 * y las deja listas. Solo para usuarios con sesión iniciada. Se puede borrar después de instalar.
 */
include "session.php";
@set_time_limit(600);

const FF_BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/';
$bin = __DIR__ . '/bin';

/** descarga un .gz y lo guarda descomprimido como ejecutable */
function ff_install($name, $dir)
{
    $tmp = $dir . '/' . $name . '.gz.part';
    $fp = @fopen($tmp, 'wb');
    if (!$fp) return 'no se pudo escribir en bin/ (permisos)';
    $ch = curl_init(FF_BASE . $name . '-linux-x64.gz');
    curl_setopt_array($ch, [CURLOPT_FILE => $fp, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 6,
        CURLOPT_CONNECTTIMEOUT => 20, CURLOPT_TIMEOUT => 500, CURLOPT_USERAGENT => WP_UA, CURLOPT_FAILONERROR => true]);
    $ok = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fp);
    if (!$ok) { @unlink($tmp); return 'descarga fallida: ' . $err; }
    $in = @gzopen($tmp, 'rb');
    $out = @fopen($dir . '/' . $name, 'wb');
    if (!$in || !$out) { @unlink($tmp); return 'no se pudo descomprimir'; }
    while (!gzeof($in)) fwrite($out, gzread($in, 1 << 20));
    gzclose($in);
    fclose($out);
    @unlink($tmp);
    @chmod($dir . '/' . $name, 0755);
    return '';
}

$msgs = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    foreach (['ffmpeg', 'ffprobe'] as $n) {
        $e = ff_install($n, $bin);
        $msgs[] = $n . ': ' . ($e === '' ? 'descargado' : $e);
    }
}

// estado actual
$mode = wp_exec_mode();
$status = [];
foreach (['ffmpeg', 'ffprobe'] as $n) {
    $p = $bin . '/' . $n;
    $ver = '';
    if (is_file($p) && $mode) {
        $o = (string)wp_run([$p, '-version'], 20);
        if (preg_match('/^\S+ version (\S+)/', $o, $m)) $ver = $m[1];
    }
    $status[$n] = ['file' => is_file($p), 'mb' => is_file($p) ? round(filesize($p) / 1048576) : 0, 'ver' => $ver];
}
$ready = $status['ffmpeg']['ver'] !== '' && $status['ffprobe']['ver'] !== '';

$page_title = 'Instalar ffmpeg';
include "header.php";
?>
<section class="nf-section" style="padding-top:90px;max-width:700px">
    <h1 style="margin:0 0 10px">Instalar ffmpeg</h1>
    <p style="color:#aaa">ffmpeg permite convertir en el hosting el audio Dolby/DTS y los formatos que el navegador no abre (MKV). Solo se usa con el contenido http del servidor IPTV.</p>
    <?php foreach ($msgs as $m): ?><p style="color:#e5e5e5">• <?php echo e($m); ?></p><?php endforeach; ?>
    <table style="width:100%;border-collapse:collapse;font-size:15px;margin:14px 0">
        <?php foreach ($status as $n => $s): ?>
        <tr style="border-bottom:1px solid #333">
            <td style="padding:8px"><b><?php echo e($n); ?></b></td>
            <td style="color:<?php echo $s['ver'] ? '#46d369' : '#e87c03'; ?>">
                <?php echo $s['ver'] ? 'Funciona · versión ' . e($s['ver']) : ($s['file'] ? 'Descargado (' . $s['mb'] . ' MB) pero no se puede ejecutar' : 'No instalado'); ?>
            </td>
        </tr>
        <?php endforeach; ?>
    </table>
    <p style="color:#aaa;font-size:14px">Ejecutar programas en el hosting: <b><?php echo $mode ? e($mode) . ' (permitido)' : 'bloqueado por el hosting'; ?></b></p>
    <?php if ($ready): ?>
        <p style="color:#46d369;font-size:17px"><b>Listo. ffmpeg ya funciona.</b> Puedes borrar este archivo (instalar_ffmpeg.php).</p>
    <?php else: ?>
        <form method="post" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Descargando (1-3 minutos)…'">
            <button type="submit" class="nf-btn nf-btn-red" style="font-size:17px">Descargar e instalar ffmpeg</button>
        </form>
    <?php endif; ?>
</section>
<?php include "footer.php"; ?>
