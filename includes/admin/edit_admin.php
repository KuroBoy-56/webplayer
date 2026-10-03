<?php
require_once __DIR__ . '/../admin_guard.php';
$jsondata = file_get_contents("admin.json");
$json = json_decode($jsondata, true);
$message = '<div class="alert alert-success" id="flash-msg"><h4><i class="icon fa fa-check"></i>Items Updated!</h4></div>';

if (isset($_POST["submit"])) {
    $jsondata = file_get_contents("admin.json");
    $replacementData = array(
        'username'   => $_POST["username"],
        'password'   => $_POST["password"],
        'sitename'   => $_POST["sitename"]
    );
    $newArrayData = array_replace_recursive($json, $replacementData);
    $newJsonData = json_encode($newArrayData, JSON_PRETTY_PRINT);
    file_put_contents("admin.json", $newJsonData);
    header("Location: edit_admin.php?message=1");
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
    background-color: black;
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

</style>
<body>

<!-- Menú horizontal similar -->
<div class="navbar">
    <a href="../../index.php">Login Page</a>
    <a href="../../includes/admin/edit_admin.php">Change Admin User/Pass</a>
    <a href="../../includes/dns/edit_dns.php">DNS Settings Page</a>
</div>

<div class="container">
  <form method="POST">
    <?php if(isset($_GET['message'])){echo $message;} ?>
    <br><br>
    <h2>Change Admin User/Pass</h2>
    <br>
    <!-- card -->
    <div class="card bg-dark text-white">
        <div class="card-body">
            <div class="form-group">
                <label for="sitename">Website Name:</label>
                <input type="text" class="form-control" name="sitename" value="<?= htmlspecialchars((string)($json['sitename'] ?? ''), ENT_QUOTES, 'UTF-8') ?>"><br>
                <label for="username">Username:</label>
                <input type="text" class="form-control" name="username" value="<?= htmlspecialchars((string)($json['username'] ?? ''), ENT_QUOTES, 'UTF-8') ?>"><br>
                <label for="password">Password:</label>
                <input type="text" class="form-control" name="password" value="<?= htmlspecialchars((string)($json['password'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
            </div>
        </div>
    </div>
    
    <div class="center-div">
        <button type="submit" name="submit" class="block btn btn-primary">Update</button>
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
