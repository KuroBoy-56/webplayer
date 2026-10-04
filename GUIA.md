# Guía para terminar: App Android

1. **Abrir:** la rama principal del repo es la web (PHP). Si clonaste desde Android Studio, se abrió como proyecto normal y al cambiar a `android` no aparece **Run**. Para arreglarlo:
   1. Cambia a la rama `android` (abajo a la derecha, o **Git → Branches → origin/android → Checkout**).
   2. **File → Close Project**.
   3. Borra la carpeta oculta `.idea` dentro de la carpeta del repo (en Windows activa *Ver → Elementos ocultos*).
   4. En la pantalla de inicio de Android Studio, **Open** y elige la carpeta del repo. Pulsa **Trust Project**.
   5. Espera a que termine **Gradle Sync** (barra de abajo). La primera vez descarga varias cosas.
   6. Arriba debe salir la configuración **app** junto al botón **Run ▶**.

   Si la sincronización falla: actualiza Android Studio (Narwhal 2025.1.2 o más nuevo) y en **Settings → Build, Execution, Deployment → Build Tools → Gradle** elige **Gradle JDK: jbr-21** (o cualquier JDK 17+). Luego **File → Sync Project with Gradle Files**.
2. **Llave:** copia `local.properties.example` como `local.properties` y pon la llave del panel en `panel.master_key=` (64 caracteres). Ese archivo no se sube a GitHub.
3. **Probar:** conecta tu teléfono o TV (o un emulador) y pulsa **Run ▶**.
4. **APK:** ve a **Build → Generate Signed App Bundle / APK → APK** y usa tu llave de firma.
5. **Prueba:**
   - En la pantalla de activación debe salir el ID del dispositivo (`XX:XX:…`).
   - Actívalo desde el panel o con usuario y contraseña.
   - Prueba **Demo automática** una vez: la segunda vez debe salir bloqueada.

El APK que compila GitHub (release `apk-latest`) sale sin llave. Úsalo solo si agregas el secreto `PANEL_MASTER_KEY` en GitHub.
