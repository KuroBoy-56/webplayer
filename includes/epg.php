<?php
/**
 * Guía de programas de respaldo: la entrega el panel (api/epg.php).
 * Las páginas piden primero get_short_epg al servidor IPTV; si un canal no
 * trae guía, se consulta aquí. El panel empareja por epg_channel_id y por
 * nombre normalizado contra las guías XMLTV públicas configuradas en el panel.
 */
require_once __DIR__ . '/core.php';

/** Datos del canal (id, epg, name) desde la lista en vivo del servidor IPTV (en caché). */
function wp_epg_channel($streamId)
{
    $all = xt_get('get_live_streams', [], 1800, 25);
    foreach ((array)$all as $c) {
        if (is_array($c) && (string)($c['stream_id'] ?? '') === (string)$streamId) {
            return ['id' => (string)$streamId, 'epg' => (string)($c['epg_channel_id'] ?? ''), 'name' => (string)($c['name'] ?? '')];
        }
    }
    return null;
}

/** Programas de respaldo de un canal: [ ['s','e','t','d'], ... ] */
function wp_epg_for($streamId, $name = '')
{
    $ch = wp_epg_channel($streamId);
    if ($ch === null) {
        if ($name === '') return [];
        $ch = ['id' => (string)$streamId, 'epg' => '', 'name' => (string)$name];
    }
    $res = wp_panel_epg([$ch]);
    return $res[(string)$streamId] ?? [];
}

/** Varios canales en una sola consulta al panel. $channels = [ ['id','epg','name'], ... ] */
function wp_epg_batch(array $channels)
{
    return wp_panel_epg($channels);
}

/** Estado de la última consulta al panel (para diag.php). */
function wp_epg_status()
{
    $st = wp_cache_get('pepg|status', 86400 * 30, $stale);
    if (!is_array($st)) $st = is_array($stale) ? $stale : null;
    return $st;
}
