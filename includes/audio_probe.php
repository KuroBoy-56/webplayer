<?php
/*
 * ¿Cuántas pistas de audio trae un video? Sin ffmpeg: el hosting lee solo la cabecera del archivo
 * (unos pocos KB con peticiones Range) y cuenta las pistas de sonido del MP4 (moov/trak/hdlr)
 * o del MKV (Tracks/TrackEntry/TrackType). El resultado queda en caché 30 días por contenido.
 *
 * Se usa para decidir si el video pasa por el hosting (más de un audio: hay que poder elegir el idioma)
 * o va directo del servidor IPTV al navegador (un solo audio: el hosting no trabaja).
 */

/** Lector por rangos con pequeños bloques en memoria y un tope de peticiones y de tiempo. */
final class WpRangeReader
{
    public $url;
    public $size = 0;
    public $requests = 0;
    private $chunks = [];
    private $deadline;

    public function __construct($url, $seconds = 3)
    {
        $this->url = $url;
        $this->deadline = microtime(true) + $seconds;
    }

    /** $len bytes desde $off ('' si no se pudo). */
    public function read($off, $len)
    {
        foreach ($this->chunks as $start => $data) {
            if ($off >= $start && $off + $len <= $start + strlen($data)) return substr($data, $off - $start, $len);
        }
        if ($this->requests >= 8 || microtime(true) > $this->deadline) return '';
        $want = max($len, 65536);
        $data = $this->fetch($off, $want);
        if ($data === '') return '';
        $this->chunks[$off] = $data;
        return substr($data, 0, $len);
    }

    private function fetch($off, $len)
    {
        $this->requests++;
        $buf = '';
        $code = 0;
        $hdr = [];
        $ch = curl_init($this->url);
        wp_doh_apply($ch, $this->url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 8, CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => max(2, (int)ceil($this->deadline - microtime(true))),
            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_USERAGENT => WP_UA,
            CURLOPT_HTTPHEADER => ['Range: bytes=' . $off . '-' . ($off + $len - 1)],
            CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$hdr) {
                $p = strpos($h, ':');
                if ($p !== false) $hdr[strtolower(trim(substr($h, 0, $p)))] = trim(substr($h, $p + 1));
                return strlen($h);
            },
            // se corta al tener lo pedido (si el servidor ignora el Range no se descarga la película)
            CURLOPT_WRITEFUNCTION => function ($c, $d) use (&$buf, $len) {
                $buf .= $d;
                return strlen($buf) >= $len ? -1 : strlen($d);
            },
        ]);
        curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $final = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        curl_close($ch);
        if ($code === 206) {
            if ($final !== '') $this->url = $final; // las siguientes lecturas van directo al destino final
            if (preg_match('~/(\d+)\s*$~', (string)($hdr['content-range'] ?? ''), $m)) $this->size = (int)$m[1];
            return substr($buf, 0, $len);
        }
        // sin soporte de rangos solo sirve el principio del archivo
        if ($code === 200 && $off === 0) return substr($buf, 0, $len);
        return '';
    }
}

/** Número de pistas de audio (0 = no se pudo saber). Caché 30 días; si falla, se reintenta en 1 hora. */
function wp_audio_track_count($url)
{
    static $memo = [];
    $ck = 'atracks|' . md5((string)$url);
    if (isset($memo[$ck])) return $memo[$ck];
    $hit = wp_cache_get($ck, 2592000);
    if (is_array($hit) && ($hit['n'] > 0 || time() - (int)$hit['t'] < 3600)) return $memo[$ck] = (int)$hit['n'];
    $r = new WpRangeReader($url);
    $head = $r->read(0, 16);
    $n = 0;
    if (strlen($head) >= 8) {
        if (substr($head, 0, 4) === "\x1A\x45\xDF\xA3") $n = wp_mkv_audio_count($r);
        elseif (in_array(substr($head, 4, 4), ['ftyp', 'moov', 'free', 'mdat', 'skip', 'wide', 'pdin', 'styp'], true)) $n = wp_mp4_audio_count($r);
    }
    wp_cache_set($ck, ['n' => $n, 't' => time()]);
    return $memo[$ck] = $n;
}

/* ---------- MP4 ---------- */

/** Cabecera de caja en $off: [tamaño, tipo, largo de cabecera] o null. */
function wp_mp4_box(WpRangeReader $r, $off, $end)
{
    $h = $r->read($off, 16);
    if (strlen($h) < 8) return null;
    $size = unpack('N', substr($h, 0, 4))[1];
    $type = substr($h, 4, 4);
    $hl = 8;
    if ($size === 1) {
        if (strlen($h) < 16) return null;
        $p = unpack('N2', substr($h, 8, 8));
        $size = $p[1] * 4294967296 + $p[2];
        $hl = 16;
    } elseif ($size === 0) {
        $size = $end - $off;
    }
    if ($size < $hl) return null;
    return [$size, $type, $hl];
}

