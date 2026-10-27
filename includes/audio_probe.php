<?php
/*
 * ¿Cuántas pistas de audio trae un video? Sin ffmpeg: lo que el panel ya sabe o la cabecera del archivo
 * (unos pocos KB con peticiones Range, includes/file_tracks.php). El resultado queda en caché 30 días por contenido.
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
    public $failed = false; // alguna lectura no llegó (tiempo, límite o error): el conteo no es confiable
    private $chunks = [];
    private $deadline;

    public function __construct($url, $seconds = 10)
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
        if ($this->requests >= 14 || microtime(true) > $this->deadline) { $this->failed = true; return ''; }
        // pocos pedidos grandes (como Roku): cada uno es una conexión al servidor IPTV
        $want = max($len, 262144);
        $data = $this->fetch($off, $want);
        if ($data === '') { $this->failed = true; return ''; }
        $this->chunks[$off] = $data;
        return substr($data, 0, $len);
    }

    /** trae [off, off + len) en un solo pedido si no está ya leído (el índice moov de un MP4) */
    public function prefetch($off, $len)
    {
        foreach ($this->chunks as $start => $data) {
            if ($off >= $start && $off + $len <= $start + strlen($data)) return;
        }
        if ($this->requests >= 14 || microtime(true) > $this->deadline) return;
        $data = $this->fetch($off, (int)$len);
        if ($data !== '') $this->chunks[$off] = $data;
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
            // cada lectura vuelve a pedir el enlace original: el destino temporal del servidor IPTV puede servir solo una vez
            if (preg_match('~/(\d+)\s*$~', (string)($hdr['content-range'] ?? ''), $m)) $this->size = (int)$m[1];
            return substr($buf, 0, $len);
        }
        // sin soporte de rangos solo sirve el principio del archivo
        if ($code === 200 && $off === 0) return substr($buf, 0, $len);
        return '';
    }
}

/**
 * Número de pistas de audio (0 = no se pudo saber). Primero lo que ya se sabe (hosting o panel, includes/file_tracks.php)
 * y si no, la cabecera del archivo (sin ffmpeg: el hosting nunca convierte ni lee con ffprobe). Caché 30 días; si falla,
 * se reintenta en 2 min. $panelUrl: la dirección con la extensión real (la que identifica el video en el panel).
 */
function wp_audio_track_count($url, $cacheOnly = false, $useProbe = false, $panelUrl = '')
{
    static $memo = [];
    $ck = 'atracks2|' . md5((string)$url);
    if (isset($memo[$ck])) return $memo[$ck];
    $hit = wp_cache_get($ck, 2592000);
    if (is_array($hit) && $hit['n'] > 0) return $memo[$ck] = (int)$hit['n'];
    // lo que sabe el panel (al momento, sin tocar el servidor IPTV); con $cacheOnly no se lee el archivo
    $t = wp_file_tracks($panelUrl !== '' ? $panelUrl : (string)$url, (string)$url, !$cacheOnly && !(is_array($hit) && time() - (int)$hit['t'] < 120), $cacheOnly ? 1.5 : 2);
    if ($t) {
        $n = count($t['audio']);
        wp_cache_set($ck, ['n' => $n, 't' => time()]);
        return $memo[$ck] = $n;
    }
    if ($cacheOnly) return is_array($hit) ? 0 : -1; // aún no se sabe (se averigua en segundo plano con tracks.php)
    wp_cache_set($ck, ['n' => 0, 't' => time()]);
    return $memo[$ck] = 0;
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

require_once __DIR__ . '/file_tracks.php';
