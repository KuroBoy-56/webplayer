<?php
require_once __DIR__ . '/includes/core.php';
$s = wp_session_read_close();
header('Location: ' . (!empty($s['username']) ? 'homex' : 'login'));
exit;
