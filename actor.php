<?php
/**
 * Actor: foto, biografía y su filmografía de TMDB, pero sólo los títulos que este
 * servidor IPTV tiene (película o serie). Al tocar un título se abre su ficha.
 */
include "session.php";
include "config.php";
require_once __DIR__ . '/includes/ui.php';

$person = wp_tmdb_person($_GET['id'] ?? '', (string)($_GET['name'] ?? ''));
$found = $person ? wp_actor_available($person) : [];

$page_title = $person ? $person['name'] : 'Actor';
$body_class = 'nf-solid';
include "header.php";

$age = '';
if ($person && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $person['birthday'], $m)) {
    $age = date('d/m/Y', mktime(0, 0, 0, (int)$m[2], (int)$m[3], (int)$m[1]));
}
?>
<div class="nf-page nf-actor-page">
    <a class="nf-actor-back" href="javascript:history.back()"><?php echo wp_icon('back'); ?> Volver</a>
    <?php if (!$person): ?>
        <div class="nf-grid-status">No se encontró información de este actor.</div>
    <?php else: ?>
    <header class="nf-actor-head">
        <img class="nf-actor-photo" src="<?php echo e($person['photo'] ?: 'https://ui-avatars.com/api/?size=300&name=' . urlencode($person['name']) . '&background=333&color=fff'); ?>" alt="">
        <div class="nf-actor-txt">
            <h1><?php echo e($person['name']); ?></h1>
            <?php if ($age || $person['place']): ?>
                <p class="nf-actor-meta"><?php echo e(trim(($age ? 'Nació el ' . $age : '') . ($age && $person['place'] ? ' · ' : '') . $person['place'])); ?></p>
            <?php endif; ?>
            <?php if ($person['bio'] !== ''): ?>
                <p class="nf-actor-bio" id="actorBio"><?php echo nl2br(e($person['bio'])); ?></p>
                <button type="button" class="nf-actor-more" id="actorMore" hidden>Leer más</button>
            <?php endif; ?>
        </div>
    </header>

    <h2 class="nf-actor-h2">Disponible en tu servidor<?php echo $found ? ' <span>(' . count($found) . ')</span>' : ''; ?></h2>
    <?php if (!$found): ?>
        <div class="nf-grid-status">Este servidor no tiene películas ni series de <?php echo e($person['name']); ?>.</div>
    <?php else: ?>
    <div class="nf-grid">
        <?php foreach ($found as $f):
            $card = wp_card($f['it'], $f['type']);
            if ($card['i'] === WP_NOIMG && $f['credit']['poster']) $card['i'] = $f['credit']['poster'];
            if ($f['credit']['character'] !== '') $card['n'] .= ' · ' . $f['credit']['character'];
            echo wp_card_html($card);
        endforeach; ?>
    </div>
    <?php endif; ?>
    <?php endif; ?>
</div>
<script>
(function () {
    var bio = document.getElementById('actorBio'), more = document.getElementById('actorMore');
    if (!bio || !more) return;
    if (bio.scrollHeight > bio.clientHeight + 4) more.hidden = false;
    more.addEventListener('click', function () { bio.classList.toggle('open'); more.textContent = bio.classList.contains('open') ? 'Leer menos' : 'Leer más'; });
})();
</script>
<?php include "footer.php"; ?>
