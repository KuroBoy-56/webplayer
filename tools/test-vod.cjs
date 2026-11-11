// Películas y capítulos contra un servidor IPTV simulado como el de los avisos (tools/vod-sim): una sola conexión,
// 3,5 s de espera por pedido y el índice al final del archivo. Corre el lector real de la app (mp4mse.ts, rangeget.ts,
// readahead.ts) con un reproductor de Vega simulado. Tarda ~2 min (tiempo real). npm run test:vod
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeMp4 } = require('./vod-sim/mp4gen.cjs');
const { xui } = require('./vod-sim/xui.cjs');
const H = require('./vod-sim/harness.cjs');

after(() => setTimeout(() => process.exit(0), 50));

test('capítulo con el índice al final y un servidor que tarda 15 s en llegar al final del archivo: abre (antes «sin índice en 120 s»)', async () => {
  const file = makeMp4({ secs: 2700, audios: 2, vkbps: 1100 });
  const s = await xui(file, { wait: 2000, rate: 1_500_000, max: 1, tailWait: 15000 });
  try {
    const r = await H.openOnce(s.url, { at: 0, lineMax: 1, watch: 5 });
    assert.equal(r.err, null, r.diag);
    assert.ok(r.first !== null && r.first < 30, 'primera imagen a los ' + r.first + ' s ' + r.diag);
  } finally {
    await s.close();
  }
});

test('película en alta calidad (5 Mbps) en una línea de una conexión: sigue de corrido después de empezar', async () => {
  const file = makeMp4({ secs: 3000, audios: 2, vkbps: 5000 });
  const s = await xui(file, { wait: 3500, rate: 2_000_000, max: 1 });
  try {
    const r = await H.openOnce(s.url, { at: 0, lineMax: 1, watch: 40 });
    assert.equal(r.err, null, r.diag);
    assert.ok(r.first !== null && r.first < 25, 'primera imagen a los ' + r.first + ' s');
    assert.ok(r.stalled < 1, 'detenido ' + r.stalled + ' s ' + r.diag);
    // cada pedido seguido ya no se rechaza: el servidor suelta la conexión y la app espera ese momento
    assert.ok(s.stats.rejected <= 2, 'rechazados ' + s.stats.rejected);
  } finally {
    await s.close();
  }
});

test('Continuar viendo con el índice leído en segundo plano: un solo pedido de video y sin cortes', async () => {
  const file = makeMp4({ secs: 7200, audios: 5, vkbps: 850 });
  const s = await xui(file, { wait: 3500, rate: 1_500_000, max: 1 });
  try {
    H.rangeget.setLineMax(1);
    assert.equal(await H.mp4.preloadIndex(s.url).done, 'ok');
    const r = await H.openOnce(s.url, { at: 74 * 60, lineMax: 1, watch: 15 });
    assert.equal(r.err, null, r.diag);
    assert.ok(r.first !== null && r.first < 9, 'primera imagen a los ' + r.first + ' s ' + r.diag);
    assert.ok(r.stalled < 1, 'detenido ' + r.stalled + ' s');
  } finally {
    await s.close();
  }
});

test('cambiar de idioma con el índice entero: sale de lo ya bajado, sin pedir nada al servidor y casi sin detenerse', async () => {
  const file = makeMp4({ secs: 2700, audios: 2, vkbps: 1100 });
  const s = await xui(file, { wait: 3500, rate: 1_500_000, max: 1 });
  try {
    let reqs = 0;
    const act = { at: 15, run: m => { reqs = s.stats.requests; return m.switchAudio(1); } };
    const r = await H.openOnce(s.url, { at: 0, lineMax: 1, watch: 25, actions: [act] });
    assert.equal(r.err, null, r.diag);
    assert.equal(act.result, true, 'switchAudio');
    assert.ok(r.stalled - act.stalledBefore < 1.5, 'detenido al cambiar ' + (r.stalled - act.stalledBefore) + ' s');
    // (puede seguir bajando lo de más adelante; para el cambio no se volvió a pedir lo de los primeros segundos: ~15 s
    // de este video son ~2,5 MB)
    const from = x => Number((/bytes=(\d+)-/.exec(x.range) || [])[1]);
    const back = s.log.slice(reqs).filter(x => x.code === 206 && from(x) < 4 * 1048576);
    assert.equal(back.length, 0, JSON.stringify(back));
  } finally {
    await s.close();
  }
});

test('subtítulos de texto dentro del MP4 (tx3g): salen de lo ya bajado, sin servidor', async () => {
  const file = makeMp4({ secs: 1800, audios: 2, vkbps: 1100, subs: 1 });
  const s = await xui(file, { wait: 1500, rate: 2_000_000, max: 1 });
  try {
    let cues = null;
    let menu = null;
    const r = await H.openOnce(s.url, {
      at: 0, lineMax: 1, watch: 12,
      actions: [{ at: 2, run: m => { menu = m.subList(); cues = m.subCues(0); } }],
    });
    assert.equal(r.err, null, r.diag);
    assert.deepEqual(menu.map(x => x.codec + ':' + x.lang), ['tx3g:spa']);
    assert.ok(cues && cues.length >= 5, 'textos: ' + JSON.stringify(cues));
    // cada frase en su segundo (una cada 2 s), en orden
    const c = cues.find(x => x.text === 'línea 3');
    assert.ok(c && Math.abs(c.s - 6) < 0.01 && Math.abs(c.e - 8) < 0.01, JSON.stringify(c));
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i].s >= cues[i - 1].s);
  } finally {
    await s.close();
  }
});
