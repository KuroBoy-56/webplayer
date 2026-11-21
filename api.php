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
        if (wp_lang() === 'es' || !wp_tmdb_on() || microtime(true) > $deadline) continue;
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
    case 'ping':
        // la sesión sigue abierta (session.php contesta 401 si no): «Atrás» a una página guardada (assets/nf/app.js)
        header('Cache-Control: no-store');
        out(['ok' => true]);

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
        $shuffle = !empty($_GET['shuffle']);
        // modo navegador sin el catálogo todavía: la fila de una categoría llega sola (includes/xt_client.php)
        if ($cat !== '' && $platform === '' && $genre === '' && !$isTop && !$shuffle && $type !== 'all') {
            $quick = wp_cat_list_quick($type, $cat, $sort);
            if ($quick !== null) out(['items' => array_map(function ($it) use ($type) { return wp_card($it, $type); }, array_slice($quick, 0, $limit))]);
        }
        // la fila sale de lo ya calculado para este catálogo (includes/catalog_fast.php): unos KB, no el catálogo entero
        $list = wp_filter_cached($type, $platform, $genre, $cat, $sort, $isTop ? 300 : ($shuffle ? 400 : $limit))['l'];
        if ($isTop) {
            wp_sort_items($list, 'rating');
            $limit = min($limit, 10);
        }
        if ($shuffle) shuffle($list);
        $items = [];
        foreach (array_slice($list, 0, $limit) as $it) $items[] = wp_card($it);
        out(['items' => $items]);

    case 'browse':
        $per = 60;
        $page = max(1, (int)($_GET['page'] ?? 1));
        // «Ver todo» de una categoría en el modo navegador sin el catálogo todavía: solo esa categoría (xt_client.php)
        $quick = ($q === '' && $cat !== '' && $platform === '' && $genre === '' && $type !== 'all') ? wp_cat_list_quick($type, $cat, $sort) : null;
        if ($quick !== null) {
            $items = [];
            foreach (array_slice($quick, ($page - 1) * $per, $per) as $it) $items[] = wp_card($it, $type);
            out(['items' => $items, 'total' => count($quick), 'more' => $page * $per < count($quick)]);
        }
        if ($q === '' && $page <= 10) {
            // las primeras 10 páginas de cada filtro quedan guardadas para este catálogo (includes/catalog_fast.php)
            $f = wp_filter_cached($type, $platform, $genre, $cat, $sort, 600);
            $list = $f['l'];
            $total = (int)$f['n'];
        } else {
            $list = wp_filter($type, $platform, $genre, $cat, $q, $sort);
            $total = count($list);
        }
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
        out(['live' => is_array($live) ? count($live) : null, 'movie' => count(wp_catalog_ids('movie')), 'series' => count(wp_catalog_ids('series'))]);

    case 'eps':
        // capítulos de una temporada con TMDB (seriesvideo.php al cambiar de temporada; includes/episodes.php)
        require_once __DIR__ . '/includes/episodes.php';
        $sid = preg_replace('/\D/', '', (string)($_GET['id'] ?? ''));
        $sn = preg_replace('/\D/', '', (string)($_GET['s'] ?? ''));
        $sd = $sid !== '' ? xt_get('get_series_info', ['series_id' => $sid], 21600) : [];
        $si = is_array($sd['info'] ?? null) ? $sd['info'] : [];
        $eps = is_array($sd['episodes'][$sn] ?? null) ? $sd['episodes'][$sn] : [];
        if (!$si || !$eps) out(['eps' => []]);
        $stitle = (string)($si['name'] ?? '');
        $tm = wp_tmdb_details('tv', $si['tmdb_id'] ?? ($si['tmdb'] ?? ''), $stitle, substr((string)($si['releaseDate'] ?? ($si['release_date'] ?? '')), 0, 4));
        $bd = $tm['backdrop'] ?: (is_array($si['backdrop_path'] ?? null) ? ($si['backdrop_path'][0] ?? '') : (string)($si['backdrop_path'] ?? ''));
        $rows = [];
        foreach ($eps as $ep) {
            if (!is_array($ep)) continue;
            $ei = is_array($ep['info'] ?? null) ? $ep['info'] : [];
            $rows[] = ['id' => (string)($ep['id'] ?? ''), 'num' => (int)($ep['episode_num'] ?? 0), 'title' => (string)($ep['title'] ?? ''),
                'plot' => (string)($ei['plot'] ?? ''), 'src' => wp_img($ei['movie_image'] ?? ($ei['cover_big'] ?? ''), '')];
        }
        out(['eps' => wp_eps_fill($rows, wp_tmdb_season($tm['id'] ?? '', $sn), $stitle, [wp_img($bd, ''), wp_img($tm['poster'] ?: ($si['cover'] ?? ''), ''), wp_img($si['cover'] ?? '', '')])]);

    case 'hero':
        // el perfil infantil tiene su propio destacado (includes/kids.php)
        $ck = 'hero|' . $type . '|' . $platform . '|' . xt_cache_key('', []) . (wp_kids_on() ? '|kids' : '');
        $cached = wp_cache_get($ck, 1200);
        if (is_array($cached) && $cached) out(['items' => wp_hero_kind($cached)]);

        // los títulos elegidos se guardan 20 min: en el modo navegador la página repite el pedido después de que el
        // navegador trae sus fichas, y con otra elección al azar volvía a pedir otras y el destacado nunca aparecía
        $pk = 'heropool|' . $ck;
        $pool = wp_cache_get($pk, 1200);
        if (!is_array($pool) || !$pool) {
            $pool = [];
            $types = $type === 'all' ? ['movie', 'series'] : [$type];
            foreach ($types as $t) {
                $list = $platform ? wp_filter($t, $platform, '', '', '', 'recent') : wp_catalog($t);
                if (!$platform) wp_sort_items($list, 'added');
                $list = array_slice(array_values(array_filter($list, function ($i) { return $i['icon'] !== ''; })), 0, 150);
                shuffle($list);
                foreach (array_slice($list, 0, 8) as $it) { $it['t'] = $t; $pool[] = $it; }
            }
            shuffle($pool);
            if ($pool) wp_cache_set($pk, $pool);
        }
        $reqs = [];
        foreach ($pool as $k => $it) {
            $reqs[$k] = $it['t'] === 'series' ? ['get_series_info', ['series_id' => $it['id']]] : ['get_vod_info', ['vod_id' => $it['id']]];
        }
        // primero lo que ya está guardado (en el modo navegador lo que falta se trae por detrás); solo si no hay ninguna
        // ficha con fondo se espera al navegador
        $infos = xt_multi($reqs, 86400, 8, false);
        $withBd = 0;
        foreach ($infos as $inf) {
            $bd = $inf['info']['backdrop_path'] ?? '';
            if (is_array($bd) ? !empty($bd[0]) : $bd !== '') $withBd++;
        }
        // (una sola vez por sesión cada 2 min: si una ficha no llegó, el destacado sale con las demás y el fondo de TMDB en
        // lugar de volver a esperar y quedar vacío)
        $askK = 'heroask|' . session_id() . '|' . $ck;
        if (!$withBd && !wp_cache_get($askK, 120)) {
            wp_cache_set($askK, 1);
            $infos = xt_multi($reqs, 86400, 8);
        }
        $items = [];
        // sin fondo en el servidor (o sin su ficha): el de TMDB, como Roku, Vega y Android TV (clave de la línea, 7 días en
        // la caché). Primero lo ya guardado; después se busca en TMDB lo que falte, hasta 4 s en total
        $tmDeadline = microtime(true) + 4;
        $tmFill = function (array &$info, array $it, $net) use ($tmDeadline) {
            if (!wp_tmdb_on() || ($net && microtime(true) > $tmDeadline)) return '';
            $tmid = is_scalar($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) ? (string)($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) : '';
            $tmx = wp_tmdb_details($it['t'] === 'series' ? 'tv' : 'movie', $tmid !== '' ? $tmid : (string)($it['tm'] ?? ''), (string)($info['name'] ?? $it['name']), (string)($it['year'] ?? ''), !$net);
            $bd = is_array($tmx) ? (string)($tmx['backdrop'] ?? '') : '';
            if ($bd !== '' && trim((string)($info['plot'] ?? ($info['description'] ?? ''))) === '' && !empty($tmx['overview'])) $info['plot'] = $tmx['overview'];
            if ($bd !== '' && empty($info['tmdb_id']) && !empty($tmx['id'])) $info['tmdb_id'] = (string)$tmx['id'];
            return $bd;
        };
        $order = array_keys($pool);
        $bds = [];
        foreach ($order as $k) {
            $info = $infos[$k]['info'] ?? [];
            $infos[$k]['info'] = is_array($info) ? $info : [];
            $bd = $infos[$k]['info']['backdrop_path'] ?? '';
            if (is_array($bd)) $bd = $bd[0] ?? '';
            $bds[$k] = (string)$bd !== '' ? (string)$bd : $tmFill($infos[$k]['info'], $pool[$k], false);
        }
        $have = count(array_filter($bds));
        foreach ($order as $k) {
            if ($have >= 6) break;
            if ($bds[$k] === '' && ($bds[$k] = $tmFill($infos[$k]['info'], $pool[$k], true)) !== '') $have++;
        }
        foreach ($pool as $k => $it) {
            $info = $infos[$k]['info'];
            $bd = $bds[$k];
            $isS = $it['t'] === 'series';
            if (!$bd) continue;
            if (!empty($info['genre'])) wp_genre_index_put($it['t'], $it['id'], $info['genre']);
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
