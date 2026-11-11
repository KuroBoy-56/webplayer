// node tools/vod-sim/run.cjs [caso]: mide cuánto tarda en verse una película / capítulo con el lector de la app contra
// un servidor XUI simulado como el de los avisos (una conexión, 3,5 s por pedido). Sin red ni Vega.
const { makeMp4 } = require('./mp4gen.cjs');
const { xui } = require('./xui.cjs');
const H = require('./harness.cjs');

const CASES = {
  // capítulo de 45 min, 2 idiomas (el aviso «sin índice en 120 s»: 403 MB, mp4a eng + spa, índice al final)
  episodio: { file: { secs: 2700, audios: 2, vkbps: 1100 }, srv: { wait: 3500, rate: 1_500_000, max: 1 } },
  // película de 2 h con 5 idiomas (índice de ~9 MB), Continuar viendo en el minuto 74 s y desde el principio
  pelicula: { file: { secs: 7200, audios: 5, vkbps: 850 }, srv: { wait: 3500, rate: 1_500_000, max: 1 } },
  // película en alta calidad (5 Mbps) en la misma línea: que no se detenga
  hd: { file: { secs: 6000, audios: 2, vkbps: 5000 }, srv: { wait: 3500, rate: 2_000_000, max: 1 } },
  // el capítulo del aviso con un servidor que tarda 15 s en llegar al final del archivo (donde está el índice)
  lento: { file: { secs: 2700, audios: 2, vkbps: 1100 }, srv: { wait: 3500, rate: 1_500_000, max: 1, tailWait: 15000 } },
  // línea que admite 4 conexiones a la vez y servidor más rápido (no debe empeorar)
  cuatro: { file: { secs: 2700, audios: 2, vkbps: 2500 }, srv: { wait: 1500, rate: 3_000_000, max: 4 } },
};

async function run(name, { at = 0, again = false, shared = false, lineMax = 1, watch = 20 } = {}) {
  const c = CASES[name];
  const file = makeMp4(c.file);
  const s = await xui(file, c.srv);
  H.sharedBox.on = shared;
  try {
    const r = await H.openOnce(s.url, { at, lineMax, watch });
    const out = { caso: name, desde: at, primera_imagen_s: r.first, cortes_s: r.stalled, error: r.err, pedidos: s.stats.requests, rechazados: s.stats.rejected, MB: +(s.stats.bytes / 1048576).toFixed(1), indice_MB: +(file.moovLen / 1048576).toFixed(2) };
    console.log(JSON.stringify(out));
    console.log('   ' + r.diag);
    if (again) {
      const before = s.stats.requests;
      const r2 = await H.openOnce(s.url, { at: at + 30, lineMax, watch: 10 });
      console.log(JSON.stringify({ caso: name + ' (otra vez, Continuar viendo)', primera_imagen_s: r2.first, cortes_s: r2.stalled, error: r2.err, pedidos: s.stats.requests - before }));
    }
    return out;
  } finally {
    await s.close();
  }
}

(async () => {
  const only = process.argv[2];
  if (!only || only === 'episodio') await run('episodio', { at: 0, again: true });
  if (!only || only === 'pelicula') await run('pelicula', { at: 0 });
  if (!only || only === 'continuar') await run('pelicula', { at: 74 * 60 });
  if (!only || only === 'hd') await run('hd', { at: 0, watch: 60 });
  if (!only || only === 'lento') await run('lento', { at: 0 });
  if (!only || only === 'cuatro') await run('cuatro', { at: 600, lineMax: 4, watch: 30 });
  process.exit(0);
})();
