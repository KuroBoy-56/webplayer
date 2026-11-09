// Compila la app de webOS (LG) en dist/: app.js (src/ de Vega + react-native-web + piezas del televisor),
// imágenes, index.html, appinfo.json e iconos. Después `ares-package dist` arma el .ipk (ver README).
require('./prepare-key.js');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// --hd: versión HD (1280x720) para los televisores LG HD; sin --hd, Full HD (1920x1080). Misma app y mismo id.
const hd = process.argv.includes('--hd');
const root = path.join(__dirname, '..');
const dist = path.join(root, hd ? 'dist-hd' : 'dist');
fs.rmSync(dist, { recursive: true, force: true });

esbuild
  .build({
    absWorkingDir: root,
    entryPoints: ['web/index.tsx'],
    outfile: path.join(dist, 'app.js'),
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
    // Shaka (motor de Vega para HLS / DASH) no va en LG: el <video> del televisor abre HLS solo y Shaka no corre en
    // webOS 4.x. src/player/shaka.ts se cambia por web/shims/shaka.ts (sin Shaka ni sus dependencias en app.js)
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
    for (const f of ['index.html', 'appinfo.json', 'icon.png', 'largeIcon.png']) fs.copyFileSync(path.join(root, 'webos', f), path.join(dist, f));
    if (hd) {
      const info = JSON.parse(fs.readFileSync(path.join(dist, 'appinfo.json'), 'utf8'));
      info.resolution = '1280x720';
      fs.writeFileSync(path.join(dist, 'appinfo.json'), JSON.stringify(info, null, 2) + '\n');
      const html = path.join(dist, 'index.html');
      const page = fs.readFileSync(html, 'utf8');
      if (!page.includes('width=1920')) throw new Error('index.html sin viewport width=1920');
      fs.writeFileSync(html, page.replace('width=1920', 'width=1280'));
      console.log('Listo: dist-hd/ (versión HD 1280x720)');
      return;
    }
    // también en webos/ (sin subir a git): el simulador de LG abierto en esa carpeta quedaba en negro sin app.js
    fs.copyFileSync(path.join(dist, 'app.js'), path.join(root, 'webos', 'app.js'));
    fs.rmSync(path.join(root, 'webos', 'img'), { recursive: true, force: true });
    fs.cpSync(path.join(dist, 'img'), path.join(root, 'webos', 'img'), { recursive: true });
    console.log('Listo: dist/ y webos/ (abre dist/index.html en un navegador para probar)');
  })
  .catch(() => process.exit(1));
