<?php
require_once __DIR__ . '/includes/core.php';

$json = wp_admin_config();
$sitename = $json['sitename'] ?? 'WebPlayer';
$adminU = $json['username'] ?? '';
$adminP = $json['password'] ?? '';

$protocol = wp_is_https() ? 'https://' : 'http://';
$basedir = $protocol . $_SERVER['HTTP_HOST'] . substr($_SERVER['REQUEST_URI'], 0, strrpos($_SERVER['REQUEST_URI'], '/'));
$json_file = __DIR__ . "/includes/dns/dns.json";
if (!file_exists($json_file)) {
    $json = '{
    "default_color": "black",
    "dns_number": "no",
    "server1_name": "",
    "server1": "",
    "server2_name": "",
    "server2": "",
    "server3_name": "",
    "server3": "",
    "server4_name": "",
    "server4": "",
    "server5_name": "",
    "server5": "",
    "server6_name": "",
    "server6": ""
}';
    @file_put_contents($json_file, $json);
}
$json = wp_dns_config();
$default_color = $json["default_color"] ?? 'black';
$get_dir = $basedir;
