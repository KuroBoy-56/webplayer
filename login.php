<?php
require_once __DIR__ . '/includes/core.php';
include "config.php";
wp_security_headers();

// Sin administrador creado todavía: ir a la configuración inicial
if ($adminU === '' && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: setup.php');
    exit;
}

/* ---------- Fondo de pósters (TMDB) con caché, sin bloquear el login ---------- */
function getMoviesFromEndpoint($api_key, $pages = 4)
{
    $cache_file = __DIR__ . '/movies_cache.json';
    $cache_time = 3600 * 6;
    $cached = is_file($cache_file) ? json_decode((string)@file_get_contents($cache_file), true) : null;
    $fresh = $cached && (time() - filemtime($cache_file) < $cache_time);
    if ($fresh) return $cached;

    $refresh = function () use ($api_key, $pages, $cache_file) {
        $urls = [];
        for ($p = 1; $p <= $pages; $p++) {
            $urls[$p] = "https://api.themoviedb.org/3/movie/now_playing?api_key={$api_key}&language=es-ES&page={$p}";
        }
        $movies = [];
        foreach (wp_http_multi($urls, 5) as $body) {
            $data = $body ? json_decode($body, true) : null;
            if (isset($data['results']) && is_array($data['results'])) $movies = array_merge($movies, $data['results']);
        }
        $movies = array_values(array_filter($movies, function ($m) { return !empty($m['poster_path']); }));
        if ($movies) @file_put_contents($cache_file, json_encode($movies));
        return $movies;
    };

    if ($cached) {
        // Se muestra la copia anterior y se actualiza después de responder
        register_shutdown_function(function () use ($refresh) {
            if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            $refresh();
        });
        return $cached;
    }
    return $refresh();
}

