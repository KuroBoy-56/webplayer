<?php
/**
 * Guía de programas (EPG) de respaldo.
 * Cuando el servidor IPTV no envía guía para un canal, se busca en guías XMLTV públicas
 * (por defecto epgshare01 y epg.pw, por país). Los canales se emparejan por epg_channel_id
 * y por nombre normalizado. Se actualiza en segundo plano cada 12 horas.
 *
 * Fuentes editables por el administrador en includes/admin/epg_sources.json:
 *   ["https://.../guia1.xml.gz", "https://.../guia2.xml"]
 */
require_once __DIR__ . '/core.php';

function wp_epg_sources()
{
    $custom = wp_json_file(WP_ROOT . '/includes/admin/epg_sources.json', null);
    if (is_array($custom) && $custom) return array_values(array_filter($custom, 'is_string'));
    $list = [];
    foreach (['MX1', 'CO1', 'AR1', 'CL1', 'PE1', 'ES1', 'US1'] as $c) $list[] = 'https://epgshare01.online/epgshare01/epg_ripper_' . $c . '.xml.gz';
    foreach (['MX', 'ES', 'US'] as $c) $list[] = 'https://epg.pw/xmltv/epg_' . $c . '.xml.gz';
    return $list;
}

/** "MX| Canal 5 HD" → "canal5" */
function wp_epg_norm($name)
{
    $n = wp_norm((string)$name);
    $n = preg_replace('/^\s*(\[[^\]]*\]|\([^)]*\)|[a-z]{2,3}\s*[|:\-])\s*/u', '', $n);
    $n = preg_replace('/\b(fhd|uhd|hd|sd|4k|8k|hevc|h265|h264|1080p?|720p?|2160p?|60fps|50fps|backup|bkp|alt|vip|op\d|opcion\s*\d|latino?|lat|mx|mex|es|esp|us|usa|co|ar|cl|pe)\b/u', ' ', $n);
    $n = preg_replace('/[^a-z0-9+]/', '', $n);
    return $n;
}

function wp_epg_store_key()
{
    return 'epgx|' . wp_user()['server'];
}

/** Programas del respaldo para un canal: [ ['s','e','t','d'], ... ] */
function wp_epg_for($streamId)
{
    $data = wp_cache_get(wp_epg_store_key(), 86400 * 3, $stale);
    if ($data === null) $data = $stale;
    $age = is_array($data) ? time() - (int)($data['_t'] ?? 0) : PHP_INT_MAX;
    if ($age > 43200) wp_epg_schedule();
    $now = time();
    $out = [];
    foreach ((array)($data['c'][(string)$streamId] ?? []) as $p) {
        if ($p[1] > $now - 1800 && $p[0] < $now + 86400) $out[] = ['s' => $p[0], 'e' => $p[1], 't' => $p[2], 'd' => $p[3] ?? ''];
    }
    return $out;
}

/** Actualiza la guía después de responder la página (no hace esperar al usuario). */
function wp_epg_schedule()
{
    static $done = false;
    if ($done) return;
    $done = true;
    if (function_exists('fastcgi_finish_request') || function_exists('litespeed_finish_request')) {
        register_shutdown_function(function () {
            if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request();
            else @litespeed_finish_request();
            wp_epg_build();
        });
        return;
    }
    // sin forma de terminar la respuesta antes: se lanza una petición aparte para no hacer esperar al usuario
    $self = (wp_is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/epgjob.php';
    $ch = curl_init($self);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT_MS => 900, CURLOPT_NOSIGNAL => 1, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER => ['Cookie: ' . session_name() . '=' . session_id()]]);
    @curl_exec($ch);
    curl_close($ch);
}

