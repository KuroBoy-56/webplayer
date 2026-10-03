<?php 
require_once __DIR__ . '/../admin_guard.php';

$db = new SQLite3('./.db.db');

if(isset($_POST['submit'])){
$st = $db->prepare("INSERT INTO notifications(title, description, backdrop, reference) VALUES(:t, :d, :b, :r)");
$st->bindValue(':t', (string)($_POST['title'] ?? ''), SQLITE3_TEXT);
$st->bindValue(':d', (string)($_POST['description'] ?? ''), SQLITE3_TEXT);
$st->bindValue(':b', (string)($_POST['backdrop'] ?? ''), SQLITE3_TEXT);
$st->bindValue(':r', (string)($_POST['reference'] ?? ''), SQLITE3_TEXT);
$st->execute();
$db->close();
header("Location: notifications.php");
}

?>
<!doctype html>
<html lang="en">
  <head>
    <title>Admin Notifications</title>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />
  <meta name="viewport" content="width=device-width, initial-scale=1">
  
  
  <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.4.1/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/3.5.2/animate.min.css">
    <link rel="stylesheet" type="text/css" href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700|Roboto+Slab:400,700|Material+Icons" />
<style>
body
{
background-color: black;
color: white;
margin: 0 auto;
}
.block {
  display: block;
  width: 30%;
  border: none;
  color: black;
  padding: 14px 28px;
  font-size: 18px;
  cursor: pointer;
  text-align: center;
  margin: 0 auto;

}

.block:hover {
  background-color: black;
  color: white;
}
</style>
<body>
<br><br><br>
<div class="container">
    <div class="col-md-8">
      <div class="card bg-dark text-white ">
        <div class="card-header">
          <h4 class="card-title">Add Notification</h4>
        </div>
        <div class="card-body">
          <form  method="post">
                <div class="form-group">
                  <label >Title</label>
                  <input type="text" class="form-control" name="title">
                </div>
                <div class="form-group">
                  <label >Description</label>
                  <input type="text" class="form-control" name="description">
                </div>
                <div class="form-group">
                  <label >Notification Banner</label>
                  <input type="text" class="form-control" name="backdrop">
                </div>
                <div class="form-group">
                  <label>Reference Url</label>
                  <input type="text" class="form-control" name="reference">
                </div>
			<br><button type="submit" name="submit" class="block">Submit</button>
		</form>
		</div>
      </div>
    </div>
  </div>

    <br><br><br>
      <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js"></script>
    <script src="https://unpkg.com/popper.js@1.12.6/dist/umd/popper.js" integrity="sha384-fA23ZRQ3G/J53mElWqVJEGJzU0sTs+SvzG8fXVWP+kJQ1lwFAOkcUOysnlKJC33U" crossorigin="anonymous"></script>
	  <script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js"></script>
</body>

</html>