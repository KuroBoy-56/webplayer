<?php
/*
 * Idiomas de audio y subtítulos de un video, igual que Roku (source/Probe.brs), Vega, LG y Samsung:
 *   1. lo que el hosting ya sabe (30 días)
 *   2. lo que el panel recuerda de ese video (api/tracks.php: otro equipo ya lo leyó; al momento, sin tocar el
 *      servidor IPTV) — es lo único que se pregunta desde la ficha
 *   3. la cabecera del archivo (unos KB por rangos, sin ffmpeg), y lo leído se le deja al panel para los demás
 * Mismo formato que las apps: {container: mp4|mkv, audio: [{id, lang, codec, name, def, forced}], subs: [...]}.
 * El panel guarda por distribuidor, servidor y video (con la extensión real del contenido).
 */

/** Token del panel de esta línea (se pide si la sesión todavía no lo tiene). */
function wp_panel_tok($fresh = false)
{
    $t = $fresh ? '' : wp_panel_token();
    if ($t !== '') return $t;
    $u = wp_user();
    if (($u['username'] ?? '') === '') return '';
    $t = wp_panel_auth($u['username'], $u['password'], $u['server']);
    if ($t !== '') { wp_panel_store_token($t); wp_panel_set_demo(!empty($GLOBALS['wp_panel_auth_demo'])); }
    return $t;
}

/** Lo que el panel recuerda de este video (api/tracks.php, hasta $wait s) o null. */
function wp_panel_tracks_get($url, $wait = 2)
{
    if (!wp_panel_ready()) return null;
    for ($try = 0; $try < 2; $try++) {
        $tok = wp_panel_tok($try > 0);
        if ($tok === '') return null;
        $res = wp_panel_request('tracks.php?token=' . rawurlencode($tok) . '&u=' . wp_b64u_enc($url), null, [], max(1, (int)ceil($wait)), $code);
        if ($code === 401 && $try === 0) continue;
        $j = is_string($res) ? json_decode($res, true) : null;
        $p = is_array($j) && !empty($j['ok']) && is_array($j['probe'] ?? null) ? $j['probe'] : null;
        return $p && is_array($p['audio'] ?? null) && is_array($p['subs'] ?? null) ? $p : null;
    }
    return null;
}

/** Le deja al panel lo leído de la cabecera (para los demás equipos y distribuidores del mismo servidor). */
function wp_panel_tracks_post($url, array $t)
{
    $tok = wp_panel_tok();
    if ($tok === '' || !in_array($t['container'] ?? '', ['mp4', 'mkv'], true)) return;
    wp_panel_request('tracks.php', ['token' => $tok, 'u' => wp_b64u_enc($url),
        'probe' => ['container' => $t['container'], 'audio' => $t['audio'], 'subs' => $t['subs']]], [], 4);
}

/**
 * Pistas del video: hosting → panel → cabecera del archivo ($read; $target = la dirección que se lee, $url = la del
 * contenido con su extensión real, la que identifica al video en el panel). null si no se sabe.
 */
function wp_file_tracks($url, $target = '', $read = true, $panelWait = 2)
{
    static $memo = [];
    $target = $target !== '' ? $target : $url;
    $ck = 'ftracks|' . md5($url);
    if (isset($memo[$ck]) && ($memo[$ck] || !$read)) return $memo[$ck] ?: null;
    $hit = wp_cache_get($ck, 30 * 86400);
    if (is_array($hit) && !empty($hit['audio'])) return $memo[$ck] = $hit;
    // el panel no lo sabía hace un momento: no se le vuelve a preguntar en cada página (2 min)
    $miss = wp_cache_get('ftracks_miss|' . md5($url), 120);
    if (!$miss) {
        $p = wp_panel_tracks_get($url, $panelWait);
        if ($p && !empty($p['audio'])) {
            $p = ['container' => (string)($p['container'] ?? ''), 'audio' => $p['audio'], 'subs' => $p['subs'], 'video' => '', 'from' => 'panel'];
            wp_cache_set($ck, $p);
            return $memo[$ck] = $p;
        }
        wp_cache_set('ftracks_miss|' . md5($url), 1);
    }
    if (!$read) { $memo[$ck] = false; return null; }
    $r = new WpRangeReader($target, 10);
    $t = wp_read_tracks($r);
    if (!$t || $r->failed || !$t['audio']) { $memo[$ck] = false; return null; }
    $t['from'] = 'file';
    wp_cache_set($ck, $t);
    wp_panel_tracks_post($url, $t);
    return $memo[$ck] = $t;
}

