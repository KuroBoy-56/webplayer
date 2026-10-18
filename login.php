<?php
require_once __DIR__ . '/includes/core.php';
require_once __DIR__ . '/includes/tenant_login.php';
include "config.php";
wp_security_headers();

// Pantalla "Número de distribuidor": Continuar (valida con el panel) u Omitir
wp_tenant_login_post();

// Pantalla falsa del panel para visitantes nuevos: el código se comprueba aquí (POST fake_unlock)
wp_fake_unlock_post();

// La llave del panel es obligatoria (includes/panel_secret.php, no se sube a GitHub)
$panel_ready = wp_panel_ready();
$panel_msg = t('Falta configurar la conexión con el panel: configura includes/panel_secret.php (copia includes/panel_secret.sample.php y pon la llave maestra del panel).');

/* ---------- Fondo de pósters: api/tmdb.php del panel, como las apps ----------
 * Clave TMDB del distribuidor (o la del dueño con Omitir / sin número). Sin clave (tmdb_key_not_set) o con
 * error del panel no hay fondo: nunca pósters viejos guardados ni otra clave. Caché corta (10 min) por
 * distribuidor e idioma, para que quitar o poner la clave en el panel se note pronto (el panel ya guarda
 * las respuestas de TMDB en su propia caché). */
function getMoviesFromPanel($pages = 4)
{
    $base = wp_panel_base();
    if ($base === '') return [];
    $ck = wp_panel_ck('login|posters|' . wp_lang());
    $c = wp_cache_get($ck, 600);
    if (is_array($c)) return (array)($c['m'] ?? []);
    $urls = [];
    for ($p = 1; $p <= $pages; $p++) {
        $urls[$p] = $base . wp_panel_tenant_query('tmdb.php?path=movie/now_playing&language=' . wp_tmdb_lang() . '&page=' . $p);
    }
    $movies = [];
    foreach (wp_http_multi($urls, 5) as $body) {
        $data = $body ? json_decode($body, true) : null;
        if (isset($data['results']) && is_array($data['results'])) $movies = array_merge($movies, $data['results']);
    }
    $movies = array_values(array_filter($movies, function ($m) { return !empty($m['poster_path']); }));
    wp_cache_set($ck, ['m' => $movies, 'at' => time()]);
    return $movies;
}

