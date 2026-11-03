# Shaka Player para Vega

Motor: Shaka Player 4.16.13, licencia Apache 2.0 (ver SHAKA-LICENSE).
Fuente original: https://github.com/shaka-project/shaka-player/tree/v4.16.13
Commit original: 969d23b040e5e2e19e06d99d27ff6ad2c24fc45f.

Este archivo JavaScript fue modificado respecto del original mediante los 33
parches publicados por Amazon en la distribución Vega 4.16.13-r1.2. El archivo
original de Amazon se conserva junto al motor para reproducir la compilación:
amazon-vega-patches-4.16.13-r1.2.tar.gz.

Documentación y descarga:
https://developer.amazon.com/docs/vega/0.22/media-player-shaka-player
https://amzndevresources.com/vega/media-player/shaka-rel-v4.16.13-r1.2-devices_scope.tar.gz

SHA256 del archivo de Amazon:
1c06ca1c8502680f2e41609f7feb7483b5a16a78ec670e71a17eb3813e17d120

Sobre el tag original, aplicar en orden shaka-rel/shaka-patch/*.patch con
git apply, instalar las dependencias de Shaka y compilar con Java 21:

```bash
python3 build/build.py --name compiled --mode release --skip-ts +@complete -@ui -@ads -@cast -@polyfillForUI
```

SHA256 de shaka-player.compiled.js entregado:
dd9176999661220e3fd8a04df0be9719e4587a179a0a94d8683528cf310ba1a6

Se excluyen la interfaz web de Shaka, anuncios y casting; la interfaz utilizada
es la propia de esta aplicación. No se necesita descargar o compilar Shaka para
construir la app: el motor JavaScript ya está incluido.
