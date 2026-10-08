<?php
/**
 * Explorar: filtros inteligentes por plataforma (Netflix, Disney+, HBO Max...),
 * género (Acción, Suspenso, Aventura, Anime, Drama...), tipo, categoría y búsqueda.
 */
include "session.php";
include "config.php";

$type = $_GET['type'] ?? 'all';
if (!in_array($type, ['all', 'movie', 'series'], true)) $type = 'all';
$platform = preg_replace('/[^a-z0-9_]/', '', (string)($_GET['platform'] ?? ''));
$genre = preg_replace('/[^a-z0-9_]/', '', (string)($_GET['genre'] ?? ''));
$cat = preg_replace('/[^0-9a-zA-Z_\-]/', '', (string)($_GET['cat'] ?? ''));
$q = trim((string)($_GET['q'] ?? ''));
$sort = in_array($_GET['sort'] ?? '', ['recent', 'az', 'rating'], true) ? $_GET['sort'] : 'recent';

$platforms = wp_platforms();
$genres = wp_genres();
if (!isset($platforms[$platform])) $platform = '';
if (!isset($genres[$genre])) $genre = '';
if ($cat !== '' && $type === 'all') $type = 'movie';

$title = 'Explorar';
$subtitle = 'Todo el catálogo de películas y series';
$accent = '#e50914';
$logo = '';
if ($platform) {
    $title = $platforms[$platform]['label'];
    $subtitle = 'Todo el contenido de ' . $platforms[$platform]['label'] . ', filtra por género o tipo';
    $accent = $platforms[$platform]['color'];
    $logo = $platforms[$platform]['img'];
} elseif ($cat !== '') {
    $names = wp_category_names($type);
    $title = $names[$cat] ?? 'Categoría';
    $subtitle = ($type === 'series' ? 'Series' : 'Películas') . ' de la categoría ' . $title;
} elseif ($genre) {
    $title = $genres[$genre]['label'];
    $subtitle = 'Películas y series de ' . mb_strtolower($genres[$genre]['label'], 'UTF-8');
} elseif ($q !== '') {
    $title = 'Resultados para "' . $q . '"';
    $subtitle = 'Películas y series que coinciden con tu búsqueda';
}

$page_title = $title;
$nav_active = $platform || $genre || $cat === '' ? 'browse' : ($type === 'series' ? 'series' : 'movies');
$body_class = 'nf-solid';
include "header.php";

$availGenres = wp_available_genres($type);
if ($genre && !isset($availGenres[$genre])) $availGenres[$genre] = $genres[$genre];
?>

<div class="nf-browse-head" style="--accent: <?php echo e($accent); ?>55">
    <h1><?php if ($logo): ?><img src="<?php echo e($logo); ?>" alt=""><?php endif; ?><?php echo e($title); ?></h1>
    <p><?php echo e($subtitle); ?></p>
    <?php if ($platform): ?>
    <div class="nf-psearch<?php echo $q !== '' ? ' open' : ''; ?>" id="fPSearch">
        <input class="nf-psearch-in" id="fQ" type="search" placeholder="Buscar en <?php echo e($platforms[$platform]['label']); ?>..." aria-label="Filtrar por nombre" value="<?php echo e($q); ?>" autocomplete="off">
        <button type="button" class="nf-psearch-btn" id="fPSearchBtn" aria-label="Buscar por nombre" title="Buscar por nombre">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
        </button>
    </div>
    <?php endif; ?>
</div>