/* ---------- Login: sólo usuario y contraseña, se prueba en todas las DNS ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST["username"], $_POST["password"])) {
    header('Content-Type: application/json; charset=utf-8');
    $username = trim((string)$_POST["username"]);
    $password = trim((string)$_POST["password"]);

    if ($username === '' || $password === '') {
        echo json_encode(['success' => false, 'message' => t('Escribe tu usuario y contraseña.')]);
        exit;
    }
    if (wp_rate_limited('login', 15, 300)) {
        echo json_encode(['success' => false, 'message' => t('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')]);
        exit;
    }

    if (!$panel_ready) {
        echo json_encode(['success' => false, 'message' => $panel_msg]);
        exit;
    }

    // Número de distribuidor guardado en este navegador (Omitir = como siempre)
    $dist_choice = wp_dist_choice();
    if ($dist_choice === '') {
        echo json_encode(['success' => false, 'dist' => true, 'message' => t('Escribe tu número de distribuidor o pulsa Omitir.')]);
        exit;
    }
    $dist_code = $dist_choice === 'skip' ? '' : $dist_choice;
    if ($dist_code !== '') {
        $dist_st = wp_tenant_status($dist_code);
        if ($dist_st['state'] !== 'ok') {
            $hard = $dist_st['state'] === 'error' && wp_tenant_is_hard($dist_st['error']);
            if ($hard) wp_dist_set('');
            echo json_encode(['success' => false, 'dist' => $hard, 'message' => wp_tenant_message($dist_st['error'], $dist_st['cfg'] ?? null)], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
    wp_panel_set_tenant($dist_code);

    wp_session_start();

    // DNS desde el panel (caché de 10 minutos; si el panel no responde, la última lista buena)
    $servers = wp_dns_list();
    if (!$servers) {
        echo json_encode(['success' => false, 'message' => t('No se pudo obtener la lista de servidores del panel. Inténtalo de nuevo en unos minutos.')]);
        exit;
    }

    // Cuando el panel responde por HTTPS cambia http:// por https:// en las DNS.
    // Se prueba también la versión http:// (primero), porque muchos servidores IPTV no tienen HTTPS.
    $cands = [];
    foreach ($servers as $srv) {
        if (stripos($srv['url'], 'https://') === 0) {
            $cands[] = ['url' => 'http://' . substr($srv['url'], 8)] + $srv;
        }
        $cands[] = $srv;
    }
    $servers = $cands;

    $urls = [];
    foreach ($servers as $i => $srv) {
        $urls[$i] = $srv['url'] . '/player_api.php?username=' . urlencode($username) . '&password=' . urlencode($password);
    }

    // Consulta paralela: se corta en cuanto un servidor acepta al usuario
    $responses = wp_http_multi($urls, 10, function ($k, $body) {
        $j = json_decode($body, true);
        return isset($j['user_info']['auth']) && (int)$j['user_info']['auth'] === 1
            && strcasecmp((string)($j['user_info']['status'] ?? ''), 'Active') === 0;
    });

    $match = null;
    $anyReply = false;
    $states = [];
    foreach ($responses as $i => $body) {
        if ($body === null) continue;
        $j = json_decode($body, true);
        if (!is_array($j)) continue;
        $anyReply = true;
        $ui = $j['user_info'] ?? [];
        if (isset($ui['auth']) && (int)$ui['auth'] === 1) {
            $st = (string)($ui['status'] ?? '');
            if (strcasecmp($st, 'Active') === 0) {
                if ($match === null || $i < $match) $match = $i;
            } else {
                $states[] = $st;
            }
        }
    }

    if ($match !== null) {
        $srv = $servers[$match];
        session_regenerate_id(true);
        $_SESSION["username"] = $username;
        $_SESSION["password"] = $password;
        $_SESSION["server"] = $srv['url'];
        $_SESSION["server_id"] = $srv['id'];
        $_SESSION["server_name"] = $srv['name'];
        // Distribuidor de esta sesión ('' = Omitir); el guardián lo revisa en cada página
        $_SESSION['dist'] = $dist_code;
        // Token del panel para "Continuar viendo" y "Mi lista" (uno por número de distribuidor)
        $_SESSION[wp_panel_token_key()] = wp_panel_auth($username, $password, $srv['url']);
        // Línea DEMO según el panel ("demo": true): un login normal la quita
        $_SESSION['is_demo'] = !empty($GLOBALS['wp_panel_auth_demo']);
        wp_rate_reset('login');

        // Sólo se recuerda el usuario (nunca la contraseña en una cookie)
        wp_setcookie("username", $username, time() + 30 * 86400);
        if (isset($_COOKIE['password'])) {
            wp_setcookie("password", '', time() - 3600);
        }
        echo json_encode(['success' => true, 'redirect' => 'homex']);
        exit;
    }

    if ($states) {
        $st = strtolower($states[0]);
        $msg = $st === 'expired' ? t('Tu cuenta está vencida. Renueva tu suscripción para seguir viendo.')
            : ($st === 'banned' || $st === 'disabled' ? t('Tu cuenta está deshabilitada. Contacta a soporte.') : t('Estado de cuenta: {s}', ['s' => $states[0]]));
        echo json_encode(['success' => false, 'message' => $msg]);
        exit;
    }
    if (!$anyReply) {
        echo json_encode(['success' => false, 'message' => t('No pudimos conectar con los servidores. Revisa tu conexión e inténtalo de nuevo.')]);
        exit;
    }
    echo json_encode(['success' => false, 'message' => t('Usuario o contraseña incorrectos.')]);
    exit;
}

$dist_view = wp_tenant_login_view();
wp_session_start();
if (!empty($_SESSION['username']) && !empty($_SESSION['server']) && !isset($_GET['dist']) && $dist_view['error'] === '') {
    session_write_close();
    header('Location: homex');
    exit;
}
session_write_close();

// visitante nuevo (sin sesión) y la app "Web" marcada en Pantalla Falsa: se muestra eso en vez del login
$fake = wp_fake_screen_cfg();
if ($fake !== null && !wp_fake_unlocked($fake)) wp_fake_screen_render($fake);

$movies = getMoviesFromPanel();
$movies = is_array($movies) ? array_slice($movies, 0, 48) : [];
// múltiplo de 8 (columnas del fondo): filas completas para que el carrusel vuelva al inicio sin salto
if (count($movies) >= 8) $movies = array_slice($movies, 0, count($movies) - count($movies) % 8);
$remember = isset($_COOKIE['username']) ? (string)$_COOKIE['username'] : '';
$dist_cfg = $dist_view['cfg'];
$dist_pal = wp_tenant_palette($dist_cfg);
$brand_name = wp_brand_name('', $dist_cfg);
$dist_step = $dist_view['step'];
?>
<!DOCTYPE html>
<html lang="<?php echo wp_lang(); ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="<?php echo e($dist_pal ? $dist_pal['bg'] : '#000000'); ?>">
    <title><?php echo $brand_name !== '' ? e($brand_name) : 'LatMpx - WebPlayer'; ?></title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="preconnect" href="https://image.tmdb.org">
    <link rel="stylesheet" href="assets/nf/app.css?v=10">
    <?php echo wp_i18n_script(); ?>
    <?php echo wp_tenant_css($dist_cfg); ?>
    <style>
        .nf-btn-skip { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.45); border-radius: 4px; cursor: pointer; font-weight: 700; }
        .nf-btn-skip:hover, .nf-btn-skip:focus-visible { background: rgba(255,255,255,.12); }
        .nf-btn-red:focus-visible, .nf-btn-skip:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        #dist-code { letter-spacing: 6px; font-size: 22px; font-variant-numeric: tabular-nums; }
        .nf-dist-now { color: #b3b3b3; font-size: 14px; margin: -14px 0 18px; }
        .nf-dist-now b { color: #fff; }
        .nf-login-lang { position: absolute; top: 18px; right: 18px; z-index: 5; }
        .nf-login-lang .nf-select { background: rgba(0,0,0,.6); width: auto; max-width: 60vw; }
        .nf-link-btn { background: none; border: 0; padding: 0; color: #fff; font: inherit; text-decoration: underline; cursor: pointer; }
        .nf-link-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        /* el hueco de abajo iguala la altura a filas enteras: el -50% de la animación cae justo en una fila */
        .nf-login-wall-inner { padding-bottom: 10px; }
    </style>
