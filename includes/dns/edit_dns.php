<?php
require_once __DIR__ . '/../admin_guard.php';
$jsondata = file_get_contents("dns.json");
$json = json_decode($jsondata, true);
$message = '<div class="alert alert-success" id="flash-msg"><h4><i class="icon fa fa-check"></i>Items Updated!</h4></div>';

if (isset($_POST["submit"])) {
    $jsondata = file_get_contents("dns.json");
    if ($_POST["dns_number"] == '1'){
        $dns_number = 'no';
    }else{
        $dns_number = $_POST["dns_number"];
    }
    $replacementData = array(
        'dns_number'    => $dns_number,
        'server1_name'  => $_POST["server1_name"],
        'server1'       => $_POST["server1"],
        'server2_name'  => $_POST["server2_name"],
        'server2'       => $_POST["server2"],
        'server3_name'  => $_POST["server3_name"],
        'server3'       => $_POST["server3"],
        'server4_name'  => $_POST["server4_name"],
        'server4'       => $_POST["server4"],
        'server5_name'  => $_POST["server5_name"],
        'server5'       => $_POST["server5"],
        'server6_name'  => $_POST["server6_name"],
        'server6'       => $_POST["server6"]
    );
    foreach ($replacementData as $k => $v) {
        $v = trim(strip_tags((string)$v));
        if (preg_match('/^server\d$/', $k) && $v !== '' && !preg_match('~^https?://~i', $v)) $v = 'http://' . $v;
        $replacementData[$k] = $v;
    }
    $newArrayData = array_replace_recursive($json, $replacementData);
    $newJsonData = json_encode($newArrayData, JSON_PRETTY_PRINT);
    file_put_contents("dns.json", $newJsonData);
    header("Location: edit_dns.php?message=1");
    exit;
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
  <title>Admin Page</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.4.1/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/3.5.2/animate.min.css">
</head>
<style>
body {
    background-color: #111;
    color: white;
}

.navbar {
    display: flex;
    justify-content: center;
    background-color: #333;
    padding: 10px;
}

.navbar a {
    color: white;
    padding: 14px 20px;
    text-decoration: none;
    text-align: center;
    margin-right: 10px;
}

.navbar a:hover {
    background-color: #ddd;
    color: black;
}

.block {
    display: block;
    width: 50%;
    border: none;
    color: white;
    padding: 14px 28px;
    font-size: 18px;
    cursor: pointer;
    text-align: center;
    margin: 20px auto;
}

.block:hover {
    background-color: #ddd;
    color: black;
}

.container {
    margin-top: 30px;
}

.card {
    margin-bottom: 20px;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 20px;
    background-color: #222;
    box-shadow: 0 0 15px rgba(0, 0, 0, 0.3);
}

.center-div {
    text-align: center;
    margin-top: 20px;
}

/* Mejoramos el tamaño de los campos */
input[type="text"] {
    width: 100%; 
    background-color: #333;
    color: white;
    border: 1px solid #555;
    border-radius: 5px;
    padding: 10px;
}

input[type="text"]::placeholder {
    color: #bbb;
}

/* Añadir espacio entre los inputs */
.form-group {
    margin-bottom: 20px;
}

</style>
<body>

<!-- Horizontal Menu Compacto -->
<div class="navbar">
    <a href="../../index.php">Login Page</a>
    <a href="../../includes/admin/edit_admin.php">Change Admin User/Pass</a>
    <a href="edit_dns.php">DNS Settings</a>
    <a href="../notifications/notifications.php">Notifications</a>
    <a href="../../logout.php">Logout</a>
</div>

<div class="container">
  <form method="POST">
    <?php if(isset($_GET['message'])){echo $message;} ?>
    <h2>Admin Portal</h2><br>
    
    <!-- Selector para el número de servidores a mostrar -->
    <div class="form-group">
      <label for="dns_number">Number of Servers:</label>
      <select class="custom-select" name="dns_number">
          <option value="1" <?=($json['dns_number']=='1'||$json['dns_number']=='no')?'selected':'' ?>>1</option>
          <option value="2" <?=$json['dns_number']=='2'?'selected':'' ?>>2</option>
          <option value="3" <?=$json['dns_number']=='3'?'selected':'' ?>>3</option>
          <option value="4" <?=$json['dns_number']=='4'?'selected':'' ?>>4</option>
          <option value="5" <?=$json['dns_number']=='5'?'selected':'' ?>>5</option>
          <option value="6" <?=$json['dns_number']=='6'?'selected':'' ?>>6</option>
      </select>
    </div>

    <!-- Sección única para todos los servidores -->
    <div class="card">
      <div class="form-group">
          <label for="server1_name">Server 1 Name:</label>
          <input type="text" class="form-control" name="server1_name" value="<?= htmlspecialchars((string)($json['server1_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 1 Name">
      </div>
      <div class="form-group">
          <label for="server1">Server 1 DNS:PORT url:</label>
          <input type="text" class="form-control" name="server1" value="<?= htmlspecialchars((string)($json['server1'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 1 DNS:PORT">
      </div>
      <div class="form-group">
          <label for="server2_name">Server 2 Name:</label>
          <input type="text" class="form-control" name="server2_name" value="<?= htmlspecialchars((string)($json['server2_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 2 Name">
      </div>
      <div class="form-group">
          <label for="server2">Server 2 DNS:PORT url:</label>
          <input type="text" class="form-control" name="server2" value="<?= htmlspecialchars((string)($json['server2'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 2 DNS:PORT">
      </div>
      <div class="form-group">
          <label for="server3_name">Server 3 Name:</label>
          <input type="text" class="form-control" name="server3_name" value="<?= htmlspecialchars((string)($json['server3_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 3 Name">
      </div>
      <div class="form-group">
          <label for="server3">Server 3 DNS:PORT url:</label>
          <input type="text" class="form-control" name="server3" value="<?= htmlspecialchars((string)($json['server3'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 3 DNS:PORT">
      </div>
      <div class="form-group">
          <label for="server4_name">Server 4 Name:</label>
          <input type="text" class="form-control" name="server4_name" value="<?= htmlspecialchars((string)($json['server4_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 4 Name">
      </div>
      <div class="form-group">
          <label for="server4">Server 4 DNS:PORT url:</label>
          <input type="text" class="form-control" name="server4" value="<?= htmlspecialchars((string)($json['server4'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 4 DNS:PORT">
      </div>
      <div class="form-group">
          <label for="server5_name">Server 5 Name:</label>
          <input type="text" class="form-control" name="server5_name" value="<?= htmlspecialchars((string)($json['server5_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 5 Name">
      </div>
      <div class="form-group">
          <label for="server5">Server 5 DNS:PORT url:</label>
          <input type="text" class="form-control" name="server5" value="<?= htmlspecialchars((string)($json['server5'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 5 DNS:PORT">
      </div>
      <div class="form-group">
          <label for="server6_name">Server 6 Name:</label>
          <input type="text" class="form-control" name="server6_name" value="<?= htmlspecialchars((string)($json['server6_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 6 Name">
      </div>
      <div class="form-group">
          <label for="server6">Server 6 DNS:PORT url:</label>
          <input type="text" class="form-control" name="server6" value="<?= htmlspecialchars((string)($json['server6'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="Enter Server 6 DNS:PORT">
      </div>
    </div>
    
    <div class="center-div">
        <button type="submit" name="submit" class="block btn btn-primary btn-lg">Update</button>
    </div>
  </form>
</div>

<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.4.1/jquery.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.16.0/umd/popper.min.js"></script>
<script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js"></script>

<script> 
$(document).ready(function () {
    $("#flash-msg").delay(3000).fadeOut("slow");
});
</script>

</body>
</html>
