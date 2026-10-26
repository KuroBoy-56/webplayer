// Borrado de caché remoto: el panel manda en check_mac "cache_clear" = id de la orden más nueva para
// esta app y la app le dice con "cc" la última que ya aplicó. El id aplicado se guarda aparte
// (cache_clear_seen, por distribuidor) y el borrado nunca lo toca.
import { keys, read, remove, write } from './storage';
import { scoped } from './tenant';

const SEEN = 'cache_clear_seen';

export function cacheSeen(): number {
  return Number(read(scoped(SEEN))) || 0;
}

// saved '' = nada guardado (instalada de nuevo, datos borrados): una orden de los últimos 3 días (at = cuándo se
// envió, cache_clear_at; now = hora corregida con el panel) se aplica igual; una más vieja se guarda en silencio
export function cacheDecision(saved: string, got: number, at = 0, now = 0): 'save' | 'clear' | 'none' {
  if (saved === '') return got > 0 && at > 0 && now - at < 3 * 86400 ? 'clear' : 'save';
  return got > (Number(saved) || 0) ? 'clear' : 'none';
}

// "cache_clear" de la respuesta; true = hay que borrar y reiniciar (el id nuevo ya quedó guardado
// antes, para no repetirlo en bucle). Sin el campo (panel viejo) no se hace nada.
export function takeCacheOrder(value: unknown, at = 0, now = 0): boolean {
  if (value === undefined || value === null || value === '') return false;
  const got = Math.floor(Number(value));
  if (!Number.isFinite(got) || got < 0) return false;
  const d = cacheDecision(read(scoped(SEEN)), got, Math.floor(Number(at)) || 0, now);
  if (d !== 'none') write(scoped(SEEN), String(got));
  return d === 'clear';
}

// lo guardado que se vuelve a descargar (servidores del panel y clave TMDB, de todos los
// distribuidores) y la caché HTTP del navegador si la hay. Se quedan la sesión, el distribuidor,
// los ajustes, el PIN y cache_clear_seen.
// viendo un video la orden espera a que se salga del reproductor (no se corta la película)
let playing = false;
let waiting: (() => void) | null = null;
export function setPlayerOpen(open: boolean): void {
  playing = open;
  if (!open && waiting) {
    const run = waiting;
    waiting = null;
    run();
  }
}
export function whenNotPlaying(run: () => void): void {
  if (playing) waiting = run;
  else run();
}

export function clearStoredCache(): void {
  for (const k of keys()) if (/^(servers|tmdb_key)(@|$)/.test(k)) remove(k);
  try {
    const c = (globalThis as any).caches;
    c?.keys?.().then((ks: string[]) => ks.forEach(k => c.delete(k))).catch(() => {});
  } catch {
    // sin Cache Storage
  }
}
