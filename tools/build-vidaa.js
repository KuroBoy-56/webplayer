// Compila la app de VIDAA OS (Hisense) en dist/: app.js (src/ de Vega + react-native-web + piezas del televisor),
// imágenes, index.html, instalar.html e iconos. VIDAA abre las apps desde una dirección web: dist/ se sube tal cual a
// la carpeta vidaa/ del panel (junto a api/), ver README.
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
    outfile: path.join(dist, 'app.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    // los televisores VIDAA más viejos traen un Chromium antiguo; lo que les falta está en web/polyfills.ts
    target: ['chrome53'],
    jsx: 'automatic',
    alias: {
      'react-native': './web/shims/react-native.tsx',
      '@amazon-devices/react-native-kepler': './web/shims/kepler.ts',
      '@amazon-devices/react-native-w3cmedia': './web/shims/w3cmedia.tsx',
      '@react-native-async-storage/async-storage': './web/shims/async-storage.ts',
    },
    loader: { '.png': 'file', '.jpg': 'file' },
    // Shaka (motor de Vega para HLS / DASH) no va en VIDAA: el <video> del televisor abre HLS solo.
    // src/player/shaka.ts se cambia por web/shims/shaka.ts (sin Shaka ni sus dependencias en app.js)
    plugins: [
      {
        name: 'sin-shaka',
        setup(b) {
          b.onResolve({ filter: /^\.\/shaka$/ }, a => (/src[\\/]player$/.test(a.resolveDir) ? { path: path.join(root, 'web', 'shims', 'shaka.ts') } : undefined));
        },
      },
    ],
    assetNames: 'img/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'window' },
    legalComments: 'none',
    logLevel: 'info',
  })
  .then(() => {
    for (const f of ['index.html', 'instalar.html', 'icon.png', 'icon_big.png', '.htaccess']) fs.copyFileSync(path.join(root, 'vidaa', f), path.join(dist, f));
    console.log('Listo: dist/ (súbela a la carpeta vidaa/ del panel; abre dist/index.html en un navegador para probar)');
  })
  .catch(() => process.exit(1));
