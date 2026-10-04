<?php
require_once __DIR__ . '/../includes/core.php';
$sess = wp_session_read_close();
if (empty($sess['username'])) {
    header("Location: ../login");
    exit;
}

$stream_format = in_array($_POST["stream_format"] ?? '', ['ts', 'm3u8'], true) ? $_POST["stream_format"] : 'm3u8';
$theme_color = preg_replace('/[^a-z]/', '', (string)($_POST["theme_color"] ?? ''));
$pincode = "1111";
$CookieArray = json_encode(["color" => $theme_color, "pincode" => $pincode, "stream_type" => $stream_format]);
setcookie("settings_array", $CookieArray, time() + 1209600, "/", $_SERVER["SERVER_NAME"], wp_is_https());
if (isset($_POST['use_vlc'])) setcookie("use_vlc", $_POST['use_vlc'] === '1' ? '1' : '0', time() + 31536000, "/", "", wp_is_https());
if (isset($_POST['epg_source'])) setcookie("epg_source", $_POST['epg_source'] === 'custom' ? 'custom' : 'server', time() + 31536000, "/", "", wp_is_https());
header("Location: ../settings?saved=1");
