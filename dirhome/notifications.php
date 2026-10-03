<?php
include "../config.php";
//$get_notif = "http://ltq.infinitiptv.net/api/notifications2?id=com.livetheride.web";
//$channel_api = json_decode(file_get_contents($get_notif), true);

$db = new SQLite3('../includes/notifications/.db.db');
$res = $db->query('SELECT * FROM notifications');
while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
	$data[]=$row;
}
$json = json_encode($data, true);
$channel_api = json_decode($json, TRUE);


$i = 0;
foreach ($channel_api as $key => $value) {
    if (20 < ++$i) {
        echo "\r\n";
    } else {
        $title = $value["title"];
        $description = $value["description"];
        $img = $value["backdrop"];
        $notificationType = 'Announcement';
        $notificationReferenceId = $value["reference"];
        if ($img == "") {
            $poster = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        } else {
            if ($img == NULL) {
                $poster = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
            } else {
                $poster = $img;
            }
        }
        echo "\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t<div class=\"mySlides custfade\" style=\"display: block;\">\r\n\t\t\t\t\t\t\t<div class=\"notification-text-sec\">\r\n\t\t\t\t\t\t\t\t<h4 class=\"notification-heading\">" . $title . "</h4>\r\n\t\t\t\t\t\t\t\t<input type=\"hidden\" value=" . $notificationType . " id=\"notificationType\">\r\n\t\t\t\t\t\t\t\t<input type=\"hidden\" value=" . $notificationReferenceId . " id=\"notificationReferenceId\">\r\n\t\t\t\t\t\t\t\t<div class=\"notification-subheading-sec\">" . $description . "</div>\r\n\t\t\t\t\t\t\t</div>\r\n\t\t\t\t\t\t\t<div class=\"notification-image\">\r\n\t\t\t\t\t\t\t\t<img src=" . $poster . " style=\"\">\r\n\t\t\t\t\t\t\t</div>\r\n\t\t\t\t\t\t</div>";
    }
}

?>