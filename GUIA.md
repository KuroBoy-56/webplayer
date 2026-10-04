# Guía para terminar: App Android

1. **Abrir:** en Android Studio usa **File → Open** y elige la carpeta de esta rama (`android`).
2. **Llave:** copia `local.properties.example` como `local.properties` y pon la llave del panel en `panel.master_key=` (64 caracteres). Ese archivo no se sube a GitHub.
3. **Probar:** conecta tu teléfono o TV (o un emulador) y pulsa **Run ▶**.
4. **APK:** ve a **Build → Generate Signed App Bundle / APK → APK** y usa tu llave de firma.
5. **Prueba:**
   - En la pantalla de activación debe salir el ID del dispositivo (`XX:XX:…`).
   - Actívalo desde el panel o con usuario y contraseña.
   - Prueba **Demo automática** una vez: la segunda vez debe salir bloqueada.

El APK que compila GitHub (release `apk-latest`) sale sin llave. Úsalo solo si agregas el secreto `PANEL_MASTER_KEY` en GitHub.
