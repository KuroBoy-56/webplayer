<?php
/**
 * Perfil infantil (includes/profiles.php): con un perfil infantil elegido la web muestra solo contenido para niños y
 * Disney. Las reglas son las del panel («kidsRules» de api/profiles.php, includes/kids_rules.php del panel): las mismas
 * en todas las apps, y si el panel sube su versión se usan las nuevas sin cambiar la web. wp_kids_rules_local() es una
 * copia por si el panel no contesta (cópiala del panel cuando cambien las listas). Algoritmo: docs/PERFILES.md del
 * panel («Perfil infantil»).
 *
 * Se filtra en el origen, así todo lo demás (Inicio, Películas, Series, Explorar, búsqueda, Top 10, actores) muestra
 * solo lo permitido:
 *  - wp_catalog(): películas y series (includes/core.php);
 *  - wp_categories(): solo las categorías con algo para niños; en vivo, solo las infantiles;
 *  - xt_get('get_live_streams'): solo los canales de las categorías infantiles (sin ninguna, TV en vivo desaparece);
 *  - fichas, reproductor y TV en vivo no abren lo que no pasa el filtro (wp_kids_guard); Deportes no está.
 *
 * v2 (con TMDB): cada título queda 'strong' (seguro: categoría o género de niños), 'weak' (dudoso: solo «Familia»,
 * una categoría de Disney o de familia, o un género como Telenovela) o fuera. La clasificación de edad de TMDB la
 * da el panel (api/kids_rate.php, la misma para todas las apps): lo dudoso se ve solo con 'ok' y lo que TMDB dice
 * 'no' nunca se ve. La web la pide en segundo plano (wp_kids_rate_schedule) y la guarda por distribuidor.
 */
if (defined('WP_KIDS_LOADED')) {
    return;
}
define('WP_KIDS_LOADED', true);

/** ¿El perfil elegido es infantil? */
function wp_kids_on()
{
    if (!function_exists('wp_prof_state') || wp_is_demo()) return false;
    $s = wp_prof_state();
    return !empty($s['on']) && !empty($s['kids']) && $s['id'] !== '' && $s['id'] !== 'main';
}

/** Las reglas: las del panel (guardadas al leer los perfiles) o la copia de abajo. */
function wp_kids_rules()
{
    static $r = null;
    if ($r !== null) return $r;
    $local = wp_kids_rules_local();
    $c = wp_cache_get(wp_panel_ck('kids|rules'), 30 * 86400);
    if (is_array($c) && wp_kids_rules_valid($c) && (int)$c['v'] >= (int)$local['v']) return $r = $c;
    return $r = $local;
}

function wp_kids_rules_valid($r)
{
    if (!is_array($r) || !isset($r['v'])) return false;
    foreach (['kids', 'live', 'disney', 'block_cats', 'kids_strong', 'genre_kids', 'genre_block', 'block_marks', 'block_titles'] as $k) {
        if (!is_array($r[$k] ?? null)) return false;
    }
    return true;
}

/** Las reglas que mandó el panel (api/profiles.php). */
function wp_kids_rules_remember($r)
{
    if (!wp_kids_rules_valid($r)) return;
    $ck = wp_panel_ck('kids|rules');
    if (wp_cache_get($ck, 30 * 86400) !== $r) wp_cache_set($ck, $r);
}

/** Una lista de las reglas como una sola expresión (rápido con miles de títulos). */
function wp_kids_rx($list)
{
    static $memo = [];
    $r = wp_kids_rules();
    $key = $list . '|' . $r['v'];
    if (isset($memo[$key])) return $memo[$key];
    $parts = [];
    foreach ((array)($r[$list] ?? []) as $e) {
        $e = (string)$e;
        if ($e === '') continue;
        if ($e[0] === '/' && strlen($e) > 2 && substr($e, -1) === '/') {
            $parts[] = '(?:' . substr($e, 1, -1) . ')';
        } else {
            $parts[] = preg_quote(wp_norm($e), '~');
        }
    }
    return $memo[$key] = $parts ? '~' . implode('|', $parts) . '~u' : '';
}