/** Lee las pistas de la cabecera (MP4 o MKV): {container, audio, subs, video} o null. */
function wp_read_tracks(WpRangeReader $r)
{
    $head = $r->read(0, 16);
    if (strlen($head) < 8) return null;
    if (substr($head, 0, 4) === "\x1A\x45\xDF\xA3") return ['container' => 'mkv'] + wp_mkv_tracks($r);
    if (in_array(substr($head, 4, 4), ['ftyp', 'moov', 'free', 'mdat', 'skip', 'wide', 'pdin', 'styp'], true)) return ['container' => 'mp4'] + wp_mp4_tracks($r);
    return null;
}

/* ---------- MP4 ---------- */

function wp_mp4_tracks(WpRangeReader $r)
{
    $none = ['audio' => [], 'subs' => [], 'video' => ''];
    $off = 0;
    for ($i = 0; $i < 20; $i++) {
        // moov al final del archivo (después del video): el final entero en un solo pedido
        if ($off > 0 && $r->size && $r->size - $off <= 4194304) $r->prefetch($off, $r->size - $off);
        $b = wp_mp4_box($r, $off, $r->size ?: PHP_INT_MAX);
        if (!$b) return $none;
        if ($b[1] === 'moov') {
            if ($b[0] <= 4194304) $r->prefetch($off, $b[0]);
            return wp_mp4_moov_tracks($r, $off + $b[2], $off + $b[0]);
        }
        $off += $b[0];
        if ($r->size && $off >= $r->size) return $none;
    }
    return $none;
}

function wp_mp4_moov_tracks(WpRangeReader $r, $off, $end)
{
    // subtítulos de MP4: texto 3GPP (sbtl/text), WebVTT y TTML (subt), CEA-608 (clcp)
    $out = ['audio' => [], 'subs' => [], 'video' => ''];
    for ($n = 0; $off < $end && $n < 32;) {
        $b = wp_mp4_box($r, $off, $end);
        if (!$b) break;
        if ($b[1] === 'trak') {
            $n++;
            $t = wp_mp4_trak($r, $off + $b[2], $off + $b[0]);
            $e = ['id' => $t['id'], 'lang' => $t['lang'], 'codec' => $t['codec'], 'name' => $t['name'], 'def' => $t['enabled'], 'forced' => false];
            if ($t['handler'] === 'soun') $out['audio'][] = $e;
            elseif (in_array($t['handler'], ['sbtl', 'text', 'subt', 'clcp'], true)) $out['subs'][] = $e;
            elseif ($t['handler'] === 'vide' && $out['video'] === '') $out['video'] = wp_codec_name($t['codec']);
        }
        $off += $b[0];
    }
    return $out;
}

/** trak → id y activada (tkhd), tipo y nombre (hdlr), idioma (mdhd), códec (stsd) */
function wp_mp4_trak(WpRangeReader $r, $off, $end)
{
    $t = ['id' => '', 'handler' => '', 'lang' => '', 'codec' => '', 'name' => '', 'enabled' => false];
    for ($guard = 0; $off < $end && $guard < 60; $guard++) {
        $b = wp_mp4_box($r, $off, $end);
        if (!$b) break;
        $body = $off + $b[2];
        if (in_array($b[1], ['mdia', 'minf', 'stbl'], true)) { $off = $body; continue; }
        if ($b[1] === 'tkhd') {
            $h = $r->read($body, 32);
            if (strlen($h) >= 32) {
                $t['enabled'] = (ord($h[3]) & 1) === 1;
                $t['id'] = (string)unpack('N', substr($h, ord($h[0]) === 1 ? 20 : 12, 4))[1];
            }
        } elseif ($b[1] === 'mdhd') {
            $h = $r->read($body, 36);
            if (strlen($h) >= 36) {
                $code = unpack('n', substr($h, ord($h[0]) === 1 ? 32 : 20, 2))[1];
                $l = chr((($code >> 10) & 31) + 96) . chr((($code >> 5) & 31) + 96) . chr(($code & 31) + 96);
                if ($code !== 0 && $l !== 'und') $t['lang'] = $l;
            }
        } elseif ($b[1] === 'hdlr') {
            $h = $r->read($body, min(80, $b[0] - $b[2]));
            if (strlen($h) >= 12) {
                $t['handler'] = substr($h, 8, 4);
                $nm = '';
                for ($i = 24; $i < strlen($h) && $h[$i] !== "\0"; $i++) if (ord($h[$i]) >= 32 && ord($h[$i]) < 127) $nm .= $h[$i];
                $nm = trim($nm);
                // nombres genéricos que pone el programa que armó el archivo
                $t['name'] = preg_match('/handler|core media|gpac/i', $nm) ? '' : $nm;
            }
        } elseif ($b[1] === 'stsd') {
            $h = $r->read($body, 16);
            if (strlen($h) >= 16) $t['codec'] = substr($h, 12, 4);
        }
        $off += $b[0];
    }
    return $t;
}

