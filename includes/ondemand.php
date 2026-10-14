<?php
/** Página "Películas" / "Series" estilo Netflix: destacado, géneros y una fila por categoría. */
$od_type = $od_type ?? 'movie';
$od_label = $od_type === 'series' ? t('Series') : t('Películas');
$od_list = $od_type === 'series' ? 'series.php' : 'movies.php';
$page_title = $od_label;
include __DIR__ . '/../header.php';

$od_cats = wp_categories($od_type);
$od_genres = wp_available_genres($od_type);
?>
<?php echo wp_hero_html($od_type === 'series' ? t('Serie') : t('Película')); ?>

<div class="nf-filterbar" style="position:relative;top:auto;background:transparent;border:0;margin-top:-8px;z-index:5">
    <div class="row1">
        <h1 class="nf-page-title" style="margin:0"><?php echo e($od_label); ?></h1>
        <select class="nf-select" id="odCat" aria-label="<?php echo e(t('Categorías')); ?>">
            <option value=""><?php echo t('Categorías'); ?></option>
            <?php foreach ($od_cats as $c): ?>
                <option value="<?php echo e($c['category_id']); ?>"><?php echo e($c['category_name']); ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <nav class="nf-chips" aria-label="<?php echo e(t('Géneros')); ?>">
        <?php foreach ($od_genres as $k => $g): ?>
            <a class="nf-chip" href="browse.php?type=<?php echo e($od_type); ?>&genre=<?php echo e($k); ?>"><?php echo e($g['label']); ?></a>
        <?php endforeach; ?>
    </nav>
</div>

<div class="nf-rows">
    <?php
    echo wp_row(t('Agregadas recientemente'), [], 'browse.php?type=' . $od_type . '&sort=recent', 'api.php?action=row&type=' . $od_type . '&sort=recent&limit=30');
    echo wp_row(t($od_type === 'series' ? 'Top 10 series hoy' : 'Top 10 películas hoy'), [], 'browse.php?type=' . $od_type . '&sort=rating', 'api.php?action=row&type=' . $od_type . '&sort=top', '', null, 'top');
    foreach ($od_cats as $c) {
        $cid = (string)$c['category_id'];
        echo wp_row($c['category_name'], [], $od_list . '?id=' . rawurlencode($cid), 'api.php?action=row&type=' . $od_type . '&cat=' . rawurlencode($cid) . '&sort=default&limit=30');
    }
    ?>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('odCat').addEventListener('change', function () {
        if (this.value) location.href = <?php echo json_encode($od_list); ?> + '?id=' + encodeURIComponent(this.value);
    });
    NF.api({ action: 'hero', type: <?php echo json_encode($od_type); ?> }).then(function (res) {
        if (res.items && res.items.length) NF.hero(document.getElementById('nfHero'), res.items);
        else document.getElementById('nfHero').style.display = 'none';
    }).catch(function () {});
});
</script>
<?php include __DIR__ . '/../footer.php'; ?>
