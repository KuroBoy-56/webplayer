<?php
/**
 * Control del motor multimedia (media.php) desde el panel: activado/desactivado, conversiones en
 * curso y detenerlas. Lo usa media_admin.php (peticiones firmadas por el panel con la llave maestra).
 * Desactivado: la página del video no ofrece el motor y media.php responde 503, así que el
 * reproductor usa el video directo del servidor IPTV, como sin ffmpeg.
 */

function wp_media_flag()
{
    return wp_cache_dir() . '/media_disabled';
}

function wp_media_enabled()
{
    return !is_file(wp_media_flag());
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
