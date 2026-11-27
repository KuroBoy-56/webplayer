<?php
/**
 * «Ver todo» de las filas Continuar viendo (?k=cont) y Mi lista (?k=fav) de Inicio: todos los títulos que el panel
 * guarda para la línea y el perfil, en la misma cuadrícula de Explorar (includes/home_lists.php arma las tarjetas).
 */
include "session.php";
include "config.php";
// wp_card_html: las tarjetas se arman antes del encabezado (que es quien carga ui.php en las demás páginas)
require_once __DIR__ . '/includes/ui.php';
require_once __DIR__ . '/includes/home_lists.php';

$k = ($_GET['k'] ?? '') === 'fav' ? 'fav' : 'cont';
if ($k === 'fav') {
    $title = t('Mi lista');
    $subtitle = t('Las películas y series que guardaste');
    list($cards, $n) = wp_mylist_cards();
} else {
    $title = t('Continuar viendo');
    $subtitle = t('Lo que dejaste a medias, lo último primero');
    list($cards, $n) = wp_continue_cards($username);
}

$page_title = $title;
$nav_active = 'home';
$body_class = 'nf-solid';
include "header.php";
?>

<div class="nf-browse-head" style="--accent: #e5091455">
    <h1><?php echo e($title); ?></h1>
    <p><?php echo e($subtitle); ?><?php echo $n ? ' · ' . e(t('{n} títulos', ['n' => $n])) : ''; ?></p>
</div>

<div class="nf-page" style="padding-top:20px">
    <?php if ($cards !== ''): ?>
        <div class="nf-grid"><?php echo $cards; ?></div>
    <?php else: ?>
        <div class="nf-grid-status"><?php echo e(t($k === 'fav' ? 'Todavía no agregaste nada a Mi lista.' : 'Aún no tienes contenido en progreso.')); ?></div>
    <?php endif; ?>
</div>

<?php include "footer.php"; ?>
