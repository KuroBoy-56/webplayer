<?php 
require_once __DIR__ . '/../admin_guard.php';
$message = '<div class="alert alert-success" id="flash-msg"><h4><i class="icon fa fa-check"></i>Items Updated!</h4></div>';

$db = new SQLite3('./.db.db');

$db->exec("CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY NOT NULL, title VARCHAR(25), description VARCHAR(25), backdrop VARCHAR(50), reference VARCHAR(50))");
//$db->exec("INSERT INTO notifications(title, description , backdrop, reference ) VALUES('test', 'hello world', 'img.jpg', 'url to point to')");
$res = $db->query('SELECT * FROM notifications');

if(isset($_GET['delete'])){
$db->exec("DELETE FROM notifications WHERE id=" . (int)$_GET['delete']);
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
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/latest/css/font-awesome.min.css" />
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
		<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-material-design/4.0.2/bootstrap-material-design.css">
	
<style>
body
{
background-color: black;
color: white;
}
.block {
  display: block;
  width: 30%;
  border: none;
  color: white;
  padding: 14px 28px;
  font-size: 18px;
  cursor: pointer;
  text-align: center;
  margin: 0 auto;

}

.block:hover {
  background-color: #ddd;
  color: black;
}
table{
	color:white;
}
</style>
<div>
      <!-- Navbar -->

    <div class="modal fade" id="confirm-delete" tabindex="-1" role="dialog" aria-labelledby="myModalLabel" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h2><font color="black">Confirm</font></h2>
                </div>
                <div class="modal-body">
                    <font color="black">Do you really want to delete?</font>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-ok">Delete</a>
                </div>
            </div>
        </div>
    </div>


<div>
   <br><center><h2>Notifications</h2></center>
   <br>
   	<center><h3><a href="../../index.php">Login Page</a></h3></center><br>
	<center><h3><a href="../../includes/admin/edit_admin.php">Change Admin User/Pass</a></h3></center><br>
	<center><h3><a href="../../includes/dns/edit_dns.php">DNS Settings Page</a></h3></center>
	<br>
   <br>
   <a href="./notifications_create.php" class="block btn">Create</a><br>
      <div class="card">
          <table class="table">
            <thead>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>title</th>
                  <th>Description</th>
                  <th>Banner</th>
				  <th>reference url</th>
				  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
			  <? while ($row = $res->fetchArray()) {?>
              <tbody>
                <tr>
                  <td><?= (int)$row['id'] ?></td>
                  <td><?= htmlspecialchars((string)$row['title'], ENT_QUOTES, 'UTF-8') ?></td>
                  <td><?= htmlspecialchars((string)$row['description'], ENT_QUOTES, 'UTF-8') ?></td>
                  <td><?= htmlspecialchars((string)$row['backdrop'], ENT_QUOTES, 'UTF-8') ?></td>
                  <td><?= htmlspecialchars((string)$row['reference'], ENT_QUOTES, 'UTF-8') ?></td>
				  <td><a href="./notifications_update.php?update=<?= (int)$row['id'] ?>"><i class="fa fa-pencil-square-o" style="font-size:24px;color:blue"></i></a></td>
                  <td><a href="#" data-href="./notifications.php?delete=<?= (int)$row['id'] ?>" data-toggle="modal" data-target="#confirm-delete"><i class="fa fa-trash-o" style="font-size:24px;color:red"></i></a></td>
                </tr>
              </tbody>
			  <? }?>
            </table>
		</div>

</div>
    <br><br><br>
	 <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js"></script>
	 <script src="https://unpkg.com/popper.js@1.12.6/dist/umd/popper.js" integrity="sha384-fA23ZRQ3G/J53mElWqVJEGJzU0sTs+SvzG8fXVWP+kJQ1lwFAOkcUOysnlKJC33U" crossorigin="anonymous"></script>
	 <script src="https://npmcdn.com/tether@1.2.4/dist/js/tether.min.js"></script>
	<script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-material-design/4.0.2/bootstrap-material-design.iife.js"></script>
    
	
<script> 
$(document).ready(function () {
    $("#flash-msg").delay(3000).fadeOut("slow");
});

$('#confirm-delete').on('show.bs.modal', function(e) {
    $(this).find('.btn-ok').attr('href', $(e.relatedTarget).data('href'));
});
</script>
</body>

</html>