function wp_mp4_audio_count(WpRangeReader $r)
{
    $off = 0;
    $end = PHP_INT_MAX;
    for ($i = 0; $i < 20; $i++) {
        $b = wp_mp4_box($r, $off, $r->size ?: $end);
        if (!$b) return 0;
        if ($b[1] === 'moov') return wp_mp4_moov_audio($r, $off + $b[2], $off + $b[0]);
        $off += $b[0]; // salta mdat, free… (moov puede estar al final del archivo)
        if ($r->size && $off >= $r->size) return 0;
    }
    return 0;
}

function wp_mp4_moov_audio(WpRangeReader $r, $off, $end)
{
    $n = 0;
    $tracks = 0;
    while ($off < $end && $tracks < 32) {
        $b = wp_mp4_box($r, $off, $end);
        if (!$b) break;
        if ($b[1] === 'trak') {
            $tracks++;
            if (wp_mp4_trak_handler($r, $off + $b[2], $off + $b[0]) === 'soun') $n++;
        }
        $off += $b[0];
    }
    return $n;
}

/** Tipo de pista (soun, vide, text…) leyendo trak → mdia → hdlr. */
function wp_mp4_trak_handler(WpRangeReader $r, $off, $end)
{
    for ($depth = 0, $guard = 0; $off < $end && $guard < 40; $guard++) {
        $b = wp_mp4_box($r, $off, $end);
        if (!$b) return '';
        if ($b[1] === 'mdia' && $depth === 0) {
            $depth = 1;
            $end = $off + $b[0];
            $off += $b[2];
            continue;
        }
        if ($b[1] === 'hdlr' && $depth === 1) {
            $h = $r->read($off + $b[2], 12); // versión/flags (4) + pre_defined (4) + handler_type (4)
            return strlen($h) === 12 ? substr($h, 8, 4) : '';
        }
        $off += $b[0];
    }
    return '';
}

/* ---------- MKV / WebM ---------- */

/** Entero EBML de largo variable en $off: [valor, largo] ($keep = conservar el bit marcador, para los ID). */
function wp_ebml_vint(WpRangeReader $r, $off, $keep)
{
    $h = $r->read($off, 8);
    if ($h === '') return null;
    $first = ord($h[0]);
    $len = 1;
    while ($len <= 8 && !($first & (0x80 >> ($len - 1)))) $len++;
    if ($len > 8 || strlen($h) < $len) return null;
    $v = $keep ? $first : $first & (0xFF >> $len);
    $allOnes = ($first & (0xFF >> $len)) === (0xFF >> $len);
    for ($i = 1; $i < $len; $i++) {
        $v = $v * 256 + ord($h[$i]);
        if (ord($h[$i]) !== 0xFF) $allOnes = false;
    }
    if (!$keep && $allOnes) $v = -1; // tamaño desconocido
    return [$v, $len];
}

/** Elemento EBML en $off: [id, inicio de datos, tamaño (-1 desconocido)] o null. */
function wp_ebml_el(WpRangeReader $r, $off)
{
    $id = wp_ebml_vint($r, $off, true);
    if (!$id) return null;
    $sz = wp_ebml_vint($r, $off + $id[1], false);
    if (!$sz) return null;
    return [$id[0], $off + $id[1] + $sz[1], $sz[0]];
}

function wp_mkv_audio_count(WpRangeReader $r)
{
    $e = wp_ebml_el($r, 0); // cabecera EBML
    if (!$e || $e[2] < 0) return 0;
    $seg = wp_ebml_el($r, $e[1] + $e[2]);
    if (!$seg || $seg[0] !== 0x18538067) return 0;
    $off = $seg[1];
    $end = $seg[2] < 0 ? PHP_INT_MAX : $seg[1] + $seg[2];
    for ($i = 0; $i < 40 && $off < $end; $i++) {
        $el = wp_ebml_el($r, $off);
        if (!$el || $el[2] < 0) return 0;
        if ($el[0] === 0x1654AE6B) return wp_mkv_tracks_audio($r, $el[1], $el[1] + $el[2]);
        if ($el[0] === 0x1F43B675) return 0; // ya empezó el video (Cluster) sin pistas antes
        $off = $el[1] + $el[2];
    }
    return 0;
}

function wp_mkv_tracks_audio(WpRangeReader $r, $off, $end)
{
    $n = 0;
    for ($i = 0; $i < 64 && $off < $end; $i++) {
        $el = wp_ebml_el($r, $off);
        if (!$el || $el[2] < 0) break;
        if ($el[0] === 0xAE) { // TrackEntry
            $o = $el[1];
            $e = $el[1] + $el[2];
            for ($j = 0; $j < 40 && $o < $e; $j++) {
                $c = wp_ebml_el($r, $o);
                if (!$c || $c[2] < 0) break;
                if ($c[0] === 0x83) { // TrackType: 2 = audio
                    $v = $r->read($c[1], $c[2]);
                    $t = 0;
                    for ($k = 0; $k < strlen($v); $k++) $t = $t * 256 + ord($v[$k]);
                    if ($t === 2) $n++;
                    break;
                }
                $o = $c[1] + $c[2];
            }
        }
        $off = $el[1] + $el[2];
    }
    return $n;
}
