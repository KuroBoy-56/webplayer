<?php
/* Configuración inicial: crea el administrador y la primera DNS.
   Solo funciona mientras no exista un administrador; después queda bloqueada. */
require_once __DIR__ . '/includes/core.php';
wp_security_headers();

$admin_file = WP_ROOT . '/includes/admin/admin.json';
$dns_file = WP_ROOT . '/includes/dns/dns.json';
$admin = wp_admin_config();
if (!empty($admin['username'])) {
    header('Location: login');
    exit;
}

$error = '';
$done = false;
$v = ['sitename' => 'WebPlayer', 'username' => '', 'server1_name' => 'Servidor 1', 'server1' => ''];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    foreach ($v as $k => $_) $v[$k] = trim((string)($_POST[$k] ?? ''));
    $pass = (string)($_POST['password'] ?? '');
    $pass2 = (string)($_POST['password2'] ?? '');
    if (wp_rate_limited('setup', 10, 300)) {
        $error = 'Demasiados intentos. Espera unos minutos.';
    } elseif ($v['username'] === '' || strlen($pass) < 6) {
        $error = 'Escribe un usuario y una contraseña de al menos 6 caracteres.';
    } elseif ($pass !== $pass2) {
        $error = 'Las contraseñas no coinciden.';
    } elseif ($v['server1'] !== '' && !preg_match('~^https?://[^\s/$.?#][^\s]*$~i', $v['server1'])) {
        $error = 'La DNS debe empezar con http:// o https://';
    } else {
        $ok = wp_json_update($admin_file, function ($d) use ($v, $pass) {
            if (!empty($d['username'])) return null; // otro proceso ya lo creó
            return ['username' => $v['username'], 'password' => $pass, 'sitename' => $v['sitename'] ?: 'WebPlayer'];
        });
        if (!$ok) {
            $error = 'No se pudo guardar. Da permiso de escritura a las carpetas includes/admin e includes/dns.';
        } else {
            if ($v['server1'] !== '') {
                wp_json_update($dns_file, function ($d) use ($v) {
                    $d += ['default_color' => 'black', 'dns_number' => 'no'];
                    for ($i = 1; $i <= 6; $i++) $d += ['server' . $i . '_name' => '', 'server' . $i => ''];
                    if (trim((string)$d['server1']) === '') {
                        $d['server1_name'] = $v['server1_name'] ?: 'Servidor 1';
                        $d['server1'] = rtrim($v['server1'], '/');
                    }
                    return $d;
                });
            }
            $done = true;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <meta name="robots" content="noindex">
    <title>Configuración inicial - WebPlayer</title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="stylesheet" href="assets/nf/app.css?v=4">
</head>
<body class="nf-login-page">
    <div class="nf-login-shade"></div>
    <header class="nf-login-header">
        <img src="assets/img/Logo.png" alt="Logo" class="nf-login-logo">
    </header>
    <main class="nf-login-main">
        <?php if ($done): ?>
            <div class="nf-login-box">
                <h1>Listo</h1>
                <p class="nf-login-hint" style="font-size:16px;color:#ddd">Tu administrador quedó creado. Inicia sesión con ese usuario y contraseña para entrar al panel de DNS.</p>
                <a class="nf-btn-red nf-btn-block" href="login" style="display:flex;align-items:center;justify-content:center;text-decoration:none">Ir a iniciar sesión</a>
            </div>
        <?php else: ?>
            <form class="nf-login-box" method="POST" autocomplete="off">
                <h1>Configuración inicial</h1>
                <p class="nf-login-hint" style="margin:0 0 16px">Crea el administrador del web player. Esta página se bloquea al terminar.</p>
                <?php if ($error): ?><div class="nf-login-error" role="alert"><?php echo e($error); ?></div><?php endif; ?>
                <label class="nf-field"><input type="text" name="sitename" placeholder=" " value="<?php echo e($v['sitename']); ?>"><span>Nombre del sitio</span></label>
                <label class="nf-field"><input type="text" name="username" placeholder=" " autocapitalize="none" spellcheck="false" value="<?php echo e($v['username']); ?>" required><span>Usuario administrador</span></label>
                <label class="nf-field"><input type="password" name="password" placeholder=" " autocomplete="new-password" required><span>Contraseña (mínimo 6)</span></label>
                <label class="nf-field"><input type="password" name="password2" placeholder=" " autocomplete="new-password" required><span>Repite la contraseña</span></label>
                <label class="nf-field"><input type="text" name="server1_name" placeholder=" " value="<?php echo e($v['server1_name']); ?>"><span>Nombre de la DNS (opcional)</span></label>
                <label class="nf-field"><input type="url" name="server1" placeholder=" " autocapitalize="none" spellcheck="false" value="<?php echo e($v['server1']); ?>"><span>DNS, ej. http://servidor.com:8080 (opcional)</span></label>
                <button class="nf-btn-red nf-btn-block" type="submit"><span class="lbl">Crear administrador</span></button>
            </form>
        <?php endif; ?>
    </main>
</body>
</html>