/** ¿El texto (ya en minúsculas y sin acentos) tiene algo de la lista? */
function wp_kids_m($normText, $list)
{
    $rx = wp_kids_rx($list);
    return $rx !== '' && $normText !== '' && @preg_match($rx, $normText) === 1;
}

/** 'block' | 'kids' | 'disney' | 'family' | '' para el nombre de una categoría. */
function wp_kids_cat_class($name, $live = false)
{
    $n = wp_norm($name);
    if ($n === '') return '';
    if (!wp_kids_m($n, 'kids_strong') && wp_kids_m($n, 'block_cats')) return 'block';
    if (wp_kids_m($n, $live ? 'live' : 'kids')) return 'kids';
    if (!$live && wp_kids_m($n, 'disney')) return 'disney';
    if (!$live && wp_kids_m($n, 'family')) return 'family';
    return '';
}

/**
 * Una película o serie del catálogo: 'strong' (se ve salvo que TMDB diga 'no'), 'weak' (se ve solo si TMDB dice 'ok')
 * o '' (nunca). Algoritmo en docs/PERFILES.md del panel («Perfil infantil»).
 */
function wp_kids_item_level(array $it, $type, array $cls, array $gidx)
{
    $kidsCat = false;
    $weakCat = false;
    foreach ((array)($it['cats'] ?? []) as $c) {
        $k = $cls[(string)$c] ?? '';
        if ($k === 'block') return '';
        if ($k === 'kids') $kidsCat = true;
        elseif ($k === 'disney' || $k === 'family') $weakCat = true;
    }
    $name = wp_norm($it['name'] ?? '');
    if (wp_kids_m($name, 'block_marks') || wp_kids_m($name, 'block_titles')) return '';
    $g = wp_norm(trim(($it['genre'] ?? '') . ' ' . ($gidx[$type . ':' . ($it['id'] ?? '')] ?? '')));
    $has = function ($list) use ($g) { return $g !== '' && wp_kids_m($g, $list); };
    $gWeak = $has('genre_weak');
    $kidsGenre = $has('genre_kids') || ($gWeak && $has('genre_anim'));
    $gHard = $has('genre_hard');
    $gBlock = $has('genre_block');
    // crimen, terror, telenovela… sin nada de niños ni de familia: fuera
    if ($gBlock && !$kidsGenre && !$gWeak) return '';
    if (($kidsCat || $kidsGenre) && !$gHard && !$gBlock) return 'strong';
    return ($kidsCat || $kidsGenre || $weakCat || $gWeak) ? 'weak' : '';
}

/** Clave del título para la clasificación de TMDB: por su id de TMDB o, sin él, por el nombre (y el año). */
function wp_kids_rate_q(array $it, $type)
{
    $t = $type === 'series' ? 's' : 'm';
    $tm = (string)($it['tm'] ?? '');
    if ($tm !== '' && $tm !== '0') return $t . ':' . $tm;
    return $t . 'n:' . substr(md5(wp_norm($it['name'] ?? '') . '|' . ($it['year'] ?? '')), 0, 16);
}

/* ---------- clasificación de edad de TMDB (api/kids_rate.php del panel) ---------- */

define('WP_KIDS_RATE_TTL', 30 * 86400);    // ok / no
define('WP_KIDS_RATE_TTL_Q', 7 * 86400);   // '?' (TMDB no alcanza para decidir)
define('WP_KIDS_RATE_TTL_WAIT', 120);      // 'wait': el panel todavía no le preguntó a TMDB
define('WP_KIDS_RATE_EVERY', 15);          // segundos entre pedidos al panel (por distribuidor)

