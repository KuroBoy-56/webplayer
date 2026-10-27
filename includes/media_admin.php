<?php
/**
 * Motor multimedia de la web: desde esta versión es el del panel (api/media_web.php, solo en una VPS / VDS; el
 * hosting de la web nunca convierte). Lo de abajo (media_admin.php: estado y detener conversiones del hosting) queda
 * por compatibilidad con paneles anteriores.
 */

function wp_media_flag()
{
    return wp_cache_dir() . '/media_disabled';
}

function wp_media_enabled()
{
    return !is_file(wp_media_flag());
}

/**
 * Por qué no se puede usar el motor (mismo texto que el motor del panel) o '' si se puede. El motor es el del panel
 * (api/media_web.php, en la VPS / VDS de la línea): él decide al final (do=status); aquí solo el permiso del
 * distribuidor y que haya token del panel.
 */
function wp_media_off_text()
{
    if (!wp_tenant_feature('ffmpeg')) return t('Sin permisos');
    if (wp_panel_base() === '' || wp_panel_token() === '') return t('No compatible con el dispositivo');
    return '';
}

function wp_media_set_enabled($on)
{
    if ($on) @unlink(wp_media_flag());
    else @touch(wp_media_flag());
}

/** ¿El proceso sigue vivo y es ffmpeg? (un pid viejo de una conversión muerta puede haberlo reusado otro programa) */
function wp_media_pid_alive($pid)
{
    $pid = (int)$pid;
    if ($pid < 2) return false;
    if (@is_readable('/proc/' . $pid . '/cmdline')) {
        $bin = wp_bin('ffmpeg');
        return strpos((string)@file_get_contents('/proc/' . $pid . '/cmdline'), $bin ? basename($bin) : 'ffmpeg') !== false;
    }
    if (function_exists('posix_kill')) return @posix_kill($pid, 0);
    return @is_dir('/proc/' . $pid);
}

/** pids de las conversiones que siguen vivas (audio en flujo o HLS) */
function wp_media_pids()
{
    $pids = [];
    foreach (array_merge((array)glob(wp_cache_dir() . '/ff_*.pid'), (array)glob(wp_cache_dir('hls') . '/*/pid')) as $f) {
        $pid = (int)@file_get_contents($f);
        if (wp_media_pid_alive($pid)) $pids[$pid] = true;
    }
    return array_keys($pids);
}

/** ['audio' => conversiones de video/audio, 'sub' => subtítulos que se están preparando] */
function wp_media_active()
{
    $sub = 0;
    foreach ((array)glob(wp_cache_dir() . '/sub_*.job') as $f) {
        if ((int)@filemtime($f) > time() - 1500) $sub++;
    }
    return ['audio' => count(wp_media_pids()), 'sub' => $sub];
}

/** Detiene todas las conversiones; devuelve cuántas había. */
function wp_media_stop_all()
{
    $n = 0;
    foreach (wp_media_pids() as $pid) {
        if (function_exists('posix_kill')) @posix_kill($pid, 15);
        else wp_bg('kill ' . (int)$pid);
        $n++;
    }
    // subtítulos: ffmpeg escribiendo sub_*.vtt.part en la caché
    if (wp_exec_mode()) wp_bg('pkill -f ' . escapeshellarg(wp_cache_dir() . '/sub_') . ' || true');
    foreach ((array)glob(wp_cache_dir() . '/sub_*.{job,part}', GLOB_BRACE) as $f) @unlink($f);
    foreach ((array)glob(wp_cache_dir() . '/ff_*.pid') as $f) @unlink($f);
    return $n;
}

/** Llave de las órdenes del panel (derivada de la llave maestra; null sin llave). */
function wp_media_admin_key()
{
    $k = wp_panel_key();
    return $k === null ? null : hash_hmac('sha256', 'media-admin-v1', $k, true);
}

/**
 * Configuración del motor para el reproductor (video_player.php y play.php): el motor del panel (api/media_web.php),
 * SOLO en la VPS / VDS de la línea — la VDS propia del distribuidor si la eligió (nunca la del dueño), si no la del
 * dueño. El hosting de la web nunca convierte. null si no se puede (y $off dice por qué).
 */
function wp_media_cfg($kind, $id, array $exts, $ext, $dur, $multi, &$off = '')
{
    $off = wp_media_off_text();
    // web https con el panel en http: el navegador bloquearía la conversión
    if ($off === '' && wp_is_https() && stripos(wp_panel_base(), 'https://') !== 0) $off = t('No compatible con el dispositivo');
    if ($off !== '' || $kind === 'live') return null;
    $tok = wp_panel_token();
    $raw = wp_stream_url($kind, $id, $ext);
    $pe = wp_panel_base() . 'media_web.php?';
    $pq = 'token=' . rawurlencode($tok) . '&u=' . wp_b64u_enc($raw);
    $cfg = ['status' => $pe . 'do=status&token=' . rawurlencode($tok), 'hls' => $pe . 'do=hls&' . $pq, 'sub' => $pe . 'do=sub&' . $pq,
        'probe' => wp_proxy_url(wp_tracks_target($kind, $id, $exts), 'tracks.php') . '&x=' . rawurlencode($ext) . '&dur=' . (int)$dur, 'dur' => (int)$dur];
    // sin varios audios conocidos: la conversión no se usa salvo que el navegador no pueda con el audio o el formato
    if (!$multi) $cfg['lazy'] = 1;
    // pistas ya conocidas (hosting o panel): el reproductor decide al instante si necesita convertir el audio
    $ft = wp_file_tracks($raw, '', false, 1);
    if ($ft) $cfg['info'] = wp_probe_labels(wp_tracks_probe($ft, (int)$dur));
    return $cfg;
}