function wp_epg_build()
{
    $lock = @fopen(wp_cache_dir() . '/epg_build.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return false; // ya se está actualizando
    @set_time_limit(0);
    @ignore_user_abort(true);
    @ini_set('memory_limit', '512M');

    // canales del servidor
    $streams = xt_get('get_live_streams', [], 3600, 40);
    $byId = [];
    $byName = [];
    foreach ((array)$streams as $st) {
        if (!is_array($st)) continue;
        $sid = (string)($st['stream_id'] ?? '');
        if ($sid === '') continue;
        $eid = strtolower(trim((string)($st['epg_channel_id'] ?? '')));
        if ($eid !== '') $byId[$eid][] = $sid;
        $nn = wp_epg_norm($st['name'] ?? '');
        if ($nn !== '' && strlen($nn) >= 2) $byName[$nn][] = $sid;
    }
    if (!$byId && !$byName) { flock($lock, LOCK_UN); fclose($lock); return false; }

    $result = [];
    $log = [];
    $from = time() - 3 * 3600;
    $to = time() + 36 * 3600;
    $tmp = wp_cache_dir() . '/epg_src.tmp';
    foreach (wp_epg_sources() as $src) {
        // descarga a disco (sin cargar todo en memoria)
        $fp = @fopen($tmp, 'w');
        if (!$fp) break;
        $ch = curl_init($src);
        curl_setopt_array($ch, [CURLOPT_FILE => $fp, CURLOPT_FOLLOWLOCATION => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 240,
            CURLOPT_USERAGENT => WP_UA, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_NOPROGRESS => false, CURLOPT_PROGRESSFUNCTION => function ($c, $dt, $d) { return $d > 400 * 1024 * 1024 ? 1 : 0; }]);
        curl_exec($ch);
        $okDl = !curl_errno($ch) && (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
        curl_close($ch);
        fclose($fp);
        $size = (int)@filesize($tmp);
        if (!$okDl || $size < 200) { $log[] = [$src, 'no se pudo descargar', 0]; continue; }
        $before = count($result);

        $r = new XMLReader();
        if (!@$r->open('compress.zlib://' . $tmp, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE)) { $log[] = [$src, 'archivo no válido', 0]; continue; }
        $map = [];     // id xmltv → [stream ids]
        $mapped = false;
        while (@$r->read()) {
            if ($r->nodeType !== XMLReader::ELEMENT) continue;
            if ($r->name === 'channel') {
                $cid = (string)$r->getAttribute('id');
                $node = @simplexml_load_string($r->readOuterXml());
                if (!$node || $cid === '') continue;
                $sids = $byId[strtolower($cid)] ?? [];
                foreach ($node->{'display-name'} as $dn) {
                    $nn = wp_epg_norm((string)$dn);
                    if ($nn !== '' && isset($byName[$nn])) $sids = array_merge($sids, $byName[$nn]);
                }
                if (!$sids) {
                    // id tipo "Canal5.mx" → "canal5"
                    $nn = wp_epg_norm(preg_replace('/\.[a-z]{2,3}$/i', '', $cid));
                    if ($nn !== '' && isset($byName[$nn])) $sids = $byName[$nn];
                }
                $sids = array_values(array_unique($sids));
                $sids = array_filter($sids, function ($s) use ($result) { return !isset($result[$s]); }); // otra fuente ya lo cubrió
                if ($sids) $map[$cid] = array_values($sids);
            } elseif ($r->name === 'programme') {
                if (!$map) { $mapped = true; continue; }
                $cid = (string)$r->getAttribute('channel');
                if (!isset($map[$cid])) continue;
                $s = wp_epg_time($r->getAttribute('start'));
                $e = wp_epg_time($r->getAttribute('stop'));
                if (!$s || !$e || $e < $from || $s > $to) continue;
                $node = @simplexml_load_string($r->readOuterXml());
                if (!$node) continue;
                $title = trim((string)$node->title);
                $desc = trim((string)$node->desc);
                if (mb_strlen($desc, 'UTF-8') > 280) $desc = mb_substr($desc, 0, 277, 'UTF-8') . '…';
                foreach ($map[$cid] as $sid) $result[$sid][] = [$s, $e, $title, $desc];
            }
        }
        $r->close();
        $log[] = [$src, 'ok (' . round($size / 1048576, 1) . ' MB)', count($result) - $before];
    }
    @unlink($tmp);
    foreach ($result as &$progs) {
        usort($progs, function ($a, $b) { return $a[0] - $b[0]; });
    }
    unset($progs);
    wp_cache_set(wp_epg_store_key(), ['_t' => time(), 'c' => $result, 'log' => $log, 'n' => count($byId) + count($byName)]);
    flock($lock, LOCK_UN);
    fclose($lock);
    return count($result);
}

/** "20261003143000 +0200" → epoch */
function wp_epg_time($v)
{
    $v = trim((string)$v);
    if (!preg_match('/^(\d{14})\s*([+-]\d{4})?/', $v, $m)) return 0;
    $d = DateTime::createFromFormat('YmdHis O', $m[1] . ' ' . ($m[2] ?? '+0000'));
    return $d ? $d->getTimestamp() : 0;
}

/** Estado de la guía de respaldo (para el diagnóstico). */
function wp_epg_status()
{
    $data = wp_cache_get(wp_epg_store_key(), 86400 * 30, $stale);
    if ($data === null) $data = $stale;
    if (!is_array($data)) return null;
    return ['t' => (int)($data['_t'] ?? 0), 'channels' => count((array)($data['c'] ?? [])), 'log' => (array)($data['log'] ?? [])];
}
