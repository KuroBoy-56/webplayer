// Continuar viendo con el índice leído en segundo plano (idxwarm.ts → preloadIndex) y con el índice de la VPS.
const { makeMp4 } = require('./mp4gen.cjs');
const { xui } = require('./xui.cjs');
const H = require('./harness.cjs');
(async () => {
  const file = makeMp4({ secs: 7200, audios: 5, vkbps: 850 });
  const s = await xui(file, { wait: 3500, rate: 1_500_000, max: 1 });
  H.rangeget.setLineMax(1);
  let t = Date.now();
  const r0 = await H.mp4.preloadIndex(s.url).done;
  console.log(JSON.stringify({ paso: 'índice en segundo plano', resultado: r0, segundos: (Date.now() - t) / 1000, pedidos: s.stats.requests }));
  // el índice queda solo en el equipo (no en memoria): como al volver a abrir la app
  const before = s.stats.requests;
  const r = await H.openOnce(s.url, { at: 74 * 60, lineMax: 1, watch: 15 });
  console.log(JSON.stringify({ paso: 'Continuar viendo (min 74)', primera_imagen_s: r.first, cortes_s: r.stalled, error: r.err, pedidos: s.stats.requests - before }));
  console.log('   ' + r.diag);
  await s.close();
  process.exit(0);
})();
