<?php
/* Idiomas de audio y subtítulos de un contenido (como Roku): lo que ya se sabe (hosting o panel, api/tracks.php) y, si
 * nadie lo sabe, la cabecera del archivo (unos KB, sin ffmpeg); lo leído se le deja al panel para los demás equipos.
 *   ?…firmado…&x=mkv        x = extensión real del contenido (la que lo identifica en el panel)
 *   &warm=1                 solo pregunta al panel (la ficha lo pide al abrirse: al pulsar Reproducir ya se sabe)
 *   &dur=S                  duración (para las pistas que se le dan al reproductor)
 * Responde {n: audios (0 = no se sabe), info: pistas para el reproductor o null}. Solo acepta enlaces firmados. */
require_once __DIR__ . '/includes/core.php';
$url = null;
if (!wp_verify_signed($url) || !isset($_GET['e'])) {
    http_response_code(403);
    exit;
}
wp_session_read_close();
header('Content-Type: application/json');
header('Cache-Control: private, no-store');
@set_time_limit(40);
$x = strtolower(preg_replace('/[^a-z0-9]/i', '', (string)($_GET['x'] ?? '')));
$panelUrl = strlen($x) >= 2 && strlen($x) <= 5 ? preg_replace('~\.[a-z0-9]{2,5}$~i', '.' . $x, $url) : $url;
$warm = !empty($_GET['warm']);
$t = wp_file_tracks($panelUrl, $url, !$warm, 2);
$n = $t ? count($t['audio']) : ($warm ? 0 : wp_audio_track_count($url, false, false, $panelUrl));
$info = $t ? wp_probe_labels(wp_tracks_probe($t, max(0, (int)($_GET['dur'] ?? 0)))) : null;
echo json_encode(['n' => $n, 'info' => $info], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
