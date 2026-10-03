<?php
if (!defined('WP_SESSION_LOADED') && session_status() === PHP_SESSION_NONE) session_start();

$app_timezone = $_SESSION['timezone'] ?? 'Etc/GMT+5';

try {
    $tz_object = new DateTimeZone($app_timezone);
} catch (Exception $e) {
    $app_timezone = 'UTC';
}

date_default_timezone_set($app_timezone);

$global_current_date = date('Y-m-d H:i:s');
?>