<div class="nf-filterbar">
    <div class="row1">
        <?php if ($cat === ''): ?>
        <div class="nf-seg" id="fType" role="tablist">
            <button type="button" data-v="all" class="<?php echo $type === 'all' ? 'active' : ''; ?>">Todo</button>
            <button type="button" data-v="movie" class="<?php echo $type === 'movie' ? 'active' : ''; ?>">Películas</button>
            <button type="button" data-v="series" class="<?php echo $type === 'series' ? 'active' : ''; ?>">Series</button>
        </div>
        <?php endif; ?>
        <select class="nf-select" id="fSort" aria-label="Ordenar">
            <option value="recent" <?php echo $sort === 'recent' ? 'selected' : ''; ?>>Agregados recientemente</option>
            <option value="az" <?php echo $sort === 'az' ? 'selected' : ''; ?>>A - Z</option>
            <option value="rating" <?php echo $sort === 'rating' ? 'selected' : ''; ?>>Mejor valorados</option>
        </select>
        <?php if (!$platform): ?>
        <input class="nf-input" id="fQ" type="search" placeholder="Filtrar por título..." value="<?php echo e($q); ?>">
        <?php endif; ?>
        <span class="nf-count" id="fCount"></span>
    </div>
    <?php if ($cat === ''): ?>
    <nav class="nf-chips" id="fGenre" aria-label="Géneros">
        <button type="button" class="nf-chip<?php echo $genre === '' ? ' active' : ''; ?>" data-v="">Todos los géneros</button>
        <?php foreach ($availGenres as $k => $g): ?>
            <button type="button" class="nf-chip<?php echo $genre === $k ? ' active' : ''; ?>" data-v="<?php echo e($k); ?>"><?php echo e($g['label']); ?></button>
        <?php endforeach; ?>
    </nav>
    <?php if (!$platform): ?>
    <nav class="nf-chips" id="fPlat" aria-label="Plataformas" style="padding-top:2px">
        <?php foreach (wp_available_platforms() as $k => $p): ?>
            <a class="nf-chip" href="browse.php?platform=<?php echo e($k); ?>"><?php echo e($p['label']); ?></a>
        <?php endforeach; ?>
    </nav>
    <?php endif; ?>
    <?php endif; ?>
</div>

<div class="nf-page" style="padding-top:20px">
    <div class="nf-grid" id="fGrid"></div>
    <div class="nf-grid-status" id="fStatus"></div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
    var state = {
        type: <?php echo json_encode($type); ?>,
        platform: <?php echo json_encode($platform); ?>,
        genre: <?php echo json_encode($genre); ?>,
        cat: <?php echo json_encode($cat); ?>,
        sort: <?php echo json_encode($sort); ?>,
        q: <?php echo json_encode($q); ?>
    };
    var count = document.getElementById('fCount');
    var grid = NF.grid({
        el: document.getElementById('fGrid'),
        status: document.getElementById('fStatus'),
        params: function () {
            return { action: 'browse', type: state.type, platform: state.platform, genre: state.genre, cat: state.cat, sort: state.sort, q: state.q };
        },
        onTotal: function (n) { count.textContent = n ? n.toLocaleString('es') + ' títulos' : ''; }
    });
    function sync() {
        var p = new URLSearchParams();
        Object.keys(state).forEach(function (k) { if (state[k] && !(k === 'type' && state[k] === 'all') && !(k === 'sort' && state[k] === 'recent')) p.set(k, state[k]); });
        history.replaceState(null, '', 'browse.php' + (p.toString() ? '?' + p.toString() : ''));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        grid.reset();
    }
    function seg(id, key) {
        var box = document.getElementById(id);
        if (!box) return;
        box.addEventListener('click', function (e) {
            var b = e.target.closest('[data-v]');
            if (!b) return;
            Array.prototype.forEach.call(box.querySelectorAll('[data-v]'), function (x) { x.classList.remove('active'); });
            b.classList.add('active');
            state[key] = b.getAttribute('data-v');
            sync();
        });
    }
    seg('fType', 'type');
    seg('fGenre', 'genre');
    document.getElementById('fSort').addEventListener('change', function () { state.sort = this.value; sync(); });
    var t;
    var fq = document.getElementById('fQ');
    function fold(s) {
        s = String(s || '').toLowerCase();
        return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
    }
    function applyQ(v) {
        // filtro instantáneo sobre lo ya cargado; luego el servidor trae todos los que coinciden
        var n = fold(v);
        Array.prototype.forEach.call(document.querySelectorAll('#fGrid .nf-card'), function (c) {
            c.style.display = !n || fold(c.getAttribute('title')).indexOf(n) !== -1 ? '' : 'none';
        });
        clearTimeout(t);
        t = setTimeout(function () { if (state.q !== v) { state.q = v; sync(); } }, 350);
    }
    fq.addEventListener('input', function () { applyQ(this.value.trim()); });
    var ps = document.getElementById('fPSearch');
    if (ps) {
        document.getElementById('fPSearchBtn').addEventListener('click', function () {
            if (!ps.classList.contains('open')) { ps.classList.add('open'); fq.focus(); return; }
            if (fq.value) { fq.value = ''; applyQ(''); }
            ps.classList.remove('open');
        });
        fq.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { fq.value = ''; applyQ(''); ps.classList.remove('open'); fq.blur(); }
        });
        fq.addEventListener('blur', function () { if (!fq.value) ps.classList.remove('open'); });
    }
    grid.reset();
});
</script>
<?php include "footer.php"; ?>
