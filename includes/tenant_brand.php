<?php
/**
 * Marca del distribuidor: nombre, logo y colores (variables CSS de :root).
 * Con Omitir o sin datos se usa lo incorporado (logo, "WebPlayer" y el tema rojo).
 */
if (defined('WP_TENANT_BRAND_LOADED')) {
    return;
}
define('WP_TENANT_BRAND_LOADED', true);

function wp_hex_rgb($hex)
{
    $hex = ltrim((string)$hex, '#');
    return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
}

function wp_rgb_hex(array $c)
{
    return sprintf('#%02X%02X%02X', max(0, min(255, (int)round($c[0]))), max(0, min(255, (int)round($c[1]))), max(0, min(255, (int)round($c[2]))));
}

/** Mezcla $a hacia $b ($t = 0..1). */
function wp_mix($a, $b, $t)
{
    $x = wp_hex_rgb($a);
    $y = wp_hex_rgb($b);
    return wp_rgb_hex([$x[0] + ($y[0] - $x[0]) * $t, $x[1] + ($y[1] - $x[1]) * $t, $x[2] + ($y[2] - $x[2]) * $t]);
}

/** Luminancia relativa WCAG. */
function wp_luminance($hex)
{
    $l = 0;
    foreach (wp_hex_rgb($hex) as $i => $v) {
        $v /= 255;
        $v = $v <= 0.03928 ? $v / 12.92 : pow(($v + 0.055) / 1.055, 2.4);
        $l += $v * [0.2126, 0.7152, 0.0722][$i];
    }
    return $l;
}

/**
 * Texto sobre el color de acento: blanco si llega a contraste 3:1 (botones en negrita, como el
 * rojo de siempre), si no el de más contraste (negro sobre dorado, verde o naranja).
 */
function wp_on_accent($accent)
{
    $l = wp_luminance($accent);
    $white = 1.05 / ($l + 0.05);
    return ($white >= 3 || $white >= ($l + 0.05) / 0.05) ? '#FFFFFF' : '#000000';
}

/** Paleta completa (con los derivados) o null para el tema incorporado. */
function wp_tenant_palette(array $cfg = null)
{
    $p = is_array($cfg) ? ($cfg['palette'] ?? null) : null;
    if (!is_array($p)) return null;
    $text = wp_hex_rgb($p['text']);
    $bg = wp_hex_rgb($p['bg']);
    return $p + [
        'accentHover' => wp_mix($p['accent'], wp_on_accent($p['accent']) === '#000000' ? '#000000' : '#FFFFFF', 0.12),
        'onAccent' => wp_on_accent($p['accent']),
        // texto al 65 % sobre el fondo (color sólido para que sirva en cualquier lugar)
        'textMuted' => wp_rgb_hex([$bg[0] + ($text[0] - $bg[0]) * .65, $bg[1] + ($text[1] - $bg[1]) * .65, $bg[2] + ($text[2] - $bg[2]) * .65]),
        'card' => wp_mix($p['surface'], $p['text'], 0.08),
        'focus' => wp_focus_color($p['accent'], $p['bg']),
    ];
}

/** Color del foco/realce: el acento, aclarado hasta que se vea sobre el fondo oscuro (contraste 3:1). */
function wp_focus_color($accent, $bg)
{
    $lb = wp_luminance($bg);
    foreach ([0, .25, .45, .65] as $t) {
        $c = wp_mix($accent, '#FFFFFF', $t);
        $lc = wp_luminance($c);
        if ((max($lc, $lb) + .05) / (min($lc, $lb) + .05) >= 3) return $c;
    }
    return '#FFFFFF';
}

