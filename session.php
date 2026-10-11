<?php
require_once __DIR__ . '/includes/core.php';
if (!defined('WP_SESSION_LOADED')) {
    define('WP_SESSION_LOADED', true);
    wp_security_headers();
    // Se lee la sesión y se libera enseguida: así las páginas, el reproductor y
    // las cargas en segundo plano no se bloquean entre sí (navegación fluida).
    $wp_sess = wp_session_read_close();
    if (empty($wp_sess['username']) || empty($wp_sess['server'])) {
        $isAjax = (isset($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest')
            || (isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false);
        if ($isAjax) {
            http_response_code(401);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'auth']);
        } else {
            header('Location: ./login');
        }
        exit;
    }
    // Distribuidor de la sesión (guardián: la revisión al panel se hace como mucho cada 10 min)
    wp_tenant_guard($wp_sess);
    // Línea vigente (contraseña, vencimiento, estado): como mucho cada 15 min
    require_once __DIR__ . '/includes/line_guard.php';
    wp_line_guard($wp_sess);
    $get_dns = rtrim($wp_sess['server'], '/');
    $username = $wp_sess['username'];
    $password = $wp_sess['password'];
    $_SESSION = $wp_sess;
}