<script>try{sessionStorage.removeItem("nfAlertShown")}catch(e){}</script>
<?php if ($dist_cfg !== null || $dist_view['choice'] === 'skip' || ($dist_view['choice'] === '' && $dist_view['error'] !== '')) echo wp_brand_store_script($dist_cfg); ?>
</head>
<body class="nf-login-page" data-step="<?php echo e($dist_step); ?>" data-brand="<?php echo $dist_cfg !== null ? '1' : ($dist_view['code'] !== '' ? 'cache' : '0'); ?>">
    <div class="nf-login-wall" aria-hidden="true">
        <div class="nf-login-wall-inner">
            <?php for ($rep = 0; $rep < 4; $rep++) foreach ($movies as $movie): ?>
                <img src="https://image.tmdb.org/t/p/w342<?php echo e($movie['poster_path']); ?>" alt="" loading="lazy" decoding="async">
            <?php endforeach; ?>
        </div>
    </div>
    <div class="nf-login-shade"></div>

    <header class="nf-login-header">
        <div class="nf-login-lang"><?php echo wp_lang_select(); ?></div>
        <img src="<?php echo e(wp_brand_logo($dist_cfg)); ?>" alt="<?php echo e($brand_name !== '' ? $brand_name : 'Logo'); ?>" class="nf-login-logo" id="brand-logo" onerror="this.onerror=null;this.src='assets/img/Logo.png'">
    </header>

    <main class="nf-login-main">
        <form id="dist-form" class="nf-login-box" method="POST" autocomplete="off" novalidate<?php echo $dist_step === 'dist' ? '' : ' hidden'; ?>>
            <h1><?php echo t('Número de distribuidor'); ?></h1>
            <div id="dist-error" class="nf-login-error" role="alert"<?php echo ($dist_step === 'dist' && $dist_view['error'] !== '') ? '' : ' hidden'; ?>><?php echo $dist_step === 'dist' ? e($dist_view['error']) : ''; ?></div>
            <label class="nf-field">
                <input type="text" id="dist-code" name="code" placeholder=" " inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" spellcheck="false" value="<?php echo e($dist_view['code']); ?>"<?php echo $dist_step === 'dist' ? ' autofocus' : ''; ?>>
                <span><?php echo t('Número de distribuidor'); ?></span>
            </label>
            <button class="nf-btn-red nf-btn-block" type="submit" id="dist-btn">
                <span class="lbl"><?php echo t('Continuar'); ?></span>
                <span class="nf-spinner" aria-hidden="true"></span>
            </button>
            <button class="nf-btn-skip nf-btn-block" type="button" id="dist-skip"><?php echo t('Omitir'); ?></button>
            <p class="nf-login-hint"><?php echo t('Escribe el número de 6 dígitos que te dio tu distribuidor. Si no tienes uno, pulsa Omitir.'); ?></p>
        </form>

        <form id="login-form" class="nf-login-box" method="POST" autocomplete="on" novalidate<?php echo $dist_step === 'login' ? '' : ' hidden'; ?>>
            <input type="hidden" name="dist_pick" value="<?php echo e($dist_view['choice']); ?>">
            <h1><?php echo t('Iniciar sesión'); ?></h1>
            <?php if ($dist_view['code'] !== ''): ?>
            <p class="nf-dist-now"><?php echo t('Distribuidor:'); ?> <b><?php echo e(($brand_name !== '' ? $brand_name . ' ' : '') . '(' . $dist_view['code'] . ')'); ?></b></p>
            <?php endif; ?>
            <?php $login_err = !$panel_ready ? $panel_msg : ($dist_step === 'login' ? $dist_view['error'] : ''); ?>
            <?php if ($login_err === '' && $dist_step === 'login' && isset($_GET['line_err'])) { require_once __DIR__ . '/includes/line_guard.php'; $login_err = wp_line_message((string)$_GET['line_err']); } ?>
            <div id="login-error" class="nf-login-error" role="alert"<?php echo $login_err !== '' ? '' : ' hidden'; ?>><?php echo e($login_err); ?></div>

            <label class="nf-field">
                <input type="text" id="username" name="username" placeholder=" " autocomplete="username" autocapitalize="none" spellcheck="false" value="<?php echo e($remember); ?>" required>
                <span><?php echo t('Usuario'); ?></span>
            </label>

            <label class="nf-field">
                <input type="password" id="password" name="password" placeholder=" " autocomplete="current-password" required>
                <span><?php echo t('Contraseña'); ?></span>
                <button type="button" class="nf-eye" id="togglePassword" aria-label="<?php echo e(t('Mostrar contraseña')); ?>">
                    <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>
                </button>
            </label>

            <button class="nf-btn-red nf-btn-block proceedLogin" type="submit" id="login-btn">
                <span class="lbl"><?php echo t('Iniciar sesión'); ?></span>
                <span class="nf-spinner" aria-hidden="true"></span>
            </button>

            <label class="nf-remember">
                <input type="checkbox" id="remember" <?php echo $remember !== '' ? 'checked' : ''; ?>> <?php echo t('Recordarme'); ?>
            </label>
            <p class="nf-login-hint"><?php echo t('Ingresa con el usuario y la contraseña de tu suscripción.'); ?>
                <button type="button" class="nf-link-btn" id="dist-change"><?php echo t('Cambiar distribuidor'); ?></button></p>
        </form>
    </main>

    <footer class="nf-login-footer">
        <?php if ($brand_name !== ''): ?>
        <p>© <?php echo date('Y'); ?> <span id="brand-name"><?php echo e($brand_name); ?></span></p>
        <?php else: ?>
        <p>© <?php echo date('Y'); ?> <a href="https://t.me/LATMPX" target="_blank" rel="noopener">Garevyn TV</a></p>
        <?php endif; ?>
    </footer>

