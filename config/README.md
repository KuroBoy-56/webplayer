# Llave del panel (opcional)

La Autodemo, el botón DNS, registrar el equipo (código MAC) y la activación por equipo usan `login.php`,
que necesita la **llave maestra del panel** (64 caracteres hex).

Hay dos formas de dársela a la compilación. En las dos la llave **no** queda en el código.

1. **Secreto de GitHub (recomendado, sirve desde el móvil):** en el repositorio
   *Settings › Secrets and variables › Actions*, secreto `PANEL_KEY` (o `PANEL_MASTER_KEY`, el mismo que
   usan Vega OS e iOS). Después corre de nuevo el workflow (Actions › App Tizen OS (Samsung) › Run workflow).
2. **Archivo local:** guarda la llave en `config/panel.key` (una línea) en tu PC y compila ahí
   con `npm run build`. Este archivo está en `.gitignore`.

Si subes `config/panel.key` al repositorio con el navegador, queda en el historial de git aunque luego
borres el archivo. El secreto evita eso.

Sin llave la app funciona igual: inicio de sesión con usuario y contraseña en todos los DNS,
progreso, Mi lista, EPG y deportes.