/** Lo que dijo el panel: [q => [veredicto, hora]] (por distribuidor: sin clave de TMDB no hay datos de otro). */
function wp_kids_rate_map()
{
    static $m = null;
    if ($m !== null) return $m;
    $d = wp_cache_get(wp_panel_ck('kids|rate'), 86400 * 60);
    return $m = is_array($d) ? $d : [];
}

/** Revisión de la lista de veredictos (cambia cuando llegan nuevos: el catálogo infantil se vuelve a armar). */
function wp_kids_rate_rev()
{
    $r = wp_cache_get(wp_panel_ck('kids|raterev'), 86400 * 60);
    return is_scalar($r) ? (string)$r : '0';
}

/** El veredicto vigente de un título ('ok' | 'no' | '?' | '' si no se sabe todavía o ya venció). */
function wp_kids_rate_get($q)
{
    $m = wp_kids_rate_map();
    if (!isset($m[$q]) || !is_array($m[$q])) return '';
    list($v, $at) = $m[$q] + ['', 0];
    $ttl = $v === 'ok' || $v === 'no' ? WP_KIDS_RATE_TTL : ($v === '?' ? WP_KIDS_RATE_TTL_Q : WP_KIDS_RATE_TTL_WAIT);
    if (time() - (int)$at > $ttl) return '';
    return $v === 'wait' ? '' : (string)$v;
}

/** ¿Se ve? según su nivel y lo que dijo TMDB. */
function wp_kids_rate_pass($level, $v)
{
    if ($level === '' || $v === 'no') return false;
    return $level === 'strong' || $v === 'ok';
}

/**
 * Los títulos sin veredicto se le piden al panel después de contestar la página (con PHP-FPM o LiteSpeed nunca la hace
 * esperar), como mucho cada WP_KIDS_RATE_EVERY segundos por distribuidor y 1200 por vez (sin cerrar la respuesta antes:
 * 150). $need = [q => ['t' => 'm'|'s', 'id' => tmdb] o ['t', 'n' => nombre, 'y' => año]]; se juntan los de películas y
 * series de la misma página.
 */
function wp_kids_rate_schedule(array $need)
{
    static $pending = [];
    static $registered = false;
    if (!$need || !wp_panel_ready()) return;
    $pending += $need;
    if ($registered) return;
    $tc = wp_panel_tenant();
    $token = wp_panel_token();
    if ($token === '') return;
    $registered = true;
    register_shutdown_function(function () use (&$pending, $tc, $token) {
        wp_panel_set_tenant($tc);
        $runKey = wp_panel_ck('kids|raterun', $tc);
        if (wp_cache_get($runKey, WP_KIDS_RATE_EVERY) !== null) return; // otro pedido ya está en eso
        wp_cache_set($runKey, time());
        $bg = function_exists('fastcgi_finish_request') || function_exists('litespeed_finish_request');
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        } elseif (function_exists('litespeed_finish_request')) {
            litespeed_finish_request();
        }
        ignore_user_abort(true);
        @set_time_limit(90);
        $got = [];
        $chunks = $bg ? array_slice(array_chunk($pending, 400, true), 0, 3) : [array_slice($pending, 0, 150, true)];
        foreach ($chunks as $chunk) {
            $items = [];
            foreach ($chunk as $q => $x) $items[] = ['q' => (string)$q] + $x;
            $res = wp_panel_request('kids_rate.php', ['token' => $token, 'items' => $items], ['Authorization: Bearer ' . $token], $bg ? 25 : 8, $code);
            $j = $res !== null ? json_decode($res, true) : null;
            if (!is_array($j) || empty($j['success']) || !is_array($j['r'] ?? null)) break;
            if (!empty($j['token']) && is_string($j['token'])) $token = $j['token'];
            foreach ($j['r'] as $q => $v) {
                if (in_array($v, ['ok', 'no', '?', 'wait'], true)) $got[(string)$q] = [$v, time()];
            }
        }
        if (!$got) return;
        $ck = wp_panel_ck('kids|rate', $tc);
        $m = wp_cache_get($ck, 86400 * 60);
        $m = is_array($m) ? $m : [];
        $changed = false;
        foreach ($got as $q => $vv) {
            if ($vv[0] !== 'wait' && (!isset($m[$q]) || $m[$q][0] !== $vv[0])) $changed = true;
            $m[$q] = $vv;
        }
        if (count($m) > 60000) $m = array_slice($m, -50000, null, true);
        wp_cache_set($ck, $m);
        if ($changed) wp_cache_set(wp_panel_ck('kids|raterev', $tc), (string)microtime(true));
        // quedan pendientes (el panel sigue con TMDB): se puede volver a preguntar enseguida
        if (in_array('wait', array_column($got, 0), true)) wp_cache_set($runKey, null);
    });
}