<script>
(function () {
    var form = document.getElementById('login-form');
    var btn = document.getElementById('login-btn');
    var err = document.getElementById('login-error');
    var pass = document.getElementById('password');
    var user = document.getElementById('username');
    var remember = document.getElementById('remember');
    var dform = document.getElementById('dist-form');
    var dcode = document.getElementById('dist-code');
    var dbtn = document.getElementById('dist-btn');
    var derr = document.getElementById('dist-error');

    // Sin respuesta del panel: se usa la marca guardada en este navegador (logo, nombre y colores)
    if (document.body.getAttribute('data-brand') === 'cache') {
        try {
            var b = JSON.parse(localStorage.getItem('wp_dist_brand') || 'null');
            if (b && b.palette) {
                var r = document.documentElement.style;
                r.setProperty('--nf-red', b.palette.accent);
                r.setProperty('--nf-bg', b.palette.bg);
                r.setProperty('--nf-bg2', b.palette.surface);
                r.setProperty('--nf-text', b.palette.text);
            }
            if (b && b.logo) document.getElementById('brand-logo').src = b.logo;
        } catch (e) {}
    }

    try {
        var saved = localStorage.getItem('wp_user');
        if (saved && !user.value) { user.value = saved; remember.checked = true; }
    } catch (e) {}

    // la elección ya va en la cookie: la dirección queda limpia
    if (location.search.indexOf('dist_pick=') !== -1 && history.replaceState) history.replaceState(null, '', 'login');

    function showStep(step) {
        dform.hidden = step !== 'dist';
        form.hidden = step !== 'login';
        document.body.setAttribute('data-step', step);
        (step === 'dist' ? dcode : (user.value ? pass : user)).focus();
    }

    document.getElementById('togglePassword').addEventListener('click', function () {
        pass.type = pass.type === 'password' ? 'text' : 'password';
        this.classList.toggle('on', pass.type === 'text');
    });

    function showError(msg) {
        err.textContent = msg;
        err.hidden = false;
    }
    function showDistError(msg) {
        derr.textContent = msg;
        derr.hidden = false;
    }

    function post(data) {
        return fetch(window.location.pathname, {
            method: 'POST',
            body: data,
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        }).then(function (r) { return r.json(); });
    }

    // ---- Número de distribuidor ----
    dcode.addEventListener('input', function () {
        var v = dcode.value.replace(/\D/g, '').slice(0, 6);
        if (v !== dcode.value) dcode.value = v;
    });
    document.getElementById('dist-change').addEventListener('click', function () {
        derr.hidden = true;
        showStep('dist');
    });
    document.getElementById('dist-skip').addEventListener('click', function () {
        var fd = new FormData();
        fd.append('action', 'dist_skip');
        post(fd).then(function () {
            try { localStorage.removeItem('wp_dist_brand'); } catch (e) {}
            window.location.href = 'login?dist_pick=skip';
        }).catch(function () { showDistError(<?php echo tj('Error de conexión. Inténtalo de nuevo.'); ?>); });
    });
    dform.addEventListener('submit', function (ev) {
        ev.preventDefault();
        derr.hidden = true;
        if (!/^\d{6}$/.test(dcode.value)) {
            showDistError(<?php echo tj('Escribe los 6 dígitos de tu número de distribuidor.'); ?>);
            return;
        }
        dbtn.classList.add('loading');
        dbtn.disabled = true;
        var fd = new FormData();
        fd.append('action', 'dist');
        fd.append('code', dcode.value);
        post(fd).then(function (data) {
            if (data.success) {
                try { localStorage.setItem('wp_dist_brand', JSON.stringify(data.brand)); } catch (e) {}
                window.location.href = 'login?dist_pick=' + dcode.value;
                return;
            }
            showDistError(data.message || <?php echo tj('No se pudo comprobar el número.'); ?>);
            dbtn.classList.remove('loading');
            dbtn.disabled = false;
        }).catch(function () {
            showDistError(<?php echo tj('Error de conexión. Inténtalo de nuevo.'); ?>);
            dbtn.classList.remove('loading');
            dbtn.disabled = false;
        });
    });

    // ---- Iniciar sesión ----
    form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        err.hidden = true;
        if (!user.value.trim() || !pass.value.trim()) {
            showError(<?php echo tj('Escribe tu usuario y contraseña.'); ?>);
            return;
        }
        btn.classList.add('loading');
        btn.disabled = true;
        try {
            if (remember.checked) localStorage.setItem('wp_user', user.value.trim());
            else localStorage.removeItem('wp_user');
        } catch (e) {}

        post(new FormData(form))
        .then(function (data) {
            if (data.success) {
                btn.querySelector('.lbl').textContent = <?php echo tj('Entrando...'); ?>;
                window.location.href = data.redirect;
            } else if (data.dist) {
                try { localStorage.removeItem('wp_dist_brand'); } catch (e) {}
                btn.classList.remove('loading');
                btn.disabled = false;
                showDistError(data.message || <?php echo tj('Escribe tu número de distribuidor.'); ?>);
                showStep('dist');
            } else {
                showError(data.message || <?php echo tj('No se pudo iniciar sesión.'); ?>);
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        })
        .catch(function () {
            showError(<?php echo tj('Error de conexión. Inténtalo de nuevo.'); ?>);
            btn.classList.remove('loading');
            btn.disabled = false;
        });
    });
})();
</script>
</body>
</html>
