<?php
include "session.php";
$pagename = "Ajustes";
include "config.php";
if (isset($_COOKIE["settings_array"])) {
    $SettingArray = json_decode($_COOKIE["settings_array"], true);
    $stream_type = isset($SettingArray["stream_type"]) ? $SettingArray["stream_type"] : "m3u8";
} else {
    $stream_type = "m3u8";
}
$use_vlc = isset($_COOKIE["use_vlc"]) ? $_COOKIE["use_vlc"] : "0";
$epg_source = isset($_COOKIE["epg_source"]) ? $_COOKIE["epg_source"] : "server";
$body_class = 'nf-solid';
include "header.php";

function opt($name, $value, $label, $desc, $current)
{
    $id = $name . '_' . $value;
    return '<label class="st-opt" for="' . $id . '"><input type="radio" id="' . $id . '" name="' . $name . '" value="' . e($value) . '"' . ($current === $value ? ' checked' : '') . '><span class="dot"></span><span><b>' . e($label) . '</b><small>' . e($desc) . '</small></span></label>';
}
?>
<style>
    .st-wrap { max-width: 860px; margin: 0 auto; }
    .st-card { background: #1a1a1a; border-radius: 8px; padding: 22px 24px; margin-bottom: 16px; }
    .st-card h3 { margin: 0 0 4px; font-size: 18px; color: #fff; display: flex; align-items: center; gap: 10px; }
    .st-card h3 i { color: var(--nf-red); }
    .st-card > p { margin: 0 0 16px; color: #999; font-size: 14px; }
    .st-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
    .st-opt { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1px solid #333; border-radius: 6px; cursor: pointer; transition: border-color .2s, background .2s; }
    .st-opt:hover { border-color: #666; }
    .st-opt input { position: absolute; opacity: 0; pointer-events: none; }
    .st-opt .dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #777; flex-shrink: 0; margin-top: 1px; position: relative; }
    .st-opt input:checked + .dot { border-color: var(--nf-red); }
    .st-opt input:checked + .dot::after { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--nf-red); }
    .st-opt:has(input:checked) { border-color: var(--nf-red); background: rgba(229,9,20,.08); }
    .st-opt b { display: block; color: #fff; font-size: 15px; }
    .st-opt small { color: #999; font-size: 13px; }
    .vlc-downloads { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    .st-saved { background: #2e7d32; color: #fff; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; }
</style>
<div class="nf-page settings-wrapper">
    <div class="st-wrap">
        <h1 class="nf-page-title">Ajustes</h1>
        <p class="nf-page-sub">Personaliza la reproducción según tu dispositivo.</p>
        <?php if (isset($_GET['saved'])): ?><div class="st-saved" id="flash">Ajustes guardados correctamente.</div><?php endif; ?>
        <form action="setting/save" method="POST" id="settings-form">
            <div class="st-card">
                <h3><i class="fa fa-play-circle"></i> Formato de TV en vivo</h3>
                <p>Si un canal no carga, prueba con el otro formato. El reproductor también cambia solo si uno falla.</p>
                <div class="st-opts">
                    <?php echo opt('stream_format', 'm3u8', 'HLS (m3u8)', 'Recomendado, compatible con todos los navegadores y celulares', $stream_type); ?>
                    <?php echo opt('stream_format', 'ts', 'MPEG (ts)', 'Menor retraso en PC y Android', $stream_type); ?>
                </div>
            </div>
            <div class="st-card">
                <h3><i class="fa fa-list-alt"></i> Guía de programas (EPG)</h3>
                <p>Origen de la guía de programación de los canales.</p>
                <div class="st-opts">
                    <?php echo opt('epg_source', 'server', 'Servidor primero', 'Guía de tu proveedor; si un canal no tiene, se usa la guía del panel', $epg_source); ?>
                    <?php echo opt('epg_source', 'custom', 'Guía del panel primero', 'Usa primero la guía de respaldo del panel (guías públicas configuradas en el panel)', $epg_source); ?>
                </div>
            </div>
            <div class="st-card">
                <h3><i class="fa fa-mobile"></i> Reproductor en celulares</h3>
                <p>Elige si en el celular se reproduce aquí mismo o en la app VLC.</p>
                <div class="st-opts">
                    <?php echo opt('use_vlc', '0', 'Reproductor web', 'Se reproduce dentro de la página', $use_vlc); ?>
                    <?php echo opt('use_vlc', '1', 'VLC (externo)', 'Abre los videos en la app VLC', $use_vlc); ?>
                </div>
                <div class="vlc-downloads" id="vlc-downloads" style="display: <?php echo ($use_vlc == "1" ? 'flex' : 'none'); ?>;">
                    <a href="https://play.google.com/store/apps/details?id=org.videolan.vlc" target="_blank" rel="noopener" class="nf-btn nf-btn-dark"><i class="fab fa-google-play"></i> VLC para Android</a>
                    <a href="https://apps.apple.com/app/vlc-media-player/id650377962" target="_blank" rel="noopener" class="nf-btn nf-btn-dark"><i class="fab fa-apple"></i> VLC para iPhone</a>
                </div>
            </div>
            <button name="submit" type="submit" class="nf-btn nf-btn-red submit-btn">Guardar ajustes</button>
        </form>
    </div>
</div>
<script>
document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="use_vlc"]'), function (r) {
        r.addEventListener('change', function () { document.getElementById('vlc-downloads').style.display = this.value === '1' ? 'flex' : 'none'; });
    });
    var f = document.getElementById('flash');
    if (f) setTimeout(function () { f.style.display = 'none'; }, 3000);
});
</script>
<?php include "footer.php"; ?>
