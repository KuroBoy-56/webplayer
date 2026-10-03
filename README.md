# LatMpx para Android, Android TV y Google TV

App nativa en Kotlin con la misma lógica y el mismo diseño que el reproductor web (rama `main`).

- **TV:** menú lateral, foco visible para el control remoto (borde blanco y zoom), guía de canales al costado, arriba/abajo o CH+/CH- para cambiar de canal.
- **Teléfono:** pantalla vertical con barra inferior como la app de Netflix. El reproductor gira a horizontal.
- **Reproductor:** ExoPlayer (Media3) con decodificador FFmpeg. Reproduce Dolby AC3/E-AC3, DTS, TrueHD, MKV, AVI, TS, HLS y más directo en el equipo, sin convertir en el hosting.
  - Selector de audio y subtítulos.
  - Idioma del equipo por defecto.
  - Continúa donde te quedaste y pasa solo al siguiente episodio.
  - Se reconecta si el servidor IPTV corta.
  - VLC solo como último recurso.
- Sin sección de administración: todo se configura desde el panel.

## Descargar el APK sin compilar

Cada vez que se sube un cambio a esta rama, GitHub compila el APK solo:

**Releases → `apk-latest` → `LatMpx.apk`**

https://github.com/KuroBoy-56/webplayer/releases/tag/apk-latest

Para que la app sepa cuál es tu panel, crea un secreto en el repositorio:

**Settings → Secrets and variables → Actions → New repository secret**
- Nombre: `PANEL_URL`
- Valor: la dirección del panel, por ejemplo `https://tu-dominio.com/webplayer`

## Compilar en Android Studio

1. En Android Studio: **File → Open** y elige esta carpeta (la rama `android`).
2. Si pregunta, acepta descargar el SDK de Android 36 y actualizar el plugin de Gradle.
3. Crea o edita `local.properties` en la raíz y agrega `panel.url=https://tu-dominio.com/webplayer`.
4. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. Para publicar en la tienda, usa **Build → Generate Signed App Bundle / APK** con tu propia clave.

## Configuración que la app pide al panel

Contrato provisional. Se adaptará cuando llegue el panel real.

`GET {PANEL_URL}/app_config.php` responde:

```json
{
  "name": "LatMpx",
  "logo": "https://.../logo.png",
  "message": "Texto opcional en el inicio de sesión",
  "dns": [
    { "name": "Servidor 1", "url": "http://dominio1:8080" },
    { "name": "Servidor 2", "url": "http://dominio2:80" }
  ]
}
```

La app prueba el usuario en cada DNS en orden, igual que la web. La última configuración se guarda en el equipo, así que la app abre aunque el panel no responda.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `data/` | API Xtream (`Xtream.kt`), panel (`Panel.kt`), datos guardados (`Store.kt`), plataformas y géneros (`Platforms.kt`) |
| `ui/` | Pantallas en Jetpack Compose: inicio, películas, series, TV en vivo, mi lista, buscar, cuenta, detalle |
| `player/` | Reproductor ExoPlayer (`PlayerActivity.kt`) |
| `Device.kt` | Detección de TV o teléfono |