/** El catálogo de películas o series para un perfil infantil (30 min en caché por servidor y por veredictos). */
function wp_kids_catalog($type, array $list)
{
    static $memo = [];
    if (isset($memo[$type])) return $memo[$type];
    $r = wp_kids_rules();
    $last = $list ? end($list) : [];
    $fp = count($list) . '|' . ($list[0]['id'] ?? '') . '|' . ($last['id'] ?? '');
    $ck = 'kidscat2|' . $r['v'] . '|' . md5(json_encode($r)) . '|' . wp_panel_ck('') . '|' . wp_kids_rate_rev() . '|' . $type . '|' . xt_cache_key('', []) . '|' . $fp;
    $hit = wp_cache_get($ck, 1800);
    if (is_array($hit) && isset($hit['items'])) {
        $need = [];
        foreach ((array)$hit['need'] as $q => $x) {
            if (wp_kids_rate_get($q) === '') $need[$q] = $x;
        }
        wp_kids_rate_schedule($need);
        return $memo[$type] = $hit['items'];
    }
    $cls = [];
    foreach (wp_categories_raw($type) as $c) $cls[(string)($c['category_id'] ?? '')] = wp_kids_cat_class($c['category_name'] ?? '');
    $gidx = wp_genre_index_get();
    $out = [];
    $need = [];
    $t = $type === 'series' ? 's' : 'm';
    foreach ($list as $it) {
        if (!is_array($it)) continue;
        $level = wp_kids_item_level($it, $type, $cls, $gidx);
        if ($level === '') continue;
        $q = wp_kids_rate_q($it, $type);
        $v = wp_kids_rate_get($q);
        if ($v === '' && !isset($need[$q])) {
            $tm = (string)($it['tm'] ?? '');
            $need[$q] = ['t' => $t] + ($tm !== '' && $tm !== '0' ? ['id' => $tm] : ['n' => (string)($it['name'] ?? ''), 'y' => (string)($it['year'] ?? '')]);
        }
        if (wp_kids_rate_pass($level, $v)) $out[] = $it;
    }
    if ($list) wp_cache_set($ck, ['items' => $out, 'need' => $need]);
    wp_kids_rate_schedule($need);
    return $memo[$type] = $out;
}

/** Las categorías de TV en vivo infantiles: [category_id => true]. */
function wp_kids_live_cat_ids()
{
    static $ids = null;
    if ($ids !== null) return $ids;
    $ids = [];
    foreach (wp_categories_raw('live') as $c) {
        if (wp_kids_cat_class($c['category_name'] ?? '', true) === 'kids') $ids[(string)($c['category_id'] ?? '')] = true;
    }
    return $ids;
}

/** ¿Hay canales para niños? (sin ninguno, TV en vivo no se muestra) */
function wp_kids_has_live()
{
    return (bool)wp_kids_live_cat_ids();
}

/** Los canales que pasan el filtro (de get_live_streams). */
function wp_kids_live_filter(array $list)
{
    $ok = wp_kids_live_cat_ids();
    $out = [];
    foreach ($list as $ch) {
        if (!is_array($ch) || !isset($ok[(string)($ch['category_id'] ?? '')])) continue;
        if (wp_kids_m(wp_norm($ch['name'] ?? ''), 'block_marks')) continue;
        $out[] = $ch;
    }
    return $out;
}