/* ---------- MKV / WebM ---------- */

function wp_mkv_tracks(WpRangeReader $r)
{
    $none = ['audio' => [], 'subs' => [], 'video' => ''];
    $e = wp_ebml_el($r, 0); // cabecera EBML
    if (!$e || $e[2] < 0) return $none;
    $seg = wp_ebml_el($r, $e[1] + $e[2]);
    if (!$seg || $seg[0] !== 0x18538067) return $none;
    $off = $seg[1];
    $end = $seg[2] < 0 ? PHP_INT_MAX : $seg[1] + $seg[2];
    for ($i = 0; $i < 40 && $off < $end; $i++) {
        $el = wp_ebml_el($r, $off);
        if (!$el || $el[2] < 0) return $none;
        if ($el[0] === 0x1654AE6B) return wp_mkv_track_list($r, $el[1], $el[1] + $el[2]);
        if ($el[0] === 0x1F43B675) return $none; // ya empezó el video (Cluster) sin pistas antes
        $off = $el[1] + $el[2];
    }
    return $none;
}

/** TrackEntry: TrackNumber D7, TrackType 83 (1 video, 2 audio, 17 subtítulos), Language 22B59C, CodecID 86, Name 536E,
 *  FlagDefault 88 (vale 1 si no viene), FlagForced 55AA */
function wp_mkv_track_list(WpRangeReader $r, $off, $end)
{
    $out = ['audio' => [], 'subs' => [], 'video' => ''];
    for ($i = 0; $i < 64 && $off < $end; $i++) {
        $el = wp_ebml_el($r, $off);
        if (!$el || $el[2] < 0) break;
        if ($el[0] === 0xAE) {
            $t = ['num' => '', 'type' => 0, 'lang' => '', 'codec' => '', 'name' => '', 'def' => true, 'forced' => false];
            $o = $el[1];
            $e = $el[1] + $el[2];
            for ($j = 0; $j < 40 && $o < $e; $j++) {
                $c = wp_ebml_el($r, $o);
                if (!$c || $c[2] < 0) break;
                $v = in_array($c[0], [0xD7, 0x83, 0x88, 0x55AA, 0x22B59C, 0x86, 0x536E], true) ? $r->read($c[1], min(64, $c[2])) : '';
                if (in_array($c[0], [0xD7, 0x83, 0x88, 0x55AA], true)) {
                    $x = 0;
                    for ($k = 0; $k < strlen($v); $k++) $x = $x * 256 + ord($v[$k]);
                    if ($c[0] === 0xD7) $t['num'] = (string)$x;
                    elseif ($c[0] === 0x83) $t['type'] = $x;
                    elseif ($c[0] === 0x88) $t['def'] = $x !== 0;
                    else $t['forced'] = $x !== 0;
                } elseif ($v !== '') {
                    $s = '';
                    for ($k = 0; $k < strlen($v) && $v[$k] !== "\0"; $k++) if (ord($v[$k]) >= 32 && ord($v[$k]) < 127) $s .= $v[$k];
                    if ($c[0] === 0x22B59C) $t['lang'] = $s;
                    elseif ($c[0] === 0x86) $t['codec'] = $s;
                    else $t['name'] = $s;
                }
                $o = $c[1] + $c[2];
            }
            $e = ['id' => $t['num'], 'lang' => $t['lang'], 'codec' => $t['codec'], 'name' => $t['name'], 'def' => $t['def'], 'forced' => $t['forced']];
            if ($t['type'] === 2) $out['audio'][] = $e;
            elseif ($t['type'] === 17) $out['subs'][] = $e;
            elseif ($t['type'] === 1 && $out['video'] === '') $out['video'] = wp_codec_name($t['codec']);
        }
        $off = $el[1] + $el[2];
    }
    return $out;
}

