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

/** 'block' | 'kids' | 'disney' | '' para el nombre de una categoría. */
function wp_kids_cat_class($name, $live = false)
{
    $n = wp_norm($name);
    if ($n === '') return '';
    if (!wp_kids_m($n, 'kids_strong') && wp_kids_m($n, 'block_cats')) return 'block';
    if (wp_kids_m($n, $live ? 'live' : 'kids')) return 'kids';
    if (!$live && wp_kids_m($n, 'disney')) return 'disney';
    return '';
}

/** ¿Una película o serie del catálogo pasa el filtro? */
function wp_kids_item_ok(array $it, $type, array $cls, array $gidx)
{
    $kidsCat = false;
    $disney = false;
    foreach ((array)($it['cats'] ?? []) as $c) {
        $k = $cls[(string)$c] ?? '';
        if ($k === 'block') return false;
        if ($k === 'kids') $kidsCat = true;
        elseif ($k === 'disney') $disney = true;
    }
    $name = wp_norm($it['name'] ?? '');
    if (wp_kids_m($name, 'block_marks') || wp_kids_m($name, 'block_titles')) return false;
    $g = wp_norm(trim(($it['genre'] ?? '') . ' ' . ($gidx[$type . ':' . ($it['id'] ?? '')] ?? '')));
    $gKids = $g !== '' && wp_kids_m($g, 'genre_kids');
    if ($g !== '' && !$gKids && wp_kids_m($g, 'genre_block')) return false;
    return $kidsCat || $disney || $gKids;
}

/** El catálogo de películas o series para un perfil infantil (30 min en caché por servidor). */
function wp_kids_catalog($type, array $list)
{
    static $memo = [];
    if (isset($memo[$type])) return $memo[$type];
    $r = wp_kids_rules();
    $last = $list ? end($list) : [];
    $fp = count($list) . '|' . ($list[0]['id'] ?? '') . '|' . ($last['id'] ?? '');
    $ck = 'kidscat|' . $r['v'] . '|' . md5(json_encode($r['block_titles'])) . '|' . $type . '|' . xt_cache_key('', []) . '|' . $fp;
    $hit = wp_cache_get($ck, 1800);
    if (is_array($hit)) return $memo[$type] = $hit;
    $cls = [];
    foreach (wp_categories_raw($type) as $c) $cls[(string)($c['category_id'] ?? '')] = wp_kids_cat_class($c['category_name'] ?? '');
    $gidx = wp_genre_index_get();
    $out = [];
    foreach ($list as $it) {
        if (is_array($it) && wp_kids_item_ok($it, $type, $cls, $gidx)) $out[] = $it;
    }
    if ($list) wp_cache_set($ck, $out);
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
        'v' => 1,
        // categorías de películas y series que son de niños
        'kids' => ['infantil', '/\bkids?\b/', 'ninos', '/\bnin[oa]s?\b/', 'children', 'peques', 'pequenos', 'junior', '/\bjr\b/',
            'baby', '/\bbebes?\b/', 'preescolar', 'preschool', 'cartoon', 'caricatura', 'dibujos', 'animad', 'animacion',
            'animation', 'animated', 'disney junior', 'disney channel', 'nickelodeon', '/\bnick\b/', 'nick jr', 'cartoonito',
            'discovery kids', 'boomerang', 'pakapaka', 'tooncast', 'babytv', 'zoomoo', 'dreamworks', 'pixar', 'illumination',
            'familia', '/\bfamily\b/', 'familiar'],
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
        'genre_kids' => ['familia', '/\bfamily\b/', 'familiar', 'infantil', '/\bkids?\b/', 'children', 'ninos'],
        'genre_block' => ['terror', 'horror', 'erot', 'adult', 'porn', 'crimen', '/\bcrime\b/', 'thriller', 'suspenso', 'belica',
            '/\bwar\b/', 'guerra', '/\bgore\b/'],
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