/** <style> con las variables del tema del distribuidor ('' con el tema incorporado). */
function wp_tenant_css(array $cfg = null)
{
    $p = wp_tenant_palette($cfg);
    if ($p === null) return '';
    return '<style id="wp-dist-theme">:root{--nf-red:' . $p['accent'] . ';--nf-red-h:' . $p['accentHover'] . ';--nf-bg:' . $p['bg']
        . ';--nf-bg2:' . $p['surface'] . ';--nf-card:' . $p['card'] . ';--nf-text:' . $p['text'] . ';--nf-gray2:' . $p['textMuted']
        . ';--nf-on-accent:' . $p['onAccent'] . '}'
        . '.nf-btn-red,.nf-btn-red:visited{color:var(--nf-on-accent)}'
        . '.nf-avatar{background:linear-gradient(135deg,' . $p['accent'] . ',' . wp_mix($p['accent'], '#000000', .45) . ');color:' . $p['onAccent'] . '}'
        . '.nf-login-page{background:' . $p['bg'] . '}.nf-login-box{background:' . wp_tenant_rgba($p['bg'], '.82') . '}'
        . '.nf-login-box h1,.nf-nav a.active{color:' . $p['text'] . '}'
        // foco y realce (teclado, control remoto, TV) con el acento del distribuidor en vez del blanco
        . ':root{--nf-focus:' . $p['focus'] . '}'
        . '.nf-plat:hover,.nf-plat:focus-visible,.nf-input:focus{border-color:var(--nf-focus)}'
        . '.nf-field input:focus{border-color:var(--nf-focus);box-shadow:0 0 0 1px var(--nf-focus)}'
        . 'a.nf-actor:focus-visible img{box-shadow:0 0 0 3px var(--nf-focus)}'
        . '.nf-card:focus-visible,.nf-chip:focus-visible,.nf-btn:focus-visible,.nf-ep:focus-visible,.nf-arrow:focus-visible{outline:3px solid var(--nf-focus);outline-offset:2px}'
        . '.nf-alert-btn:focus-visible{outline-color:var(--nf-focus)}</style>';
}

function wp_tenant_rgba($hex, $a)
{
    $c = wp_hex_rgb($hex);
    return 'rgba(' . $c[0] . ',' . $c[1] . ',' . $c[2] . ',' . $a . ')'; // $a como texto ('.82'): sin coma decimal por locale
}

/** Nombre de la marca ($default con Omitir o sin nombre). */
function wp_brand_name($default = 'WebPlayer', array $cfg = null)
{
    $cfg = $cfg === null ? wp_tenant_cfg() : $cfg;
    return (is_array($cfg) && !empty($cfg['name'])) ? (string)$cfg['name'] : $default;
}

/** Inicial de la marca para los banners (en lugar de la "N"): la del distribuidor o la de "MPX Player". */
function wp_brand_initial(array $cfg = null)
{
    $n = wp_brand_name('MPX Player', $cfg);
    return preg_match('/[\p{L}\p{N}]/u', $n, $m) ? mb_strtoupper($m[0], 'UTF-8') : 'M';
}

/** URL del logo para <img> (el incorporado con Omitir o sin logo). */
function wp_brand_logo(array $cfg = null)
{
    $cfg = $cfg === null ? wp_tenant_cfg() : $cfg;
    if (!is_array($cfg) || empty($cfg['logo_url'])) return WP_LOGO;
    // en una página https un logo http pasa por img.php (caché del hosting)
    return wp_img($cfg['logo_url'], WP_LOGO);
}

/** Lo que el navegador guarda en localStorage (solo logo, nombre y colores). */
function wp_brand_local(array $cfg = null)
{
    if (!is_array($cfg)) return null;
    return [
        'code' => $cfg['code'],
        'name' => $cfg['name'],
        'logo' => empty($cfg['logo_url']) ? null : wp_brand_logo($cfg),
        'rev' => (int)$cfg['rev'] . '.' . (int)$cfg['logo_rev'],
        'palette' => $cfg['palette'],
    ];
}

/** Script que guarda (o borra) la marca en localStorage. */
function wp_brand_store_script(array $cfg = null)
{
    $b = wp_brand_local($cfg);
    $js = $b === null ? 'localStorage.removeItem("wp_dist_brand")'
        : 'localStorage.setItem("wp_dist_brand",' . json_encode(json_encode($b, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), JSON_HEX_TAG | JSON_HEX_AMP) . ')';
    return '<script>try{' . $js . '}catch(e){}</script>';
}
