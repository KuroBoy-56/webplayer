<?php
/*
 * «¿Quién está viendo?»: la pantalla de perfiles (includes/profiles.php). Elegir un perfil, administrarlos (nombre,
 * avatar, PIN, eliminar) y crear otro. Todo se guarda en el panel (api/profiles.php); la web solo recuerda en la
 * sesión el perfil elegido. Horizontal: perfiles en columna a la izquierda y de fondo lo más destacado de la semana
 * en TMDB; vertical (celular): dos por fila y el último centrado.
 */
include __DIR__ . '/session.php';
include __DIR__ . '/config.php';

// acciones (assets/nf/profiles.js): siempre JSON
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(wp_prof_post($_POST), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
    exit;
}

$pf_next = (string)($_GET['next'] ?? '');
$pf_go = wp_prof_next_ok($pf_next) ? $pf_next : wp_route_url('homex');
list($pf_s, $pf_j) = wp_prof_refresh(true);
// perfiles apagados, una sola conexión o DEMO: no hay nada que elegir
if (is_array($pf_j) && !wp_prof_needed($pf_s)) {
    header('Cache-Control: no-store');
    header('Location: ' . $pf_go, true, 302);
    exit;
}
$pf_state = is_array($pf_j) ? wp_prof_public($pf_j, $pf_s) : null;
$pf_dist = wp_tenant_cfg();
// fondo: lo más destacado de la semana (15 a 20), profiles.js pasa de uno a otro cada 10 s y vuelve al primero
$pf_bgs = array_map('wp_prof_bg', wp_prof_highlights());
$pf_bg = $pf_bgs ? $pf_bgs[0] : [];
$pf_cfg = [
    'state' => $pf_state,
    'csrf' => wp_prof_csrf(),
    'next' => wp_prof_next_ok($pf_next) ? $pf_next : '',
    'manage' => !empty($_GET['manage']),
    'bg' => $pf_bgs,
    'kinds' => ['tv' => t('Serie'), 'movie' => t('Película')],
];
?>
<!DOCTYPE html>
<html lang="<?php echo wp_lang(); ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="<?php echo e(($pf_pal = wp_tenant_palette($pf_dist)) ? $pf_pal['bg'] : '#000000'); ?>">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <title><?php echo e(t('¿Quién está viendo?')); ?> - <?php echo e($sitename); ?></title>
    <script>/* al entrar no hay transición: nunca se ve un pedazo de la página de antes (como «Top 10 de hoy» del inicio) */
    addEventListener('pagereveal', function (e) { var v = e.viewTransition; if (!v) return; v.skipTransition(); [v.ready, v.finished, v.updateCallbackDone].forEach(function (p) { if (p && p.catch) p.catch(function () {}); }); });</script>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="stylesheet" href="assets/vendor/fa/css/all.min.css">
    <link rel="stylesheet" href="assets/nf/app.css?v=14">
    <link rel="stylesheet" href="assets/nf/profiles.css?v=13">
    <?php echo wp_tenant_css($pf_dist); ?>
    <?php echo wp_prof_theme_css($pf_dist); ?>
    <?php echo wp_i18n_script(); ?>
    <script>window.PF=<?php echo json_encode($pf_cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>;</script>
    <script src="assets/nf/profiles.js?v=9" defer></script>
</head>
<body class="pf-body">
<div class="pf-root" id="pfRoot">
    <?php if ($pf_bg): ?>
        <img class="pf-bg" id="pfBg" alt="" decoding="async" fetchpriority="high"
             src="<?php echo e($pf_bg['fhd']); ?>"
             srcset="<?php echo e($pf_bg['fhd'] . ' ' . $pf_bg['w'] . 'w, ' . $pf_bg['orig'] . ' 3840w'); ?>" sizes="100vw"
             data-fb="<?php echo e(json_encode(array_values(array_unique([$pf_bg['orig'], $pf_bg['fhd']])), JSON_UNESCAPED_SLASHES)); ?>">
    <?php endif; ?>
    <div class="pf-shade"></div>

    <header class="pf-top">
        <a class="pf-exit" href="logout.php" data-noprefetch><i class="fas fa-sign-out-alt" aria-hidden="true"></i> <span><?php echo e(t('Salir')); ?></span></a>
        <img class="pf-logo" src="<?php echo e(wp_brand_logo($pf_dist)); ?>" alt="<?php echo e(wp_brand_name('Logo', $pf_dist)); ?>" onerror="this.onerror=null;this.src='assets/img/Logo.png'">
    </header>

    <main class="pf-side">
        <h1 class="pf-title" id="pfTitle"><?php echo e(t('¿Quién está viendo?')); ?></h1>
        <?php if ($pf_state === null): ?>
            <p class="pf-msg"><?php echo e(t('No se pudieron cargar los perfiles. Puedes entrar con el perfil principal o intentarlo de nuevo.')); ?></p>
            <div class="pf-actions">
                <a class="pf-btn pf-btn-main" href="<?php echo e($pf_go); ?>"><?php echo e(t('Entrar')); ?></a>
                <a class="pf-btn" href="perfiles.php"><?php echo e(t('Reintentar')); ?></a>
            </div>
        <?php else: ?>
            <ul class="pf-list" id="pfList" aria-labelledby="pfTitle"></ul>
            <button type="button" class="pf-btn pf-manage" id="pfManage"><i class="fas fa-pen" aria-hidden="true"></i> <span><?php echo e(t('Administrar perfiles')); ?></span></button>
        <?php endif; ?>
    </main>

    <?php if ($pf_bg): ?>
        <aside class="pf-hl" id="pfHl" aria-label="<?php echo e(t('Lo más destacado de la semana')); ?>">
            <b class="pf-hl-t"><?php echo e($pf_bg['t']); ?></b>
            <span class="pf-hl-m">
                <?php if ($pf_bg['r'] > 0): ?><span class="pf-hl-r"><i class="fas fa-star" aria-hidden="true"></i> <?php echo e(number_format((float)$pf_bg['r'], 1)); ?></span><?php endif; ?>
                <?php if ($pf_bg['y'] !== ''): ?><span><?php echo e($pf_bg['y']); ?></span><?php endif; ?>
                <span><?php echo e($pf_bg['k'] === 'tv' ? t('Serie') : t('Película')); ?></span>
            </span>
        </aside>
    <?php endif; ?>
    <span class="pf-ver"><?php echo e(t('Versión {v}', ['v' => WP_VERSION])); ?></span>
</div>

<div class="pf-modal" id="pfModal" role="dialog" aria-modal="true" aria-labelledby="pfModalTitle" hidden>
    <div class="pf-card" id="pfCard"></div>
</div>
</body>
</html>