/** Las categorías que ve un perfil infantil (las que tienen algo permitido). */
function wp_kids_categories($type, array $cats)
{
    if ($type === 'live') {
        $ok = wp_kids_live_cat_ids();
        return array_values(array_filter($cats, function ($c) use ($ok) { return isset($ok[(string)($c['category_id'] ?? '')]); }));
    }
    $used = [];
    foreach (wp_catalog($type) as $it) {
        foreach ((array)$it['cats'] as $c) $used[(string)$c] = true;
    }
    return array_values(array_filter($cats, function ($c) use ($used) { return isset($used[(string)($c['category_id'] ?? '')]); }));
}

/** ¿Este título lo puede abrir el perfil infantil? */
function wp_kids_allowed($type, $id)
{
    static $idx = [];
    $type = $type === 'series' ? 'series' : 'movie';
    if (!isset($idx[$type])) {
        $idx[$type] = [];
        foreach (wp_catalog($type) as $it) $idx[$type][(string)$it['id']] = true;
    }
    return isset($idx[$type][(string)$id]);
}

/** En las fichas y el reproductor: lo que no pasa el filtro vuelve al inicio. */
function wp_kids_guard($type, $id)
{
    if (!wp_kids_on() || wp_kids_allowed($type, $id)) return;
    header('Cache-Control: no-store');
    header('Location: homex.php', true, 302);
    exit;
}

