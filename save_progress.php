<?php
/* Guarda "Continuar viendo" en el panel (api/progress.php). Nada se guarda en el hosting. */
include "session.php";
include "config.php";
require_once __DIR__ . '/includes/progress_save.php';

header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo '{"ok":false}';
    exit;
}
echo json_encode(wp_progress_save($_POST, $username));