/* ---------- Login: sólo usuario y contraseña, se prueba en todas las DNS ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST["username"], $_POST["password"])) {
    header('Content-Type: application/json; charset=utf-8');
    $username = trim((string)$_POST["username"]);
    $password = trim((string)$_POST["password"]);

    if ($username === '' || $password === '') {
        echo json_encode(['success' => false, 'message' => 'Escribe tu usuario y contraseña.']);
        exit;
    }
    if (wp_rate_limited('login', 15, 300)) {
        echo json_encode(['success' => false, 'message' => 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.']);
        exit;
    }

    wp_session_start();

    // Acceso de administrador
    if ($adminU !== '' && hash_equals((string)$adminU, $username) && hash_equals((string)$adminP, $password)) {
        session_regenerate_id(true);
        $_SESSION['is_admin'] = true;
        wp_rate_reset('login');
        echo json_encode(['success' => true, 'redirect' => 'includes/dns/edit_dns.php']);
        exit;
    }

    $servers = wp_dns_list();
    if (!$servers) {
        echo json_encode(['success' => false, 'message' => 'No hay servidores configurados.']);
        exit;
    }

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
        unset($_SESSION['is_admin']);
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
        $msg = $st === 'expired' ? 'Tu cuenta está vencida. Renueva tu suscripción para seguir viendo.'
            : ($st === 'banned' || $st === 'disabled' ? 'Tu cuenta está deshabilitada. Contacta a soporte.' : 'Estado de cuenta: ' . $states[0]);
        echo json_encode(['success' => false, 'message' => $msg]);
        exit;
    }
    if (!$anyReply) {
        echo json_encode(['success' => false, 'message' => 'No pudimos conectar con los servidores. Revisa tu conexión e inténtalo de nuevo.']);
        exit;
    }
    echo json_encode(['success' => false, 'message' => 'Usuario o contraseña incorrectos.']);
    exit;
}

wp_session_start();
if (!empty($_SESSION['username']) && !empty($_SESSION['server'])) {
    session_write_close();
    header('Location: homex');
    exit;
}
session_write_close();

$api_key = WP_TMDB_KEY;
$movies = getMoviesFromEndpoint($api_key);
$movies = is_array($movies) ? array_slice($movies, 0, 48) : [];
$remember = isset($_COOKIE['username']) ? (string)$_COOKIE['username'] : '';
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <title>LatMpx - WebPlayer</title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="preconnect" href="https://image.tmdb.org">
    <link rel="stylesheet" href="assets/nf/app.css?v=4">
</head>
<body class="nf-login-page">
    <div class="nf-login-wall" aria-hidden="true">
        <div class="nf-login-wall-inner">
            <?php for ($rep = 0; $rep < 2; $rep++) foreach ($movies as $movie): ?>
                <img src="https://image.tmdb.org/t/p/w342<?php echo e($movie['poster_path']); ?>" alt="" loading="lazy" decoding="async">
            <?php endforeach; ?>
        </div>
    </div>
    <div class="nf-login-shade"></div>

    <header class="nf-login-header">
        <img src="assets/img/Logo.png" alt="Logo" class="nf-login-logo">
    </header>

    <main class="nf-login-main">
        <form id="login-form" class="nf-login-box" method="POST" autocomplete="on" novalidate>
            <h1>Iniciar sesión</h1>
            <div id="login-error" class="nf-login-error" role="alert" hidden></div>

            <label class="nf-field">
                <input type="text" id="username" name="username" placeholder=" " autocomplete="username" autocapitalize="none" spellcheck="false" value="<?php echo e($remember); ?>" required>
                <span>Usuario</span>
            </label>

            <label class="nf-field">
                <input type="password" id="password" name="password" placeholder=" " autocomplete="current-password" required>
                <span>Contraseña</span>
                <button type="button" class="nf-eye" id="togglePassword" aria-label="Mostrar contraseña">
                    <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>
                </button>
            </label>

            <button class="nf-btn-red nf-btn-block proceedLogin" type="submit" id="login-btn">
                <span class="lbl">Iniciar sesión</span>
                <span class="nf-spinner" aria-hidden="true"></span>
            </button>

            <label class="nf-remember">
                <input type="checkbox" id="remember" <?php echo $remember !== '' ? 'checked' : ''; ?>> Recordarme
            </label>
            <p class="nf-login-hint">Ingresa con el usuario y la contraseña de tu suscripción.</p>
        </form>
    </main>

    <footer class="nf-login-footer">
        <p>© <?php echo date('Y'); ?> <a href="https://t.me/LATMPX" target="_blank" rel="noopener">Garevyn TV</a></p>
    </footer>

<script>
(function () {
    var form = document.getElementById('login-form');
    var btn = document.getElementById('login-btn');
    var err = document.getElementById('login-error');
    var pass = document.getElementById('password');
    var user = document.getElementById('username');
    var remember = document.getElementById('remember');

    try {
        var saved = localStorage.getItem('wp_user');
        if (saved && !user.value) { user.value = saved; remember.checked = true; }
    } catch (e) {}

    document.getElementById('togglePassword').addEventListener('click', function () {
        pass.type = pass.type === 'password' ? 'text' : 'password';
        this.classList.toggle('on', pass.type === 'text');
    });

    function showError(msg) {
        err.textContent = msg;
        err.hidden = false;
    }

    form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        err.hidden = true;
        if (!user.value.trim() || !pass.value.trim()) {
            showError('Escribe tu usuario y contraseña.');
            return;
        }
        btn.classList.add('loading');
        btn.disabled = true;
        try {
            if (remember.checked) localStorage.setItem('wp_user', user.value.trim());
            else localStorage.removeItem('wp_user');
        } catch (e) {}

        fetch(window.location.pathname, {
            method: 'POST',
            body: new FormData(form),
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                btn.querySelector('.lbl').textContent = 'Entrando...';
                window.location.href = data.redirect;
            } else {
                showError(data.message || 'No se pudo iniciar sesión.');
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        })
        .catch(function () {
            showError('Error de conexión. Inténtalo de nuevo.');
            btn.classList.remove('loading');
            btn.disabled = false;
        });
    });
})();
</script>
</body>
</html>