/** Las reglas de siempre (copia de includes/kids_rules.php del panel, por si el panel no contesta). */
function wp_kids_rules_local()
{
    return [
        'v' => 2,
        // edad máxima de la clasificación (TMDB): hasta PG / TV-PG / 7 años, como el perfil «Niños» de Netflix
        'rate_age_max' => 7,
        // categorías de películas y series que son de niños
        'kids' => ['infantil', '/\bkids?\b/', 'ninos', '/\bnin[oa]s?\b/', 'children', 'peques', 'pequenos', 'junior', '/\bjr\b/',
            'baby', '/\bbebes?\b/', 'preescolar', 'preschool', 'cartoon', 'caricatura', 'dibujos', 'animad', 'animacion',
            'animation', 'animated', 'disney junior', 'disney channel', 'nickelodeon', '/\bnick\b/', 'nick jr', 'cartoonito',
            'discovery kids', 'boomerang', 'pakapaka', 'tooncast', 'babytv', 'zoomoo', 'dreamworks', 'pixar', 'illumination'],
        // categorías de familia: dudosas (suelen traer telenovelas y dramas): solo con el visto bueno de TMDB
        'family' => ['familia', '/\bfamily\b/', 'familiar'],
        // categorías de TV en vivo que son de niños (sin «familia»: en vivo suelen ser canales de todo tipo)
        'live' => ['infantil', '/\bkids?\b/', 'ninos', '/\bnin[oa]s?\b/', 'children', 'peques', 'junior', '/\bjr\b/', 'baby',
            '/\bbebes?\b/', 'preescolar', 'cartoon', 'caricatura', 'dibujos', 'animad', 'disney', 'nickelodeon', '/\bnick\b/',
            'cartoonito', 'discovery kids', 'boomerang', 'pakapaka', 'tooncast', 'babytv', 'zoomoo', 'dreamworks'],
        // categorías de Disney (fuera de las de niños): cuentan como infantiles con las exclusiones de títulos
        'disney' => ['disney', 'pixar'],
        // categorías que nunca son para niños: lo que está en ellas se quita aunque también esté en una de niños
        // (salvo que el nombre de esa categoría tenga una palabra de «kids_strong», como «Anime infantil»)
        'block_cats' => ['adult', '/\+ ?18/', '/18 ?\+/', 'xxx', 'porn', 'erotic', 'erotico', 'erotica', '/\bhot\b/', 'sexy',
            'playboy', 'terror', 'horror', 'miedo', '/\bgore\b/', 'anime', 'star+', 'star plus', '/\bstar\b/',
            'adult swim', 'marvel', 'star wars', 'suspenso', 'thriller', 'crimen', '/\bcrime\b/', 'policia', 'narco', 'mafia',
            'belica', 'guerra', '/\bwar\b/', '/\bmma\b/', '/\bufc\b/'],
        'kids_strong' => ['infantil', '/\bkids?\b/', 'ninos', '/\bnin[oa]s?\b/', 'children', 'peques', 'junior', 'baby',
            'preescolar', 'cartoon', 'caricatura', 'dibujos'],
        // géneros del título (los manda el servidor IPTV o salen de su ficha)
        // de niños (seguros)
        'genre_kids' => ['infantil', '/\bkids?\b/', 'children', 'ninos', '/\bnin[oa]s?\b/', 'preescolar'],
        // familia: dudoso solo; con animación cuenta como de niños
        'genre_weak' => ['familia', '/\bfamily\b/', 'familiar'],
        'genre_anim' => ['animacion', 'animation', 'animad', 'dibujos'],
        // nunca seguros sin TMDB, aunque también digan Familia o estén en una categoría de niños
        'genre_hard' => ['soap', 'telenovela', '/\bnovelas?\b/', 'reality', 'terror', 'horror', 'erot', 'adult', 'porn', '/\bgore\b/'],
        // fuera, salvo que también sean de niños o de familia (entonces dudosos)
        'genre_block' => ['terror', 'horror', 'erot', 'adult', 'porn', 'crimen', '/\bcrime\b/', 'thriller', 'suspenso', 'suspense',
            'belica', '/\bwar\b/', 'guerra', '/\bgore\b/', 'soap', 'telenovela', '/\bnovelas?\b/'],
        // marcas en el nombre (películas, series y canales)
        'block_marks' => ['/\+ ?18/', '/18 ?\+/', 'xxx', 'porn', 'erotic', 'erotica', 'erotico', 'hentai', 'playboy', '/\bsexy?\b/'],
        // títulos que nunca son para niños aunque estén en una categoría de animación, de niños o de Disney
        'block_titles' => [
            // animación para adultos
            'family guy', 'padre de familia', 'south park', 'rick and morty', 'rick y morty', 'bojack', 'american dad', 'big mouth',
            'sausage party', 'fiesta de las salchichas', 'beavis', '/\barcher\b/', 'f is for family', 'paradise pd', 'invincible',
            'invencible', 'harley quinn', 'hazbin', 'helluva', 'castlevania', '/\bprimal\b/', 'love, death', 'love death', 'amor, muerte',
            'amor muerte', 'midnight gospel', 'solar opposites', 'duncanville', '/bob.?s burgers/', 'king of the hill',
            'rey de la colina', 'cleveland', 'desencanto', 'disenchantment', 'inside job', 'final space', 'brickleberry',
            'drawn together', 'happy tree friends', 'superjail', 'robot chicken', 'aqua teen', 'mr pickles', 'mr. pickles', '/\btuca\b/',
            '/\bvelma\b/', 'krapopolis', 'hit-monkey', 'blood of zeus', 'sangre de zeus', '/\barcane\b/', 'futurama', 'simpson',
            'fritz the cat', 'anomalisa', 'persepolis', 'scanner darkly', 'perfect blue', 'the boondocks', 'ugly americans',
            'axe cop', 'moral orel', 'dr. katz', 'home movies', 'mike tyson mysteries', 'the venture bros', 'metalocalypse',
            'squidbillies', 'aqua unit', 'smiling friends', 'q-force', 'chicago party aunt', 'farzar', 'koala man',
            'the great north', 'pantheon', 'scavengers reign', 'common side effects', 'digman',
            // anime para adolescentes y adultos
            'attack on titan', 'ataque a los titanes', 'shingeki', 'death note', 'tokyo ghoul', 'chainsaw man', 'jujutsu',
            'kimetsu', 'demon slayer', 'guardianes de la noche', 'berserk', 'hellsing', 'devilman', 'parasyte', 'kiseiju',
            'elfen lied', 'goblin slayer', 'high school dxd', 'akame ga kill', 'dorohedoro', 'vinland saga', 'psycho-pass',
            'psycho pass', 'evangelion', 'cowboy bebop', 'ghost in the shell', '/\bakira\b/', 'one punch', 'my hero academia',
            'boku no hero', 'hunter x hunter', '/\bbleach\b/', 'tokyo revengers', 'mob psycho', 'hell.?s paradise', 'jigokuraku',
            'blue lock', 'spy x family code', 'baki', 'kengan', 'record of ragnarok', 'shuumatsu', 'the promised neverland',
            'yakusoku', 'made in abyss', 'black lagoon', 'gantz', 'future diary', 'mirai nikki', 'terror in resonance', 'zankyou', 'neon genesis', 'higurashi',
            // Disney+ y Star para adolescentes y adultos (Marvel, Star Wars, Star)
            'marvel', 'avengers', 'vengadores', 'deadpool', 'wolverine', '/\blogan\b/', 'daredevil', 'punisher', 'castigador',
            'jessica jones', 'luke cage', 'iron fist', 'moon knight', 'caballero luna', '/\bloki\b/', 'wandavision', '/\bfalcon\b/',
            'hawkeye', 'ojo de halcon', 'she-hulk', 'secret invasion', 'invasion secreta', 'agatha', '/\bthor\b/', 'capitan america',
            'captain america', 'iron man', 'black panther', 'pantera negra', 'black widow', 'viuda negra', 'eternals', 'eternos',
            'shang-chi', 'doctor strange', 'doctor extrano', 'ant-man', 'hombre hormiga', 'guardianes de la galaxia',
            'guardians of the galaxy', '/\bblade\b/', '/\bvenom\b/', 'morbius', 'kraven', 'x-men', 'thunderbolts', 'star wars',
            '/\bandor\b/', 'mandalorian', 'boba fett', 'obi-wan', 'ahsoka', 'acolyte', 'walking dead', 'american horror',
            '/grey.?s anatomy/', 'anatomia de grey', '/^the bear(\s*\(|\s*$|\s+s\d)/', 'shogun', 'only murders', 'solo asesinatos', '/\bfargo\b/',
            'desperate housewives', 'esposas desesperadas', 'criminal minds', 'mentes criminales', 'prison break', 'expedientes x', 'expedientes secretos x',
            'x-files', 'homeland', 'american crime', 'dopesick', 'the old man', 'how i met', 'como conoci', 'atlanta',
            // otros títulos para adultos que a veces aparecen en categorías de familia
            'joker', '/\bthe batman\b/', 'suicide squad', 'escuadron suicida', 'peacemaker', 'pacificador', 'watchmen', 'the boys',
            '/\bgen v\b/', 'fifty shades', 'cincuenta sombras', '365 dias', '365 days', 'game of thrones', 'juego de tronos',
            'house of the dragon', 'casa del dragon', 'euphoria', 'squid game', 'juego del calamar', 'breaking bad',
            'better call saul', '/\bnarcos\b/', 'peaky blinders', 'soprano', 'casa de papel', 'money heist', 'sex education',
            '/\belite\b/', 'chucky', 'annabelle', 'conjuro', 'conjuring', 'it chapter', '/^scream\b/',
            'hereditary', 'midsommar', 'terrifier', 'the purge', 'la purga', 'the nun', 'la monja', 'insidious', 'la noche del demonio',
            'evil dead', 'exorcist', 'exorcista', '/^smile\b/', '/\bbarbarians?\b/',
        ],
    ];
}
