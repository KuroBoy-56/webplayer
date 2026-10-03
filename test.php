<?php
// Herramienta de diagnóstico: sólo administrador
require_once __DIR__ . '/includes/core.php';
wp_session_start();
if (empty($_SESSION['is_admin'])) { session_write_close(); header('Location: login'); exit; }
?><?php
session_start();

if (isset($_POST['logout'])) {
    session_destroy();
    header("Location: " . $_SERVER['PHP_SELF']);
    exit;
}

if (isset($_POST['submit'])) {
    $_SESSION['xtream_url'] = $_POST['xtream_url'];
    $_SESSION['username'] = $_POST['username'];
    $_SESSION['password'] = $_POST['password'];
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Conexión Xtream Codes</title>
    <style>
        * {
            box-sizing: border-box;
        }

        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #1e1e1e;
            color: #e0e0e0;
            margin: 0;
            padding: 15px;
            overflow-x: hidden;
        }

        .container {
            background-color: #333;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.6);
            width: 100%;
            max-width: 500px;
            text-align: center;
        }

        form, .logout-form {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        input[type="text"],
        input[type="password"],
        input[type="submit"] {
            width: 100%;
            padding: 14px;
            border-radius: 5px;
            border: none;
            font-size: 16px;
        }

        input[type="text"],
        input[type="password"] {
            background: #444;
            color: #e0e0e0;
        }

        input[type="submit"] {
            background-color: #007acc;
            color: #fff;
            cursor: pointer;
            transition: background-color 0.3s ease;
            font-weight: bold;
        }

        input[type="submit"]:hover {
            background-color: #005a99;
        }

        .logout-button {
            background-color: #ff6347;
            color: #fff;
            cursor: pointer;
            padding: 14px;
            border-radius: 5px;
            border: none;
            font-size: 16px;
            font-weight: bold;
            transition: background-color 0.3s ease;
            width: 100%;
            margin-top: 10px;
        }

        .logout-button:hover {
            background-color: #ff4500;
        }

        h2 {
            margin-bottom: 20px;
            color: #ffffff;
            font-size: 22px;
        }

        .result {
            margin-top: 20px;
            text-align: left;
        }

        .result h3 {
            color: #ffaa00;
            font-size: 18px;
            margin-bottom: 12px;
        }

        .category {
            padding: 12px;
            background-color: #2a2a2a;
            border-radius: 5px;
            margin-bottom: 12px;
            color: #e0e0e0;
            word-wrap: break-word;
        }

        .category img {
            max-width: 100%;
            height: auto;
            border-radius: 5px;
            margin-top: 10px;
            display: block;
        }

        @media (max-width: 480px) {
            .container {
                padding: 20px 15px;
            }
            h2 {
                font-size: 20px;
            }
        }
    </style>
</head>
<body>
<div class="container">
    <?php
    if (isset($_SESSION['xtream_url']) && isset($_SESSION['username']) && isset($_SESSION['password'])) {
        $xtream_url = $_SESSION['xtream_url'];
        $username = $_SESSION['username'];
        $password = $_SESSION['password'];

        function verificar_login_curl($xtream_url, $username, $password) {
            $url = $xtream_url . "/player_api.php?username=" . urlencode($username) . "&password=" . urlencode($password) . "&action=user_info";
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0');
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            $response = curl_exec($ch);
            curl_close($ch);
            $data = json_decode($response, true);
            return isset($data['user_info']['auth']) && $data['user_info']['auth'] == 1;
        }

        function fetch_from_xtream($xtream_url, $username, $password, $type) {
            $url = $xtream_url . "/player_api.php?username=" . urlencode($username) . "&password=" . urlencode($password) . "&action=" . $type;
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0');
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            $response = curl_exec($ch);
            curl_close($ch);
            return json_decode($response, true);
        }

        if (verificar_login_curl($xtream_url, $username, $password)) {
            echo "<div class='result'><h3>Login exitoso!</h3>";

            $canal_prueba = fetch_from_xtream($xtream_url, $username, $password, "get_live_streams");
            $pelicula_prueba = fetch_from_xtream($xtream_url, $username, $password, "get_vod_streams");
            $serie_prueba = fetch_from_xtream($xtream_url, $username, $password, "get_series");

            if (!empty($canal_prueba)) {
                echo "<div class='category'><h3>Canal de Prueba</h3>";
                echo "Nombre: " . htmlspecialchars($canal_prueba[0]['name']) . "<br>ID: " . $canal_prueba[0]['stream_id'] . "<br><img src='" . $canal_prueba[0]['stream_icon'] . "' alt='icon'>";
                echo "</div>";
            }

            if (!empty($pelicula_prueba)) {
                echo "<div class='category'><h3>Película de Prueba</h3>";
                echo "Nombre: " . htmlspecialchars($pelicula_prueba[0]['name']) . "<br>ID: " . $pelicula_prueba[0]['stream_id'] . "<br><img src='" . $pelicula_prueba[0]['stream_icon'] . "' alt='icon'>";
                echo "</div>";
            }

            if (!empty($serie_prueba)) {
                echo "<div class='category'><h3>Serie de Prueba</h3>";
                echo "Nombre: " . htmlspecialchars($serie_prueba[0]['name']) . "<br>ID: " . $serie_prueba[0]['series_id'] . "<br><img src='" . $serie_prueba[0]['cover'] . "' alt='icon'>";
                echo "</div>";
            }

            $categorias_peliculas = fetch_from_xtream($xtream_url, $username, $password, "get_vod_categories");
            if (!empty($categorias_peliculas)) {
                echo "<h3>Categorías de Películas</h3>";
                $count = 0;
                foreach ($categorias_peliculas as $categoria) {
                    if ($count >= 5) break;
                    echo "<div class='category'>Nombre: " . htmlspecialchars($categoria['category_name']) . "<br>ID: " . $categoria['category_id'] . "</div>";
                    $count++;
                }
            }

            echo "</div>";
            ?>
            <form method="POST" class="logout-form">
                <input type="hidden" name="logout" value="1">
                <button type="submit" class="logout-button">Desconectar</button>
            </form>
            <?php
        } else {
            echo "<h3>Error de autenticación. Verifica tus credenciales.</h3>";
            session_destroy();
            echo "<a href='' style='color:#007acc; text-decoration:none;'>Reintentar</a>";
        }
    } else {
    ?>
        <h2>Conectar a Xtream Codes</h2>
        <form method="POST">
            <input type="text" name="xtream_url" placeholder="URL del servidor Xtream" required>
            <input type="text" name="username" placeholder="Usuario" required>
            <input type="password" name="password" placeholder="Contraseña" required>
            <input type="submit" name="submit" value="Conectar">
        </form>
    <?php } ?>
</div>
</body>
</html>
