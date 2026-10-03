<?php
/**
 * API interna (JSON) para cargas en segundo plano.
 * El navegador nunca habla directo con la DNS: evita errores HTTPS/CORS y no expone credenciales.
 */
include "session.php";
include "config.php";

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=60');

$action = $_GET['action'] ?? '';
$type = $_GET['type'] ?? 'movie';
if (!in_array($type, ['movie', 'series', 'all'], true)) $type = 'movie';
$platform = preg_replace('/[^a-z0-9_]/', '', (string)($_GET['platform'] ?? ''));
$genre = preg_replace('/[^a-z0-9_]/', '', (string)($_GET['genre'] ?? ''));
$cat = preg_replace('/[^0-9a-zA-Z_\-]/', '', (string)($_GET['cat'] ?? ''));
$sort = in_array($_GET['sort'] ?? '', ['recent', 'az', 'rating', 'default'], true) ? $_GET['sort'] : 'recent';
$q = trim((string)($_GET['q'] ?? ''));

function out($data)
{
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

switch ($action) {
    case 'posters':
        // Carátulas de TMDB en alta calidad para las tarjetas visibles
        header('Cache-Control: no-store');
        $in = json_decode((string)file_get_contents('php://input'), true);
        $items = [];
        foreach (array_slice(is_array($in['items'] ?? null) ? $in['items'] : [], 0, 40) as $it) {
            if (!is_array($it) || empty($it['k'])) continue;
            $items[] = [
                'k' => substr((string)$it['k'], 0, 40),
                't' => ($it['t'] ?? '') === 'series' ? 'series' : 'movie',
                'tm' => substr(preg_replace('/\D/', '', (string)($it['tm'] ?? '')), 0, 10),
                'n' => mb_substr((string)($it['n'] ?? ''), 0, 120),
                'y' => substr(preg_replace('/\D/', '', (string)($it['y'] ?? '')), 0, 4),
            ];
        }
        out(['p' => (object)wp_tmdb_posters($items)]);

    case 'row':
        $limit = max(1, min(60, (int)($_GET['limit'] ?? 30)));
        $isTop = ($_GET['sort'] ?? '') === 'top';
        $list = wp_filter($type, $platform, $genre, $cat, '', $sort);
        if ($isTop) {
            $list = array_slice($list, 0, 300);
            usort($list, function ($a, $b) { return $b['rating'] <=> $a['rating']; });
            $limit = min($limit, 10);
        }
        if (!empty($_GET['shuffle'])) {
            $list = array_slice($list, 0, 400);
            shuffle($list);
        }
        $items = [];
        foreach (array_slice($list, 0, $limit) as $it) $items[] = wp_card($it);
        out(['items' => $items]);

    case 'browse':
        $per = 60;
        $page = max(1, (int)($_GET['page'] ?? 1));
        $list = wp_filter($type, $platform, $genre, $cat, $q, $sort);
        $total = count($list);
        $items = [];
        foreach (array_slice($list, ($page - 1) * $per, $per) as $it) $items[] = wp_card($it);
        out(['items' => $items, 'total' => $total, 'more' => $page * $per < $total]);

    case 'search':
        if (mb_strlen($q, 'UTF-8') < 2) out(['movies' => [], 'series' => [], 'live' => []]);
        $res = ['movies' => [], 'series' => [], 'live' => []];
        foreach (wp_filter('movie', '', '', '', $q, 'az') as $i => $it) { if ($i >= 12) break; $res['movies'][] = wp_card($it); }
        foreach (wp_filter('series', '', '', '', $q, 'az') as $i => $it) { if ($i >= 12) break; $res['series'][] = wp_card($it); }
        $live = xt_get('get_live_streams', [], 1800, 25);
        $qn = wp_norm($q);
        if (is_array($live)) {
            foreach ($live as $ch) {
                if (!is_array($ch) || strpos(wp_norm($ch['name'] ?? ''), $qn) === false) continue;
                $res['live'][] = [
                    't' => 'live', 'id' => (string)$ch['stream_id'], 'n' => (string)$ch['name'], 'r' => '', 'y' => '',
                    'i' => wp_logo($ch['stream_icon'] ?? ''),
                    'u' => 'tvguide.php?id=' . rawurlencode($ch['stream_id']) . '&slug=live&category_id=' . rawurlencode($ch['category_id'] ?? ''),
                ];
                if (count($res['live']) >= 6) break;
            }
        }
        out($res);

    case 'hero':
        $ck = 'hero|' . $type . '|' . $platform . '|' . xt_cache_key('', []);
        $cached = wp_cache_get($ck, 1200);
        if (is_array($cached) && $cached) out(['items' => $cached]);

        $pool = [];
        $types = $type === 'all' ? ['movie', 'series'] : [$type];
        foreach ($types as $t) {
            $list = $platform ? wp_filter($t, $platform, '', '', '', 'recent') : wp_catalog($t);
            if (!$platform) usort($list, function ($a, $b) { return $b['added'] <=> $a['added']; });
            $list = array_slice(array_values(array_filter($list, function ($i) { return $i['icon'] !== ''; })), 0, 150);
            shuffle($list);
            foreach (array_slice($list, 0, 8) as $it) { $it['t'] = $t; $pool[] = $it; }
        }
        shuffle($pool);
        $reqs = [];
        foreach ($pool as $k => $it) {
            $reqs[$k] = $it['t'] === 'series' ? ['get_series_info', ['series_id' => $it['id']]] : ['get_vod_info', ['vod_id' => $it['id']]];
        }
        $infos = xt_multi($reqs, 86400, 8);
        $items = [];
        foreach ($pool as $k => $it) {
            $info = $infos[$k]['info'] ?? [];
            if (!is_array($info)) continue;
            $bd = $info['backdrop_path'] ?? '';
            if (is_array($bd)) $bd = $bd[0] ?? '';
            if (!$bd) continue;
            if (!empty($info['genre'])) wp_genre_index_put($it['t'], $it['id'], $info['genre']);
            $isS = $it['t'] === 'series';
            $link = $isS ? 'seriesvideo.php?id=' . rawurlencode($it['id']) : 'Movie_description.php?id=' . rawurlencode($it['id']);
            $year = substr((string)($info['releasedate'] ?? ($info['releaseDate'] ?? ($info['release_date'] ?? ''))), 0, 4);
            $items[] = [
                'title' => (string)($info['name'] ?? $it['name']) ?: $it['name'],
                'description' => (string)($info['plot'] ?? ($info['description'] ?? '')),
                'rating' => (string)($info['rating'] ?? $it['rating']),
                'year' => $year,
                'genre' => implode(', ', array_slice(array_map('trim', explode(',', (string)($info['genre'] ?? ''))), 0, 2)),
                'background_image' => wp_img($bd, ''),
                'poster' => wp_img($it['icon'], ''),
                'play_link' => $link,
                'info_link' => $link,
                'kind' => $isS ? 'Serie' : 'Película',
            ];
            if (count($items) >= 6) break;
        }
        if ($items) wp_cache_set($ck, $items);
        out(['items' => $items]);

    default:
        http_response_code(400);
        out(['error' => 'acción no válida']);
}
