<?php
/* Procesamiento en el hosting (proxy.php y media.php): solo se usa cuando el servidor IPTV entrega por http. */
/* ------------------------------------------------------------------ */
/* FFmpeg opcional: audio Dolby (AC3/E-AC3/DTS), pistas y subtítulos   */
/* ------------------------------------------------------------------ */

/** Ruta de un binario (ffmpeg|ffprobe) o null. El hosting ya no usa ffmpeg (la conversión es del panel en la VPS / VDS). */
function wp_bin($name)
{
    static $memo = [];
    if (array_key_exists($name, $memo)) return $memo[$name];
    if (!wp_exec_mode()) return $memo[$name] = null;
    $const = 'WP_' . strtoupper($name);
    $cands = [];
    if (defined($const)) $cands[] = constant($const);
    $cands[] = WP_ROOT . '/bin/' . $name;
    $cands[] = '/usr/bin/' . $name;
    $cands[] = '/usr/local/bin/' . $name;
    $cands[] = '/opt/homebrew/bin/' . $name;
    foreach ($cands as $c) {
        if ($c && @is_file($c) && @is_executable($c)) return $memo[$name] = $c;
    }
    return $memo[$name] = null;
}

/** Información de pistas (ffprobe) con caché de 7 días. */
function wp_probe($url)
{
    $ck = 'probe|' . md5($url);
    $hit = wp_cache_get($ck, 604800);
    if (is_array($hit)) return $hit;
    $bin = wp_bin('ffprobe');
    if (!$bin) return null;
    list($in, $hdr) = wp_doh_ffmpeg($url);
    $cmd = array_merge([$bin, '-v', 'error', '-user_agent', WP_UA, '-rw_timeout', '15000000'], $hdr, ['-show_entries',
        'format=duration:stream=index,codec_type,codec_name,channels,profile:stream_tags=language,title:stream_disposition=default,forced',
        '-of', 'json', $in]);
    $out = wp_run($cmd, 25);
    $j = $out ? json_decode($out, true) : null;
    if (!is_array($j) || empty($j['streams'])) {
        // el servidor IPTV a veces rechaza una conexión extra mientras el navegador está leyendo el video
        sleep(2);
        $out = wp_run($cmd, 25);
        $j = $out ? json_decode($out, true) : null;
    }
    if (!is_array($j) || empty($j['streams'])) return null;
    $res = ['dur' => (float)($j['format']['duration'] ?? 0), 'video' => '', 'audio' => [], 'subs' => []];
    $ai = 0; $si = 0;
    foreach ($j['streams'] ?? [] as $st) {
        $type = $st['codec_type'] ?? '';
        $lang = strtolower((string)($st['tags']['language'] ?? ''));
        $title = (string)($st['tags']['title'] ?? '');
        if ($type === 'video' && $res['video'] === '' && ($st['codec_name'] ?? '') !== 'mjpeg' && ($st['codec_name'] ?? '') !== 'png') {
            $res['video'] = (string)($st['codec_name'] ?? '');
        } elseif ($type === 'audio') {
            $res['audio'][] = ['i' => $ai++, 'codec' => (string)($st['codec_name'] ?? ''), 'ch' => (int)($st['channels'] ?? 0),
                'lang' => $lang, 'title' => $title, 'def' => !empty($st['disposition']['default'])];
        } elseif ($type === 'subtitle') {
            $c = (string)($st['codec_name'] ?? '');
            $res['subs'][] = ['i' => $si++, 'codec' => $c, 'lang' => $lang, 'title' => $title, 'forced' => !empty($st['disposition']['forced']),
                'text' => in_array($c, ['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'srt'], true)];
        }
    }
    wp_cache_set($ck, $res);
    return $res;
}

/**
 * Nombre de cada pista solo con su idioma, como en las apps ("Español latino", "Inglés"; si se repite, "Inglés 2"),
 * nunca el códec ni el título técnico del proveedor. Sin idioma: su nombre o "Audio N".
 */
function wp_probe_labels(array $p)
{
    foreach (['audio', 'subs'] as $kind) {
        $seen = [];
        foreach ($p[$kind] as &$a) {
            $ln = wp_lang_name($a['lang'] ?? '');
            // "Latino" en el nombre de una pista en español (o sin idioma): Español latino, como en las apps
            if (($ln === '' || $ln === t('Español')) && preg_match('/latino|latam|\blat\b/i', (string)($a['title'] ?? ''))) $ln = t('Español latino');
            $base = $ln !== '' ? $ln : (trim((string)($a['title'] ?? '')) !== '' ? trim((string)$a['title']) : t($kind === 'audio' ? 'Audio {n}' : 'Subtítulo {n}', ['n' => $a['i'] + 1]));
            $seen[$base] = ($seen[$base] ?? 0) + 1;
            $a['label'] = $base . ($seen[$base] > 1 ? ' ' . $seen[$base] : '') . ($kind === 'subs' && !empty($a['forced']) ? ' (' . t('forzado') . ')' : '');
        }
        unset($a);
    }
    $p['ok'] = true;
    return $p;
}

/** ¿El hosting permite esta función de PHP? */
function wp_fn_ok($f)
{
    static $dis = null;
    if ($dis === null) $dis = array_map('strtolower', array_map('trim', explode(',', (string)ini_get('disable_functions'))));
    return function_exists($f) && !in_array(strtolower($f), $dis, true);
}

/** Forma de ejecutar programas que permite el hosting: proc_open, popen, exec o shell_exec (o null si todas están bloqueadas). */
function wp_exec_mode()
{
    static $m = false;
    if ($m !== false) return $m;
    foreach (['proc_open' => 'proc', 'popen' => 'popen', 'exec' => 'exec', 'shell_exec' => 'shell'] as $f => $k) {
        if (wp_fn_ok($f)) return $m = $k;
    }
    return $m = null;
}

function wp_cmd_line(array $cmd)
{
    return implode(' ', array_map('escapeshellarg', $cmd));
}

/** Ejecuta un comando y devuelve código de salida, salida, errores y duración. */
function wp_exec(array $cmd, $timeout = 20)
{
    $res = ['ok' => false, 'code' => -1, 'out' => '', 'err' => '', 'ms' => 0];
    $t = microtime(true);
    $mode = wp_exec_mode();
    if (!$mode) { $res['err'] = 'el hosting bloquea la ejecución de programas'; return $res; }
    $line = wp_cmd_line($cmd);
    $end = $t + $timeout;
    if ($mode === 'proc') {
        $p = @proc_open($line, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($p)) { $res['err'] = 'proc_open no pudo iniciar el programa'; return $res; }
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $code = null;
        while (microtime(true) < $end) {
            $r = [$pipes[1], $pipes[2]]; $w = null; $x = null;
            if (@stream_select($r, $w, $x, 1) === false) break;
            foreach ($r as $fh) {
                $c = fread($fh, 65536);
                if ($c === false) continue;
                if ($fh === $pipes[1]) { if (strlen($res['out']) < 2000000) $res['out'] .= $c; } else { $res['err'] .= $c; }
            }
            $st = proc_get_status($p);
            if (!$st['running']) { $code = $st['exitcode']; $res['out'] .= (string)stream_get_contents($pipes[1]); $res['err'] .= (string)stream_get_contents($pipes[2]); break; }
        }
        @fclose($pipes[1]); @fclose($pipes[2]);
        $st = proc_get_status($p);
        if ($st['running']) { @proc_terminate($p, 9); $res['err'] .= "\n(tiempo agotado)"; }
        @proc_close($p);
        $res['code'] = $code === null ? -1 : (int)$code;
    } else {
        // popen / exec / shell_exec pasan por la shell: errores a un archivo y límite de tiempo con "timeout"
        $errFile = wp_cache_dir() . '/exec_' . md5(uniqid('', true)) . '.err';
        $sh = (@is_executable('/usr/bin/timeout') ? 'timeout -k 2 ' . (int)$timeout . ' ' : '') . $line . ' 2>' . escapeshellarg($errFile);
        if ($mode === 'popen') {
            $h = @popen($sh . '; echo "__RC=$?"', 'r');
            if (!$h) { $res['err'] = 'popen no pudo iniciar el programa'; return $res; }
            while (!feof($h) && microtime(true) < $end + 3) {
                $c = fread($h, 65536);
                if ($c === false) break;
                if (strlen($res['out']) < 2000000) $res['out'] .= $c;
            }
            @pclose($h);
        } elseif ($mode === 'exec') {
            $lines = [];
            @exec($sh . '; echo "__RC=$?"', $lines);
            $res['out'] = implode("\n", $lines);
        } else {
            $res['out'] = (string)@shell_exec($sh . '; echo "__RC=$?"');
        }
        if (preg_match('/__RC=(\d+)\s*$/', $res['out'], $m)) {
            $res['code'] = (int)$m[1];
            $res['out'] = substr($res['out'], 0, -strlen($m[0]));
        }
        if ($res['code'] === 124) $res['err'] .= "(tiempo agotado)\n";
        $res['err'] .= (string)@file_get_contents($errFile);
        @unlink($errFile);
    }
    $res['ok'] = $res['code'] === 0;
    $res['ms'] = (int)round((microtime(true) - $t) * 1000);
    $res['err'] = trim(substr($res['err'], -1500));
    return $res;
}

/** Lanza una línea de shell en segundo plano (sin esperar), con la forma que permita el hosting. */
function wp_bg($line)
{
    $mode = wp_exec_mode();
    $bg = '(' . $line . ') </dev/null >/dev/null 2>&1 &';
    if ($mode === 'proc') { $p = @proc_open($bg, [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes); if (is_resource($p)) @proc_close($p); return is_resource($p) || $p !== false; }
    if ($mode === 'popen') { $h = @popen($bg, 'r'); if ($h) @pclose($h); return (bool)$h; }
    if ($mode === 'exec') { @exec($bg); return true; }
    if ($mode === 'shell') { @shell_exec($bg); return true; }
    return false;
}

/** Ejecuta un comando y devuelve stdout (o null). */
function wp_run(array $cmd, $timeout = 20)
{
    $r = wp_exec($cmd, $timeout);
    return $r['out'] !== '' ? $r['out'] : null;
}

/**
 * Inicia un programa que escribe un flujo largo (la conversión de video) y devuelve
 * ['h' => stream de lectura, 'alive' => fn, 'stop' => fn], según lo que permita el hosting.
 */
function wp_spawn_stream(array $cmd, $errFile, $pidFile)
{
    $mode = wp_exec_mode();
    $line = wp_cmd_line($cmd);
    if ($mode === 'proc') {
        $p = @proc_open('exec ' . $line, [1 => ['pipe', 'w'], 2 => ['file', $errFile, 'w']], $pipes);
        if (!is_resource($p)) return null;
        @file_put_contents($pidFile, (string)proc_get_status($p)['pid']);
        return ['h' => $pipes[1],
            'alive' => function () use ($p) { return proc_get_status($p)['running']; },
            'stop' => function () use ($p, $pipes, $pidFile) { @fclose($pipes[1]); if (proc_get_status($p)['running']) @proc_terminate($p, 15); @proc_close($p); @unlink($pidFile); }];
    }
    $alive = function () use ($pidFile) {
        $pid = (int)@file_get_contents($pidFile);
        if ($pid < 2) return false;
        if (function_exists('posix_kill')) return @posix_kill($pid, 0);
        return @is_dir('/proc/' . $pid);
    };
    if ($mode === 'popen') {
        $h = @popen('echo $$ > ' . escapeshellarg($pidFile) . '; exec ' . $line . ' 2>' . escapeshellarg($errFile), 'r');
        if (!$h) return null;
        return ['h' => $h, 'alive' => $alive, 'stop' => function () use ($h, $pidFile) {
            $pid = (int)@file_get_contents($pidFile);
            if ($pid > 1 && function_exists('posix_kill')) @posix_kill($pid, 15);
            @pclose($h);
            @unlink($pidFile);
        }];
    }
    if ($mode === 'exec' || $mode === 'shell') {
        // ffmpeg en segundo plano escribiendo a un "fifo" (tubería con nombre) que PHP va leyendo
        $fifo = substr($pidFile, 0, -4) . '.fifo';
        if (end($cmd) === 'pipe:1') { array_pop($cmd); $line = wp_cmd_line($cmd); }
        @unlink($fifo);
        if (function_exists('posix_mkfifo')) @posix_mkfifo($fifo, 0600);
        $mk = is_file($fifo) || @filetype($fifo) === 'fifo' ? '' : 'mkfifo ' . escapeshellarg($fifo) . '; ';
        $bg = $mk . $line . ' -y ' . escapeshellarg($fifo) . ' </dev/null >/dev/null 2>' . escapeshellarg($errFile) . ' & echo $! > ' . escapeshellarg($pidFile);
        if ($mode === 'exec') @exec($bg); else @shell_exec($bg);
        usleep(100000);
        if (@filetype($fifo) !== 'fifo') return null;
        $h = @fopen($fifo, 'r+'); // r+ no se bloquea si ffmpeg falla antes de abrir la salida
        if (!$h) return null;
        stream_set_blocking($h, false);
        return ['h' => $h, 'alive' => $alive, 'stop' => function () use ($h, $pidFile, $fifo) {
            $pid = (int)@file_get_contents($pidFile);
            if ($pid > 1 && function_exists('posix_kill')) @posix_kill($pid, 15);
            elseif ($pid > 1) { if (wp_exec_mode() === 'exec') @exec('kill ' . $pid); else @shell_exec('kill ' . $pid); }
            @fclose($h);
            @unlink($fifo);
            @unlink($pidFile);
        }];
    }
    return null;
}

/** Nombre legible de idioma ISO 639. */