/* ---------- formato del reproductor ---------- */

/** Códec del archivo (fourcc de MP4 o CodecID de MKV, como los guarda el panel) con el nombre de ffmpeg. */
function wp_codec_name($c)
{
    $c = strtolower(trim((string)$c));
    static $map = [
        'ac-3' => 'ac3', 'a_ac3' => 'ac3', 'ec-3' => 'eac3', 'a_eac3' => 'eac3', 'mp4a' => 'aac', 'a_aac' => 'aac',
        'a_truehd' => 'truehd', 'mlpa' => 'truehd', 'opus' => 'opus', 'a_opus' => 'opus', 'a_mpeg/l3' => 'mp3', '.mp3' => 'mp3',
        'a_mpeg/l2' => 'mp2', 'flac' => 'flac', 'fla' => 'flac', 'a_flac' => 'flac', 'a_vorbis' => 'vorbis', 'alac' => 'alac', 'a_alac' => 'alac',
        'lpcm' => 'pcm_s16le', 'sowt' => 'pcm_s16le', 'twos' => 'pcm_s16be',
        's_text/utf8' => 'subrip', 's_text/ascii' => 'subrip', 's_text/ass' => 'ass', 's_text/ssa' => 'ass', 's_ass' => 'ass', 's_ssa' => 'ass',
        's_text/webvtt' => 'webvtt', 'wvtt' => 'webvtt', 'tx3g' => 'mov_text', 'text' => 'mov_text', 's_hdmv/pgs' => 'hdmv_pgs_subtitle',
        's_vobsub' => 'dvd_subtitle', 'stpp' => 'ttml', 'c608' => 'eia_608',
        'avc1' => 'h264', 'avc3' => 'h264', 'v_mpeg4/iso/avc' => 'h264', 'hvc1' => 'hevc', 'hev1' => 'hevc', 'v_mpegh/iso/hevc' => 'hevc',
        'vp09' => 'vp9', 'v_vp9' => 'vp9', 'v_vp8' => 'vp8', 'av01' => 'av1', 'v_av1' => 'av1', 'mp4v' => 'mpeg4', 'v_mpeg4/iso/asp' => 'mpeg4',
        'v_mpeg2' => 'mpeg2video', 'v_ms/vfw/fourcc' => 'mpeg4',
    ];
    if (isset($map[$c])) return $map[$c];
    if (strpos($c, 'a_aac') === 0) return 'aac';
    if (strpos($c, 'a_dts') === 0 || in_array($c, ['dtsc', 'dtsh', 'dtsl', 'dtse'], true)) return 'dts';
    if (strpos($c, 'a_pcm') === 0) return 'pcm_s16le';
    return $c;
}

/**
 * Las pistas en el formato del reproductor (el de ffprobe que ya usaba la web): audio/subs con su número (i, en el
 * orden de ffmpeg), idioma, nombre y si es texto (los subtítulos de imagen no se pueden pasar a WebVTT).
 */
function wp_tracks_probe(array $t, $dur = 0)
{
    $res = ['dur' => (float)$dur, 'video' => (string)($t['video'] ?? ''), 'audio' => [], 'subs' => [], 'from' => (string)($t['from'] ?? '')];
    foreach ($t['audio'] as $i => $a) {
        if (!is_array($a)) continue;
        $res['audio'][] = ['i' => $i, 'codec' => wp_codec_name($a['codec'] ?? ''), 'ch' => 0, 'lang' => strtolower((string)($a['lang'] ?? '')),
            'title' => (string)($a['name'] ?? ''), 'def' => !empty($a['def'])];
    }
    foreach ($t['subs'] as $i => $s) {
        if (!is_array($s)) continue;
        $c = wp_codec_name($s['codec'] ?? '');
        $res['subs'][] = ['i' => $i, 'codec' => $c, 'lang' => strtolower((string)($s['lang'] ?? '')), 'title' => (string)($s['name'] ?? ''),
            'forced' => !empty($s['forced']), 'text' => in_array($c, ['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'srt'], true)];
    }
    return $res;
}
