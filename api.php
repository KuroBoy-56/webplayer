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

/**
 * Destacados (en caché en español) en el idioma de la app: el tipo y, fuera del español,
 * la sinopsis de TMDB en ese idioma (si no hay, la del servidor). Máx. 8 s; los que falten quedan como están.
 */
function wp_hero_kind(array $items)
{
    $deadline = microtime(true) + 8;
    foreach ($items as &$it) {
        $it['kind'] = t((string)($it['kind'] ?? ''));
        // fondo en Full HD hecho por el panel (con el token de quien mira: nunca se guarda en la caché compartida)
        if (!empty($it['bd'])) {
            $bs = wp_backdrop_sources($it['bd']);
            if ($bs) { $it['background_image'] = array_shift($bs); $it['background_fb'] = $bs; }
        }
        if (isset($it['icon'])) {
            $ps = wp_poster_sources(strpos((string)($it['play_link'] ?? ''), 'seriesvideo') === 0 ? 'series' : 'movie', $it['icon'], (string)($it['title'] ?? ''), (string)($it['year'] ?? ''), (string)($it['tm'] ?? ''));
            if ($ps) { $it['poster'] = array_shift($ps); $it['poster_fb'] = $ps; }
        }
        unset($it['bd'], $it['icon']);
        if (wp_lang() === 'es' || !wp_tmdb_key() || microtime(true) > $deadline) continue;
        $isS = strpos((string)($it['play_link'] ?? ''), 'seriesvideo') === 0;
        $tm = wp_tmdb_details($isS ? 'tv' : 'movie', $it['tm'] ?? '', (string)($it['title'] ?? ''), (string)($it['year'] ?? ''));
        $it['description'] = wp_tmdb_plot($tm, (string)($it['description'] ?? ''));
    }
    unset($it);
    return $items;
}

function out($data)
{
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

switch ($action) {
    case 'alerta':
        // Aviso del panel (Alertas): bienvenida o vencimiento, igual que en las apps
        header('Cache-Control: no-store');
        // el distribuidor puede tener las alertas apagadas
        if (!wp_tenant_feature('alerts')) out(['show' => false]);
        $aq = http_build_query([
            'format' => 'json', 'user' => $username, 'pass' => $password,
            'dns' => $get_dns, 'title' => (string)($_SESSION['server_name'] ?? ''),
        ]);
        // con número de distribuidor: &t=NNNNNN&app=web (textos de ese distribuidor)
        $raw = wp_panel_request(wp_panel_tenant_query('alerta.php?' . $aq), null, [], 10);
        $aj = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($aj) || !in_array($aj['type'] ?? '', ['welcome', 'expiry'], true)) out(['show' => false]);
        $ip = (string)($aj['image_path'] ?? '');
        $img = '';
        $vid = '';
        if ($aj['type'] === 'welcome' && preg_match('~^img/alertas/[A-Za-z0-9._-]+$~', $ip)) {
            $img = wp_img(preg_replace('~api/$~', '', wp_panel_base()) . $ip, '');
        } elseif ($aj['type'] === 'welcome' && preg_match('~^https://[^\s"\'<>?#]+\.(png|jpe?g|webp|gif)$~i', (string)($aj['image'] ?? ''))) {
            // imagen por enlace (Alertas del panel): el navegador la carga directo desde el enlace
            $img = (string)$aj['image'];
        }
        // todas las imágenes del registro de Alertas (images, en orden): cambian cada "interval" s; sin la lista
        // (panel anterior), la de siempre
        $imgs = [];
        if ($aj['type'] === 'welcome' && is_array($aj['images'] ?? null)) {
            foreach ($aj['images'] as $u) {
                $u = trim((string)$u);
                if (preg_match('~^https://[^\s"\'<>?#]+\.(png|jpe?g|webp|gif)$~i', $u)) $imgs[] = $u;
                elseif (preg_match('~^https?://~i', $u)) $imgs[] = wp_img($u, ''); // imagen vieja del panel (http)
            }
            $imgs = array_values(array_filter($imgs));
        }
        if (!$imgs && $img !== '') $imgs = [$img];
        if ($imgs) $img = $imgs[0];
        $secs = (int)($aj['interval'] ?? 3);
        // video corto por enlace (https .mp4 / .webm / .m4v): se reproduce sin sonido y en bucle, con la imagen de portada
        if ($aj['type'] === 'welcome' && preg_match('~^https://[^\s"\'<>?#]+\.(mp4|webm|m4v)$~i', (string)($aj['video'] ?? ''))) {
            $vid = (string)$aj['video'];
        }
        out([
            'show' => true,
            'type' => $aj['type'],
            'days' => isset($aj['days']) ? (int)$aj['days'] : null,
            // DEMO: el aviso nunca muestra el usuario ni la contraseña de la línea
            'title' => wp_demo_mask($aj['title'] ?? ''),
            'message' => wp_demo_mask($aj['message'] ?? ''),
            'image' => $img,
            'images' => $imgs,
            'interval' => $secs >= 1 ? $secs : 3,
            'video' => $vid,
            'button' => (string)($aj['button'] ?? t('ENTENDIDO')),
            'logo' => wp_brand_logo(),
        ]);

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

    case 'counts':
        // Mi cuenta: cantidad de contenido de la línea (catálogos en caché, los mismos que usa el resto de la web)
        $live = xt_get('get_live_streams', [], 1800, 25);
        out(['live' => is_array($live) ? count($live) : null, 'movie' => count(wp_catalog('movie')), 'series' => count(wp_catalog('series'))]);

    case 'hero':
        $ck = 'hero|' . $type . '|' . $platform . '|' . xt_cache_key('', []);
        $cached = wp_cache_get($ck, 1200);
        if (is_array($cached) && $cached) out(['items' => wp_hero_kind($cached)]);

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
                'bd' => $bd,
                'icon' => $it['icon'],
                'play_link' => $link,
                'info_link' => $link,
                'kind' => $isS ? 'Serie' : 'Película',
                'tm' => is_scalar($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) ? (string)($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) : '',
            ];
            if (count($items) >= 6) break;
        }
        if ($items) wp_cache_set($ck, $items);
        out(['items' => wp_hero_kind($items)]);

    default:
        http_response_code(400);
        out(['error' => t('acción no válida')]);
}
