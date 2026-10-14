<?php
/**
 * Idioma de la app: español (texto original y respaldo), inglés, portugués (Brasil) y francés.
 *
 * - Elección: cookie "wp_lang" (Mi cuenta, menú del perfil o el selector del login); sin cookie,
 *   el idioma del navegador (Accept-Language). Si no es es/en/pt/fr, español.
 * - t('Texto en español', ['n' => 3]) traduce con includes/lang/{en,pt,fr}.php (clave = el texto en
 *   español; {n} se reemplaza). Sin traducción se muestra el español.
 * - JS: wp_i18n_script() deja en la página window.NF_T('Texto', {n: 3}) con solo las frases que usan
 *   assets/nf/*.js (las que escriben tr('...')) y atiende los selectores de idioma [data-wp-lang].
 * - No se traducen títulos del servidor ni de TMDB, textos del panel (alertas, pantalla falsa) ni marcas.
 *   El panel recibe el idioma (lang) en cada llamada y traduce sus propios mensajes.
 */
if (defined('WP_I18N_LOADED')) {
    return;
}
define('WP_I18N_LOADED', true);

/** Idiomas de la app con su nombre en su propio idioma. */
function wp_langs()
{
    return ['es' => 'Español', 'en' => 'English', 'pt' => 'Português', 'fr' => 'Français'];
}

/** Idioma elegido en este navegador ('' = automático). */
function wp_lang_choice()
{
    $c = (string)($_COOKIE['wp_lang'] ?? '');
    return isset(wp_langs()[$c]) ? $c : '';
}

/** Idioma actual: cookie → idioma principal del navegador → español. */
function wp_lang()
{
    static $l = null;
    if ($l !== null) return $l;
    $c = wp_lang_choice();
    if ($c !== '') return $l = $c;
    // el idioma preferido del navegador es el de mayor q (sin q = 1)
    $best = '';
    $bq = -1.0;
    foreach (explode(',', (string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')) as $part) {
        if (!preg_match('/^\s*([a-z]{1,8})(?:-[a-z0-9]{1,8})*\s*(?:;\s*q\s*=\s*([0-9.]+))?/i', $part, $m)) continue;
        $q = isset($m[2]) && $m[2] !== '' ? (float)$m[2] : 1.0;
        if ($q > $bq) { $bq = $q; $best = strtolower($m[1]); }
    }
    return $l = isset(wp_langs()[$best]) ? $best : 'es';
}

/** Idioma para TMDB (fichas y fondo del login; la búsqueda de títulos sigue en es-MX). */
function wp_tmdb_lang()
{
    $m = ['es' => 'es-MX', 'en' => 'en-US', 'pt' => 'pt-BR', 'fr' => 'fr-FR'];
    return $m[wp_lang()];
}

/** Diccionario español → idioma actual. */
function wp_i18n_dict()
{
    static $d = null;
    if ($d !== null) return $d;
    $l = wp_lang();
    $f = __DIR__ . '/lang/' . $l . '.php';
    $d = ($l !== 'es' && is_file($f)) ? include $f : [];
    return $d = is_array($d) ? $d : [];
}

/** Traduce un texto en español; {clave} se reemplaza con $p['clave']. */
function t($s, array $p = [])
{
    $d = wp_i18n_dict();
    $s = isset($d[$s]) && $d[$s] !== '' ? $d[$s] : $s;
    if (!$p) return $s;
    $r = [];
    foreach ($p as $k => $v) $r['{' . $k . '}'] = (string)$v;
    return strtr($s, $r);
}

/** Texto traducido como literal JS (para los scripts dentro de las páginas). */
function tj($s, array $p = [])
{
    return json_encode(t($s, $p), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
}

/** Fecha corta en el idioma actual (con hora si $time). */
function wp_date($ts, $time = false)
{
    $ts = (int)$ts;
    $mon = [
        'es' => ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
        'en' => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        'pt' => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
        'fr' => ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
    ];
    $l = wp_lang();
    $m = $mon[$l][(int)date('n', $ts) - 1];
    $d = $l === 'en' ? $m . ' ' . date('j, Y', $ts) : date('j', $ts) . ' ' . $m . ' ' . date('Y', $ts);
    if (!$time) return $d;
    return $d . ' - ' . ($l === 'en' ? date('g:i A', $ts) : date('H:i', $ts));
}

/** Selector "Idioma de la app" (lo atiende el script de wp_i18n_script). */
function wp_lang_select($class = 'nf-select')
{
    $cur = wp_lang_choice();
    $o = '<select class="' . e($class) . '" data-wp-lang aria-label="' . e(t('Idioma de la app')) . '">';
    $o .= '<option value=""' . ($cur === '' ? ' selected' : '') . '>' . e(t('Automático (idioma del navegador)')) . '</option>';
    foreach (wp_langs() as $k => $n) {
        $o .= '<option value="' . $k . '" lang="' . $k . '"' . ($cur === $k ? ' selected' : '') . '>' . e($n) . '</option>';
    }
    return $o . '</select>';
}

/** Frases que usan los JS de assets/nf (tr('...')) traducidas al idioma actual. Caché por versión de los JS. */
function wp_i18n_js_dict()
{
    $l = wp_lang();
    if ($l === 'es') return [];
    $files = glob(WP_ROOT . '/assets/nf/*.js') ?: [];
    $ver = '';
    foreach ($files as $f) $ver .= basename($f) . filemtime($f);
    $ld = __DIR__ . '/lang/' . $l . '.php';
    $ck = 'i18n|js|' . $l . '|' . md5($ver . (is_file($ld) ? filemtime($ld) : ''));
    $hit = wp_cache_get($ck, 30 * 86400);
    if (is_array($hit)) return $hit;
    $dict = wp_i18n_dict();
    $out = [];
    foreach ($files as $f) {
        preg_match_all("/\\btr\\(\\s*'((?:[^'\\\\]|\\\\.)*)'/", (string)file_get_contents($f), $m);
        foreach ($m[1] as $k) {
            $k = stripslashes($k);
            if (isset($dict[$k])) $out[$k] = $dict[$k];
        }
    }
    wp_cache_set($ck, $out);
    return $out;
}

/** <script> con el idioma, NF_T() y el cambio de idioma (cookie de 5 años; "Automático" la borra). */
function wp_i18n_script()
{
    $loc = ['es' => 'es-ES', 'en' => 'en-US', 'pt' => 'pt-BR', 'fr' => 'fr-FR'];
    return '<script>window.NF_LANG=' . json_encode(wp_lang()) . ';window.NF_LOCALE=' . json_encode($loc[wp_lang()])
        . ';window.NF_I18N=' . json_encode((object)wp_i18n_js_dict(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP)
        . ';window.NF_T=function(s,p){var r=NF_I18N[s]||s;if(p)for(var k in p)r=r.split("{"+k+"}").join(p[k]);return r};'
        . 'document.addEventListener("change",function(e){var s=e.target;if(!s.hasAttribute||!s.hasAttribute("data-wp-lang"))return;'
        . 'document.cookie="wp_lang="+s.value+";path=/;SameSite=Lax;max-age="+(s.value?157680000:0);location.reload()});</script>';
}
