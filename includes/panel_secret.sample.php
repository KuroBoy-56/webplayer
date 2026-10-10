<?php
// Copia este archivo como includes/panel_secret.php y pon la llave maestra del panel
// (la misma "master_key_hex" de includes/secrets.php del panel: 64 caracteres hexadecimales).
// includes/panel_secret.php nunca se sube a GitHub (está en .gitignore).
return [
    'master_key_hex' => '',
    // Opcional: carpeta api/ de otro panel (termina en "/"), p. ej. para pruebas.
    // 'panel_url' => 'https://mi-panel.com/api/',
    // Opcional: clave de TMDB (32 caracteres). Sin ella se usa la que manda el panel.
    // 'tmdb_key' => '',
];
