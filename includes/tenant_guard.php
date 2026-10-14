<?php
/**
 * Guardián del distribuidor en las páginas con sesión (session.php).
 * - Omitir (o sesión de antes de esta versión): nada cambia, no se pregunta nada al panel.
 * - Con número: wp_tenant_status() (caché de 10 min). Vencido, suspendido, no válido o app no
 *   vinculada => se borra el número y la sesión y se vuelve a la pantalla del distribuidor.
 *   Sin panel por más de 72 h => pantalla para reintentar.
 */
if (defined('WP_TENANT_GUARD_LOADED')) {
    return;
}
define('WP_TENANT_GUARD_LOADED', true);

function wp_tenant_is_ajax()
{
    return (isset($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest')
        || (isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false);
}

/** Corta la petición: a la pantalla del distribuidor (o 401 JSON en cargas en segundo plano). */
function wp_tenant_kick($error, $code = '')
{
    if (wp_tenant_is_ajax()) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'auth', 'dist' => $error]);
    } else {
        header('Location: ./login?dist_err=' . rawurlencode($error) . ($code !== '' ? '&d=' . rawurlencode($code) : ''));
    }
    exit;
}

function wp_tenant_guard(array $sess)
{
    if (!array_key_exists('dist', $sess)) {
        // sesión iniciada antes del número de distribuidor: igual que Omitir
        wp_panel_set_tenant('');
        return;
    }
    $dist = (string)$sess['dist'];
    wp_panel_set_tenant($dist);
    $want = $dist === '' ? 'skip' : $dist;
    $choice = wp_dist_choice();
    if ($choice === '') {
        wp_dist_set($want); // la cookie se perdió: se repone con la de la sesión
    } elseif ($choice !== $want) {
        // se eligió otro distribuidor en otra pestaña: esta sesión ya no vale
        wp_tenant_logout();
        wp_tenant_kick('changed');
    }
    if ($dist === '') return;

    $st = wp_tenant_status($dist);
    if ($st['state'] === 'ok') return;
    if ($st['state'] === 'error' && wp_tenant_is_hard($st['error'])) {
        wp_dist_set('');
        wp_tenant_logout();
        wp_tenant_kick($st['error'], $dist);
    }
    if ($st['state'] === 'offline') {
        if (wp_tenant_is_ajax()) {
            http_response_code(503);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'offline']);
            exit;
        }
        wp_tenant_retry_page();
    }
    // too_many_attempts / app_required: no se corta la sesión
}

/** Pantalla "Reintentar" cuando el panel no responde y la copia tiene más de 72 h. */
function wp_tenant_retry_page()
{
    http_response_code(503);
    header('Cache-Control: no-store');
    header('Retry-After: 60');
    echo '<!DOCTYPE html><html lang="' . wp_lang() . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . e(t('Sin conexión')) . '</title><link rel="stylesheet" href="assets/nf/app.css?v=10"></head>'
        . '<body class="nf-login-page"><main class="nf-login-main"><div class="nf-login-box">'
        . '<h1>' . e(t('Sin conexión')) . '</h1><p class="nf-login-hint" style="color:#ccc;font-size:15px">' . e(wp_tenant_message('offline')) . '</p>'
        . '<p><a class="nf-btn-red nf-btn-block" style="display:block;text-align:center;padding:14px;border-radius:4px;font-weight:700" href="javascript:location.reload()">' . e(t('Reintentar')) . '</a></p>'
        . '<p class="nf-login-hint"><a href="logout.php?dist=1" style="color:#fff">' . e(t('Cambiar distribuidor')) . '</a></p>'
        . '</div></main></body></html>';
    exit;
}
