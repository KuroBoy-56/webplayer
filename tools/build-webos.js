// Compila la app de webOS (LG) en dist/: app.js (src/ de Vega + react-native-web + piezas del televisor),
// imágenes, index.html, appinfo.json e iconos. Después `ares-package dist` arma el .ipk (ver README).
require('./prepare-key.js');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

esbuild
  .build({
    absWorkingDir: root,
    entryPoints: ['web/index.tsx'],
    outfile: 'dist/app.js',
    bundle: true,
    minify: true,
    format: 'iife',
    // webOS 4.x (televisores LG 2018-2019) trae Chromium 53; lo que le falta está en web/polyfills.ts
    target: ['chrome53'],
    jsx: 'automatic',
    alias: {
      'react-native': './web/shims/react-native.tsx',
      '@amazon-devices/react-native-kepler': './web/shims/kepler.ts',
      '@amazon-devices/react-native-w3cmedia': './web/shims/w3cmedia.tsx',
      '@react-native-async-storage/async-storage': './web/shims/async-storage.ts',
    },
    loader: { '.png': 'file', '.jpg': 'file' },
    assetNames: 'img/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'window' },
    legalComments: 'none',
    logLevel: 'info',
  })
  .then(() => {
    for (const f of ['index.html', 'appinfo.json', 'icon.png', 'largeIcon.png']) fs.copyFileSync(path.join(root, 'webos', f), path.join(dist, f));
    // también en webos/ (sin subir a git): el simulador de LG abierto en esa carpeta quedaba en negro sin app.js
    fs.copyFileSync(path.join(dist, 'app.js'), path.join(root, 'webos', 'app.js'));
    fs.rmSync(path.join(root, 'webos', 'img'), { recursive: true, force: true });
    fs.cpSync(path.join(dist, 'img'), path.join(root, 'webos', 'img'), { recursive: true });
    console.log('Listo: dist/ y webos/ (abre dist/index.html en un navegador para probar)');
  })
  .catch(() => process.exit(1));
