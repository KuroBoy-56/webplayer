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
    // Opcional: dominio propio con un Worker de Cloudflare (GUIA-WORKER.html). Cada secreto (32 a 128 letras y
    // números) es el EDGE_KEY de un Worker; a la derecha, '' (el cliente escribe su número o pulsa Omitir) o el
    // número de 6 dígitos del distribuidor dueño de ese dominio (la web queda fija en él).
    // 'edge_keys' => [
    //     'PEGA_AQUI_EL_SECRETO_DE_TU_WORKER' => '',
    //     'PEGA_AQUI_EL_SECRETO_DEL_WORKER_DEL_DISTRIBUIDOR' => '123456',
    // ],
    // false = el dominio original sigue abriendo (para probar el Worker); true (o sin poner) = 403 Forbidden.
    // 'edge_block' => false,
];
